'use strict';

const crypto = require('crypto');

const sessions = new Map();
const DESKTOP_WEB_SESSION_TTL_MS = 45 * 1000;

const tokenHash = (token) => crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');

const normalizeNextPath = (value) => {
  const requested = String(value || '/nas').trim();
  if (requested === '/nas' || requested.startsWith('/nas?')) return requested;
  if (requested === '/platform' || requested.startsWith('/platform?')) return requested;
  return '/nas';
};

const cleanupExpired = () => {
  const now = Date.now();
  for (const [hash, session] of sessions.entries()) {
    if (!session || session.expiresAt <= now) sessions.delete(hash);
  }
};

const createDesktopWebSession = ({ deviceId, ownerKey, userUid, loginId, next }) => {
  cleanupExpired();
  const token = `desktop_${crypto.randomBytes(32).toString('base64url')}`;
  sessions.set(tokenHash(token), {
    deviceId: String(deviceId || ''),
    ownerKey: String(ownerKey || ''),
    userUid: String(userUid || ''),
    loginId: String(loginId || ''),
    next: normalizeNextPath(next),
    issuedAt: Date.now(),
    expiresAt: Date.now() + DESKTOP_WEB_SESSION_TTL_MS
  });
  return { token, expiresInMs: DESKTOP_WEB_SESSION_TTL_MS };
};

const consumeDesktopWebSession = (token) => {
  cleanupExpired();
  const hash = tokenHash(token);
  const session = sessions.get(hash);
  sessions.delete(hash);
  if (!session || session.expiresAt <= Date.now()) return null;
  return { ...session };
};

module.exports = {
  DESKTOP_WEB_SESSION_TTL_MS,
  createDesktopWebSession,
  consumeDesktopWebSession,
  normalizeNextPath
};
