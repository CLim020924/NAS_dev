const crypto = require('crypto');

const RETENTION_MS = 10 * 60_000;

const createExecutionQueueService = ({ pollIntervalMs = 750 } = {}) => {
  const jobs = new Map();
  const pending = [];
  let timer = null;
  let pumping = false;
  let lastOwnerKey = '';

  const snapshot = (job) => ({
    jobId: job.id,
    state: job.state,
    language: job.language,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    position: job.state === 'queued' ? pending.indexOf(job.id) + 1 : 0,
    reasons: job.reasons || [],
    error: job.error || '',
    session: job.session || null,
  });

  const schedule = (delay = 0) => {
    if (timer) return;
    timer = setTimeout(() => { timer = null; pump(); }, delay);
    timer.unref?.();
  };

  const finish = (job, state = 'finished') => {
    if (!job || ['finished', 'failed', 'cancelled'].includes(job.state)) return;
    job.state = state;
    job.finishedAt = new Date().toISOString();
    job.resourceControl?.release(job.reservationId);
    job.reservationId = '';
    schedule();
  };

  const isTransientUserLimit = (admission, requested) => {
    const reasons = admission.reasons || [];
    if (!reasons.length || !reasons.every((reason) => ['USER_CPU_LIMIT', 'USER_MEMORY_LIMIT', 'USER_CONCURRENCY_LIMIT'].includes(reason))) return false;
    return Number(requested.cpuPercent || 0) <= Number(admission.limits?.cpuPercent || 0)
      && Number(requested.memoryBytes || 0) <= Number(admission.limits?.memoryBytes || 0);
  };

  const chooseNext = () => {
    const rows = pending.map((id) => jobs.get(id)).filter(Boolean);
    return rows.find((job) => job.ownerKey !== lastOwnerKey) || rows[0] || null;
  };

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    try {
      const job = chooseNext();
      if (!job) return;
      const admission = job.resourceControl.reserve({ jobId: `code-queue:${job.id}`, user: job.user, requested: job.requested });
      job.reasons = admission.reasons || [];
      if (admission.state !== 'available') {
        if (admission.state === 'blocked' && !isTransientUserLimit(admission, job.requested)) {
          pending.splice(pending.indexOf(job.id), 1);
          job.state = 'blocked';
          job.finishedAt = new Date().toISOString();
          job.error = '현재 사용자 또는 서버 자원 보호 기준으로 실행이 차단되었습니다.';
        }
        return;
      }
      pending.splice(pending.indexOf(job.id), 1);
      job.state = 'starting';
      job.startedAt = new Date().toISOString();
      job.reservationId = admission.jobId;
      lastOwnerKey = job.ownerKey;
      try {
        job.session = await job.start({
          onFinish: () => finish(job, job.session?.state === 'failed' ? 'failed' : 'finished'),
          reservationId: admission.jobId,
        });
        job.state = job.session?.state === 'running' ? 'running' : (job.session?.state || 'running');
      } catch (error) {
        job.error = error.message || '실행을 시작하지 못했습니다.';
        finish(job, 'failed');
      }
    } finally {
      pumping = false;
      if (pending.length) schedule(pollIntervalMs);
    }
  };

  const submit = ({ ownerKey, language, user, requested, resourceControl, start, getSession, stop }) => {
    if (!ownerKey || !resourceControl || typeof start !== 'function') throw new Error('execution queue dependencies are required');
    const job = {
      id: crypto.randomUUID(), ownerKey, language, user, requested, resourceControl, start, getSession, stop,
      state: 'queued', createdAt: new Date().toISOString(), reasons: [], error: '', session: null,
    };
    jobs.set(job.id, job);
    pending.push(job.id);
    schedule();
    return snapshot(job);
  };

  const get = ({ ownerKey, jobId }) => {
    const job = jobs.get(String(jobId || ''));
    if (!job || job.ownerKey !== ownerKey) throw Object.assign(new Error('실행 대기 작업을 찾을 수 없습니다.'), { status: 404, code: 'EXECUTION_JOB_NOT_FOUND' });
    if (job.state === 'running' && job.session?.sessionId) {
      try {
        const latest = job.getSession?.(job.session.sessionId);
        if (latest) job.session = latest;
      } catch {}
    }
    return snapshot(job);
  };

  const cancel = async ({ ownerKey, jobId }) => {
    const job = jobs.get(String(jobId || ''));
    if (!job || job.ownerKey !== ownerKey) throw Object.assign(new Error('실행 대기 작업을 찾을 수 없습니다.'), { status: 404 });
    if (job.state === 'queued') {
      const index = pending.indexOf(job.id);
      if (index >= 0) pending.splice(index, 1);
      finish(job, 'cancelled');
    } else if (['starting', 'running'].includes(job.state) && job.stop) {
      await job.stop(job.session?.sessionId);
      finish(job, 'cancelled');
    }
    return snapshot(job);
  };

  const cleanup = () => {
    const cutoff = Date.now() - RETENTION_MS;
    for (const [id, job] of jobs) {
      if (job.finishedAt && new Date(job.finishedAt).getTime() < cutoff) jobs.delete(id);
    }
  };
  const cleanupTimer = setInterval(cleanup, 60_000);
  cleanupTimer.unref?.();

  return { submit, get, cancel, finish, cleanup, _pump: pump };
};

module.exports = { createExecutionQueueService };
