const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { getDownloader, requireDownloadLogin } = require('../shareDownloadPolicy');

const secret = 'share-download-policy-test';
const token = jwt.sign({ userUid: 'u-1', sessionId: 's-1', loginId: 'alice' }, secret);
const member = { userUid: 'u-1', loginId: 'alice', activeSessions: [{ sessionId: 's-1' }] };

test('new links require a valid active NAS login for download', () => {
  assert.equal(requireDownloadLogin({ downloadRequiresLogin: true }, null), true);
  assert.equal(requireDownloadLogin({ downloadRequiresLogin: true }, getDownloader(token, secret, () => member)), false);
  assert.equal(getDownloader(token, secret, () => ({ ...member, activeSessions: [] })), null);
  assert.equal(getDownloader(token, secret, () => ({ ...member, disabled: true })), null);
  assert.equal(getDownloader(jwt.sign({ userUid: 'u-1' }, secret), secret, () => member), null);
  assert.equal(getDownloader('invalid', secret, () => member), null);
});

test('legacy links remain public and anonymous without a session', () => {
  assert.equal(requireDownloadLogin({}, null), false);
  assert.equal(requireDownloadLogin({ downloadRequiresLogin: false }, null), false);
});
