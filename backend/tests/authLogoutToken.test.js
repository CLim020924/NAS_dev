const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { verifySignedLogoutToken } = require('../authLogoutToken');

test('logout verifies the signature while accepting an expired session token', () => {
  const secret = 'logout-test-secret-with-enough-entropy';
  const token = jwt.sign({ userUid: 'user-1', sessionId: 'session-1' }, secret, { expiresIn: -1 });
  const decoded = verifySignedLogoutToken(token, secret);
  assert.equal(decoded.userUid, 'user-1');
  assert.equal(decoded.sessionId, 'session-1');
});

test('logout never trusts a token signed with another secret', () => {
  const token = jwt.sign({ userUid: 'user-1', sessionId: 'session-1' }, 'wrong-secret');
  assert.equal(verifySignedLogoutToken(token, 'expected-secret'), null);
});
