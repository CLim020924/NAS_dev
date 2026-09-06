const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const POLICY_VERSION = 1;
const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_SAMPLE_INTERVAL_MS = 30 * 1000;

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)));
const nowIso = () => new Date().toISOString();
const safeUserId = (user = {}) => String(user.userUid || user.loginId || user.id || user.username || '').trim();

const atomicWriteJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
};

const readJson = (filePath, fallback) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { return error.code === 'ENOENT' ? fallback : fallback; }
};

const defaultPolicy = () => ({
  version: POLICY_VERSION,
  mode: 'auto',
  enforcementEnabled: true,
  retentionDays: DEFAULT_RETENTION_DAYS,
  manual: {},
  userOverrides: {},
  updatedAt: nowIso(),
  updatedBy: 'system'
});

const calculateAutomaticPolicy = (metrics = {}, accountCount = 1) => {
  const logicalCores = Math.max(1, Number(metrics.cpu?.logicalCores || 1));
  const totalMemory = Math.max(512 * MIB, Number(metrics.memory?.totalBytes || 0));
  const userMemory = clamp(Math.floor(totalMemory * 0.15), 384 * MIB, 1024 * MIB);
  const reserveMemory = Math.max(1024 * MIB, Math.floor(totalMemory * 0.25));
  const hardReserveMemory = Math.max(768 * MIB, Math.floor(totalMemory * 0.15));
  const defaultConcurrent = Math.max(1, Math.min(2, Math.floor((totalMemory - reserveMemory) / userMemory), Math.floor(logicalCores / 4) || 1));
  const nasVolume = (metrics.disks?.volumes || []).find((volume) => volume.purpose === 'NAS 데이터');
  const diskTotal = Math.max(0, Number(nasVolume?.totalBytes || 0));
  return {
    source: 'auto',
    system: {
      cpuSoftPercent: 70,
      cpuHardPercent: 90,
      loadSoft: Math.round(logicalCores * 0.75 * 10) / 10,
      loadHard: Math.round(logicalCores * 1.0 * 10) / 10,
      minAvailableMemoryBytes: reserveMemory,
      hardMinAvailableMemoryBytes: hardReserveMemory,
      swapSoftPercent: 75,
      swapHardPercent: 90,
      temperatureSoftC: 75,
      temperatureHardC: 85,
      minNasFreeBytes: Math.max(10 * GIB, Math.floor(diskTotal * 0.05))
    },
    defaultUser: {
      cpuPercent: clamp(200 / logicalCores, 12.5, 50),
      memoryBytes: userMemory,
      maxConcurrentJobs: defaultConcurrent
    },
    detected: { logicalCores, totalMemoryBytes: totalMemory, accountCount: Math.max(0, Number(accountCount || 0)) }
  };
};

const normalizeManual = (manual = {}, automatic) => {
  const number = (key, fallback, min, max) => {
    const value = Number(manual[key]);
    return Number.isFinite(value) ? clamp(value, min, max) : fallback;
  };
  const memory = (key, fallback) => {
    const value = Number(manual[key]);
    return Number.isFinite(value) ? Math.floor(clamp(value, 256 * MIB, 1024 * GIB)) : fallback;
  };
  return {
    system: {
      cpuSoftPercent: number('cpuSoftPercent', automatic.system.cpuSoftPercent, 10, 95),
      cpuHardPercent: number('cpuHardPercent', automatic.system.cpuHardPercent, 20, 100),
      loadSoft: number('loadSoft', automatic.system.loadSoft, 0.1, 1024),
      loadHard: number('loadHard', automatic.system.loadHard, 0.2, 2048),
      minAvailableMemoryBytes: memory('minAvailableMemoryBytes', automatic.system.minAvailableMemoryBytes),
      hardMinAvailableMemoryBytes: memory('hardMinAvailableMemoryBytes', automatic.system.hardMinAvailableMemoryBytes),
      swapSoftPercent: number('swapSoftPercent', automatic.system.swapSoftPercent, 10, 99),
      swapHardPercent: number('swapHardPercent', automatic.system.swapHardPercent, 20, 100),
      temperatureSoftC: number('temperatureSoftC', automatic.system.temperatureSoftC, 30, 100),
      temperatureHardC: number('temperatureHardC', automatic.system.temperatureHardC, 40, 120),
      minNasFreeBytes: memory('minNasFreeBytes', automatic.system.minNasFreeBytes)
    },
    defaultUser: {
      cpuPercent: number('defaultUserCpuPercent', automatic.defaultUser.cpuPercent, 1, 100),
      memoryBytes: memory('defaultUserMemoryBytes', automatic.defaultUser.memoryBytes),
      maxConcurrentJobs: Math.floor(number('defaultUserMaxConcurrentJobs', automatic.defaultUser.maxConcurrentJobs, 1, 16))
    }
  };
};

const assertThresholdOrder = (effective) => {
  const { system } = effective;
  if (system.cpuSoftPercent >= system.cpuHardPercent) throw Object.assign(new Error('CPU 주의 임계값은 차단 임계값보다 작아야 합니다.'), { status: 400 });
  if (system.loadSoft >= system.loadHard) throw Object.assign(new Error('부하 주의 임계값은 차단 임계값보다 작아야 합니다.'), { status: 400 });
  if (system.hardMinAvailableMemoryBytes >= system.minAvailableMemoryBytes) throw Object.assign(new Error('메모리 차단 기준은 주의 기준보다 낮아야 합니다.'), { status: 400 });
  if (system.swapSoftPercent >= system.swapHardPercent) throw Object.assign(new Error('스왑 주의 임계값은 차단 임계값보다 작아야 합니다.'), { status: 400 });
  if (system.temperatureSoftC >= system.temperatureHardC) throw Object.assign(new Error('온도 주의 임계값은 차단 임계값보다 작아야 합니다.'), { status: 400 });
};

const getSwapPercent = (memory = {}) => {
  const total = Number(memory.swapTotalBytes || 0);
  return total > 0 ? Math.round((Number(memory.swapUsedBytes || 0) / total) * 1000) / 10 : 0;
};

const evaluateSystemPressure = (metrics = {}, effective = {}) => {
  const system = effective.system || {};
  const cpu = Number(metrics.cpu?.usagePercent || 0);
  const load = Number(metrics.cpu?.loadAverage?.[0] || 0);
  const availableMemory = Number(metrics.memory?.availableBytes || 0);
  const swap = getSwapPercent(metrics.memory);
  const maxTemperature = Math.max(0, ...(metrics.temperatures || []).map((item) => Number(item.value || 0)));
  const nasVolume = (metrics.disks?.volumes || []).find((volume) => volume.purpose === 'NAS 데이터');
  const free = Number(nasVolume?.freeBytes || 0);
  const hard = [];
  const soft = [];
  if (cpu >= system.cpuHardPercent) hard.push('CPU_HARD'); else if (cpu >= system.cpuSoftPercent) soft.push('CPU_SOFT');
  if (load >= system.loadHard) hard.push('LOAD_HARD'); else if (load >= system.loadSoft) soft.push('LOAD_SOFT');
  if (availableMemory <= system.hardMinAvailableMemoryBytes) hard.push('MEMORY_HARD'); else if (availableMemory <= system.minAvailableMemoryBytes) soft.push('MEMORY_SOFT');
  // Linux may keep cold pages in swap after RAM pressure has ended. Swap occupancy
  // alone is not current pressure, so combine it with the available-RAM guard.
  if (availableMemory <= system.minAvailableMemoryBytes) {
    if (swap >= system.swapHardPercent) hard.push('SWAP_HARD');
    else if (swap >= system.swapSoftPercent) soft.push('SWAP_SOFT');
  }
  if (maxTemperature >= system.temperatureHardC) hard.push('TEMPERATURE_HARD'); else if (maxTemperature >= system.temperatureSoftC) soft.push('TEMPERATURE_SOFT');
  if (free > 0 && free <= system.minNasFreeBytes) hard.push('DISK_RESERVE');
  return { state: hard.length ? 'blocked' : soft.length ? 'queued' : 'available', hardReasons: hard, softReasons: soft, swapUsedPercent: swap, maxTemperatureC: maxTemperature };
};

const createResourceControlService = ({ dataDir, collectMetrics, getUsers, getStorageSummary, sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS }) => {
  if (!dataDir || typeof collectMetrics !== 'function' || typeof getUsers !== 'function') throw new Error('resource control dependencies are required');
  const policyPath = path.join(dataDir, 'resource_policy.json');
  const historyRoot = path.join(dataDir, 'resource_usage_history');
  const reservations = new Map();
  const storageSnapshots = new Map();
  let timer = null;
  let lastMetrics = null;
  let lastSampleAt = '';
  let sampling = false;

  const readPolicy = () => ({ ...defaultPolicy(), ...readJson(policyPath, {}) });
  const effectivePolicy = (metrics = lastMetrics || {}, users = getUsers()) => {
    const stored = readPolicy();
    const automatic = calculateAutomaticPolicy(metrics, users.length);
    if (stored.mode !== 'manual') return { ...automatic, mode: 'auto', enforcementEnabled: stored.enforcementEnabled !== false, retentionDays: stored.retentionDays || DEFAULT_RETENTION_DAYS, userOverrides: stored.userOverrides || {}, updatedAt: stored.updatedAt, updatedBy: stored.updatedBy };
    const manual = normalizeManual(stored.manual, automatic);
    const effective = { source: 'manual', mode: 'manual', enforcementEnabled: stored.enforcementEnabled !== false, retentionDays: stored.retentionDays || DEFAULT_RETENTION_DAYS, userOverrides: stored.userOverrides || {}, updatedAt: stored.updatedAt, updatedBy: stored.updatedBy, detected: automatic.detected, ...manual };
    assertThresholdOrder(effective);
    return effective;
  };

  const userLimit = (user, effective) => {
    const userUid = safeUserId(user);
    const override = effective.userOverrides?.[userUid] || {};
    return {
      cpuPercent: clamp(Number(override.cpuPercent ?? effective.defaultUser.cpuPercent), 1, 100),
      memoryBytes: Math.floor(clamp(Number(override.memoryBytes ?? effective.defaultUser.memoryBytes), 256 * MIB, 1024 * GIB)),
      maxConcurrentJobs: Math.floor(clamp(Number(override.maxConcurrentJobs ?? effective.defaultUser.maxConcurrentJobs), 1, 16))
    };
  };

  const usageFor = (userUid) => [...reservations.values()].filter((item) => item.userUid === userUid).reduce((total, item) => ({ cpuPercent: total.cpuPercent + item.cpuPercent, memoryBytes: total.memoryBytes + item.memoryBytes, activeJobs: total.activeJobs + 1 }), { cpuPercent: 0, memoryBytes: 0, activeJobs: 0 });
  const globalUsage = () => [...reservations.values()].reduce((total, item) => ({ cpuPercent: total.cpuPercent + item.cpuPercent, memoryBytes: total.memoryBytes + item.memoryBytes, activeJobs: total.activeJobs + 1 }), { cpuPercent: 0, memoryBytes: 0, activeJobs: 0 });

  const usersSnapshot = (metrics = lastMetrics || {}, { refreshStorage = false } = {}) => {
    const users = getUsers();
    const effective = effectivePolicy(metrics, users);
    return users.map((user) => {
      const userUid = safeUserId(user);
      if ((refreshStorage || !storageSnapshots.has(userUid)) && typeof getStorageSummary === 'function') {
        storageSnapshots.set(userUid, getStorageSummary(user));
      }
      const storage = storageSnapshots.get(userUid) || {};
      return {
        userUid,
        loginId: String(user.loginId || user.id || user.username || ''),
        displayName: String(user.displayName || user.nickname || user.loginId || user.id || ''),
        storage: { usedBytes: Number(storage.usedBytes || 0), quotaBytes: Number(storage.quotaBytes || user.storageQuotaBytes || 0) },
        managed: usageFor(userUid),
        limits: userLimit(user, effective)
      };
    });
  };

  const historyFile = (date = new Date()) => path.join(historyRoot, `${date.toISOString().slice(0, 10)}.jsonl`);
  const cleanupHistory = (retentionDays) => {
    fs.mkdirSync(historyRoot, { recursive: true, mode: 0o700 });
    const cutoff = Date.now() - clamp(retentionDays, 1, 365) * 86400 * 1000;
    for (const name of fs.readdirSync(historyRoot)) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
      const date = Date.parse(name.slice(0, 10));
      if (Number.isFinite(date) && date < cutoff) fs.rmSync(path.join(historyRoot, name), { force: true });
    }
  };

  const capture = async ({ includeUsers = false } = {}) => {
    const metrics = await collectMetrics();
    lastMetrics = metrics;
    const effective = effectivePolicy(metrics);
    const pressure = evaluateSystemPressure(metrics, effective);
    const record = {
      collectedAt: metrics.collectedAt || nowIso(),
      system: {
        cpuPercent: Number(metrics.cpu?.usagePercent || 0),
        load1: Number(metrics.cpu?.loadAverage?.[0] || 0),
        memoryUsedBytes: Number(metrics.memory?.usedBytes || 0),
        memoryAvailableBytes: Number(metrics.memory?.availableBytes || 0),
        swapUsedPercent: pressure.swapUsedPercent,
        maxTemperatureC: pressure.maxTemperatureC,
        nasFreeBytes: Number((metrics.disks?.volumes || []).find((item) => item.purpose === 'NAS 데이터')?.freeBytes || 0),
        gateState: effective.enforcementEnabled ? pressure.state : 'monitor-only',
        reasons: [...pressure.hardReasons, ...pressure.softReasons]
      }
    };
    if (includeUsers) record.users = usersSnapshot(metrics, { refreshStorage: true });
    fs.mkdirSync(historyRoot, { recursive: true, mode: 0o700 });
    fs.appendFileSync(historyFile(), `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
    cleanupHistory(effective.retentionDays);
    lastSampleAt = record.collectedAt;
    return { metrics, effective, pressure, record };
  };

  const start = () => {
    if (timer) return;
    let sequence = 0;
    const tick = async () => {
      if (sampling) return;
      sampling = true;
      try { await capture({ includeUsers: sequence++ % 4 === 0 }); }
      catch (error) { console.error('[resource-control] sample failed', error.message); }
      finally { sampling = false; }
    };
    tick();
    timer = setInterval(tick, Math.max(5000, sampleIntervalMs));
    timer.unref?.();
  };

  const stop = () => { if (timer) clearInterval(timer); timer = null; };

  const updatePolicy = (input = {}, actor = 'manager') => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('자원 보호 정책 형식이 올바르지 않습니다.'), { status: 400 });
    if (input.manual !== undefined && (!input.manual || typeof input.manual !== 'object' || Array.isArray(input.manual))) throw Object.assign(new Error('수동 임계값 형식이 올바르지 않습니다.'), { status: 400 });
    if (input.userOverrides !== undefined && !Array.isArray(input.userOverrides)) throw Object.assign(new Error('사용자별 제한은 배열이어야 합니다.'), { status: 400 });
    const current = readPolicy();
    const mode = input.mode === undefined ? current.mode : String(input.mode);
    if (!['auto', 'manual'].includes(mode)) throw Object.assign(new Error('정책 모드는 auto 또는 manual이어야 합니다.'), { status: 400 });
    const allowedUserIds = new Set(getUsers().map(safeUserId));
    const overrides = input.userOverrides === undefined ? (current.userOverrides || {}) : {};
    if (Array.isArray(input.userOverrides)) {
      for (const row of input.userOverrides) {
        const userUid = String(row.userUid || '').trim();
        if (!allowedUserIds.has(userUid)) throw Object.assign(new Error('존재하지 않는 사용자의 자원 제한입니다.'), { status: 400 });
        const cpuPercent = Number(row.cpuPercent);
        const memoryBytes = Number(row.memoryBytes);
        const maxConcurrentJobs = Number(row.maxConcurrentJobs);
        if (!Number.isFinite(cpuPercent) || !Number.isFinite(memoryBytes) || !Number.isFinite(maxConcurrentJobs)) {
          throw Object.assign(new Error('사용자별 CPU, 메모리, 동시 작업 제한은 숫자여야 합니다.'), { status: 400 });
        }
        overrides[userUid] = {
          cpuPercent: clamp(cpuPercent, 1, 100),
          memoryBytes: Math.floor(clamp(memoryBytes, 256 * MIB, 1024 * GIB)),
          maxConcurrentJobs: Math.floor(clamp(maxConcurrentJobs, 1, 16))
        };
      }
    }
    const next = {
      version: POLICY_VERSION,
      mode,
      enforcementEnabled: input.enforcementEnabled === undefined ? current.enforcementEnabled !== false : !!input.enforcementEnabled,
      retentionDays: Math.floor(clamp(input.retentionDays ?? current.retentionDays ?? DEFAULT_RETENTION_DAYS, 1, 365)),
      manual: input.manual === undefined ? (current.manual || {}) : { ...input.manual },
      userOverrides: overrides,
      updatedAt: nowIso(),
      updatedBy: String(actor || 'manager').slice(0, 120)
    };
    const effective = next.mode === 'manual'
      ? { ...normalizeManual(next.manual, calculateAutomaticPolicy(lastMetrics || {}, getUsers().length)), mode: 'manual' }
      : calculateAutomaticPolicy(lastMetrics || {}, getUsers().length);
    assertThresholdOrder(effective);
    atomicWriteJson(policyPath, next);
    return { policy: next, effective: effectivePolicy(lastMetrics || {}) };
  };

  const normalizeRequestedResources = (requested = {}) => {
    const cpuPercent = Number(requested.cpuPercent || 0);
    const memoryBytes = Number(requested.memoryBytes || 0);
    if (!Number.isFinite(cpuPercent) || !Number.isFinite(memoryBytes) || cpuPercent < 0 || memoryBytes < 0) {
      throw Object.assign(new Error('요청 자원은 0 이상의 숫자여야 합니다.'), { status: 400 });
    }
    return { cpuPercent: clamp(cpuPercent, 0, 100), memoryBytes: Math.floor(memoryBytes) };
  };

  const evaluateAdmission = ({ user, requested = {}, metrics = lastMetrics || {} }) => {
    const effective = effectivePolicy(metrics);
    const pressure = evaluateSystemPressure(metrics, effective);
    const userUid = safeUserId(user);
    if (!userUid) throw Object.assign(new Error('사용자 식별자가 필요합니다.'), { status: 400 });
    const limits = userLimit(user, effective);
    const current = usageFor(userUid);
    const global = globalUsage();
    const { cpuPercent, memoryBytes } = normalizeRequestedResources(requested);
    const violations = [];
    if (current.cpuPercent + cpuPercent > limits.cpuPercent) violations.push('USER_CPU_LIMIT');
    if (current.memoryBytes + memoryBytes > limits.memoryBytes) violations.push('USER_MEMORY_LIMIT');
    if (current.activeJobs + 1 > limits.maxConcurrentJobs) violations.push('USER_CONCURRENCY_LIMIT');
    const globalHard = [];
    const globalSoft = [];
    const projectedCpu = global.cpuPercent + cpuPercent;
    const totalMemory = Number(metrics.memory?.totalBytes || effective.detected?.totalMemoryBytes || 0);
    const projectedMemory = global.memoryBytes + memoryBytes;
    if (projectedCpu > effective.system.cpuHardPercent) globalHard.push('GLOBAL_CPU_RESERVE_HARD');
    else if (projectedCpu > effective.system.cpuSoftPercent) globalSoft.push('GLOBAL_CPU_RESERVE_SOFT');
    if (totalMemory > 0) {
      if (projectedMemory > totalMemory - effective.system.hardMinAvailableMemoryBytes) globalHard.push('GLOBAL_MEMORY_RESERVE_HARD');
      else if (projectedMemory > totalMemory - effective.system.minAvailableMemoryBytes) globalSoft.push('GLOBAL_MEMORY_RESERVE_SOFT');
    }
    if (!effective.enforcementEnabled) return { state: 'available', reasons: [], observedReasons: [...violations, ...globalHard, ...globalSoft, ...pressure.hardReasons, ...pressure.softReasons], limits, current, global, monitorOnly: true };
    if (violations.length) return { state: 'blocked', reasons: violations, limits, current };
    if (globalHard.length) return { state: 'blocked', reasons: globalHard, limits, current, global };
    if (globalSoft.length) return { state: 'queued', reasons: globalSoft, limits, current, global };
    if (pressure.state !== 'available') return { state: pressure.state, reasons: [...pressure.hardReasons, ...pressure.softReasons], limits, current };
    return { state: 'available', reasons: [], limits, current, global };
  };

  const reserve = ({ jobId = crypto.randomUUID(), user, requested = {}, metrics = lastMetrics || {} }) => {
    const admission = evaluateAdmission({ user, requested, metrics });
    if (admission.state !== 'available') return { ...admission, jobId: null };
    const resources = normalizeRequestedResources(requested);
    const reservation = { jobId, userUid: safeUserId(user), ...resources, createdAt: nowIso() };
    reservations.set(jobId, reservation);
    return { ...admission, jobId, reservation };
  };

  const release = (jobId) => reservations.delete(String(jobId || ''));

  const readHistory = ({ from, to, userUid = '', limit = 1000 } = {}) => {
    const end = to ? Date.parse(to) : Date.now();
    const start = from ? Date.parse(from) : end - 24 * 60 * 60 * 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 31 * 86400 * 1000) throw Object.assign(new Error('조회 기간은 최대 31일입니다.'), { status: 400 });
    const rows = [];
    const firstDay = new Date(start);
    firstDay.setUTCHours(0, 0, 0, 0);
    for (let cursor = firstDay; cursor.getTime() <= end; cursor = new Date(cursor.getTime() + 86400 * 1000)) {
      const filePath = historyFile(cursor);
      if (!fs.existsSync(filePath)) continue;
      for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        if (!line) continue;
        try {
          const row = JSON.parse(line);
          const time = Date.parse(row.collectedAt);
          if (time < start || time > end) continue;
          if (userUid) {
            const user = (row.users || []).find((item) => item.userUid === userUid);
            if (user) rows.push({ collectedAt: row.collectedAt, user, system: row.system });
          } else rows.push(row);
        } catch {}
      }
    }
    const max = Math.floor(clamp(limit, 1, 5000));
    if (rows.length <= max) return rows;
    const step = rows.length / max;
    return Array.from({ length: max }, (_, index) => rows[Math.floor(index * step)]);
  };

  const dashboard = async (metrics) => {
    if (metrics) lastMetrics = metrics;
    if (!lastMetrics) lastMetrics = await collectMetrics();
    const effective = effectivePolicy(lastMetrics);
    return {
      policy: readPolicy(),
      effective,
      pressure: evaluateSystemPressure(lastMetrics, effective),
      users: usersSnapshot(lastMetrics),
      measurement: { cpuMemoryScope: 'managed-jobs-only', storageScope: 'personal-root', sampleIntervalSeconds: Math.max(5, sampleIntervalMs / 1000), lastSampleAt }
    };
  };

  return { start, stop, capture, dashboard, updatePolicy, readHistory, evaluateAdmission, reserve, release, getEffectivePolicy: effectivePolicy };
};

module.exports = { createResourceControlService, calculateAutomaticPolicy, evaluateSystemPressure, _test: { normalizeManual, assertThresholdOrder, getSwapPercent } };
