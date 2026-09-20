const jwt = require('jsonwebtoken');

const getDownloader = (token, secret, findMember) => {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, secret);
    const member = findMember(decoded);
    if (!member || member.disabled || !decoded.sessionId) return null;
    if (!(
      (Array.isArray(member.activeSessions) && member.activeSessions.some((session) => session.sessionId === decoded.sessionId)) ||
      (!Array.isArray(member.activeSessions) && member.activeSessionId === decoded.sessionId)
    )) return null;
    return {
      userUid: String(member.userUid || ''),
      loginId: String(member.loginId || member.id || decoded.loginId || decoded.id || ''),
      displayName: String(member.displayName || member.nickname || member.loginId || decoded.loginId || '')
    };
  } catch {
    return null;
  }
};

const requireDownloadLogin = (share, downloader) => share.downloadRequiresLogin === true && !downloader;

module.exports = { getDownloader, requireDownloadLogin };
