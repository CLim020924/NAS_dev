const assert = require('node:assert/strict');
const test = require('node:test');
const { createDeviceHeartbeatPersistence } = require('../deviceHeartbeatPersistence');

test('keeps heartbeat presence live while coalescing unchanged durable writes', () => {
  let clock = 1_000_000;
  const store = createDeviceHeartbeatPersistence({ persistIntervalMs: 300_000, now: () => clock });
  const original = { deviceId: 'dev-1', status: 'connected', syncState: 'up-to-date', lastSeenAt: 'first' };
  assert.equal(store.stage(original, { previousDevice: original }).persist, true);
  store.markPersisted([original]);

  clock += 15_000;
  const heartbeat = { ...original, lastSeenAt: 'second' };
  assert.equal(store.stage(heartbeat, { previousDevice: original }).persist, false);
  assert.equal(store.overlay([original])[0].lastSeenAt, 'second');

  clock += 1_000;
  const syncing = { ...heartbeat, syncState: 'syncing', lastSeenAt: 'syncing' };
  assert.equal(store.stage(syncing, { previousDevice: heartbeat }).persist, false);

  clock += 1_000;
  const emptyError = { ...syncing, syncState: 'error', lastError: '', lastSeenAt: 'empty-error' };
  assert.equal(store.stage(emptyError, { previousDevice: syncing }).persist, false);

  clock += 283_000;
  assert.equal(store.stage({ ...emptyError, lastSeenAt: 'third' }, { previousDevice: emptyError }).persist, true);
});

test('persists an actual connection state transition immediately', () => {
  let clock = 2_000_000;
  const store = createDeviceHeartbeatPersistence({ persistIntervalMs: 300_000, now: () => clock });
  const connected = { deviceId: 'dev-1', status: 'connected', syncState: 'up-to-date', lastSeenAt: 'first' };
  store.stage(connected, { previousDevice: connected });
  store.markPersisted([connected]);
  clock += 1_000;
  const failed = { ...connected, syncState: 'error', lastError: 'offline' };
  assert.equal(store.stage(failed, { previousDevice: connected }).persist, true);
  store.markPersisted([failed]);
  clock += 1_000;
  assert.equal(store.stage({ ...failed, lastError: 'offline at a newer timestamp' }, { previousDevice: failed }).persist, false);
});
