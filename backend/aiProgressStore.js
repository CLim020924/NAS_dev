const crypto = require('crypto');

const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_STEPS = 12;
const progressByRequest = new Map();

const userKey = (user = {}) => String(user.userUid || user.uid || user.id || user.loginId || user.username || '');
const validRequestId = (requestId) => (
  typeof requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
);
const keyFor = (user, requestId) => `${userKey(user)}:${requestId}`;

const prune = () => {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [key, value] of progressByRequest.entries()) {
    if (new Date(value.updatedAt).getTime() < cutoff) progressByRequest.delete(key);
  }
};

const snapshot = (value) => value ? JSON.parse(JSON.stringify(value)) : null;

const startProgress = (user, requestId) => {
  if (!userKey(user) || !validRequestId(requestId)) return null;
  prune();
  const now = new Date().toISOString();
  const value = {
    requestId,
    state: 'running',
    phase: 'validating',
    title: '요청을 안전하게 확인하고 있습니다',
    detail: '계정 권한과 요청 범위를 검사합니다.',
    progress: 8,
    toolCompleted: 0,
    steps: [{ phase: 'validating', title: '요청 확인', status: 'active', at: now }],
    updatedAt: now,
  };
  progressByRequest.set(keyFor(user, requestId), value);
  return snapshot(value);
};

const updateProgress = (user, requestId, patch = {}) => {
  if (!validRequestId(requestId)) return null;
  const key = keyFor(user, requestId);
  const current = progressByRequest.get(key);
  if (!current) return null;
  const now = new Date().toISOString();
  const steps = current.steps.map((step) => step.status === 'active' ? { ...step, status: 'done' } : step);
  const nextStepTitle = String(patch.stepTitle || patch.title || '').trim();
  if (nextStepTitle) {
    const previous = steps[steps.length - 1];
    if (!previous || previous.phase !== patch.phase || previous.title !== nextStepTitle) {
      steps.push({ phase: patch.phase || current.phase, title: nextStepTitle, status: patch.state === 'failed' ? 'failed' : 'active', at: now });
    } else {
      previous.status = patch.state === 'failed' ? 'failed' : 'active';
      previous.at = now;
    }
  }
  const value = {
    ...current,
    ...patch,
    progress: Math.max(current.progress || 0, Math.min(100, Number(patch.progress ?? current.progress ?? 0))),
    steps: steps.slice(-MAX_STEPS),
    updatedAt: now,
  };
  delete value.stepTitle;
  progressByRequest.set(key, value);
  return snapshot(value);
};

const getProgress = (user, requestId) => {
  prune();
  if (!validRequestId(requestId)) return null;
  return snapshot(progressByRequest.get(keyFor(user, requestId)));
};

const finishProgress = (user, requestId, patch = {}) => updateProgress(user, requestId, {
  state: 'completed', phase: 'completed', title: '요청 처리가 끝났습니다', detail: '최종 답변을 표시합니다.',
  progress: 100, stepTitle: '완료', ...patch,
});

const failProgress = (user, requestId, message = '') => updateProgress(user, requestId, {
  state: 'failed', phase: 'failed', title: '요청 처리를 마치지 못했습니다',
  detail: String(message || '오류 내용을 확인해 주세요.').slice(0, 240), progress: 100, stepTitle: '중단됨',
});

const createRequestId = () => crypto.randomUUID();

module.exports = {
  startProgress,
  updateProgress,
  getProgress,
  finishProgress,
  failProgress,
  createRequestId,
  _test: { validRequestId, userKey, progressByRequest, prune },
};
