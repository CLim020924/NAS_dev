const test = require('node:test');
const assert = require('node:assert/strict');
const { createExecutionQueueService } = require('../executionQueueService');

const waitFor = async (predicate, timeoutMs = 500) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test('queued execution starts after admission and releases its reservation on completion', async () => {
  const released = [];
  const resourceControl = {
    reserve: ({ jobId }) => ({ state: 'available', jobId }),
    release: (jobId) => released.push(jobId),
  };
  let finish;
  const queue = createExecutionQueueService({ pollIntervalMs: 5 });
  const submitted = queue.submit({
    ownerKey: 'user-1', language: 'python', user: { userUid: 'user-1' }, requested: { cpuPercent: 10, memoryBytes: 1 }, resourceControl,
    start: async ({ onFinish }) => { finish = onFinish; return { sessionId: 'session-1', state: 'running' }; },
  });
  await waitFor(() => queue.get({ ownerKey: 'user-1', jobId: submitted.jobId }).state === 'running');
  finish();
  assert.equal(queue.get({ ownerKey: 'user-1', jobId: submitted.jobId }).state, 'finished');
  assert.equal(released.length, 1);
});
