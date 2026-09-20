const DAY_MS = 24 * 60 * 60 * 1000;

const sessionExpiryMs = (session = {}) => {
  const explicit = Date.parse(session.expiresAt || '');
  if (Number.isFinite(explicit)) return explicit;
  // Older records have no expiresAt. Use the latest recorded activity to avoid
  // expiring a token that was renewed when the persistence setting changed.
  const issued = Date.parse(session.issuedAt || '');
  const seen = Date.parse(session.lastSeenAt || '');
  const base = Math.max(Number.isFinite(issued) ? issued : 0, Number.isFinite(seen) ? seen : 0);
  return base ? base + (session.persistent ? 30 : 1) * DAY_MS : Infinity;
};

const classifySessions = (sessions = [], connectedSessionIds = [], now = Date.now()) => {
  const connected = new Set(connectedSessionIds);
  const valid = sessions.filter((session) => session.sessionId && sessionExpiryMs(session) > now);
  return {
    valid,
    onlineCount: valid.filter((session) => connected.has(session.sessionId)).length,
    offlineCount: valid.filter((session) => !connected.has(session.sessionId)).length,
    removedCount: sessions.length - valid.length
  };
};

module.exports = { DAY_MS, sessionExpiryMs, classifySessions };
