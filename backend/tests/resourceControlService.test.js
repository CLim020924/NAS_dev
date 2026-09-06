const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createResourceControlService, calculateAutomaticPolicy, evaluateSystemPressure } = require('../resourceControlService');

const GIB = 1024 * 1024 * 1024;
const metrics = (overrides = {}) => ({
  collectedAt: new Date().toISOString(),
  cpu: { logicalCores: 8, usagePercent: 20, loadAverage: [0.5, 0.4, 0.3], ...(overrides.cpu || {}) },
  memory: { totalBytes: 6 * GIB, usedBytes: 2 * GIB, availableBytes: 4 * GIB, swapTotalBytes: GIB, swapUsedBytes: 100 * 1024 * 1024, ...(overrides.memory || {}) },
  disks: overrides.disks || { volumes: [{ purpose: 'NAS 데이터', totalBytes: 2 * 1024 * GIB, freeBytes: 1500 * GIB }] },
  temperatures: overrides.temperatures || [{ source: 'cpu', label: 'Tctl', value: 45 }]
});

const withService = async (run) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-resource-control-'));
  const users = [{ userUid: 'u-1', loginId: 'alpha', displayName: 'Alpha', storageQuotaBytes: 20 * GIB }];
  let currentMetrics = metrics();
  const service = createResourceControlService({
    dataDir,
    collectMetrics: async () => currentMetrics,
    getUsers: () => users,
    getStorageSummary: () => ({ usedBytes: 3 * GIB, quotaBytes: 20 * GIB }),
    sampleIntervalMs: 5000
  });
  try { await run({ service, users, setMetrics: (next) => { currentMetrics = next; }, dataDir }); }
  finally { service.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); }
};

test('queues burst work at the global reservation safety line', () => withService(async ({ service, users }) => {
  const secondUser = { userUid: 'u-2', loginId: 'beta', storageQuotaBytes: 20 * GIB };
  users.push(secondUser);
  await service.dashboard(metrics());
  const first = service.reserve({ user: users[0], requested: { cpuPercent: 25, memoryBytes: 512 * 1024 * 1024 }, metrics: metrics() });
  const second = service.reserve({ user: secondUser, requested: { cpuPercent: 25, memoryBytes: 512 * 1024 * 1024 }, metrics: metrics() });
  const thirdUser = { userUid: 'u-3', loginId: 'gamma', storageQuotaBytes: 20 * GIB };
  users.push(thirdUser);
  const third = service.reserve({ user: thirdUser, requested: { cpuPercent: 25, memoryBytes: 512 * 1024 * 1024 }, metrics: metrics() });
  assert.equal(first.state, 'available');
  assert.equal(second.state, 'available');
  assert.equal(third.state, 'queued');
  assert.ok(third.reasons.includes('GLOBAL_CPU_RESERVE_SOFT'));
  service.release(first.jobId);
  service.release(second.jobId);
}));

test('derives conservative automatic limits from detected hardware', () => {
  const policy = calculateAutomaticPolicy(metrics(), 5);
  assert.equal(policy.detected.logicalCores, 8);
  assert.equal(policy.defaultUser.cpuPercent, 25);
  assert.ok(policy.defaultUser.memoryBytes >= 384 * 1024 * 1024);
  assert.ok(policy.system.minAvailableMemoryBytes > policy.system.hardMinAvailableMemoryBytes);
  assert.equal(policy.system.minNasFreeBytes, Math.floor(102.4 * GIB));
});

test('classifies soft pressure as queued and hard pressure as blocked', () => {
  const policy = calculateAutomaticPolicy(metrics(), 1);
  assert.equal(evaluateSystemPressure(metrics({ cpu: { logicalCores: 8, usagePercent: 75, loadAverage: [1, 1, 1] } }), policy).state, 'queued');
  assert.equal(evaluateSystemPressure(metrics({ memory: { totalBytes: 6 * GIB, usedBytes: 5.5 * GIB, availableBytes: 0.5 * GIB, swapTotalBytes: GIB, swapUsedBytes: GIB } }), policy).state, 'blocked');
  assert.equal(evaluateSystemPressure(metrics({ memory: { totalBytes: 6 * GIB, usedBytes: 2 * GIB, availableBytes: 4 * GIB, swapTotalBytes: GIB, swapUsedBytes: GIB } }), policy).state, 'available');
});

test('persists validated manager policy and rejects invalid threshold order', () => withService(async ({ service }) => {
  await service.dashboard(metrics());
  const saved = service.updatePolicy({
    mode: 'manual',
    manual: { cpuSoftPercent: 60, cpuHardPercent: 85, minAvailableMemoryBytes: 2 * GIB, hardMinAvailableMemoryBytes: GIB }
  }, 'manager-1');
  assert.equal(saved.policy.mode, 'manual');
  assert.equal(saved.effective.system.cpuHardPercent, 85);
  assert.throws(() => service.updatePolicy({ mode: 'manual', manual: { cpuSoftPercent: 90, cpuHardPercent: 80 } }, 'manager-1'), /CPU 주의/);
}));

test('enforces per-user CPU, memory and concurrency reservations', () => withService(async ({ service, users }) => {
  await service.dashboard(metrics());
  service.updatePolicy({ userOverrides: [{ userUid: 'u-1', cpuPercent: 40, memoryBytes: GIB, maxConcurrentJobs: 1 }] }, 'manager-1');
  const first = service.reserve({ user: users[0], requested: { cpuPercent: 20, memoryBytes: 512 * 1024 * 1024 }, metrics: metrics() });
  assert.equal(first.state, 'available');
  const second = service.reserve({ user: users[0], requested: { cpuPercent: 10, memoryBytes: 128 * 1024 * 1024 }, metrics: metrics() });
  assert.equal(second.state, 'blocked');
  assert.ok(second.reasons.includes('USER_CONCURRENCY_LIMIT'));
  assert.equal(service.release(first.jobId), true);
  assert.equal(service.reserve({ user: users[0], requested: { cpuPercent: 50, memoryBytes: 512 * 1024 * 1024 }, metrics: metrics() }).state, 'blocked');
  assert.throws(() => service.reserve({ user: users[0], requested: { cpuPercent: 'invalid' }, metrics: metrics() }), /0 이상의 숫자/);
}));

test('records system and user history without credentials or file paths', () => withService(async ({ service, dataDir }) => {
  const captured = await service.capture({ includeUsers: true });
  const rows = service.readHistory({ from: new Date(Date.now() - 60000).toISOString(), to: new Date(Date.now() + 60000).toISOString() });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].users[0].userUid, 'u-1');
  assert.equal(rows[0].users[0].storage.usedBytes, 3 * GIB);
  const raw = fs.readFileSync(path.join(dataDir, 'resource_usage_history', `${captured.record.collectedAt.slice(0, 10)}.jsonl`), 'utf8');
  assert.equal(raw.includes('password'), false);
  assert.equal(raw.includes('/users/'), false);
}));

test('monitor-only mode records violations without blocking managed work', () => withService(async ({ service, users }) => {
  await service.dashboard(metrics());
  service.updatePolicy({
    enforcementEnabled: false,
    userOverrides: [{ userUid: 'u-1', cpuPercent: 1, memoryBytes: 256 * 1024 * 1024, maxConcurrentJobs: 1 }]
  }, 'manager-1');
  const admission = service.evaluateAdmission({ user: users[0], requested: { cpuPercent: 50, memoryBytes: GIB }, metrics: metrics({ cpu: { logicalCores: 8, usagePercent: 99 } }) });
  assert.equal(admission.state, 'available');
  assert.equal(admission.monitorOnly, true);
  assert.ok(admission.observedReasons.includes('USER_CPU_LIMIT'));
  assert.ok(admission.observedReasons.includes('CPU_HARD'));
}));
