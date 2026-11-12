'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;
const AGENT_TOKEN_ROTATE_AFTER_MS = 30 * DAY_MS;
const AGENT_TOKEN_EXPIRES_AFTER_MS = 90 * DAY_MS;
const AGENT_TOKEN_PREVIOUS_GRACE_MS = 7 * DAY_MS;

const parseTime = (value) => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const tokenMetadataPatch = (now = Date.now()) => ({
  agentTokenIssuedAt: new Date(now).toISOString(),
  agentTokenExpiresAt: new Date(now + AGENT_TOKEN_EXPIRES_AFTER_MS).toISOString()
});

const authenticateAgentTokenHash = ({ device = {}, presentedHash = '', secureEquals, now = Date.now() }) => {
  if (!presentedHash || typeof secureEquals !== 'function') return null;
  const currentMatches = device.agentTokenHash && secureEquals(device.agentTokenHash, presentedHash);
  if (currentMatches) {
    const expiresAt = parseTime(device.agentTokenExpiresAt);
    if (expiresAt && expiresAt <= now) return null;
    return { slot: 'current', legacy: !parseTime(device.agentTokenIssuedAt), expiresAt };
  }

  const previousMatches = device.previousAgentTokenHash
    && secureEquals(device.previousAgentTokenHash, presentedHash);
  if (!previousMatches) return null;
  const previousExpiresAt = parseTime(device.previousAgentTokenExpiresAt);
  if (!previousExpiresAt || previousExpiresAt <= now) return null;
  return { slot: 'previous', legacy: false, expiresAt: previousExpiresAt };
};

const shouldRotateAgentToken = (device = {}, auth = {}, now = Date.now()) => {
  if (!auth || auth.legacy) return false;
  if (auth.slot === 'previous') return true;
  const issuedAt = parseTime(device.agentTokenIssuedAt);
  const expiresAt = parseTime(device.agentTokenExpiresAt);
  return !issuedAt || !expiresAt
    || now - issuedAt >= AGENT_TOKEN_ROTATE_AFTER_MS
    || expiresAt - now <= AGENT_TOKEN_PREVIOUS_GRACE_MS;
};

const initializeLegacyAgentTokenMetadata = (device = {}, now = Date.now()) => {
  if (parseTime(device.agentTokenIssuedAt) && parseTime(device.agentTokenExpiresAt)) return device;
  return { ...device, ...tokenMetadataPatch(now) };
};

const rotateAgentTokenRecord = ({ device = {}, nextTokenHash, authenticatedHash, now = Date.now() }) => ({
  ...device,
  previousAgentTokenHash: authenticatedHash,
  previousAgentTokenExpiresAt: new Date(now + AGENT_TOKEN_PREVIOUS_GRACE_MS).toISOString(),
  agentTokenHash: nextTokenHash,
  ...tokenMetadataPatch(now)
});

const clearAgentTokenRecord = (device = {}) => ({
  ...device,
  agentTokenHash: null,
  agentTokenIssuedAt: null,
  agentTokenExpiresAt: null,
  previousAgentTokenHash: null,
  previousAgentTokenExpiresAt: null
});

module.exports = {
  AGENT_TOKEN_ROTATE_AFTER_MS,
  AGENT_TOKEN_EXPIRES_AFTER_MS,
  AGENT_TOKEN_PREVIOUS_GRACE_MS,
  authenticateAgentTokenHash,
  shouldRotateAgentToken,
  initializeLegacyAgentTokenMetadata,
  rotateAgentTokenRecord,
  clearAgentTokenRecord,
  tokenMetadataPatch
};
