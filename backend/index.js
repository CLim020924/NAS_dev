const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const http = require('http');           
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { runMessageRetentionCleanup } = require('./chatRetentionEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});
app.set('io', io);

const JWT_SECRET = process.env.JWT_SECRET || 'my-service-platform-secure-key-2026';
const nasPath = '/mnt/nas';
// 서버 시작 시 루트 백업 폴더 생성
const systemBackupPath = '/mnt/nas/backup';
if (!fs.existsSync(systemBackupPath)) fs.mkdirSync(systemBackupPath, { recursive: true });
 

app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

const FRONTEND_BUILD_PATH = '/var/www/html';
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
  sameSite: 'none',
  maxAge: 24 * 60 * 60 * 1000
};

const CLEAR_AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none'
};


const getUserLoginId = (user = {}) => user.loginId || user.id || '';
const getUserRole = (user = {}) => user.role || (user.Masters ? 'MASTER' : (user.Managers ? 'MANAGER' : 'USER'));

const normalizeApprovedUser = (user = {}) => {
  const loginId = (user.loginId || user.id || '').trim();
  const normalized = { ...user };

  normalized.userUid = user.userUid || generateUserUid();
  normalized.loginId = loginId;
  normalized.id = loginId;
  normalized.username = user.username || loginId;
  normalized.displayName = user.displayName || user.nickname || user.username || loginId;
  normalized.nickname = user.nickname || '';
  normalized.profile = (user.profile && typeof user.profile === 'object') ? user.profile : {};
  normalized.role = getUserRole(user);
  normalized.status = user.status || (user.disabled ? 'DISABLED' : 'ACTIVE');
  normalized.createdAt = user.createdAt || user.date || nowIso();
  normalized.approvedAt = user.approvedAt || user.createdAt || user.date || nowIso();
  normalized.disabled = !!user.disabled;
  normalized.globalAccess = !!user.globalAccess;
  normalized.isPasswordEnabled = !!user.isPasswordEnabled;
  normalized.activeSessionId = user.activeSessionId || '';
  normalized.activeSessionIssuedAt = user.activeSessionIssuedAt || '';
  normalized.activeSessionDeviceId = user.activeSessionDeviceId || '';

  return normalized;
};

const normalizeSignupRequest = (user = {}) => {
  const loginId = (user.loginId || user.id || '').trim();
  const normalized = { ...user };

  normalized.userUid = user.userUid || generateUserUid();
  normalized.loginId = loginId;
  normalized.id = loginId;
  normalized.username = user.username || loginId;
  normalized.displayName = user.displayName || user.nickname || user.username || loginId;
  normalized.nickname = user.nickname || '';
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

const saveMembers = () => fs.writeFileSync(membersFilePath, JSON.stringify(approvedUsers, null, 2));
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

const publicApiPaths = new Set([
  '/login',
  '/signup-request'
]);

const getTokenFromRequest = (req) => req.cookies?.token;

const isTokenSessionReplaced = (decoded) => {
  const target = findApprovedUserByAnyId(decoded.userUid || decoded.loginId || decoded.id || decoded.username);
  if (!target) return true;
  if (target.disabled) return true;

  // 서버에 activeSessionId가 있는 계정은 JWT sessionId가 반드시 일치해야 함
  if (target.activeSessionId && decoded.sessionId !== target.activeSessionId) {
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
      res.clearCookie('token', CLEAR_AUTH_COOKIE_OPTIONS);
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
      res.clearCookie('token', CLEAR_AUTH_COOKIE_OPTIONS);
      return res.status(401).json({
        error: 'SESSION_REPLACED',
        message: '다른 기기에서 로그인되어 현재 세션이 종료되었습니다.'
      });
    }

    return res.json({ success: true });
  } catch (err) {
    res.clearCookie('token', CLEAR_AUTH_COOKIE_OPTIONS);
    return res.status(401).json({ error: '토큰 만료' });
  }
});

app.use('/api', enforceSingleActiveSession);

app.use('/api', nasRoutes);
app.use('/api', friendsRoutes);
app.use('/api', notificationsRoutes);
app.use('/api', chatRoutes);
app.use('/api', chatAttachmentRoutes);

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

  const role = getUserRole(user);
  const loginIdForToken = getUserLoginId(user);
  const sessionId = generateSessionId();
  const deviceId = String(req.body.deviceId || req.headers['x-device-id'] || '').trim();

  user.activeSessionId = sessionId;
  user.activeSessionIssuedAt = nowIso();
  user.activeSessionDeviceId = deviceId;
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
    rootPath: user.rootPath
  }, JWT_SECRET, { expiresIn: '1d' });

  res.cookie('token', token, AUTH_COOKIE_OPTIONS);
  res.json({
    message: '성공',
    user: {
      ...user,
      id: loginIdForToken,
      loginId: loginIdForToken,
      username: loginIdForToken,
      role
    }
  });
});

// [회원가입 요청]
app.post('/api/signup-request', (req, res) => {
  const { id, password, passwordConfirm, displayName, nickname, realName } = req.body;
  const loginId = (id || '').trim();

  if (!loginId) return res.status(400).json({ error: '아이디가 필요합니다.' });
  if (!password) return res.status(400).json({ error: '비밀번호가 필요합니다.' });
  if (passwordConfirm !== undefined && password !== passwordConfirm) return res.status(400).json({ error: '비밀번호 확인이 일치하지 않습니다.' });

  if (approvedUsers.find(u => getUserLoginId(u) === loginId) || signupRequests.find(r => getUserLoginId(r) === loginId)) {
    return res.status(400).json({ error: '이미 존재함' });
  }

  signupRequests.push(normalizeSignupRequest({
    id: loginId,
    loginId,
    password,
    displayName: displayName || loginId,
    nickname: nickname || '',
    profile: realName ? { realName } : {},
    date: new Date().toISOString().split('T')[0],
    requestedAt: nowIso()
  }));

  saveRequests();
  io.emit('membersChanged');
  res.json({ success: true });
});

// [유저 데이터 조회]
app.get('/api/users/data', (req, res) => {
  const connectedIds = Array.from(io.sockets.sockets.values()).map(s => s.userId).filter(Boolean);
  const connectedUserUids = Array.from(io.sockets.sockets.values()).map(s => s.userUid).filter(Boolean);

  const users = approvedUsers.map(u => {
    const loginId = getUserLoginId(u);
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
      rootPath: u.rootPath || ''
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
app.put('/api/users/update', (req, res) => {
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
app.post('/api/users/delete', (req, res) => {
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

// [승인/거절]

// 🔥 [긴급 복구] 가입 거절 API
app.post('/api/users/reject', (req, res) => {
  const { id } = req.body;
  const target = findSignupRequestByAnyId(id);
  if (!target) return res.status(404).json({ error: '없음' });

  signupRequests = signupRequests.filter(r => r.userUid !== target.userUid);
  saveRequests();
  io.emit('membersChanged');
  res.json({ success: true });
});

app.post('/api/users/approve', (req, res) => {
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

      // 🚨 [1단계 핵심] 중복 로그인 감지 및 기존 기기 킥오프(Kick)
      if (activeUsers.has(socket.userId)) {
        const oldSocketId = activeUsers.get(socket.userId);
        
        // 1. 기존에 접속해 있던 브라우저에 경고장 발송
        io.to(oldSocketId).emit('duplicate_login');
        
        // 2. 서버에서 기존 기기의 소켓 연결을 물리적으로 끊어버림
        const oldSocket = io.sockets.sockets.get(oldSocketId);
        if (oldSocket) oldSocket.disconnect(true);
        console.log(`[보안] ${socket.userId} 중복 접속 발생 -> 기존 세션 종료`);
      }

      // 3. 장부에 새로운 기기를 등록
      activeUsers.set(socket.userId, socket.id);
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
  
  socket.on('disconnect', () => { 
    if (socket.userId) {
      // 🚨 내가 다른 기기로 접속해서 강제로 끊긴 게 아니라, 진짜 창을 닫아서 끊긴 경우에만 장부에서 삭제
      if (activeUsers.get(socket.userId) === socket.id) {
        activeUsers.delete(socket.userId);
        io.emit('cursor_remove', socket.id); // 👻 퇴장한 유저의 커서 지우기
      }
      setTimeout(()=>io.emit('membersChanged'), 1000); 
    }
  });
});

app.get(/^\/(?!api(?:\/|$)|socket\.io(?:\/|$)).*/, (req, res) => {
  res.sendFile(path.join(FRONTEND_BUILD_PATH, 'index.html'));
});

server.listen(3030, () => console.log('🚀 서버 부활!'));
