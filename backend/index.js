const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const config = require('./config/env');
const http = require('http');           
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { runMessageRetentionCleanup } = require('./chatRetentionEngine');
const { createNotification } = require('./notificationStore');
const {
  createMessage: createStoredChatMessage,
  createMeetingConversation,
  getConversationById,
  getConversationRole,
  getMeetingConversationByRoomCode,
  listAllConversationsForMeetingSearch,
  listConversationsForUser,
  requestConversationJoin,
  upsertConversationParticipant,
  updateMeetingConversationSettings
} = require('./chatStore');
const {
  DEFAULT_USER_QUOTA_BYTES,
  normalizeQuotaFields,
  getUserStorageSummary
} = require('./storageQuota');
const { getAiStatus } = require('./services/aiService');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});
app.set('io', io);

const JWT_SECRET = config.JWT_SECRET;
const nasPath = config.NAS_ROOT;
// 서버 시작 시 루트 백업 폴더 생성
const systemBackupPath = config.NAS_BACKUP_PATH;
if (!fs.existsSync(systemBackupPath)) fs.mkdirSync(systemBackupPath, { recursive: true });
 

app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

const FRONTEND_BUILD_PATH = config.FRONTEND_BUILD_PATH;
app.use(express.static(FRONTEND_BUILD_PATH));

// 데이터 로드
const membersFilePath = path.join(__dirname, 'data', 'members.json');
const requestsFilePath = path.join(__dirname, 'data', 'requests.json');
let signupRequests = [];
let approvedUsers = [];

const nowIso = () => new Date().toISOString();
const generateUserUid = () => {
  if (typeof crypto.randomUUID === 'function') {
    return `usr_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `usr_${crypto.randomBytes(16).toString('hex')}`;
};

const generateSessionId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return `sess_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `sess_${crypto.randomBytes(24).toString('hex')}`;
};

const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none'
};

const CLEAR_AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none'
};

const PERSISTENT_AUTH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_DISCONNECT_LOGOUT_MS = config.SESSION_DISCONNECT_LOGOUT_MS;
const SHARED_COOKIE_DOMAIN = config.COOKIE_DOMAIN;

const isHttpsRequest = (req) =>
  req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

const getRequestHostname = (req) =>
  String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .split(':')[0]
    .toLowerCase();

const shouldUseSharedCookieDomain = (req) => {
  const hostname = getRequestHostname(req);
  return hostname === config.APP_DOMAIN || hostname.endsWith(config.COOKIE_DOMAIN);
};

const getAuthCookieOptions = (req, persistent = false) => {
  const options = {
    ...AUTH_COOKIE_OPTIONS,
    secure: isHttpsRequest(req),
    sameSite: isHttpsRequest(req) ? 'none' : 'lax'
  };
  if (isHttpsRequest(req) && shouldUseSharedCookieDomain(req)) {
    options.domain = SHARED_COOKIE_DOMAIN;
  }
  if (persistent) options.maxAge = PERSISTENT_AUTH_COOKIE_MAX_AGE_MS;
  return options;
};

const getClearAuthCookieOptions = (req) => {
  const options = {
    ...CLEAR_AUTH_COOKIE_OPTIONS,
    secure: isHttpsRequest(req),
    sameSite: isHttpsRequest(req) ? 'none' : 'lax'
  };
  if (isHttpsRequest(req) && shouldUseSharedCookieDomain(req)) {
    options.domain = SHARED_COOKIE_DOMAIN;
  }
  return options;
};

const normalizeActiveSession = (session = {}) => ({
  sessionId: String(session.sessionId || '').trim(),
  deviceId: String(session.deviceId || '').trim(),
  issuedAt: session.issuedAt || nowIso(),
  lastSeenAt: session.lastSeenAt || session.issuedAt || nowIso(),
  persistent: !!session.persistent
});

const getUserActiveSessions = (user = {}) => {
  const sessions = Array.isArray(user.activeSessions)
    ? user.activeSessions
    : [];
  const normalized = sessions
    .map(normalizeActiveSession)
    .filter((session) => session.sessionId);

  if (!normalized.length && user.activeSessionId) {
    normalized.push(normalizeActiveSession({
      sessionId: user.activeSessionId,
      deviceId: user.activeSessionDeviceId || '',
      issuedAt: user.activeSessionIssuedAt || nowIso(),
      lastSeenAt: user.activeSessionIssuedAt || nowIso(),
      persistent: !!user.loginPersistenceEnabled
    }));
  }

  return normalized;
};

const setUserActiveSessions = (user, sessions = []) => {
  const normalized = sessions
    .map(normalizeActiveSession)
    .filter((session) => session.sessionId);
  user.activeSessions = normalized;
  const primary = normalized[normalized.length - 1];
  user.activeSessionId = primary?.sessionId || '';
  user.activeSessionIssuedAt = primary?.issuedAt || '';
  user.activeSessionDeviceId = primary?.deviceId || '';
  return normalized;
};

const addUserActiveSession = (user, session) => {
  const nextSession = normalizeActiveSession(session);
  const sessions = getUserActiveSessions(user)
    .filter((item) => item.sessionId !== nextSession.sessionId);
  sessions.push(nextSession);
  return setUserActiveSessions(user, sessions);
};

const removeUserActiveSession = (user, sessionId) => {
  const safeSessionId = String(sessionId || '').trim();
  const sessions = getUserActiveSessions(user)
    .filter((item) => item.sessionId !== safeSessionId);
  return setUserActiveSessions(user, sessions);
};

const findUserActiveSession = (user, sessionId) =>
  getUserActiveSessions(user).find((session) => session.sessionId === sessionId);

const updateUserSessionPersistence = (user, sessionId, persistent) => {
  const sessions = getUserActiveSessions(user).map((session) =>
    session.sessionId === sessionId
      ? { ...session, persistent: !!persistent, lastSeenAt: nowIso() }
      : session
  );
  return setUserActiveSessions(user, sessions);
};


const getUserLoginId = (user = {}) => user.loginId || user.id || '';
const getUserRole = (user = {}) => user.role || (user.Masters ? 'MASTER' : (user.Managers ? 'MANAGER' : 'USER'));
const normalizeNickname = (value) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 24);
const nicknameKey = (value) => normalizeNickname(value).toLocaleLowerCase('ko-KR');
const isNicknameTaken = (nickname, excludeUserUid = '') => {
  const key = nicknameKey(nickname);
  if (!key) return false;
  return [...approvedUsers, ...signupRequests].some((user) =>
    user.userUid !== excludeUserUid && nicknameKey(user.nickname || user.displayName) === key
  );
};

const normalizeApprovedUser = (user = {}) => {
  const loginId = (user.loginId || user.id || '').trim();
  const normalized = { ...user };

  normalized.userUid = user.userUid || generateUserUid();
  normalized.loginId = loginId;
  normalized.id = loginId;
  normalized.username = user.username || loginId;
  normalized.nickname = normalizeNickname(user.nickname || user.displayName || loginId);
  normalized.displayName = normalized.nickname;
  normalized.profile = (user.profile && typeof user.profile === 'object') ? user.profile : {};
  normalized.role = getUserRole(user);
  normalized.status = user.status || (user.disabled ? 'DISABLED' : 'ACTIVE');
  normalized.createdAt = user.createdAt || user.date || nowIso();
  normalized.approvedAt = user.approvedAt || user.createdAt || user.date || nowIso();
  normalized.disabled = !!user.disabled;
  normalized.globalAccess = !!user.globalAccess;
  normalized.isPasswordEnabled = !!user.isPasswordEnabled;
  normalized.loginPersistenceEnabled = !!user.loginPersistenceEnabled;
  normalized.activeSessions = getUserActiveSessions(user);
  normalized.activeSessionId = user.activeSessionId || '';
  normalized.activeSessionIssuedAt = user.activeSessionIssuedAt || '';
  normalized.activeSessionDeviceId = user.activeSessionDeviceId || '';
  setUserActiveSessions(normalized, normalized.activeSessions);

  return normalizeQuotaFields(normalized);
};

const normalizeSignupRequest = (user = {}) => {
  const loginId = (user.loginId || user.id || '').trim();
  const normalized = { ...user };

  normalized.userUid = user.userUid || generateUserUid();
  normalized.loginId = loginId;
  normalized.id = loginId;
  normalized.username = user.username || loginId;
  normalized.nickname = normalizeNickname(user.nickname || user.displayName || loginId);
  normalized.displayName = normalized.nickname;
  normalized.profile = (user.profile && typeof user.profile === 'object') ? user.profile : {};
  normalized.status = 'PENDING';
  normalized.requestedAt = user.requestedAt || user.createdAt || user.date || nowIso();
  normalized.createdAt = user.createdAt || user.date || nowIso();

  return normalized;
};

const findApprovedUserByAnyId = (value) =>
  approvedUsers.find(u => [u.userUid, u.loginId, u.id, u.username].filter(Boolean).includes(value));

const findSignupRequestByAnyId = (value) =>
  signupRequests.find(u => [u.userUid, u.loginId, u.id, u.username].filter(Boolean).includes(value));

const saveMembers = () => {
  approvedUsers = approvedUsers.map(normalizeApprovedUser);
  fs.writeFileSync(membersFilePath, JSON.stringify(approvedUsers, null, 2));
};
const saveRequests = () => fs.writeFileSync(requestsFilePath, JSON.stringify(signupRequests, null, 2));

function loadData() {
  try {
    if (fs.existsSync(membersFilePath)) {
      const raw = JSON.parse(fs.readFileSync(membersFilePath, 'utf8'));
      approvedUsers = Array.isArray(raw) ? raw.map(normalizeApprovedUser) : [];
    } else {
      approvedUsers = [
        normalizeApprovedUser({
          id: 'admin',
          password: '1234567890',
          Masters: true,
          Managers: true,
          disabled: false,
          globalAccess: true,
          rootPassword: '',
          masterKey: 'admin1234',
          role: 'MASTER'
        })
      ];
      saveMembers();
    }
  } catch (e) {
    approvedUsers = [
      normalizeApprovedUser({
        id: 'admin',
        password: '1234567890',
        Masters: true,
        Managers: true,
        globalAccess: true,
        role: 'MASTER'
      })
    ];
    saveMembers();
  }

  try {
    if (fs.existsSync(requestsFilePath)) {
      const raw = JSON.parse(fs.readFileSync(requestsFilePath, 'utf8'));
      signupRequests = Array.isArray(raw) ? raw.map(normalizeSignupRequest) : [];
    } else {
      signupRequests = [];
    }
  } catch (e) {
    signupRequests = [];
  }

  saveMembers();
  saveRequests();
}
loadData();

const runChatRetentionSafely = (reason = 'manual') => {
  try {
    const result = runMessageRetentionCleanup();
    console.log(`[chat-retention] ${reason}`, result);
  } catch (err) {
    console.error(`[chat-retention] ${reason} failed:`, err.message);
  }
};

runChatRetentionSafely('startup');
setInterval(() => runChatRetentionSafely('interval_1h'), 60 * 60 * 1000);

// 라우터 연결
const nasRoutes = require('./nasRoutes');
const friendsRoutes = require('./friendsRoutes');
const notificationsRoutes = require('./notificationsRoutes');
const chatRoutes = require('./chatRoutes');
const chatAttachmentRoutes = require('./chatAttachmentRoutes');
const shareRoutes = require('./shareRoutes');
const aiAgentRoutes = require('./aiAgentRoutes');

const publicApiPaths = new Set([
  '/login',
  '/signup-request',
  '/onlyoffice/callback',
  '/onlyoffice/file'
]);

const getTokenFromRequest = (req) => req.cookies?.token;

const getAuthenticatedUserFromRequest = (req) => {
  const token = getTokenFromRequest(req);
  if (!token) return null;

  const decoded = jwt.verify(token, JWT_SECRET);
  if (isTokenSessionReplaced(decoded)) {
    const err = new Error('SESSION_REPLACED');
    err.code = 'SESSION_REPLACED';
    throw err;
  }

  return findApprovedUserByAnyId(decoded.userUid || decoded.loginId || decoded.id || decoded.username);
};

const requireManager = (req, res, next) => {
  try {
    const user = getAuthenticatedUserFromRequest(req);
    const role = getUserRole(user || {});
    if (!user || (role !== 'MASTER' && role !== 'MANAGER' && !user.Masters && !user.Managers)) {
      return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
    }
    req.authUser = user;
    return next();
  } catch (err) {
    if (err.code === 'SESSION_REPLACED') {
      res.clearCookie('token', getClearAuthCookieOptions(req));
      return res.status(401).json({
        error: 'SESSION_REPLACED',
        message: '다른 기기에서 로그인되어 현재 세션이 종료되었습니다.'
      });
    }
    return res.status(401).json({ error: '로그인 필요' });
  }
};

const isTokenSessionReplaced = (decoded) => {
  const target = findApprovedUserByAnyId(decoded.userUid || decoded.loginId || decoded.id || decoded.username);
  if (!target) return true;
  if (target.disabled) return true;

  if (decoded.sessionId && !findUserActiveSession(target, decoded.sessionId)) {
    return true;
  }

  return false;
};

const enforceSingleActiveSession = (req, res, next) => {
  if (publicApiPaths.has(req.path)) return next();

  const token = getTokenFromRequest(req);
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (isTokenSessionReplaced(decoded)) {
      res.clearCookie('token', getClearAuthCookieOptions(req));
      return res.status(401).json({
        error: 'SESSION_REPLACED',
        message: '다른 기기에서 로그인되어 현재 세션이 종료되었습니다.'
      });
    }
  } catch (err) {
    // 토큰 만료/손상은 각 라우터의 기존 인증 로직에서 처리
  }

  next();
};

app.get('/api/auth/session', (req, res) => {
  const token = getTokenFromRequest(req);
  if (!token) return res.status(401).json({ error: '로그인 필요' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (isTokenSessionReplaced(decoded)) {
      res.clearCookie('token', getClearAuthCookieOptions(req));
      return res.status(401).json({
        error: 'SESSION_REPLACED',
        message: '다른 기기에서 로그인되어 현재 세션이 종료되었습니다.'
      });
    }

    const user = findApprovedUserByAnyId(decoded.userUid || decoded.loginId || decoded.id || decoded.username);
    return res.json({
      success: true,
      sessionId: decoded.sessionId || '',
      user: user ? {
        ...user,
        currentSessionId: decoded.sessionId || ''
      } : null,
      preferences: {
        loginPersistenceEnabled: !!user?.loginPersistenceEnabled
      }
    });
  } catch (err) {
    res.clearCookie('token', getClearAuthCookieOptions(req));
    return res.status(401).json({ error: '토큰 만료' });
  }
});

app.post('/api/logout', (req, res) => {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = findApprovedUserByAnyId(decoded.userUid || decoded.loginId || decoded.id || decoded.username);
      const timerKey = `${getUserLoginId(user || {})}:${decoded.sessionId || ''}`;
      const logoutTimer = sessionLogoutTimers.get(timerKey);
      if (logoutTimer) clearTimeout(logoutTimer);
      sessionLogoutTimers.delete(timerKey);
      if (user) {
        removeUserActiveSession(user, decoded.sessionId || '');
        saveMembers();
      }
    } catch (err) {
      // An invalid or expired token still needs its browser cookie cleared.
    }
  }

  res.clearCookie('token', getClearAuthCookieOptions(req));
  return res.json({ success: true });
});

app.use('/api', enforceSingleActiveSession);

app.get('/api/user/preferences', (req, res) => {
  try {
    const user = getAuthenticatedUserFromRequest(req);
    if (!user) return res.status(401).json({ error: '로그인 필요' });
    return res.json({
      loginPersistenceEnabled: !!user.loginPersistenceEnabled
    });
  } catch (err) {
    if (err.code === 'SESSION_REPLACED') {
      res.clearCookie('token', getClearAuthCookieOptions(req));
      return res.status(401).json({ error: 'SESSION_REPLACED' });
    }
    return res.status(401).json({ error: '로그인 필요' });
  }
});

app.patch('/api/user/preferences', (req, res) => {
  try {
    const token = getTokenFromRequest(req);
    if (!token) return res.status(401).json({ error: '로그인 필요' });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (isTokenSessionReplaced(decoded)) {
      res.clearCookie('token', getClearAuthCookieOptions(req));
      return res.status(401).json({ error: 'SESSION_REPLACED' });
    }

    const user = findApprovedUserByAnyId(decoded.userUid || decoded.loginId || decoded.id || decoded.username);
    if (!user) return res.status(401).json({ error: '로그인 필요' });

    const loginPersistenceEnabled = !!req.body.loginPersistenceEnabled;
    user.loginPersistenceEnabled = loginPersistenceEnabled;
    updateUserSessionPersistence(user, decoded.sessionId || '', loginPersistenceEnabled);
    saveMembers();

    const { iat, exp, nbf, ...renewPayload } = decoded;
    const renewedToken = jwt.sign({
      ...renewPayload,
      persistent: loginPersistenceEnabled
    }, JWT_SECRET, { expiresIn: loginPersistenceEnabled ? '30d' : '1d' });

    res.cookie('token', renewedToken, getAuthCookieOptions(req, loginPersistenceEnabled));
    return res.json({ success: true, loginPersistenceEnabled });
  } catch (err) {
    res.clearCookie('token', getClearAuthCookieOptions(req));
    return res.status(401).json({ error: '로그인 필요' });
  }
});

app.use('/api', nasRoutes);
app.use('/api', friendsRoutes);
app.use('/api', notificationsRoutes);
app.use('/api', chatRoutes);
app.use('/api', chatAttachmentRoutes);
app.use('/api', shareRoutes);
app.use('/api', aiAgentRoutes);

app.get('/api/ai/status', (req, res) => {
  const status = getAiStatus();
  res.json({
    provider: status.provider,
    model: status.model,
    enabled: status.enabled,
    configured: status.configured,
  });
});

// --- API 영역 ---

// 💾 [공간 동기화] 절대 경로 기반 아이콘 데이터베이스
const iconDataPath = path.join(__dirname, 'data', 'icon_positions.json');
let globalIcons = {};
try { if (fs.existsSync(iconDataPath)) globalIcons = JSON.parse(fs.readFileSync(iconDataPath, 'utf8')); } catch(e){}

// 🗺️ 상대 경로 -> 절대 경로 번역기
const getAbsPath = (user, reqPath) => {
  const isPrivileged = user.Masters || user.globalAccess;
  const loginId = user.loginId || user.id;
  let relativeRoot = user.rootPath ? user.rootPath.replace(/^(\/|\\)+/, '') : path.join('users', loginId);
  const basePath = isPrivileged ? nasPath : path.resolve(nasPath, relativeRoot);
  const safeReqPath = (reqPath || '').replace(/^(\/|\\)+/, '');
  return path.resolve(basePath, safeReqPath);
};

// 📥 [GET] 각자의 시점에 맞게 번역된 아이콘 좌표 내려주기
app.get('/api/icons', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json({});
  try {
    const user = jwt.verify(token, JWT_SECRET);
    const result = {};
    const isPrivileged = user.Masters || user.globalAccess;
    const basePath = isPrivileged ? nasPath : path.resolve(nasPath, user.rootPath ? user.rootPath.replace(/^(\/|\\)+/, '') : path.join('users', user.id));

    // DB에 있는 모든 절대 경로를 뒤져서, 이 유저가 볼 수 있는 파일만 상대경로로 변환
    for (const [absFilePath, pos] of Object.entries(globalIcons)) {
      if (absFilePath.startsWith(basePath)) {
         let relPath = absFilePath.substring(basePath.length).replace(/\\/g, '/');
         if (!relPath.startsWith('/')) relPath = '/' + relPath;
         result[relPath] = pos;
      }
    }
    res.json(result);
  } catch (e) { res.json({}); }
});




// [로그인]
app.post('/api/login', (req, res) => {
  const { id, password } = req.body;
  const loginId = (id || '').trim();
  const user = approvedUsers.find(u => getUserLoginId(u) === loginId && u.password === password);

  if (!user) return res.status(401).json({ error: '아이디/비번이 틀렸습니다.' });
  if (user.disabled) return res.status(403).json({ error: '비활성화된 계정입니다.' });

  // Legacy accounts receive a stable nickname on their first login after migration.
  if (!normalizeNickname(user.nickname)) user.nickname = loginId;
  user.displayName = user.nickname;

  const role = getUserRole(user);
  const loginIdForToken = getUserLoginId(user);
  const sessionId = generateSessionId();
  const deviceId = String(req.body.deviceId || req.headers['x-device-id'] || '').trim();
  const sessionConflictAction = String(req.body.sessionConflictAction || '').trim();
  const existingSessions = getUserActiveSessions(user);

  if (existingSessions.length > 0 && !['allow', 'replace'].includes(sessionConflictAction)) {
    return res.status(409).json({
      code: 'ACTIVE_SESSION_EXISTS',
      error: '이미 로그인되어 있는 계정입니다.',
      message: '이미 로그인되어 있는 계정입니다. 이 기기에서도 로그인할지 선택해주세요.',
      activeSessionCount: existingSessions.length
    });
  }

  if (sessionConflictAction === 'replace') {
    existingSessions.forEach((session) => {
      const timerKey = `${loginIdForToken}:${session.sessionId}`;
      const logoutTimer = sessionLogoutTimers.get(timerKey);
      if (logoutTimer) clearTimeout(logoutTimer);
      sessionLogoutTimers.delete(timerKey);
      [...io.sockets.sockets.values()].forEach((connectedSocket) => {
        if (connectedSocket.userId === loginIdForToken && connectedSocket.authSessionId === session.sessionId) {
          connectedSocket.emit('duplicate_login');
          connectedSocket.disconnect(true);
        }
      });
    });
    setUserActiveSessions(user, []);
  }

  const persistent = !!user.loginPersistenceEnabled;
  addUserActiveSession(user, {
    sessionId,
    deviceId,
    issuedAt: nowIso(),
    lastSeenAt: nowIso(),
    persistent
  });
  saveMembers();


  const token = jwt.sign({
    userUid: user.userUid,
    sessionId,
    id: loginIdForToken,
    loginId: loginIdForToken,
    username: loginIdForToken,
    displayName: user.displayName || loginIdForToken,
    nickname: user.nickname || '',
    role,
    Masters: user.Masters,
    Managers: user.Managers,
    globalAccess: user.globalAccess,
    rootPath: user.rootPath,
    persistent
  }, JWT_SECRET, { expiresIn: persistent ? '30d' : '1d' });

  res.cookie('token', token, getAuthCookieOptions(req, persistent));
  res.json({
    message: '성공',
    user: {
      ...user,
      id: loginIdForToken,
      loginId: loginIdForToken,
      username: loginIdForToken,
      currentSessionId: sessionId,
      role
    }
  });
});

// [회원가입 요청]
app.post('/api/signup-request', (req, res) => {
  const { id, password, passwordConfirm, displayName, nickname, realName } = req.body;
  const loginId = (id || '').trim();
  const safeNickname = normalizeNickname(nickname);

  if (!loginId) return res.status(400).json({ error: '아이디가 필요합니다.' });
  if (!password) return res.status(400).json({ error: '비밀번호가 필요합니다.' });
  if (password.length < 4) return res.status(400).json({ error: '비밀번호는 최소 4자 이상이어야 합니다.' });
  if (passwordConfirm !== undefined && password !== passwordConfirm) return res.status(400).json({ error: '비밀번호 확인이 일치하지 않습니다.' });
  if (safeNickname.length < 2) return res.status(400).json({ error: '닉네임은 2자 이상 입력해주세요.' });

  if (approvedUsers.find(u => getUserLoginId(u) === loginId) || signupRequests.find(r => getUserLoginId(r) === loginId)) {
    return res.status(409).json({ error: '이미 사용 중인 아이디입니다.', field: 'id' });
  }
  if (isNicknameTaken(safeNickname)) {
    return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.', field: 'nickname' });
  }

  signupRequests.push(normalizeSignupRequest({
    id: loginId,
    loginId,
    password,
    displayName: safeNickname,
    nickname: safeNickname,
    profile: realName ? { realName } : {},
    date: new Date().toISOString().split('T')[0],
    requestedAt: nowIso()
  }));

  saveRequests();
  io.emit('membersChanged');
  res.json({ success: true });
});

app.get('/api/users/check-identity', (req, res) => {
  const loginId = String(req.query.id || '').trim();
  const nickname = normalizeNickname(req.query.nickname);
  const idAvailable = !loginId || !approvedUsers.some((user) => getUserLoginId(user).toLowerCase() === loginId.toLowerCase())
    && !signupRequests.some((user) => getUserLoginId(user).toLowerCase() === loginId.toLowerCase());
  const nicknameAvailable = !nickname || !isNicknameTaken(nickname);
  res.json({ idAvailable, nicknameAvailable });
});

// [유저 데이터 조회]
app.get('/api/users/data', requireManager, (req, res) => {
  const connectedIds = Array.from(io.sockets.sockets.values()).map(s => s.userId).filter(Boolean);
  const connectedUserUids = Array.from(io.sockets.sockets.values()).map(s => s.userUid).filter(Boolean);

  const users = approvedUsers.map(u => {
    const loginId = getUserLoginId(u);
    const normalizedUser = normalizeQuotaFields(u);
    return {
      userUid: u.userUid,
      id: loginId,
      loginId,
      username: loginId,
      displayName: u.displayName || loginId,
      nickname: u.nickname || '',
      role: getUserRole(u),
      globalAccess: u.globalAccess,
      isOnline: connectedIds.includes(loginId) || connectedUserUids.includes(u.userUid),
      rootPath: u.rootPath || '',
      storageQuotaMode: normalizedUser.storageQuotaMode,
      storageQuotaBytes: normalizedUser.storageQuotaBytes,
      storageUsedBytes: null,
      storageTotalBytes: null,
      storageFreeBytes: null
    };
  });

  const pendingUsers = signupRequests.map(u => {
    const loginId = getUserLoginId(u);
    return {
      userUid: u.userUid,
      id: loginId,
      loginId,
      username: loginId,
      displayName: u.displayName || loginId,
      nickname: u.nickname || '',
      requestedAt: u.requestedAt || u.date || ''
    };
  });

  res.json({ users, pendingUsers });
});

// [권한 업데이트 & 강제 로그아웃 방송]
app.put('/api/users/update', requireManager, (req, res) => {
  const updatedIds = [];

  req.body.users.forEach(u => {
    const target = findApprovedUserByAnyId(u.userUid || u.loginId || u.id);
    if (target && getUserLoginId(target) !== 'admin') {
      if ((target.role !== u.role || target.globalAccess !== u.globalAccess) && u.role !== 'MASTER') {
        updatedIds.push(getUserLoginId(target));
      }
      target.Masters = u.role === 'MASTER';
      target.Managers = u.role === 'MANAGER' || u.role === 'MASTER';
      target.globalAccess = u.role === 'MASTER' ? true : !!u.globalAccess;
      target.role = u.role || target.role;
      target.rootPath = u.rootPath || u.root_path || target.rootPath;
      if (u.storageQuotaMode === 'unlimited') {
        target.storageQuotaMode = 'unlimited';
        target.storageQuotaBytes = null;
      } else if (u.storageQuotaGb !== undefined || u.storageQuotaBytes !== undefined) {
        const quotaGb = Number(u.storageQuotaGb);
        const quotaBytes = Number(u.storageQuotaBytes);
        const nextQuotaBytes = Number.isFinite(quotaGb) && quotaGb > 0
          ? Math.round(quotaGb * 1024 * 1024 * 1024)
          : quotaBytes;
        target.storageQuotaMode = 'limited';
        target.storageQuotaBytes = Number.isFinite(nextQuotaBytes) && nextQuotaBytes > 0
          ? Math.round(nextQuotaBytes)
          : DEFAULT_USER_QUOTA_BYTES;
      }
      if (u.displayName !== undefined) target.displayName = u.displayName || getUserLoginId(target);
      if (u.nickname !== undefined) target.nickname = u.nickname || '';
    }
  });

  saveMembers();
  updatedIds.forEach(targetId => io.emit('force_logout_target', { targetId }));
  io.emit('membersChanged');
  res.json({ success: true });
});

// [보안 계정 삭제 & 폴더 백업]
app.post('/api/users/delete', requireManager, (req, res) => {
  const { targetId, adminId, adminPassword } = req.body;
  const admin = findApprovedUserByAnyId(adminId);
  const targetUser = findApprovedUserByAnyId(targetId);

  if (!admin || admin.password !== adminPassword) return res.status(401).json({ error: '비밀번호 불일치' });
  if (!targetUser) return res.status(404).json({ error: '삭제 대상 없음' });

  const targetLoginId = getUserLoginId(targetUser);
  if (targetLoginId === 'admin') return res.status(400).json({ error: '삭제 불가 계정' });

  const relativeRoot = targetUser.rootPath ? targetUser.rootPath.replace(/^(\/|\\)+/, '') : path.join('users', targetLoginId);
  const userPath = path.resolve(nasPath, relativeRoot);
  const backupDir = path.join(nasPath, 'backup');

  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  if (fs.existsSync(userPath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(userPath, path.join(backupDir, `${targetLoginId}_${ts}`));
  }

  approvedUsers = approvedUsers.filter(u => u.userUid !== targetUser.userUid);
  saveMembers();
  io.emit('force_logout_target', { targetId: targetLoginId });
  io.emit('membersChanged');
  res.json({ success: true });
});


// 🔐 [보안] 루트 폴더 비밀번호 및 마스터 키 설정
app.put('/api/users/security-settings', (req, res) => {
  const { id, rootPassword, masterKey, isPasswordEnabled } = req.body;
  const user = findApprovedUserByAnyId(id);
  if (!user) return res.status(404).json({ error: '유저 없음' });

  if (rootPassword !== undefined) user.rootPassword = rootPassword;
  if (isPasswordEnabled !== undefined) user.isPasswordEnabled = !!isPasswordEnabled;
  if (masterKey !== undefined && (user.Masters || user.Managers)) user.masterKey = masterKey;

  saveMembers();
  res.json({ success: true });
});

// [비밀번호 변경]
app.put('/api/users/password', (req, res) => {
  const { id, currentPassword, newPassword } = req.body;
  const user = findApprovedUserByAnyId(id);
  if (!user || user.password !== currentPassword) return res.status(401).json({ error: '비밀번호 틀림' });
  user.password = newPassword;
  saveMembers();
  res.json({ success: true });
});

app.put('/api/users/profile', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = findApprovedUserByAnyId(decoded.userUid || decoded.loginId || decoded.id);
    if (!user || user.disabled) return res.status(401).json({ error: '사용자 정보를 찾을 수 없습니다.' });

    const nickname = normalizeNickname(req.body.nickname);
    if (nickname.length < 2) return res.status(400).json({ error: '닉네임은 2자 이상 입력해주세요.' });
    if (isNicknameTaken(nickname, user.userUid)) {
      return res.status(409).json({ error: '이미 사용 중인 닉네임입니다.' });
    }

    user.nickname = nickname;
    user.displayName = nickname;
    saveMembers();
    io.emit('membersChanged');

    const loginId = getUserLoginId(user);
    return res.json({
      success: true,
      user: { ...user, id: loginId, loginId, username: loginId, role: getUserRole(user) }
    });
  } catch (err) {
    return res.status(401).json({ error: '인증 정보가 만료되었습니다.' });
  }
});

// [승인/거절]

// 🔥 [긴급 복구] 가입 거절 API
app.post('/api/users/reject', requireManager, (req, res) => {
  const { id } = req.body;
  const target = findSignupRequestByAnyId(id);
  if (!target) return res.status(404).json({ error: '없음' });

  signupRequests = signupRequests.filter(r => r.userUid !== target.userUid);
  saveRequests();
  io.emit('membersChanged');
  res.json({ success: true });
});

app.post('/api/users/approve', requireManager, (req, res) => {
  const { id } = req.body;
  const reqUser = findSignupRequestByAnyId(id);
  if (!reqUser) return res.status(404).json({ error: '없음' });

  const loginId = getUserLoginId(reqUser);

  approvedUsers.push(normalizeApprovedUser({
    ...reqUser,
    id: loginId,
    loginId,
    username: loginId,
    Masters: false,
    Managers: false,
    globalAccess: false,
    isPasswordEnabled: false,
    disabled: false,
    status: 'ACTIVE',
    approvedAt: nowIso(),
    role: 'USER'
  }));

  signupRequests = signupRequests.filter(r => r.userUid !== reqUser.userUid);

  const upath = path.join(nasPath, 'users', loginId);
  if (!fs.existsSync(upath)) fs.mkdirSync(upath, { recursive: true });

  saveMembers();
  saveRequests();
  io.emit('membersChanged');
  res.json({ success: true });
});

// 🔥 [소켓] 접속 중인 유저 기기 명부
const activeUsers = new Map();
const meetingRooms = new Map();
const meetingDisconnectTimers = new Map();
const sessionLogoutTimers = new Map();
const meetingChatsFilePath = path.join(__dirname, 'data', 'meetingChats.json');
const endedMeetingsFilePath = path.join(__dirname, 'data', 'endedMeetings.json');
const ENDED_MEETING_VISIBLE_MS = 2 * 60 * 60 * 1000;
const MEETING_CHAT_RETENTION_MS = 0;
const MEETING_ORPHAN_GRACE_MS = 11 * 60 * 1000;
const MEETING_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let meetingChatHistory = {};
let endedMeetings = {};

try {
  if (fs.existsSync(meetingChatsFilePath)) {
    const parsedMeetingChats = JSON.parse(fs.readFileSync(meetingChatsFilePath, 'utf8'));
    meetingChatHistory = parsedMeetingChats && typeof parsedMeetingChats === 'object' ? parsedMeetingChats : {};
  }
} catch (err) {
  console.error('[meeting chat] failed to load history', err);
  meetingChatHistory = {};
}

try {
  if (fs.existsSync(endedMeetingsFilePath)) {
    const parsed = JSON.parse(fs.readFileSync(endedMeetingsFilePath, 'utf8'));
    endedMeetings = parsed && typeof parsed === 'object' ? parsed : {};
  }
} catch (err) {
  console.error('[meeting] failed to load ended meeting records', err);
  endedMeetings = {};
}

const pruneEndedMeetings = () => {
  const cutoff = Date.now() - ENDED_MEETING_VISIBLE_MS;
  let changed = false;
  Object.entries(endedMeetings).forEach(([roomId, endedAt]) => {
    if (new Date(endedAt).getTime() <= cutoff) {
      delete endedMeetings[roomId];
      changed = true;
    }
  });
  if (changed) fs.writeFileSync(endedMeetingsFilePath, JSON.stringify(endedMeetings, null, 2));
};

const recordEndedMeeting = (roomId) => {
  pruneEndedMeetings();
  endedMeetings[roomId] = nowIso();
  fs.mkdirSync(path.dirname(endedMeetingsFilePath), { recursive: true });
  fs.writeFileSync(endedMeetingsFilePath, JSON.stringify(endedMeetings, null, 2));
};

const saveMeetingChatHistory = () => {
  fs.mkdirSync(path.dirname(meetingChatsFilePath), { recursive: true });
  fs.writeFileSync(meetingChatsFilePath, JSON.stringify(meetingChatHistory, null, 2));
};

const getMeetingChatMessages = (roomId) => {
  const messages = meetingChatHistory[roomId];
  return Array.isArray(messages) ? messages.slice(-500) : [];
};

const appendMeetingChatMessage = (roomId, message) => {
  const current = getMeetingChatMessages(roomId);
  meetingChatHistory[roomId] = [...current, message].slice(-500);
  saveMeetingChatHistory();
  return message;
};

const pruneMeetingChatHistory = () => {
  const cutoff = Date.now() - MEETING_CHAT_RETENTION_MS;
  let changed = false;

  Object.entries(meetingChatHistory).forEach(([roomId, messages]) => {
    if (meetingRooms.has(roomId)) return;
    const latestCreatedAt = Array.isArray(messages) && messages.length > 0
      ? new Date(messages[messages.length - 1]?.createdAt || 0).getTime()
      : 0;
    if (!latestCreatedAt || latestCreatedAt <= cutoff) {
      delete meetingChatHistory[roomId];
      changed = true;
    }
  });

  if (changed) saveMeetingChatHistory();
};

const normalizeMeetingRoomId = (value) =>
  String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);

const hashMeetingPassword = (roomId, password) =>
  crypto.createHash('sha256').update(`${roomId}:${String(password || '')}`).digest('hex');

const sanitizeMeetingAccessPolicy = (policy = {}, roomId = '', fallback = {}) => {
  const existing = fallback && typeof fallback === 'object' ? fallback : {};
  const requestedMode = String(policy.mode || existing.mode || 'private').toLowerCase();
  const mode = ['public', 'private', 'members', 'link'].includes(requestedMode)
    ? requestedMode
    : 'private';
  const requestedEntryMode = String(policy.entryMode || existing.entryMode || 'direct').toLowerCase();
  const entryMode = ['direct', 'approval'].includes(requestedEntryMode) ? requestedEntryMode : 'direct';
  const password = String(policy.password || '').trim();
  const passwordFlagProvided = Object.prototype.hasOwnProperty.call(policy, 'passwordEnabled');
  const passwordEnabled = passwordFlagProvided
    ? (policy.passwordEnabled === true || !!password)
    : (existing.passwordEnabled === true || !!password);
  return {
    mode,
    searchable: mode === 'public' && policy.searchable === true,
    entryMode,
    passwordEnabled,
    passwordHash: password
      ? hashMeetingPassword(roomId, password)
      : (passwordEnabled ? existing.passwordHash || '' : ''),
    createdAt: existing.createdAt || nowIso(),
    updatedAt: nowIso()
  };
};

const publicMeetingAccessPolicy = (policy = {}) => ({
  mode: policy.mode || 'private',
  searchable: !!policy.searchable,
  entryMode: policy.entryMode || 'direct',
  passwordEnabled: !!policy.passwordEnabled
});

const sanitizeMeetingTitle = (value, fallback = '화상회의') => {
  const title = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return title || fallback;
};

const getMeetingHostDisplayName = (room = {}) => {
  const hostUser = findApprovedUserByAnyId(room.hostUserUid || '');
  return hostUser?.nickname || hostUser?.displayName || hostUser?.username || hostUser?.loginId || room.hostDisplayName || '방장';
};

const verifyMeetingAccessPassword = (roomId, room, accessPassword = '') => {
  const policy = room?.accessPolicy || {};
  if (!policy.passwordEnabled) return true;
  const password = String(accessPassword || '').trim();
  if (!password) return false;
  return hashMeetingPassword(roomId, password) === policy.passwordHash;
};

const getConversationMeetingCode = (conversationId) => {
  const suffix = String(conversationId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-24).toUpperCase();
  return normalizeMeetingRoomId(`CHAT-${suffix || crypto.randomBytes(4).toString('hex').toUpperCase()}`);
};

const isConversationParticipant = (conversation, userUid) =>
  !!conversation?.participantUids?.includes(userUid);

const getMeetingParticipant = (socket, fallback = {}) => ({
  socketId: socket.id,
  sessionId: socket.authSessionId || fallback.sessionId || '',
  userUid: socket.userUid || fallback.userUid || fallback.id || socket.id,
  loginId: socket.loginId || fallback.loginId || fallback.username || '',
  baseDisplayName: fallback.baseDisplayName || fallback.displayName || fallback.nickname || fallback.username || socket.loginId || '\ucc38\uac00\uc790',
  displayName: fallback.displayName || fallback.nickname || fallback.username || socket.loginId || '\ucc38\uac00\uc790',
  audioEnabled: fallback.audioEnabled !== false,
  videoEnabled: fallback.videoEnabled !== false,
  screenSharing: !!fallback.screenSharing,
  isGuest: !!fallback.isGuest || fallback.role === 'GUEST' || String(fallback.userUid || '').startsWith('guest_'),
  lobbyOnly: !!fallback.lobbyOnly
});

const isActiveMeetingParticipant = (participant = {}) => (
  !participant.lobbyOnly && !participant.temporarilyDisconnected
);

const annotateMeetingParticipants = (participants = []) => {
  const activeParticipants = participants.filter(isActiveMeetingParticipant);
  const countsByAccount = activeParticipants.reduce((acc, participant) => {
    const groupId = participant.userUid || participant.loginId || participant.socketId;
    acc.set(groupId, (acc.get(groupId) || 0) + 1);
    return acc;
  }, new Map());
  const seenByAccount = new Map();

  return participants.map((participant) => {
    const groupId = participant.userUid || participant.loginId || participant.socketId;
    const groupSize = countsByAccount.get(groupId) || 0;
    const baseDisplayName = participant.baseDisplayName || participant.displayName || participant.loginId || '\ucc38\uac00\uc790';
    if (!isActiveMeetingParticipant(participant) || groupSize <= 1) {
      return {
        ...participant,
        baseDisplayName,
        displayName: baseDisplayName,
        accountGroupId: groupId,
        accountGroupSize: Math.max(groupSize, 1),
        accountGroupIndex: 1
      };
    }

    const nextIndex = (seenByAccount.get(groupId) || 0) + 1;
    seenByAccount.set(groupId, nextIndex);
    return {
      ...participant,
      baseDisplayName,
      displayName: `${baseDisplayName}_${nextIndex}`,
      accountGroupId: groupId,
      accountGroupSize: groupSize,
      accountGroupIndex: nextIndex
    };
  });
};

const getMeetingRoomState = (roomId, room) => ({
  roomId,
  title: sanitizeMeetingTitle(room?.title, room?.conversationId ? '채팅방 회의' : '임시 회의'),
  type: room?.conversationId ? 'conversation' : 'temporary',
  conversationId: room?.conversationId || null,
  accessPolicy: publicMeetingAccessPolicy(room?.accessPolicy || { mode: room?.conversationId ? 'members' : 'private' }),
  recording: room?.recording || { status: 'idle', startedByUserUid: null, startedAt: null },
  ai: room?.ai || { status: 'idle', startedByUserUid: null, startedAt: null },
  hostSocketId: room?.hostSocketId || '',
  hostUserUid: room?.hostUserUid || '',
  hostDisplayName: getMeetingHostDisplayName(room),
  createdAt: room?.createdAt || nowIso(),
  participants: annotateMeetingParticipants([...(room?.participants?.values?.() || [])])
    .filter(isActiveMeetingParticipant)
});

const getMeetingRoomSummary = (roomId, room, viewerUserUid = '') => {
  const participants = annotateMeetingParticipants([...(room?.participants?.values?.() || [])])
    .filter(isActiveMeetingParticipant);
  const conversation = room?.conversationId ? getConversationById(room.conversationId) : null;
  return {
    roomId,
    title: sanitizeMeetingTitle(room?.title, conversation?.title || (room?.conversationId ? '채팅방 회의' : '임시 회의')),
    type: room?.conversationId ? 'conversation' : 'temporary',
    conversationId: room?.conversationId || null,
    conversationTitle: conversation?.title || '',
    accessPolicy: publicMeetingAccessPolicy(room?.accessPolicy || { mode: room?.conversationId ? 'members' : 'private' }),
    recording: room?.recording || { status: 'idle', startedByUserUid: null, startedAt: null },
    ai: room?.ai || { status: 'idle', startedByUserUid: null, startedAt: null },
    hostSocketId: room?.hostSocketId || '',
    hostUserUid: room?.hostUserUid || '',
    hostDisplayName: getMeetingHostDisplayName(room),
    createdAt: room?.createdAt || nowIso(),
    lastActivityAt: room?.lastActivityAt || room?.createdAt || nowIso(),
    participantCount: participants.length,
    participants,
    isParticipant: !!viewerUserUid && participants.some((participant) => participant.userUid === viewerUserUid)
  };
};

const getSavedMeetingSummary = (conversation = {}) => {
  const meeting = conversation.meeting || {};
  const roomId = normalizeMeetingRoomId(meeting.roomCode);
  if (!meeting.enabled || !roomId) return null;
  const activeRoom = meetingRooms.get(roomId);
  if (activeRoom) return getMeetingRoomSummary(roomId, activeRoom);
  const owner = findApprovedUserByAnyId(conversation.ownerUid) || {};
  return {
    roomId,
    title: sanitizeMeetingTitle(conversation.title, '정규 회의방'),
    type: 'conversation',
    conversationId: conversation.conversationId,
    conversationTitle: conversation.title || '',
    accessPolicy: publicMeetingAccessPolicy(meeting.accessPolicy || {}),
    hostSocketId: '',
    hostUserUid: conversation.ownerUid || '',
    hostDisplayName: owner.nickname || owner.displayName || owner.loginId || '방장',
    createdAt: conversation.createdAt || nowIso(),
    lastActivityAt: conversation.updatedAt || conversation.createdAt || nowIso(),
    participantCount: 0,
    participants: [],
    savedMeeting: true
  };
};

const createMeetingLinkedChatMessage = ({ conversationId, actorUserUid, text }) => {
  if (!conversationId || !actorUserUid || !text) return null;
  try {
    return createStoredChatMessage({
      conversationId,
      senderUid: actorUserUid,
      text,
      allowExternalSender: false
    });
  } catch (err) {
    console.warn('[meeting] linked chat event failed', err.message);
    return null;
  }
};

const notifyConversationMeetingEvent = ({ conversation, actorUserUid = '', roomId, type, title, message }) => {
  if (!conversation?.conversationId || !Array.isArray(conversation.participantUids)) return;
  conversation.participantUids.forEach((userUid) => {
    if (!userUid) return;
    const notification = createNotification({
      userUid,
      type,
      title,
      message,
      meta: {
        conversationId: conversation.conversationId,
        meetingRoomId: roomId,
        actorUserUid
      }
    });
    io.to(`user:${userUid}`).emit('notification:new', notification);
  });
};

const publishLinkedMeetingChatEvent = ({ conversationId, actorUserUid, roomId, type, title, text }) => {
  const conversation = getConversationById(conversationId);
  if (!conversation) return;
  const stored = createMeetingLinkedChatMessage({
    conversationId,
    actorUserUid,
    text
  });
  if (stored?.message) {
    (stored.conversation.participantUids || []).forEach((userUid) => {
      io.to(`user:${userUid}`).emit('chat:message', {
        conversationId,
        message: stored.message,
        sender: {
          userUid: actorUserUid,
          username: '',
          displayName: '회의 시스템',
          role: 'SYSTEM'
        }
      });
    });
  }
  notifyConversationMeetingEvent({
    conversation,
    actorUserUid,
    roomId,
    type,
    title,
    message: text
  });
};

const emitMeetingRoomState = (roomId) => {
  const normalizedRoomId = normalizeMeetingRoomId(roomId);
  const room = meetingRooms.get(normalizedRoomId);
  if (!room) return;
  io.to(`meeting:${normalizedRoomId}`).emit('meeting:room-state', getMeetingRoomState(normalizedRoomId, room));
};

const endMeetingRoom = (roomId, endedBySocketId = '') => {
  const normalizedRoomId = normalizeMeetingRoomId(roomId);
  const room = meetingRooms.get(normalizedRoomId);
  if (!room) return false;

  recordEndedMeeting(normalizedRoomId);

  if (room.conversationId && !room.endedAnnouncementSent) {
    room.endedAnnouncementSent = true;
    publishLinkedMeetingChatEvent({
      conversationId: room.conversationId,
      actorUserUid: room.hostUserUid || '',
      roomId: normalizedRoomId,
      type: 'meeting_ended',
      title: '회의가 종료되었습니다',
      text: '채팅방 화상회의가 종료되었습니다.'
    });
  }

  io.to(`meeting:${normalizedRoomId}`).emit('meeting:ended', {
    roomId: normalizedRoomId,
    endedBySocketId
  });

  for (const participant of room.participants.values()) {
    const disconnectTimer = meetingDisconnectTimers.get(participant.socketId);
    if (disconnectTimer) clearTimeout(disconnectTimer);
    meetingDisconnectTimers.delete(participant.socketId);
    const targetSocket = io.sockets.sockets.get(participant.socketId);
    if (targetSocket) {
      targetSocket.leave(`meeting:${normalizedRoomId}`);
      if (targetSocket.meetingRoomId === normalizedRoomId) targetSocket.meetingRoomId = '';
    }
  }

  room.participants.clear();
  meetingRooms.delete(normalizedRoomId);
  if (meetingChatHistory[normalizedRoomId]) {
    delete meetingChatHistory[normalizedRoomId];
    saveMeetingChatHistory();
  }
  return true;
};

app.set('endMeetingRoomsForConversation', (conversationId, endedBySocketId = 'conversation-deleted') => {
  const safeConversationId = String(conversationId || '').trim();
  if (!safeConversationId) return 0;

  let endedCount = 0;
  [...meetingRooms.entries()].forEach(([roomId, room]) => {
    if (room?.conversationId !== safeConversationId) return;
    if (endMeetingRoom(roomId, endedBySocketId)) endedCount += 1;
  });
  return endedCount;
});

const leaveMeetingRoom = (socket, roomId) => {
  const normalizedRoomId = normalizeMeetingRoomId(roomId || socket.meetingRoomId);
  if (!normalizedRoomId) return;

  const room = meetingRooms.get(normalizedRoomId);
  if (!room) {
    socket.leave(`meeting:${normalizedRoomId}`);
    if (socket.meetingRoomId === normalizedRoomId) socket.meetingRoomId = '';
    return;
  }

  const leavingParticipant = room.participants.get(socket.id);
  if (!leavingParticipant) {
    socket.leave(`meeting:${normalizedRoomId}`);
    if (socket.meetingRoomId === normalizedRoomId) socket.meetingRoomId = '';
    return;
  }

  const disconnectTimer = meetingDisconnectTimers.get(socket.id);
  if (disconnectTimer) clearTimeout(disconnectTimer);
  meetingDisconnectTimers.delete(socket.id);

  room.participants.delete(socket.id);
  if (room.hostSocketId === socket.id) {
    const nextHost = [...room.participants.values()].find(isActiveMeetingParticipant);
    room.hostSocketId = nextHost?.socketId || '';
    room.hostUserUid = nextHost?.userUid || '';
  }
  socket.leave(`meeting:${normalizedRoomId}`);
  socket.to(`meeting:${normalizedRoomId}`).emit('meeting:peer-left', {
    roomId: normalizedRoomId,
    socketId: socket.id
  });

  if (room.participants.size === 0) {
    endMeetingRoom(normalizedRoomId, socket.id);
  } else {
    emitMeetingRoomState(normalizedRoomId);
  }

  if (socket.meetingRoomId === normalizedRoomId) socket.meetingRoomId = '';
};

const runMeetingCleanup = () => {
  pruneEndedMeetings();
  pruneMeetingChatHistory();

  const now = Date.now();
  meetingRooms.forEach((room, roomId) => {
    const hasConnectedParticipant = [...room.participants.keys()].some((socketId) => io.sockets.sockets.has(socketId));
    const lastActivityAt = new Date(room.lastActivityAt || room.createdAt || 0).getTime();
    if (!hasConnectedParticipant && lastActivityAt && now - lastActivityAt >= MEETING_ORPHAN_GRACE_MS) {
      endMeetingRoom(roomId, 'cleanup');
    }
  });

  activeUsers.forEach((socketId, userId) => {
    if (!io.sockets.sockets.has(socketId)) activeUsers.delete(userId);
  });
};

runMeetingCleanup();
const meetingCleanupInterval = setInterval(runMeetingCleanup, MEETING_CLEANUP_INTERVAL_MS);
meetingCleanupInterval.unref?.();

app.get('/api/meetings/:roomId/status', (req, res) => {
  pruneEndedMeetings();
  const roomId = normalizeMeetingRoomId(req.params.roomId);
  if (!roomId) return res.status(400).json({ status: 'missing', participantCount: 0 });

  const room = meetingRooms.get(roomId);
  if (room) {
    const participantCount = [...room.participants.values()].filter(isActiveMeetingParticipant).length;
    const accessPolicy = publicMeetingAccessPolicy(room.accessPolicy || { mode: room.conversationId ? 'members' : 'private' });
    return res.json({
      status: 'active',
      roomId,
      participantCount,
      startedAt: room.createdAt,
      accessPolicy,
      passwordRequired: !!accessPolicy.passwordEnabled
    });
  }

  if (endedMeetings[roomId]) {
    return res.json({
      status: 'ended',
      roomId,
      participantCount: 0,
      endedAt: endedMeetings[roomId],
      expiresAt: new Date(new Date(endedMeetings[roomId]).getTime() + ENDED_MEETING_VISIBLE_MS).toISOString()
    });
  }

  const savedConversation = getMeetingConversationByRoomCode(roomId);
  const savedSummary = savedConversation ? getSavedMeetingSummary(savedConversation) : null;
  if (savedSummary) {
    return res.json({
      status: 'active',
      roomId,
      savedMeeting: true,
      title: savedSummary.title,
      participantCount: savedSummary.participantCount || 0,
      startedAt: savedSummary.createdAt,
      accessPolicy: savedSummary.accessPolicy,
      passwordRequired: !!savedSummary.accessPolicy?.passwordEnabled
    });
  }

  return res.status(404).json({ status: 'missing', roomId, participantCount: 0 });
});

app.get('/api/meetings/overview/current', (req, res) => {
  try {
    const user = getAuthenticatedUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' });

    const userUid = user.userUid || user.loginId || user.id || '';
    const conversations = listConversationsForUser(userUid);
    const activeRoomSummaries = [...meetingRooms.entries()]
      .map(([roomId, room]) => getMeetingRoomSummary(roomId, room, userUid));

    const activeMeetings = activeRoomSummaries
      .filter((summary) => summary.isParticipant)
      .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

    const conversationMeetings = conversations.map((conversation) => {
      const activeRoom = activeRoomSummaries.find((summary) => summary.conversationId === conversation.conversationId) || null;
      const savedMeeting = conversation.meeting?.enabled ? conversation.meeting : null;
      const viewerRole = getConversationRole(conversation, userUid);
      return {
        conversationId: conversation.conversationId,
        title: conversation.title || '',
        type: conversation.type || 'group',
        participantCount: Array.isArray(conversation.participantUids) ? conversation.participantUids.length : 0,
        defaultRoomCode: savedMeeting?.roomCode || getConversationMeetingCode(conversation.conversationId),
        accessPolicy: publicMeetingAccessPolicy(savedMeeting?.accessPolicy || { mode: 'members' }),
        savedMeeting: !!savedMeeting,
        viewerRole,
        viewerCanManage: ['owner', 'cohost'].includes(viewerRole),
        viewerCanDelete: viewerRole === 'owner',
        activeRoom
      };
    }).sort((a, b) => {
      const aTime = new Date(a.activeRoom?.lastActivityAt || 0).getTime();
      const bTime = new Date(b.activeRoom?.lastActivityAt || 0).getTime();
      return bTime - aTime;
    });

    res.json({
      success: true,
      activeMeetings,
      conversationMeetings
    });
  } catch (err) {
    if (err.code === 'SESSION_REPLACED') {
      res.clearCookie('token', getClearAuthCookieOptions(req));
      return res.status(401).json({ error: 'SESSION_REPLACED' });
    }
    res.status(401).json({ error: 'LOGIN_REQUIRED' });
  }
});

app.get('/api/meetings/public/search', (req, res) => {
  const query = String(req.query?.q || '').trim().toLowerCase();
  const activeRooms = [...meetingRooms.entries()]
    .map(([roomId, room]) => getMeetingRoomSummary(roomId, room))
    .filter((summary) => {
      if (summary.type !== 'temporary' && summary.type !== 'conversation') return false;
      if (summary.accessPolicy?.mode !== 'public' || !summary.accessPolicy?.searchable) return false;
      if (!query) return true;
      return [
        summary.title,
        summary.hostDisplayName,
        summary.roomId
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    });

  const savedConversationRooms = listAllConversationsForMeetingSearch();

  const savedSummaries = savedConversationRooms
    .filter((conversation) => {
      const meeting = conversation.meeting || {};
      const policy = publicMeetingAccessPolicy(meeting.accessPolicy || {});
      if (!meeting.enabled || !meeting.roomCode) return false;
      if (policy.mode !== 'public' || !policy.searchable) return false;
      if (meetingRooms.has(normalizeMeetingRoomId(meeting.roomCode))) return false;
      if (!query) return true;
      return [
        conversation.title,
        findApprovedUserByAnyId(conversation.ownerUid)?.nickname,
        findApprovedUserByAnyId(conversation.ownerUid)?.loginId,
        meeting.roomCode
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
    })
    .map((conversation) => {
      const meeting = conversation.meeting || {};
      const owner = findApprovedUserByAnyId(conversation.ownerUid) || {};
      return {
        roomId: normalizeMeetingRoomId(meeting.roomCode),
        title: sanitizeMeetingTitle(conversation.title, '정규 회의방'),
        type: 'conversation',
        conversationId: conversation.conversationId,
        conversationTitle: conversation.title || '',
        accessPolicy: publicMeetingAccessPolicy(meeting.accessPolicy || {}),
        hostSocketId: '',
        hostUserUid: conversation.ownerUid || '',
        hostDisplayName: owner.nickname || owner.displayName || owner.loginId || '방장',
        createdAt: conversation.createdAt || nowIso(),
        lastActivityAt: conversation.updatedAt || conversation.createdAt || nowIso(),
        participantCount: 0,
        participants: [],
        savedMeeting: true
      };
    });

  const rooms = [...activeRooms, ...savedSummaries]
    .filter((room, index, arr) => arr.findIndex((item) => item.roomId === room.roomId) === index)
    .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
    .slice(0, 50);

  res.json({ success: true, rooms });
});

app.get('/api/meetings/public/exact', (req, res) => {
  const rawName = String(req.query?.name || '').trim();
  const normalizedName = rawName.replace(/\s+/g, ' ').toLowerCase();
  if (!normalizedName) return res.status(400).json({ success: false, error: 'NAME_REQUIRED', rooms: [] });

  const activeRooms = [...meetingRooms.entries()]
    .map(([roomId, room]) => getMeetingRoomSummary(roomId, room))
    .filter((summary) => {
      const title = String(summary.title || '').trim().replace(/\s+/g, ' ').toLowerCase();
      return title === normalizedName &&
        summary.accessPolicy?.mode === 'public' &&
        summary.accessPolicy?.searchable;
    });

  const savedRooms = listAllConversationsForMeetingSearch()
    .map(getSavedMeetingSummary)
    .filter(Boolean)
    .filter((summary) => {
      const title = String(summary.title || '').trim().replace(/\s+/g, ' ').toLowerCase();
      return title === normalizedName &&
        summary.accessPolicy?.mode === 'public' &&
        summary.accessPolicy?.searchable;
    });

  const rooms = [...activeRooms, ...savedRooms]
    .filter((room, index, arr) => arr.findIndex((item) => item.roomId === room.roomId) === index)
    .sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime())
    .slice(0, 10);

  res.json({ success: true, rooms });
});

app.post('/api/meetings/conversations/:conversationId/settings', (req, res) => {
  try {
    const user = getAuthenticatedUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' });

    const userUid = user.userUid || user.loginId || user.id || '';
    const conversation = getConversationById(req.params.conversationId);
    if (!conversation || conversation.deletedAt) {
      return res.status(404).json({ error: 'CONVERSATION_NOT_FOUND', message: '채팅방을 찾을 수 없습니다.' });
    }

    const roomId = normalizeMeetingRoomId(conversation.meeting?.roomCode || req.body?.roomCode) || getConversationMeetingCode(conversation.conversationId);
    const nextPolicy = sanitizeMeetingAccessPolicy(req.body?.accessPolicy || conversation.meeting?.accessPolicy || {}, roomId, conversation.meeting?.accessPolicy || {});
    const updatedConversation = updateMeetingConversationSettings({
      conversationId: conversation.conversationId,
      actorUid: userUid,
      title: sanitizeMeetingTitle(req.body?.title || conversation.title, conversation.title || '채팅방 회의'),
      accessPolicy: nextPolicy
    });

    const activeEntry = [...meetingRooms.entries()].find(([, room]) => room.conversationId === conversation.conversationId);
    if (activeEntry) {
      const [activeRoomId, activeRoom] = activeEntry;
      activeRoom.title = sanitizeMeetingTitle(updatedConversation.title, activeRoom.title || '채팅방 회의');
      activeRoom.accessPolicy = nextPolicy;
      activeRoom.lastActivityAt = nowIso();
      emitMeetingRoomState(activeRoomId);
    }

    res.json({
      success: true,
      conversation: updatedConversation,
      room: getSavedMeetingSummary(updatedConversation)
    });
  } catch (err) {
    if (err.code === 'SESSION_REPLACED') {
      res.clearCookie('token', getClearAuthCookieOptions(req));
      return res.status(401).json({ error: 'SESSION_REPLACED' });
    }
    if (err.message === 'FORBIDDEN_MANAGER') {
      return res.status(403).json({ error: 'FORBIDDEN_MANAGER', message: '채팅방 관리자만 방 설정을 수정할 수 있습니다.' });
    }
    console.error('[meeting conversation settings] failed', err);
    res.status(500).json({ error: 'MEETING_SETTINGS_FAILED', message: '방 설정을 저장할 수 없습니다.' });
  }
});

app.post('/api/meetings/conversations/:conversationId/start', (req, res) => {
  try {
    const user = getAuthenticatedUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' });

    const userUid = user.userUid || user.loginId || user.id || '';
    const conversation = getConversationById(req.params.conversationId);
    const savedMeetingPolicy = sanitizeMeetingAccessPolicy(conversation?.meeting?.accessPolicy || { mode: 'members' }, conversation?.meeting?.roomCode || '');
    if (!isConversationParticipant(conversation, userUid)) {
      if (savedMeetingPolicy.mode !== 'public' && savedMeetingPolicy.mode !== 'link') {
        return res.status(403).json({ error: 'FORBIDDEN', message: 'Conversation membership is required.' });
      }
      if (!verifyMeetingAccessPassword(conversation?.meeting?.roomCode || getConversationMeetingCode(conversation?.conversationId), { accessPolicy: savedMeetingPolicy }, req.body?.accessPassword || '')) {
        return res.status(403).json({ error: 'PASSWORD_REQUIRED', message: '회의 입장 비밀번호가 필요하거나 올바르지 않습니다.' });
      }
      if (savedMeetingPolicy.entryMode === 'approval') {
        requestConversationJoin({ conversationId: conversation.conversationId, userUid });
        return res.status(202).json({ error: 'APPROVAL_REQUIRED', message: '방장 승인 후 입장할 수 있습니다.' });
      }
      upsertConversationParticipant({ conversationId: conversation.conversationId, userUid });
    }

    const existingEntry = [...meetingRooms.entries()]
      .find(([, room]) => room.conversationId === conversation.conversationId);
    if (existingEntry) {
      return res.json({
        success: true,
        room: getMeetingRoomSummary(existingEntry[0], existingEntry[1], userUid),
        existed: true
      });
    }

    const requestedRoomId = normalizeMeetingRoomId(req.body?.roomCode || conversation.meeting?.roomCode) || getConversationMeetingCode(conversation.conversationId);
    const requestedTitle = sanitizeMeetingTitle(req.body?.title, conversation.title || '채팅방 회의');
    const occupiedRoom = meetingRooms.get(requestedRoomId);
    if (occupiedRoom && occupiedRoom.conversationId !== conversation.conversationId) {
      return res.status(409).json({ error: 'ROOM_CODE_TAKEN', message: 'Meeting code is already in use.' });
    }

    const room = occupiedRoom || {
      participants: new Map(),
      title: requestedTitle,
      createdAt: nowIso(),
      lastActivityAt: nowIso(),
      conversationId: conversation.conversationId,
      accessPolicy: sanitizeMeetingAccessPolicy(conversation.meeting?.accessPolicy || { mode: 'members' }, requestedRoomId),
      recording: { status: 'idle', startedByUserUid: null, startedAt: null },
      ai: { status: 'idle', startedByUserUid: null, startedAt: null },
      hostSocketId: '',
      hostUserUid: userUid
    };
    room.conversationId = conversation.conversationId;
    room.title = sanitizeMeetingTitle(room.title || requestedTitle, conversation.title || '채팅방 회의');
    room.hostDisplayName = getMeetingHostDisplayName(room);
    room.accessPolicy = sanitizeMeetingAccessPolicy(conversation.meeting?.accessPolicy || { mode: 'members' }, requestedRoomId, room.accessPolicy);
    room.lastActivityAt = nowIso();
    if (!room.hostUserUid) room.hostUserUid = userUid;
    meetingRooms.set(requestedRoomId, room);

    if (!room.startedAnnouncementSent) {
      room.startedAnnouncementSent = true;
      publishLinkedMeetingChatEvent({
        conversationId: conversation.conversationId,
        actorUserUid: userUid,
        roomId: requestedRoomId,
        type: 'meeting_started',
        title: '회의가 시작되었습니다',
        text: '채팅방 화상회의가 시작되었습니다.'
      });
    }

    res.json({
      success: true,
      room: getMeetingRoomSummary(requestedRoomId, room, userUid),
      existed: false
    });
  } catch (err) {
    if (err.code === 'SESSION_REPLACED') {
      res.clearCookie('token', getClearAuthCookieOptions(req));
      return res.status(401).json({ error: 'SESSION_REPLACED' });
    }
    res.status(500).json({ error: 'MEETING_START_FAILED' });
  }
});

app.post('/api/meetings/:roomId/save', (req, res) => {
  try {
    const user = getAuthenticatedUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'LOGIN_REQUIRED' });

    const userUid = user.userUid || user.loginId || user.id || '';
    const roomId = normalizeMeetingRoomId(req.params.roomId);
    const room = meetingRooms.get(roomId);
    if (!room) return res.status(404).json({ error: 'ROOM_NOT_FOUND', message: '저장할 회의방을 찾을 수 없습니다.' });
    if (room.hostUserUid && room.hostUserUid !== userUid) {
      return res.status(403).json({ error: 'HOST_ONLY', message: '회의 방장만 정규 회의방으로 저장할 수 있습니다.' });
    }
    if (room.conversationId) {
      const conversation = getConversationById(room.conversationId);
      return res.json({
        success: true,
        conversation,
        room: getMeetingRoomSummary(roomId, room, userUid),
        existed: true
      });
    }

    const title = sanitizeMeetingTitle(req.body?.title || room.title, '정규 회의방');
    const accessPolicy = sanitizeMeetingAccessPolicy(req.body?.accessPolicy || room.accessPolicy || {}, roomId, room.accessPolicy);
    const memberUids = [...room.participants.values()]
      .filter((participant) => !participant.isGuest && participant.userUid && !participant.lobbyOnly)
      .map((participant) => participant.userUid);

    const conversation = createMeetingConversation({
      title,
      creatorUid: userUid,
      participantUids: memberUids,
      roomCode: roomId,
      accessPolicy
    });

    room.conversationId = conversation.conversationId;
    room.title = title;
    room.accessPolicy = accessPolicy;
    room.lastActivityAt = nowIso();

    const history = getMeetingChatMessages(roomId);
    history.forEach((message) => {
      const senderUid = message.isGuest ? `meeting_${message.senderSocketId || crypto.randomBytes(4).toString('hex')}` : (message.senderUserUid || userUid);
      const senderName = message.senderDisplayName || '참가자';
      const text = message.isGuest ? `${senderName}: ${message.content}` : message.content;
      try {
        createStoredChatMessage({
          conversationId: conversation.conversationId,
          senderUid,
          text,
          allowExternalSender: !!message.isGuest
        });
      } catch (err) {
        console.warn('[meeting save] failed to persist meeting message', err.message);
      }
    });

    publishLinkedMeetingChatEvent({
      conversationId: conversation.conversationId,
      actorUserUid: userUid,
      roomId,
      type: 'meeting_saved',
      title: '정규 회의방으로 저장되었습니다',
      text: '임시 회의가 정규 회의방으로 저장되었습니다.'
    });

    emitMeetingRoomState(roomId);
    res.json({
      success: true,
      conversation: getConversationById(conversation.conversationId),
      room: getMeetingRoomSummary(roomId, room, userUid),
      existed: false
    });
  } catch (err) {
    if (err.code === 'SESSION_REPLACED') {
      res.clearCookie('token', getClearAuthCookieOptions(req));
      return res.status(401).json({ error: 'SESSION_REPLACED' });
    }
    console.error('[meeting save] failed', err);
    res.status(500).json({ error: 'MEETING_SAVE_FAILED', message: '회의방을 저장할 수 없습니다.' });
  }
});

io.on('connection', (socket) => {
  const cookies = socket.handshake.headers.cookie;
  if (cookies) {
    const token = cookies.split('; ').find(row => row.startsWith('token='))?.split('=')[1];
    try { 
      const decoded = jwt.verify(token, JWT_SECRET);

      if (isTokenSessionReplaced(decoded)) {
        socket.emit('duplicate_login');
        socket.disconnect(true);
        return;
      }

      socket.loginId = decoded.loginId || decoded.id;
      socket.userId = socket.loginId;
      socket.userUid = decoded.userUid || socket.userId;
      socket.authSessionId = decoded.sessionId || '';
      const sessionTimerKey = `${socket.userId}:${socket.authSessionId}`;
      const existingSessionTimer = sessionLogoutTimers.get(sessionTimerKey);
      if (existingSessionTimer) clearTimeout(existingSessionTimer);
      sessionLogoutTimers.delete(sessionTimerKey);

      activeUsers.set(socket.userId, socket.id);
      const socketUser = findApprovedUserByAnyId(socket.userUid || socket.userId);
      const socketSession = findUserActiveSession(socketUser || {}, socket.authSessionId);
      if (socketUser && socketSession) {
        socketSession.lastSeenAt = nowIso();
        setUserActiveSessions(socketUser, getUserActiveSessions(socketUser).map((session) =>
          session.sessionId === socket.authSessionId ? socketSession : session
        ));
        saveMembers();
      }
      socket.join(`user:${socket.userUid}`);

      // 📦 [공간 동기화] 아이콘 이동 시 절대 경로로 변환하여 저장
      socket.on('move_icons', (data) => {
        let changed = false;
        for (const [relPath, pos] of Object.entries(data)) {
            const absPath = getAbsPath(decoded, relPath);
            globalIcons[absPath] = pos;
            changed = true;
        }
        if (changed) {
            fs.writeFileSync(iconDataPath, JSON.stringify(globalIcons));
            socket.broadcast.emit('icons_changed'); // 나 빼고 모두에게 "DB 업데이트 됨!" 알림
        }
      });

      // 📦 [동기화] 누군가 아이콘을 옮겼을 때 수신 및 전체 방송
      socket.on('move_icons', (data) => {
        globalIcons = { ...globalIcons, ...data };
        fs.writeFileSync(iconDataPath, JSON.stringify(globalIcons)); // 파일로 영구 저장!
        socket.broadcast.emit('sync_icons', data); // 나 빼고 모두에게 "아이콘 움직여!" 방송
      });

      
      // 🖱️ [2단계] 마우스 커서 위치 수신 및 타인에게 방송
      socket.on('cursor_move', (data) => {
        socket.broadcast.emit('cursor_update', { 
          socketId: socket.id, 
          userId: socket.userId, 
          x: data.x, 
          y: data.y 
        });
      });
      io.emit('membersChanged'); 
    } catch(e){}
  }

  socket.on('meeting:create', ({ roomId, user = {}, accessPolicy = {}, metadata = {} } = {}, ack) => {
    const normalizedRoomId = normalizeMeetingRoomId(roomId);
    if (!normalizedRoomId) {
      const payload = { success: false, code: 'INVALID_ROOM', message: '\ud68c\uc758 \ucf54\ub4dc\uac00 \uc62c\ubc14\ub974\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.' };
      if (typeof ack === 'function') ack(payload);
      else socket.emit('meeting:error', payload);
      return;
    }

    if (socket.meetingRoomId && socket.meetingRoomId !== normalizedRoomId) {
      leaveMeetingRoom(socket, socket.meetingRoomId);
    }

    let room = meetingRooms.get(normalizedRoomId);
    if (!room) {
      room = {
        participants: new Map(),
        title: sanitizeMeetingTitle(metadata.title, '임시 회의'),
        createdAt: nowIso(),
        lastActivityAt: nowIso(),
        accessPolicy: sanitizeMeetingAccessPolicy(accessPolicy, normalizedRoomId),
        recording: { status: 'idle', startedByUserUid: null, startedAt: null },
        ai: { status: 'idle', startedByUserUid: null, startedAt: null },
        hostSocketId: socket.id,
        hostUserUid: socket.userUid || user.userUid || user.id || socket.id,
        hostDisplayName: user.displayName || user.nickname || user.username || socket.loginId || '방장'
      };
      meetingRooms.set(normalizedRoomId, room);
    }

    if (!room.hostSocketId) {
      room.hostSocketId = socket.id;
      room.hostUserUid = socket.userUid || user.userUid || user.id || socket.id;
      room.hostDisplayName = user.displayName || user.nickname || user.username || socket.loginId || '방장';
    }
    if (socket.id === room.hostSocketId) {
      room.accessPolicy = sanitizeMeetingAccessPolicy(accessPolicy, normalizedRoomId, room.accessPolicy);
      room.title = sanitizeMeetingTitle(metadata.title, room.title || '임시 회의');
    }
    room.lastActivityAt = nowIso();

    const participant = getMeetingParticipant(socket, { ...user, lobbyOnly: true });
    room.participants.set(socket.id, participant);
    socket.meetingRoomId = normalizedRoomId;
    socket.join(`meeting:${normalizedRoomId}`);

    const state = getMeetingRoomState(normalizedRoomId, room);
    if (typeof ack === 'function') ack({ success: true, room: state });
    emitMeetingRoomState(normalizedRoomId);
  });

  socket.on('meeting:join', ({ roomId, user = {}, requireExisting = false, conversationId = null, accessPolicy = null, accessPassword = '', metadata = {} } = {}, ack) => {
    const normalizedRoomId = normalizeMeetingRoomId(roomId);
    if (!normalizedRoomId) {
      const payload = { success: false, code: 'INVALID_ROOM', message: '\ud68c\uc758 \ucf54\ub4dc\uac00 \uc62c\ubc14\ub974\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.' };
      if (typeof ack === 'function') ack(payload);
      else socket.emit('meeting:error', payload);
      return;
    }

    if (socket.meetingRoomId && socket.meetingRoomId !== normalizedRoomId) {
      leaveMeetingRoom(socket, socket.meetingRoomId);
    }

    let room = meetingRooms.get(normalizedRoomId);
    const guestJoin = !!user.isGuest || user.role === 'GUEST' || String(user.userUid || '').startsWith('guest_');
    const savedConversation = !room ? getMeetingConversationByRoomCode(normalizedRoomId) : null;
    const savedPolicy = savedConversation
      ? sanitizeMeetingAccessPolicy(savedConversation.meeting?.accessPolicy || {}, normalizedRoomId)
      : null;
    if (!room && (requireExisting || guestJoin)) {
      if (!savedConversation || !['public', 'link'].includes(savedPolicy.mode)) {
        const payload = { success: false, code: 'ROOM_EXPIRED', message: '\uc885\ub8cc\ub418\uc5c8\uac70\ub098 \uc874\uc7ac\ud558\uc9c0 \uc54a\ub294 \ud68c\uc758\uc785\ub2c8\ub2e4.' };
        if (typeof ack === 'function') ack(payload);
        else socket.emit('meeting:error', payload);
        return;
      }
      if (!verifyMeetingAccessPassword(normalizedRoomId, { accessPolicy: savedPolicy }, accessPassword)) {
        const payload = { success: false, code: 'PASSWORD_REQUIRED', message: '회의 입장 비밀번호가 필요하거나 올바르지 않습니다.' };
        if (typeof ack === 'function') ack(payload);
        else socket.emit('meeting:error', payload);
        return;
      }
      if (savedPolicy.entryMode === 'approval') {
        const payload = { success: false, code: 'APPROVAL_REQUIRED', message: '방장 승인 후 입장할 수 있습니다.' };
        if (typeof ack === 'function') ack(payload);
        else socket.emit('meeting:error', payload);
        return;
      }
    }

    const joiningUserUid = socket.userUid || user.userUid || user.id || '';
    const requestedConversation = conversationId ? getConversationById(conversationId) : null;
    const allowedConversationId = requestedConversation?.participantUids?.includes(joiningUserUid)
      ? requestedConversation.conversationId
      : null;

    if (room?.conversationId) {
      const roomConversation = getConversationById(room.conversationId);
      const roomPolicy = sanitizeMeetingAccessPolicy(room.accessPolicy || roomConversation?.meeting?.accessPolicy || {}, normalizedRoomId);
      const canExternalJoin = ['public', 'link'].includes(roomPolicy.mode)
        && verifyMeetingAccessPassword(normalizedRoomId, { accessPolicy: roomPolicy }, accessPassword)
        && roomPolicy.entryMode !== 'approval';
      if (!isConversationParticipant(roomConversation, joiningUserUid) && !canExternalJoin) {
        const payload = { success: false, code: 'CONVERSATION_MEMBERS_ONLY', message: 'This meeting is limited to chat room members.' };
        if (typeof ack === 'function') ack(payload);
        else socket.emit('meeting:error', payload);
        return;
      }
    }

    if (!room) {
      room = {
        participants: new Map(),
        title: sanitizeMeetingTitle(metadata.title, savedConversation?.title || (allowedConversationId ? '채팅방 회의' : '임시 회의')),
        createdAt: nowIso(),
        lastActivityAt: nowIso(),
        conversationId: savedConversation?.conversationId || allowedConversationId,
        accessPolicy: savedConversation
          ? savedPolicy
          : allowedConversationId
          ? sanitizeMeetingAccessPolicy({ mode: 'members' }, normalizedRoomId)
          : sanitizeMeetingAccessPolicy(accessPolicy || { mode: 'private' }, normalizedRoomId),
        recording: { status: 'idle', startedByUserUid: null, startedAt: null },
        ai: { status: 'idle', startedByUserUid: null, startedAt: null },
        hostSocketId: socket.id,
        hostUserUid: socket.userUid || user.userUid || user.id || socket.id,
        hostDisplayName: user.displayName || user.nickname || user.username || socket.loginId || '방장'
      };
      meetingRooms.set(normalizedRoomId, room);
    }
    if (!room.conversationId && allowedConversationId) {
      room.conversationId = allowedConversationId;
      room.accessPolicy = sanitizeMeetingAccessPolicy({ mode: 'members' }, normalizedRoomId, room.accessPolicy);
    }
    if (room.hostSocketId === socket.id && accessPolicy && !room.conversationId) {
      room.accessPolicy = sanitizeMeetingAccessPolicy(accessPolicy, normalizedRoomId, room.accessPolicy);
      room.title = sanitizeMeetingTitle(metadata.title, room.title || '임시 회의');
    }
    if (!room.conversationId && !verifyMeetingAccessPassword(normalizedRoomId, room, accessPassword)) {
      const payload = { success: false, code: 'PASSWORD_REQUIRED', message: '회의 입장 비밀번호가 필요하거나 올바르지 않습니다.' };
      if (typeof ack === 'function') ack(payload);
      else socket.emit('meeting:error', payload);
      return;
    }
    if (room.conversationId && !room.startedAnnouncementSent) {
      room.startedAnnouncementSent = true;
      publishLinkedMeetingChatEvent({
        conversationId: room.conversationId,
        actorUserUid: joiningUserUid,
        roomId: normalizedRoomId,
        type: 'meeting_started',
        title: '회의가 시작되었습니다',
        text: '채팅방 화상회의가 시작되었습니다.'
      });
    }

    const participant = getMeetingParticipant(socket, { ...user, lobbyOnly: false });
    room.lastActivityAt = nowIso();
    const replacedParticipants = [...room.participants.values()].filter((item) => {
      if (item.socketId === socket.id || !item.userUid || item.userUid !== participant.userUid) return false;

      const sameGuestDevice = item.isGuest && participant.isGuest;
      if (sameGuestDevice) return true;

      return !!item.sessionId
        && !!participant.sessionId
        && item.sessionId === participant.sessionId;
    });

    replacedParticipants.forEach((item) => {
      const replacedTimer = meetingDisconnectTimers.get(item.socketId);
      if (replacedTimer) clearTimeout(replacedTimer);
      meetingDisconnectTimers.delete(item.socketId);
      room.participants.delete(item.socketId);
      const oldSocket = io.sockets.sockets.get(item.socketId);
      if (oldSocket) {
        oldSocket.leave(`meeting:${normalizedRoomId}`);
        if (oldSocket.meetingRoomId === normalizedRoomId) oldSocket.meetingRoomId = '';
      }
      io.to(`meeting:${normalizedRoomId}`).emit('meeting:peer-left', {
        roomId: normalizedRoomId,
        socketId: item.socketId
      });
      if (room.hostSocketId === item.socketId) {
        room.hostSocketId = socket.id;
        room.hostUserUid = participant.userUid || '';
      }
    });

    room.participants.set(socket.id, {
      ...participant,
      temporarilyDisconnected: false,
      disconnectedAt: ''
    });
    const reconnectTimer = meetingDisconnectTimers.get(socket.id);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    meetingDisconnectTimers.delete(socket.id);
    socket.meetingRoomId = normalizedRoomId;
    socket.join(`meeting:${normalizedRoomId}`);

    const state = getMeetingRoomState(normalizedRoomId, room);
    const existingParticipants = state.participants.filter((item) => item.socketId !== socket.id && isActiveMeetingParticipant(item));
    if (typeof ack === 'function') {
      ack({ success: true, room: state, participants: existingParticipants, messages: getMeetingChatMessages(normalizedRoomId) });
    }

    socket.emit('meeting:participants', {
      roomId: normalizedRoomId,
      participants: existingParticipants
    });

    socket.to(`meeting:${normalizedRoomId}`).emit('meeting:peer-joined', {
      roomId: normalizedRoomId,
      participant: annotateMeetingParticipants([...room.participants.values()])
        .find((item) => item.socketId === socket.id) || participant
    });

    socket.emit('meeting:chat-history', {
      roomId: normalizedRoomId,
      messages: getMeetingChatMessages(normalizedRoomId)
    });
    emitMeetingRoomState(normalizedRoomId);
  });

  socket.on('meeting:chat-send', ({ roomId, content } = {}, ack) => {
    const normalizedRoomId = normalizeMeetingRoomId(roomId || socket.meetingRoomId);
    const room = meetingRooms.get(normalizedRoomId);
    const participant = room?.participants?.get(socket.id);
    const safeContent = String(content || '').trim().slice(0, 2000);

    if (!room || !participant) {
      if (typeof ack === 'function') ack({ success: false, message: '\ud604\uc7ac \ucc38\uac00 \uc911\uc778 \ud68c\uc758\uc5d0\uc11c\ub9cc \ucc44\ud305\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.' });
      return;
    }
    if (!safeContent) {
      if (typeof ack === 'function') ack({ success: false, message: '\uba54\uc2dc\uc9c0\ub97c \uc785\ub825\ud574\uc8fc\uc138\uc694.' });
      return;
    }
    room.lastActivityAt = nowIso();

    const rawName = participant.displayName || participant.loginId || '\ucc38\uac00\uc790';
    const displayName = participant.isGuest && !rawName.startsWith('(guest)')
      ? `(guest) ${rawName}`
      : rawName;
    const message = appendMeetingChatMessage(normalizedRoomId, {
      messageId: typeof crypto.randomUUID === 'function'
        ? `mtgmsg_${crypto.randomUUID().replace(/-/g, '')}`
        : `mtgmsg_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`,
      roomId: normalizedRoomId,
      content: safeContent,
      createdAt: nowIso(),
      senderSocketId: socket.id,
      senderUserUid: participant.userUid || '',
      senderLoginId: participant.loginId || '',
      senderDisplayName: displayName,
      isGuest: !!participant.isGuest
    });

    if (room.conversationId) {
      try {
        const storedText = participant.isGuest ? `${displayName}: ${safeContent}` : safeContent;
        const stored = createStoredChatMessage({
          conversationId: room.conversationId,
          senderUid: participant.userUid || `meeting_${socket.id}`,
          text: storedText,
          allowExternalSender: !!participant.isGuest
        });
        (stored.conversation.participantUids || []).forEach((userUid) => {
          io.to(`user:${userUid}`).emit('chat:message', {
            conversationId: room.conversationId,
            message: stored.message,
            sender: {
              userUid: participant.userUid || '',
              username: participant.loginId || '',
              displayName,
              role: participant.isGuest ? 'GUEST' : 'USER'
            }
          });
        });
      } catch (err) {
        console.warn('[meeting chat] linked conversation persistence failed', err.message);
      }
    }

    io.to(`meeting:${normalizedRoomId}`).emit('meeting:chat-message', {
      roomId: normalizedRoomId,
      message
    });
    if (typeof ack === 'function') ack({ success: true, message });
  });

  socket.on('meeting:signal', ({ roomId, targetSocketId, signal } = {}) => {
    const normalizedRoomId = normalizeMeetingRoomId(roomId);
    if (!normalizedRoomId || !targetSocketId || !signal) return;

    io.to(targetSocketId).emit('meeting:signal', {
      roomId: normalizedRoomId,
      fromSocketId: socket.id,
      signal
    });
  });

  socket.on('meeting:media-state', ({ roomId, audioEnabled, videoEnabled, screenSharing } = {}) => {
    const normalizedRoomId = normalizeMeetingRoomId(roomId || socket.meetingRoomId);
    const room = meetingRooms.get(normalizedRoomId);
    if (!room || !room.participants.has(socket.id)) return;
    room.lastActivityAt = nowIso();

    const participant = room.participants.get(socket.id);
    const nextParticipant = {
      ...participant,
      audioEnabled: audioEnabled !== false,
      videoEnabled: videoEnabled !== false,
      screenSharing: !!screenSharing
    };

    room.participants.set(socket.id, nextParticipant);
    socket.to(`meeting:${normalizedRoomId}`).emit('meeting:peer-media-state', {
      roomId: normalizedRoomId,
      participant: nextParticipant
    });
    emitMeetingRoomState(normalizedRoomId);
  });

  socket.on('meeting:resync', ({ roomId } = {}, ack) => {
    const normalizedRoomId = normalizeMeetingRoomId(roomId || socket.meetingRoomId);
    const room = meetingRooms.get(normalizedRoomId);
    if (!room || !room.participants.has(socket.id)) {
      if (typeof ack === 'function') ack({ success: false, message: '회의 참가 상태를 다시 확인할 수 없습니다.' });
      return;
    }

    room.lastActivityAt = nowIso();
    const state = getMeetingRoomState(normalizedRoomId, room);
    const existingParticipants = state.participants.filter((item) => item.socketId !== socket.id && isActiveMeetingParticipant(item));
    socket.emit('meeting:participants', {
      roomId: normalizedRoomId,
      participants: existingParticipants
    });
    socket.emit('meeting:room-state', state);
    if (typeof ack === 'function') ack({ success: true, room: state, participants: existingParticipants });
  });

  socket.on('meeting:end', ({ roomId } = {}) => {
    const normalizedRoomId = normalizeMeetingRoomId(roomId || socket.meetingRoomId);
    const room = meetingRooms.get(normalizedRoomId);
    if (!room) return;
    if (room.hostSocketId && room.hostSocketId !== socket.id) {
      socket.emit('meeting:error', { code: 'HOST_ONLY', message: '\ud68c\uc758 \ud638\uc2a4\ud2b8\ub9cc \ud68c\uc758\ub97c \uc885\ub8cc\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.' });
      return;
    }
    endMeetingRoom(normalizedRoomId, socket.id);
  });

  socket.on('meeting:update-settings', ({ roomId, title, accessPolicy = {} } = {}, ack) => {
    const normalizedRoomId = normalizeMeetingRoomId(roomId || socket.meetingRoomId);
    const room = meetingRooms.get(normalizedRoomId);
    if (!room) {
      if (typeof ack === 'function') ack({ success: false, message: '회의방을 찾을 수 없습니다.' });
      return;
    }

    const actorUid = socket.userUid || socket.loginId || socket.id;
    const conversation = room.conversationId ? getConversationById(room.conversationId) : null;
    const canUpdate = room.hostSocketId === socket.id || (conversation && ['owner', 'cohost'].includes(require('./chatStore').getConversationRole(conversation, actorUid)));
    if (!canUpdate) {
      if (typeof ack === 'function') ack({ success: false, message: '방장만 회의방 설정을 수정할 수 있습니다.' });
      return;
    }

    const nextTitle = sanitizeMeetingTitle(title, room.title || '화상회의');
    const nextPolicy = sanitizeMeetingAccessPolicy(accessPolicy, normalizedRoomId, room.accessPolicy);
    room.title = nextTitle;
    room.accessPolicy = nextPolicy;
    room.lastActivityAt = nowIso();

    let updatedConversation = null;
    if (room.conversationId) {
      try {
        updatedConversation = updateMeetingConversationSettings({
          conversationId: room.conversationId,
          actorUid,
          title: nextTitle,
          accessPolicy: nextPolicy
        });
      } catch (err) {
        console.warn('[meeting settings] conversation update failed', err.message);
      }
    }

    emitMeetingRoomState(normalizedRoomId);
    if (typeof ack === 'function') {
      ack({
        success: true,
        room: getMeetingRoomSummary(normalizedRoomId, room, actorUid),
        conversation: updatedConversation
      });
    }
  });

  socket.on('meeting:transfer-host', ({ roomId, targetSocketId } = {}, ack) => {
    const normalizedRoomId = normalizeMeetingRoomId(roomId || socket.meetingRoomId);
    const room = meetingRooms.get(normalizedRoomId);
    const target = room?.participants?.get(targetSocketId);

    if (!room || room.hostSocketId !== socket.id) {
      if (typeof ack === 'function') ack({ success: false, message: '\ud68c\uc758 \ubc29\uc7a5\ub9cc \ubc29\uc7a5\uc744 \uc704\uc784\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.' });
      return;
    }
    if (!target || target.lobbyOnly || targetSocketId === socket.id) {
      if (typeof ack === 'function') ack({ success: false, message: '\ubc29\uc7a5\uc744 \uc704\uc784\ud560 \ucc38\uac00\uc790\ub97c \ud655\uc778\ud574\uc8fc\uc138\uc694.' });
      return;
    }

    room.hostSocketId = target.socketId;
    room.hostUserUid = target.userUid || '';
    emitMeetingRoomState(normalizedRoomId);
    if (typeof ack === 'function') ack({ success: true });
  });

  socket.on('meeting:kick', ({ roomId, targetSocketId } = {}, ack) => {
    const normalizedRoomId = normalizeMeetingRoomId(roomId || socket.meetingRoomId);
    const room = meetingRooms.get(normalizedRoomId);
    const target = room?.participants?.get(targetSocketId);

    if (!room || room.hostSocketId !== socket.id) {
      if (typeof ack === 'function') ack({ success: false, message: '\ud68c\uc758 \ubc29\uc7a5\ub9cc \ucc38\uac00\uc790\ub97c \ub0b4\ubcf4\ub0bc \uc218 \uc788\uc2b5\ub2c8\ub2e4.' });
      return;
    }
    if (!target || targetSocketId === socket.id) {
      if (typeof ack === 'function') ack({ success: false, message: '\ub0b4\ubcf4\ub0bc \ucc38\uac00\uc790\ub97c \ud655\uc778\ud574\uc8fc\uc138\uc694.' });
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.emit('meeting:kicked', { roomId: normalizedRoomId });
      leaveMeetingRoom(targetSocket, normalizedRoomId);
    } else {
      room.participants.delete(targetSocketId);
      emitMeetingRoomState(normalizedRoomId);
    }
    if (typeof ack === 'function') ack({ success: true });
  });

  socket.on('meeting:leave', ({ roomId } = {}) => {
    leaveMeetingRoom(socket, roomId);
  });
  
  socket.on('disconnect', () => {
    const disconnectedMeetingRoomId = socket.meetingRoomId;
    const disconnectedUserId = socket.userId;
    const disconnectedSessionId = socket.authSessionId;
    if (disconnectedMeetingRoomId) {
      const room = meetingRooms.get(disconnectedMeetingRoomId);
      if (room) {
        room.lastActivityAt = nowIso();
        const participant = room.participants.get(socket.id);
        if (participant) {
          room.participants.set(socket.id, {
            ...participant,
            temporarilyDisconnected: true,
            disconnectedAt: nowIso()
          });
          socket.to(`meeting:${disconnectedMeetingRoomId}`).emit('meeting:peer-left', {
            roomId: disconnectedMeetingRoomId,
            socketId: socket.id,
            temporary: true
          });
          emitMeetingRoomState(disconnectedMeetingRoomId);
        }
      }
      const previousMeetingTimer = meetingDisconnectTimers.get(socket.id);
      if (previousMeetingTimer) clearTimeout(previousMeetingTimer);
      const meetingTimer = setTimeout(() => {
        meetingDisconnectTimers.delete(socket.id);
        const room = meetingRooms.get(disconnectedMeetingRoomId);
        if (room?.participants?.has(socket.id)) {
          leaveMeetingRoom(socket, disconnectedMeetingRoomId);
        }
      }, config.MEETING_DISCONNECT_GRACE_MS);
      meetingTimer.unref?.();
      meetingDisconnectTimers.set(socket.id, meetingTimer);
    }
    if (socket.userId) {
      // 🚨 내가 다른 기기로 접속해서 강제로 끊긴 게 아니라, 진짜 창을 닫아서 끊긴 경우에만 장부에서 삭제
      if (activeUsers.get(socket.userId) === socket.id) {
        activeUsers.delete(socket.userId);
        io.emit('cursor_remove', socket.id); // 👻 퇴장한 유저의 커서 지우기
      }
      const membersChangedTimer = setTimeout(()=>io.emit('membersChanged'), 1000);
      membersChangedTimer.unref?.();
    }

    if (disconnectedUserId && disconnectedSessionId) {
      const disconnectedUser = findApprovedUserByAnyId(disconnectedUserId);
      const disconnectedSession = findUserActiveSession(disconnectedUser || {}, disconnectedSessionId);
      if (disconnectedSession?.persistent) return;

      const sessionTimerKey = `${disconnectedUserId}:${disconnectedSessionId}`;
      const previousSessionTimer = sessionLogoutTimers.get(sessionTimerKey);
      if (previousSessionTimer) clearTimeout(previousSessionTimer);
      const sessionTimer = setTimeout(() => {
        sessionLogoutTimers.delete(sessionTimerKey);
        const sameSessionConnected = [...io.sockets.sockets.values()].some((connectedSocket) =>
          connectedSocket.userId === disconnectedUserId
          && connectedSocket.authSessionId === disconnectedSessionId
        );
        if (sameSessionConnected) return;

        const user = findApprovedUserByAnyId(disconnectedUserId);
        const session = findUserActiveSession(user || {}, disconnectedSessionId);
        if (user && session && !session.persistent) {
          removeUserActiveSession(user, disconnectedSessionId);
          saveMembers();
        }
      }, SESSION_DISCONNECT_LOGOUT_MS);
      sessionTimer.unref?.();
      sessionLogoutTimers.set(sessionTimerKey, sessionTimer);
    }
  });
});

app.get(/^\/(?!api(?:\/|$)|socket\.io(?:\/|$)).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_BUILD_PATH, 'index.html'));
});

server.listen(config.BACKEND_PORT, () => console.log(`🚀 서버 부활! :${config.BACKEND_PORT}`));
