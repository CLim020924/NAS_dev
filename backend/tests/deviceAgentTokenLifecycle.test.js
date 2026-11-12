'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  AGENT_TOKEN_ROTATE_AFTER_MS,
  AGENT_TOKEN_EXPIRES_AFTER_MS,
  AGENT_TOKEN_PREVIOUS_GRACE_MS,
  authenticateAgentTokenHash,
  shouldRotateAgentToken,
  initializeLegacyAgentTokenMetadata,
  rotateAgentTokenRecord,
  clearAgentTokenRecord,
  tokenMetadataPatch
} = require('../deviceAgentTokenLifecycle');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const secureEquals = (left, right) => left === right;
const now = Date.UTC(2026, 10, 13, 0, 0, 0);

const currentToken = hash('current');
const previousToken = hash('previous');
const metadata = tokenMetadataPatch(now);
assert.strictEqual(new Date(metadata.agentTokenExpiresAt).getTime() - now, AGENT_TOKEN_EXPIRES_AFTER_MS);

const current = {
  agentTokenHash: currentToken,
  ...metadata
};
assert.deepStrictEqual(
  authenticateAgentTokenHash({ device: current, presentedHash: currentToken, secureEquals, now }),
  { slot: 'current', legacy: false, expiresAt: new Date(metadata.agentTokenExpiresAt).getTime() }
);
assert.strictEqual(authenticateAgentTokenHash({ device: current, presentedHash: hash('wrong'), secureEquals, now }), null);
assert.strictEqual(shouldRotateAgentToken(current, { slot: 'current', legacy: false }, now), false);
assert.strictEqual(shouldRotateAgentToken(current, { slot: 'current', legacy: false }, now + AGENT_TOKEN_ROTATE_AFTER_MS), true);

const legacy = initializeLegacyAgentTokenMetadata({ agentTokenHash: currentToken }, now);
assert.strictEqual(legacy.agentTokenHash, currentToken);
assert.ok(legacy.agentTokenIssuedAt);
assert.ok(legacy.agentTokenExpiresAt);

const rotated = rotateAgentTokenRecord({
  device: current,
  nextTokenHash: hash('next'),
  authenticatedHash: currentToken,
  now
});
assert.strictEqual(rotated.previousAgentTokenHash, currentToken);
assert.strictEqual(new Date(rotated.previousAgentTokenExpiresAt).getTime() - now, AGENT_TOKEN_PREVIOUS_GRACE_MS);
assert.strictEqual(authenticateAgentTokenHash({ device: rotated, presentedHash: currentToken, secureEquals, now })?.slot, 'previous');
assert.strictEqual(authenticateAgentTokenHash({ device: rotated, presentedHash: currentToken, secureEquals, now: now + AGENT_TOKEN_PREVIOUS_GRACE_MS }), null);
assert.strictEqual(shouldRotateAgentToken(rotated, { slot: 'previous', legacy: false }, now), true);

const expired = { ...current, agentTokenExpiresAt: new Date(now - 1).toISOString() };
assert.strictEqual(authenticateAgentTokenHash({ device: expired, presentedHash: currentToken, secureEquals, now }), null);

const cleared = clearAgentTokenRecord({ ...rotated, status: 'connected' });
assert.strictEqual(cleared.agentTokenHash, null);
assert.strictEqual(cleared.previousAgentTokenHash, null);
assert.strictEqual(cleared.agentTokenExpiresAt, null);
assert.strictEqual(cleared.status, 'connected');

console.log('device agent token lifecycle tests passed');
