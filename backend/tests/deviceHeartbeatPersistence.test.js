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

  clock += 285_000;
  assert.equal(store.stage({ ...heartbeat, lastSeenAt: 'third' }, { previousDevice: heartbeat }).persist, true);
});

test('persists an actual connection state transition immediately', () => {
  let clock = 2_000_000;
  const store = createDeviceHeartbeatPersistence({ persistIntervalMs: 300_000, now: () => clock });
  const connected = { deviceId: 'dev-1', status: 'connected', syncState: 'up-to-date', lastSeenAt: 'first' };
  store.stage(connected, { previousDevice: connected });
  store.markPersisted([connected]);
  clock += 1_000;
  assert.equal(store.stage({ ...connected, syncState: 'error', lastError: 'offline' }, { previousDevice: connected }).persist, true);
});
