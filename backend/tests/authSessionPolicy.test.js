const test = require('node:test');
const assert = require('node:assert/strict');
const { DAY_MS, sessionExpiryMs, classifySessions } = require('../authSessionPolicy');

test('offline persistent login remains valid but is not called online', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const oldSession = { sessionId: 'old', persistent: true, issuedAt: new Date(now - 2 * DAY_MS).toISOString() };
  const result = classifySessions([oldSession], [], now);
  assert.equal(result.onlineCount, 0);
  assert.equal(result.offlineCount, 1);
  assert.equal(result.removedCount, 0);
});

test('expired records do not trigger a concurrent-login warning', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const expired = { sessionId: 'old', persistent: false, issuedAt: new Date(now - 2 * DAY_MS).toISOString() };
  const result = classifySessions([expired], [], now);
  assert.deepEqual(result, { valid: [], onlineCount: 0, offlineCount: 0, removedCount: 1 });
});

test('explicit renewed expiry wins over an old issue time', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const renewed = { sessionId: 'renewed', issuedAt: new Date(now - 31 * DAY_MS).toISOString(), expiresAt: new Date(now + DAY_MS).toISOString() };
  assert.ok(sessionExpiryMs(renewed) > now);
  assert.equal(classifySessions([renewed], ['renewed'], now).onlineCount, 1);
});

test('legacy renewal activity is preserved without a recorded expiry', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const renewed = { sessionId: 'legacy', persistent: true, issuedAt: new Date(now - 31 * DAY_MS).toISOString(), lastSeenAt: new Date(now - DAY_MS).toISOString() };
  assert.equal(classifySessions([renewed], [], now).offlineCount, 1);
});

test('two devices of one account are reported separately by connection state', () => {
  const now = Date.parse('2026-09-20T12:00:00Z');
  const expiresAt = new Date(now + DAY_MS).toISOString();
  const result = classifySessions([
    { sessionId: 'online', expiresAt },
    { sessionId: 'powered-off', expiresAt }
  ], ['online'], now);
  assert.equal(result.onlineCount, 1);
  assert.equal(result.offlineCount, 1);
  assert.equal(result.valid.length, 2);
});
