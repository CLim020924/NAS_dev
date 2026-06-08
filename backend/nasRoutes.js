const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const archiver = require('archiver');
const { exec } = require('child_process');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

const router = express.Router();

// 🔥 [최종 방어선] 403 에러 강제 세탁 미들웨어 (프론트엔드 폭파 방지)
router.use('/files', (req, res, next) => {
  const originalStatus = res.status;
  const originalJson = res.json;
  let currentStatus = res.statusCode;

  res.status = function (code) {
    currentStatus = code;
    return originalStatus.apply(this, arguments);
  };

  res.json = function (data) {
    // GET 요청 중에 서버가 403을 뱉으려 하거나 비밀번호 에러가 나면? -> 200 정상 응답으로 위장!
    if (req.method === 'GET' && (currentStatus === 403 || (data && (data.error === 'PASSWORD_REQUIRED' || data.error === '권한 없는 경로')))) {
      res.status(200); 
      return originalJson.call(this, { locked: true, message: '이 폴더는 잠겨있습니다.' });
    }
    return originalJson.apply(this, arguments);
  };
  next();
});

const nasPath = '/mnt/nas';
const JWT_SECRET = 'my-service-platform-secure-key-2026';
const canceledSessions = new Set();
// =========================================================
// PC 바탕화면 연동 / Device Pairing 기초 구조
// =========================================================
const LINKED_DEVICE_META = '.msp-linked-device.json';
const DEVICE_DATA_DIR = path.join(__dirname, 'data');
const DEVICE_PAIRINGS_FILE = path.join(DEVICE_DATA_DIR, 'device_pairings.json');
const LINKED_DEVICES_FILE = path.join(DEVICE_DATA_DIR, 'linked_devices.json');
const AGENT_INCOMING_ROOT = path.join(nasPath, '.agent_incoming');

const createAgentToken = () => {
  return 'agt_' + crypto.randomBytes(32).toString('hex');
};

const hashAgentToken = (token) => {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
};

const normalizeAgentRelPath = (relPath) => {
  const clean = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');

  if (!clean || clean.includes('..')) {
    const err = new Error('잘못된 상대 경로입니다.');
    err.status = 400;
    throw err;
  }

  return clean;
};

const updateLinkedDeviceRecord = (device) => {
  const devices = readJsonArrayFile(LINKED_DEVICES_FILE);
  const idx = devices.findIndex(d => d.deviceId === device.deviceId);
  if (idx >= 0) devices[idx] = { ...devices[idx], ...device };
  else devices.push(device);
  writeJsonArrayFile(LINKED_DEVICES_FILE, devices);
};

const getAgentDeviceByToken = (deviceId, agentToken) => {
  const devices = readJsonArrayFile(LINKED_DEVICES_FILE);
  const device = devices.find(d => d.deviceId === deviceId);

  if (!device || !device.agentTokenHash) return null;
  if (device.agentTokenHash !== hashAgentToken(agentToken)) return null;

  return device;
};

const agentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        if (!fs.existsSync(AGENT_INCOMING_ROOT)) fs.mkdirSync(AGENT_INCOMING_ROOT, { recursive: true });
        cb(null, AGENT_INCOMING_ROOT);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + '_' + Math.random().toString(36).slice(2) + '.agentupload');
    }
  }),
  limits: {
    fileSize: 96 * 1024 * 1024
  }
});


const ensureDeviceDataFiles = () => {
  if (!fs.existsSync(DEVICE_DATA_DIR)) fs.mkdirSync(DEVICE_DATA_DIR, { recursive: true });
  for (const f of [DEVICE_PAIRINGS_FILE, LINKED_DEVICES_FILE]) {
    if (!fs.existsSync(f)) fs.writeFileSync(f, '[]');
  }
};

const readJsonArrayFile = (filePath) => {
  try {
    ensureDeviceDataFiles();
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
};

const writeJsonArrayFile = (filePath, rows) => {
  ensureDeviceDataFiles();
  fs.writeFileSync(filePath, JSON.stringify(rows || [], null, 2));
};

const getDeviceOwnerKey = (user = {}) => {
  return String(user.userUid || user.loginId || user.id || user.username || 'unknown');
};

const createPairingToken = () => {
  if (typeof crypto.randomUUID === 'function') {
    return 'pair_' + crypto.randomUUID().replace(/-/g, '');
  }
  return 'pair_' + crypto.randomBytes(16).toString('hex');
};

const createDeviceId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return 'dev_' + crypto.randomUUID().replace(/-/g, '');
  }
  return 'dev_' + crypto.randomBytes(16).toString('hex');
};

const sanitizeDeviceFolderName = (name = '내-PC') => {
  const safe = String(name || '내-PC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return safe || '내-PC';
};

const makeUniqueFolderPath = (parentDir, folderName) => {
  let finalName = folderName;
  let finalPath = path.join(parentDir, finalName);
  let counter = 1;

  while (fs.existsSync(finalPath)) {
    finalName = `${folderName} (${counter})`;
    finalPath = path.join(parentDir, finalName);
    counter += 1;
  }

  return { finalName, finalPath };
};

const readLinkedDeviceMeta = (folderPath) => {
  try {
    const metaPath = path.join(folderPath, LINKED_DEVICE_META);
    if (!fs.existsSync(metaPath)) return null;
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    return null;
  }
};

const createLinkedDeviceFolder = (user, parentReqPath, deviceInfo = {}) => {
  const { basePath, targetPath: parentDir } = getValidatedPath(user, parentReqPath || '/');

  if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
  if (!fs.statSync(parentDir).isDirectory()) {
    const err = new Error('연동 폴더를 생성할 위치가 폴더가 아닙니다.');
    err.status = 400;
    throw err;
  }

  const safeDeviceName = sanitizeDeviceFolderName(deviceInfo.deviceName || '내-PC');
  const { finalName, finalPath } = makeUniqueFolderPath(parentDir, safeDeviceName);
  fs.mkdirSync(finalPath, { recursive: true });

  const deviceId = deviceInfo.deviceId || createDeviceId();
  const meta = {
    deviceId,
    deviceName: finalName,
    originalDeviceName: deviceInfo.deviceName || finalName,
    osType: deviceInfo.osType || 'unknown',
    ownerKey: getDeviceOwnerKey(user),
    linkedNasPath: path.relative(basePath, finalPath).replace(/\\/g, '/'),
    absolutePath: finalPath,
    syncMode: 'safe-bidirectional',
    direction: 'bidirectional',
    deletePolicy: 'trash-first',
    purgePolicy: 'purge-trash-on-confirm',
    conflictPolicy: 'keep-conflict-copy',
    status: 'connected',
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(finalPath, LINKED_DEVICE_META), JSON.stringify(meta, null, 2));

  const devices = readJsonArrayFile(LINKED_DEVICES_FILE).filter(d => d.deviceId !== deviceId);
  devices.push(meta);
  writeJsonArrayFile(LINKED_DEVICES_FILE, devices);

  return {
    ...meta,
    name: finalName,
    fullPath: meta.linkedNasPath
  };
};



// =========================================================
// 대용량 청크 업로드 공통 유틸
// - Cloudflare 1회 요청 크기 제한 회피
// - 취소된 uploadId는 늦게 도착한 청크도 무효 처리
// =========================================================
const CHUNK_TMP_ROOT = path.join(nasPath, '.upload_tmp');
const CHUNK_INCOMING_ROOT = path.join(CHUNK_TMP_ROOT, '_incoming');
const CHUNK_CANCELED_ROOT = path.join(CHUNK_TMP_ROOT, '_canceled');
const canceledChunkUploads = new Map();

const ensureDirSync = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const safeRmSync = (targetPath) => {
  try {
    if (targetPath && fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  } catch (err) {}
};

const sanitizeUploadFileName = (name = 'upload.bin') => {
  const base = path.basename(String(name || 'upload.bin'));
  return base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'upload.bin';
};

const getChunkOwnerKey = (user = {}) => {
  return String(user.userUid || user.loginId || user.id || user.username || 'unknown');
};

const createChunkUploadId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return 'cup_' + crypto.randomUUID().replace(/-/g, '');
  }
  return 'cup_' + crypto.randomBytes(16).toString('hex');
};

const normalizeUploadId = (uploadId) => {
  return String(uploadId || '').replace(/[^a-zA-Z0-9_-]/g, '');
};

const getChunkDir = (uploadId) => path.join(CHUNK_TMP_ROOT, normalizeUploadId(uploadId));
const getChunkMetaPath = (uploadId) => path.join(getChunkDir(uploadId), 'meta.json');
const getChunkDoneDir = (uploadId) => path.join(getChunkDir(uploadId), 'done');
const getChunkCanceledPath = (uploadId) => path.join(CHUNK_CANCELED_ROOT, normalizeUploadId(uploadId) + '.canceled');

const cleanupOldChunkCancelMarkers = () => {
  const now = Date.now();

  for (const [uploadId, ts] of canceledChunkUploads.entries()) {
    if (now - ts > 6 * 60 * 60 * 1000) {
      canceledChunkUploads.delete(uploadId);
    }
  }

  try {
    if (!fs.existsSync(CHUNK_CANCELED_ROOT)) return;
    for (const name of fs.readdirSync(CHUNK_CANCELED_ROOT)) {
      const full = path.join(CHUNK_CANCELED_ROOT, name);
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs > 6 * 60 * 60 * 1000) {
        safeRmSync(full);
      }
    }
  } catch (err) {}
};

const readChunkMeta = (uploadId) => {
  const metaPath = getChunkMetaPath(uploadId);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    return null;
  }
};

const writeChunkMeta = (uploadId, meta) => {
  ensureDirSync(getChunkDir(uploadId));
  fs.writeFileSync(getChunkMetaPath(uploadId), JSON.stringify({
    ...meta,
    updatedAt: new Date().toISOString()
  }, null, 2));
};

const isChunkUploadCanceled = (uploadId) => {
  const safeId = normalizeUploadId(uploadId);
  if (!safeId) return true;
  if (canceledChunkUploads.has(safeId)) return true;
  if (fs.existsSync(getChunkCanceledPath(safeId))) return true;
  return false;
};

const markChunkUploadCanceled = (uploadId) => {
  const safeId = normalizeUploadId(uploadId);
  if (!safeId) return;

  ensureDirSync(CHUNK_CANCELED_ROOT);
  canceledChunkUploads.set(safeId, Date.now());

  try {
    fs.writeFileSync(getChunkCanceledPath(safeId), new Date().toISOString());
  } catch (err) {}
};

const assertChunkOwner = (req, meta) => {
  const currentOwner = getChunkOwnerKey(req.user);
  if (!meta || meta.ownerKey !== currentOwner) {
    const err = new Error('업로드 세션 권한이 없습니다.');
    err.status = 403;
    throw err;
  }
};

const listReceivedChunkIndexes = (uploadId) => {
  const doneDir = getChunkDoneDir(uploadId);
  if (!fs.existsSync(doneDir)) return [];

  return fs.readdirSync(doneDir)
    .filter((name) => /^chunk_\d+\.done$/.test(name))
    .map((name) => Number(name.match(/^chunk_(\d+)\.done$/)[1]))
    .filter((num) => Number.isInteger(num))
    .sort((a, b) => a - b);
};

const precheckChunkCanceled = (req, res, next) => {
  cleanupOldChunkCancelMarkers();

  const uploadId = normalizeUploadId(
    req.headers['x-upload-id'] ||
    req.query.uploadId ||
    req.body?.uploadId ||
    ''
  );

  if (uploadId && isChunkUploadCanceled(uploadId)) {
    return res.status(409).json({ error: 'UPLOAD_CANCELED' });
  }

  next();
};

const chunkUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        ensureDirSync(CHUNK_INCOMING_ROOT);
        cb(null, CHUNK_INCOMING_ROOT);
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const uploadId = normalizeUploadId(req.headers['x-upload-id'] || 'unknown');
      const chunkIndex = String(req.headers['x-chunk-index'] || '0').replace(/[^0-9]/g, '');
      cb(null, Date.now() + '_' + uploadId + '_' + chunkIndex + '_' + Math.random().toString(36).slice(2) + '.part');
    }
  }),
  limits: {
    fileSize: 96 * 1024 * 1024
  }
});


const verifyToken = (req, res, next) => {
  // 🔥 [복구] ONLYOFFICE 도커 서버의 비밀 통로 (토큰 검사 우회)
  if (req.query.oosecret === 'nas_office_2026') {
    const isActuallyAdmin = req.query.officeAdmin === 'true';
    const officeLoginId = req.query.officeUid || 'office';
    req.user = { 
        id: officeLoginId,
        loginId: officeLoginId,
        userUid: officeLoginId,
        Masters: isActuallyAdmin,
        globalAccess: isActuallyAdmin,
        rootPath: isActuallyAdmin ? '' : decodeURIComponent(req.query.officeRoot || '')
    };
    return next();
}
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } 
  catch (e) { res.status(401).json({ error: '인증실패' }); }
};

const getValidatedPath = (user, requestedPath, providedPassword) => {
  const isPrivileged = user.Masters || user.globalAccess;
  const path = require('path');
  const fs = require('fs');

  const currentLoginId = user.loginId || user.id;
  let relativeRoot = user.rootPath ? user.rootPath.replace(/^(\/|\\)+/, '') : path.join('users', currentLoginId);
  const basePath = isPrivileged ? nasPath : path.resolve(nasPath, relativeRoot);
  const safeReqPath = (requestedPath || '').replace(/^(\/|\\)+/, '');
  const targetPath = path.resolve(basePath, safeReqPath);

  let hasPasswordAccess = false;

  if (targetPath.includes(path.join(nasPath, 'users'))) {
    const segments = path.relative(path.join(nasPath, 'users'), targetPath).split(path.sep);
    const targetUserId = segments[0];

    if (targetUserId && targetUserId !== currentLoginId) {
      try {
        const members = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'members.json'), 'utf8'));
        const targetUser = members.find(u => (u.loginId || u.id) === targetUserId);
        const currentUser = members.find(u => (u.loginId || u.id) === currentLoginId);

        if (targetUser) {
          if (targetUser.isPasswordEnabled) {
            const isMasterKeyCorrect = (user.Masters || user.Managers) && currentUser?.masterKey && providedPassword === currentUser.masterKey;
            const isRootPassCorrect = providedPassword === targetUser.rootPassword;

            if (!isMasterKeyCorrect && !isRootPassCorrect) { const err = new Error('PASSWORD_REQUIRED'); err.status = 403; throw err; } else {
              hasPasswordAccess = true; // ✨ 비밀번호/마스터키 맞음! VIP 패스 발급
            }
          } else {
            hasPasswordAccess = true; // ✨ 스위치 OFF 상태! 무조건 VIP 패스 발급
          }
        }
      } catch(e) { 
        if(e.message === 'PASSWORD_REQUIRED') throw e; 
      }
    }
  }

  // 🚨 [핵심 수정] VIP 패스(hasPasswordAccess)가 있다면, 내 홈 폴더 밖이라도 권한 검사를 무사통과!
  if (!isPrivileged && !hasPasswordAccess && !targetPath.startsWith(basePath)) {
    const err = new Error('권한 없는 경로');
    err.status = 403;
    throw err;
  }
  return { basePath, targetPath };
};

const getUserBasePath = (user) => {
  const isPrivileged = user.Masters || user.globalAccess;
  const currentLoginId = user.loginId || user.id;
  let relativeRoot = user.rootPath ? user.rootPath.replace(/^(\/|\\)+/, '') : path.join('users', currentLoginId);
  return isPrivileged ? nasPath : path.resolve(nasPath, relativeRoot);
};

const ensureFixedSystemFolders = (user) => {
  const basePath = getUserBasePath(user);
  const receivedFolderPath = path.join(basePath, '받은 파일');
  if (!fs.existsSync(receivedFolderPath)) {
    fs.mkdirSync(receivedFolderPath, { recursive: true });
  }

  const result = { basePath, receivedFolderPath };

  if (user.Masters || user.globalAccess) {
    const chatdataPath = path.join(nasPath, 'chatdata');
    if (!fs.existsSync(chatdataPath)) {
      fs.mkdirSync(chatdataPath, { recursive: true });
    }
    result.chatdataPath = chatdataPath;
  }

  return result;
};

router.post('/file/cancel-session', verifyToken, (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) {
    canceledSessions.add(sessionId);
    setTimeout(() => canceledSessions.delete(sessionId), 3600 * 1000);
  }
  res.json({ success: true });
});

const upload = multer({ storage: multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.headers['x-upload-session'];
    if (sessionId && canceledSessions.has(sessionId)) {
      return cb(new Error('CANCELED_SESSION')); // 🛑 Nginx가 보내는 좀비 파일 원천 차단!
    }
    try { 
      const targetDir = getValidatedPath(req.user, req.body.path || req.query.path, req.headers['x-nas-password']).targetPath;
      // 🔥 [폴더 자동 생성] 경로가 없으면 하위 폴더까지 싹 다 생성
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      cb(null, targetDir); 
    } catch(e){ cb(e); }
  },
  filename: (req, file, cb) => cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'))
})});

// [1] 파일 목록 조회
router.get('/files', verifyToken, (req, res) => {
  try {
    ensureFixedSystemFolders(req.user);
    const { basePath, targetPath } = getValidatedPath(req.user, req.query.path, req.headers['x-nas-password']);
    if (!fs.existsSync(targetPath)) return res.json([]); 
    const items = fs.readdirSync(targetPath).map(item => {
      if (item === LINKED_DEVICE_META) return null;

      const full = path.join(targetPath, item);

      try {
        const stat = fs.statSync(full);
        const rel = path.relative(basePath, full).replace(/\\/g, '/');

        if (stat.isDirectory()) {
          const linkedMeta = readLinkedDeviceMeta(full);
          if (linkedMeta) {
            return {
              name: item,
              type: 'linked-device',
              fullPath: rel,
              deviceId: linkedMeta.deviceId,
              osType: linkedMeta.osType || 'unknown',
              syncMode: linkedMeta.syncMode || 'safe-bidirectional',
              deviceStatus: linkedMeta.status || 'connected'
            };
          }
        }

        return { name: item, type: stat.isDirectory() ? 'folder' : 'file', fullPath: rel };
      } catch (err) {
        return null;
      }
    }).filter(Boolean);
    res.json(items);
  } catch (e) { res.status(403).json({ error: e.message }); }
});

// [2] 파일 업로드 / 폴더 생성
router.post('/file', verifyToken, upload.single('file'), (req, res) => {
  if (req.file) return res.json({ success: true });
  try {
    const { targetPath } = getValidatedPath(req.user, path.join(req.body.path || '', req.body.folderName), req.headers['x-nas-password']);
    if (!fs.existsSync(targetPath)) fs.mkdirSync(targetPath, { recursive: true });
    res.json({ success: true });
  } catch (e) { res.status(403).json({ error: e.message }); }
});

// [3] 파일/폴더 삭제 (🚨 강력한 보호막 적용 완료)
router.delete('/file', verifyToken, (req, res) => {
  try {
    const requestPath = req.query.path || (req.body && req.body.path);
    
    // 빈 껍데기 요청 차단
    if (!requestPath || requestPath === 'undefined' || requestPath.trim() === '' || requestPath === '/') {
      return res.status(400).json({ error: '삭제할 정확한 파일 경로가 필요합니다.' });
    }

    const { basePath, targetPath } = getValidatedPath(req.user, requestPath);
    const fixedFolders = ensureFixedSystemFolders(req.user);

    if (targetPath === fixedFolders.receivedFolderPath || targetPath === fixedFolders.chatdataPath) {
      return res.status(403).json({ error: '고정 시스템 폴더는 삭제할 수 없습니다.' });
    }

    // 최상위 루트 폴더 자체 삭제 방지
    if (basePath === targetPath) {
      return res.status(403).json({ error: '최상위 루트 폴더는 삭제할 수 없습니다.' });
    }

    // 시스템 백업 보관소 앱 내 삭제 원천 차단
    if (targetPath.includes(path.join('/mnt/nas', 'backup'))) {
      return res.status(403).json({ error: '시스템 백업 보관소는 앱 내에서 삭제할 수 없습니다.' });
    }

    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    res.json({ success: true });
  } catch (e) { res.status(403).json({ error: e.message }); }
});

// [4] 단일 파일 다운로드
router.get('/file/download', verifyToken, (req, res) => {
  try { 
    const { targetPath } = getValidatedPath(req.user, req.query.path, req.headers['x-nas-password']);
    if (req.query.inline === 'true') {
      res.sendFile(targetPath); // 브라우저 자체 뷰어로 열기 (모바일 43페이지 스크롤 가능!)
    } else {
      res.download(targetPath); // 일반 파일 다운로드
    }
  } 
  catch(e){ res.status(403).send(); }
});

// [5] 파일/폴더 복사 (Ctrl+C / Ctrl+V)
router.post('/file/copy', verifyToken, (req, res) => {
  try {
    const { sourcePaths, destinationFolder } = req.body;
    if (!sourcePaths || !Array.isArray(sourcePaths)) return res.status(400).json({ error: '잘못된 요청' });

    let destReqPath = destinationFolder;
    if (!destReqPath || destReqPath === 'undefined') destReqPath = '/';
    const { targetPath: destDir } = getValidatedPath(req.user, destReqPath);

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    sourcePaths.forEach(src => {
      const { targetPath: srcPath } = getValidatedPath(req.user, src);
      if (!fs.existsSync(srcPath)) return;

      const fileName = path.basename(srcPath);
      let finalDest = path.join(destDir, fileName);
      let counter = 1;

      while(fs.existsSync(finalDest)) {
        const ext = path.extname(fileName);
        const name = path.basename(fileName, ext);
        finalDest = path.join(destDir, `${name} - 복사본 (${counter})${ext}`);
        counter++;
      }
      fs.cpSync(srcPath, finalDest, { recursive: true });
    });
    res.json({ message: '복사 완료' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// [6] 속성 조회
router.get('/file/properties', verifyToken, (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: '경로 필요' });

    const requestedPath = String(req.query.path || '/').replace(/\\/g, '/');
    const safeRelativePath = requestedPath.startsWith('/') ? requestedPath : `/${requestedPath}`;
    const { targetPath } = getValidatedPath(req.user, safeRelativePath, req.headers['x-nas-password']);

    if (!fs.existsSync(targetPath)) return res.status(404).json({ error: '파일 없음' });

    const stats = fs.statSync(targetPath);
    const isDirectory = stats.isDirectory();
    const name = safeRelativePath === '/' ? '/' : path.basename(safeRelativePath);
    const parentPath = safeRelativePath === '/'
      ? '/'
      : (path.dirname(safeRelativePath).replace(/\\/g, '/') === '.' ? '/' : path.dirname(safeRelativePath).replace(/\\/g, '/'));

    const ext = isDirectory ? '' : path.extname(name).replace(/^\./, '').toLowerCase();

    const extTypeMap = {
      zip: 'ZIP 압축 파일',
      tar: 'TAR 압축 파일',
      gz: 'GZIP 압축 파일',
      tgz: 'TAR.GZ 압축 파일',
      txt: '텍스트 문서',
      md: 'Markdown 문서',
      json: 'JSON 파일',
      js: 'JavaScript 파일',
      jsx: 'React JSX 파일',
      ts: 'TypeScript 파일',
      tsx: 'React TSX 파일',
      html: 'HTML 문서',
      css: 'CSS 파일',
      png: 'PNG 이미지',
      jpg: 'JPEG 이미지',
      jpeg: 'JPEG 이미지',
      gif: 'GIF 이미지',
      webp: 'WEBP 이미지',
      svg: 'SVG 이미지',
      pdf: 'PDF 문서',
      doc: 'Word 문서',
      docx: 'Word 문서',
      xls: 'Excel 문서',
      xlsx: 'Excel 문서',
      ppt: 'PowerPoint 문서',
      pptx: 'PowerPoint 문서',
      hwp: '한글 문서',
      hwpx: '한글 문서',
      mp4: 'MP4 동영상',
      mov: 'MOV 동영상',
      avi: 'AVI 동영상',
      mkv: 'MKV 동영상',
      mp3: 'MP3 오디오',
      wav: 'WAV 오디오',
      flac: 'FLAC 오디오'
    };

    const permissionString = (mode) => {
      const bits = [
        [0o400, 'r'], [0o200, 'w'], [0o100, 'x'],
        [0o040, 'r'], [0o020, 'w'], [0o010, 'x'],
        [0o004, 'r'], [0o002, 'w'], [0o001, 'x']
      ];

      return bits.map(([bit, char]) => (mode & bit) ? char : '-').join('');
    };

    let itemCount = null;
    let childFileCount = null;
    let childFolderCount = null;

    if (isDirectory) {
      try {
        const children = fs.readdirSync(targetPath, { withFileTypes: true });
        itemCount = children.length;
        childFileCount = children.filter(child => child.isFile()).length;
        childFolderCount = children.filter(child => child.isDirectory()).length;
      } catch (err) {
        itemCount = null;
        childFileCount = null;
        childFolderCount = null;
      }
    }

    res.json({
      name,
      path: safeRelativePath,
      parentPath,
      extension: ext,
      typeLabel: isDirectory ? '파일 폴더' : (extTypeMap[ext] || (ext ? `${ext.toUpperCase()} 파일` : '파일')),
      size: stats.size,
      isDirectory,
      itemCount,
      childFileCount,
      childFolderCount,
      modified: stats.mtime,
      created: stats.birthtime,
      accessed: stats.atime,
      changed: stats.ctime,
      mode: stats.mode,
      permissions: permissionString(stats.mode),
      uid: stats.uid,
      gid: stats.gid
    });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});

// [7] 무확장자 감식
router.get('/file/detect', verifyToken, (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: '경로 필요' });
    const { targetPath } = getValidatedPath(req.user, req.query.path, req.headers['x-nas-password']);
    if (!fs.existsSync(targetPath)) return res.status(404).json({ error: '파일 없음' });

    exec(`file -b --mime-type "${targetPath}"`, (err, stdout) => {
      if (err) return res.json({ ext: '' });
      const mime = stdout.trim();
      let detectedExt = '';
      if (mime.includes('image/jpeg')) detectedExt = 'jpg';
      else if (mime.includes('image/png')) detectedExt = 'png';
      else if (mime.includes('application/pdf')) detectedExt = 'pdf';
      else if (mime.includes('application/zip')) detectedExt = 'zip';
      res.json({ ext: detectedExt, mime });
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// [8] 폴더 압축 다운로드
router.get('/file/download-folder', verifyToken, (req, res) => {
  try {
    if (!req.query.path) return res.status(400).json({ error: '경로 필요' });
    const { targetPath } = getValidatedPath(req.user, req.query.path, req.headers['x-nas-password']);
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) return res.status(400).json({ error: '폴더 아님' });

    const folderName = path.basename(targetPath) || 'archive';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(folderName)}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { if (!res.headersSent) res.status(500).json({ error: err.message }); });
    archive.pipe(res);
    archive.directory(targetPath, folderName);
    archive.finalize();
  } catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); }
});


// 🔥 [긴급 복구 완료] 파일 이동 및 이름 변경 (Drag & Drop) API
router.put('/file', verifyToken, (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ error: '경로가 누락되었습니다.' });

    const { targetPath: fullOldPath } = getValidatedPath(req.user, oldPath);
    const { targetPath: fullNewPath } = getValidatedPath(req.user, newPath);
    const fixedFolders = ensureFixedSystemFolders(req.user);
    const fs = require('fs');
    const path = require('path');

    if (fullOldPath === fixedFolders.receivedFolderPath || fullOldPath === fixedFolders.chatdataPath) {
      return res.status(403).json({ error: '고정 시스템 폴더는 이동하거나 이름을 바꿀 수 없습니다.' });
    }

    // 🛡️ 백업 폴더 보호막 (이동하거나 이름 바꿀 수 없음)
    if (fullOldPath.includes(path.join('/mnt/nas', 'backup')) || fullNewPath.includes(path.join('/mnt/nas', 'backup'))) {
      return res.status(403).json({ error: '시스템 백업 보관소는 건드릴 수 없습니다.' });
    }

    // 파일 이동(이름 변경) 실행
    if (fs.existsSync(fullOldPath)) {
      fs.renameSync(fullOldPath, fullNewPath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});


// 🔥 [복구] ONLYOFFICE 저장 콜백 API (문서 편집 후 저장 담당)
router.post('/onlyoffice/callback', async (req, res) => {
  const { status, url } = req.body;
  const relPath = req.query.path;
  const uid = req.query.uid;
  const isAdmin = req.query.isAdmin === 'true';

  if (status === 2 || status === 6) { 
    try {
      const axios = require('axios');
      const fs = require('fs');
      const path = require('path');
      
      const nasPath = process.env.NAS_PATH || '/mnt/nas';
      const basePath = isAdmin ? nasPath : path.join(nasPath, 'users', uid || 'default');
      const safeReqPath = (relPath || '').replace(/^(\/|\\)+/, '');
      const absoluteFilePath = path.resolve(basePath, safeReqPath);

      const response = await axios.get(url, { responseType: 'stream' });
      const writer = fs.createWriteStream(absoluteFilePath);
      response.data.pipe(writer);
      
      writer.on('finish', () => res.json({ error: 0 }));
      writer.on('error', (err) => res.json({ error: 1 }));
    } catch (error) {
      return res.json({ error: 1 });
    }
  } else {
    return res.json({ error: 0 });
  }
});


// 🛡️ [보안] 폴더 접근 전 사전 검증 API (프리플라이트 & 향후 감사 로그용)
router.post('/check-access', (req, res) => {
  try {
    getValidatedPath(req.user, req.body.path, req.headers['x-nas-password']);
    res.json({ success: true, message: 'Access Granted' });
  } catch (err) {
    res.status(err.status || 403).json({ error: err.message });
  }
});


// =========================================================
// 대용량 파일 청크 업로드 API
// =========================================================

// [청크] 업로드 세션 생성
router.post('/file/chunk/init', verifyToken, (req, res) => {
  try {
    cleanupOldChunkCancelMarkers();
    ensureDirSync(CHUNK_TMP_ROOT);
    ensureDirSync(CHUNK_INCOMING_ROOT);
    ensureDirSync(CHUNK_CANCELED_ROOT);

    const body = req.body || {};
    const folderPath = body.path || '/';
    const safeFileName = sanitizeUploadFileName(body.fileName);
    const fileSize = Number(body.fileSize);
    const chunkSize = Number(body.chunkSize);
    const totalChunks = Number(body.totalChunks);

    if (!safeFileName || !Number.isFinite(fileSize) || fileSize <= 0) {
      return res.status(400).json({ error: '파일 정보가 올바르지 않습니다.' });
    }

    if (!Number.isFinite(chunkSize) || chunkSize <= 0 || chunkSize > 96 * 1024 * 1024) {
      return res.status(400).json({ error: '청크 크기가 올바르지 않습니다.' });
    }

    if (!Number.isInteger(totalChunks) || totalChunks <= 0 || totalChunks > 200000) {
      return res.status(400).json({ error: '청크 개수가 올바르지 않습니다.' });
    }

    const { targetPath: destDir } = getValidatedPath(
      req.user,
      folderPath,
      req.headers['x-nas-password']
    );

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    if (!fs.statSync(destDir).isDirectory()) {
      return res.status(400).json({ error: '대상 경로가 폴더가 아닙니다.' });
    }

    const finalReqPath = path.join(folderPath || '/', safeFileName);
    const { targetPath: finalPath } = getValidatedPath(
      req.user,
      finalReqPath,
      req.headers['x-nas-password']
    );

    const uploadId = createChunkUploadId();
    const uploadDir = getChunkDir(uploadId);
    const doneDir = getChunkDoneDir(uploadId);

    ensureDirSync(uploadDir);
    ensureDirSync(doneDir);

    const tempPath = path.join(uploadDir, safeFileName + '.uploading');
    fs.closeSync(fs.openSync(tempPath, 'w'));

    const meta = {
      uploadId,
      ownerKey: getChunkOwnerKey(req.user),
      folderPath,
      fileName: safeFileName,
      fileSize,
      chunkSize,
      totalChunks,
      finalPath,
      tempPath,
      createdAt: new Date().toISOString(),
      status: 'uploading'
    };

    writeChunkMeta(uploadId, meta);

    return res.json({
      success: true,
      uploadId,
      fileName: safeFileName,
      chunkSize,
      totalChunks
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || '청크 업로드 세션 생성 실패'
    });
  }
});

// [청크] 이미 올라간 청크 조회
router.post('/file/chunk/status', verifyToken, (req, res) => {
  try {
    const uploadId = normalizeUploadId(req.body?.uploadId);
    const meta = readChunkMeta(uploadId);

    if (!meta) {
      return res.status(404).json({ error: '업로드 세션을 찾을 수 없습니다.' });
    }

    assertChunkOwner(req, meta);

    return res.json({
      success: true,
      uploadId,
      canceled: isChunkUploadCanceled(uploadId),
      receivedChunks: listReceivedChunkIndexes(uploadId),
      totalChunks: meta.totalChunks,
      fileSize: meta.fileSize,
      chunkSize: meta.chunkSize,
      fileName: meta.fileName
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || '청크 상태 조회 실패'
    });
  }
});

// [청크] 청크 하나 저장
router.post('/file/chunk', verifyToken, precheckChunkCanceled, chunkUpload.single('chunk'), async (req, res) => {
  const incomingPath = req.file?.path;

  try {
    const uploadId = normalizeUploadId(req.body?.uploadId || req.headers['x-upload-id']);
    const chunkIndex = Number(req.body?.chunkIndex ?? req.headers['x-chunk-index']);
    const startByte = Number(req.body?.startByte ?? req.headers['x-start-byte']);

    if (!uploadId || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
      safeRmSync(incomingPath);
      return res.status(400).json({ error: '청크 정보가 올바르지 않습니다.' });
    }

    if (isChunkUploadCanceled(uploadId)) {
      safeRmSync(incomingPath);
      return res.status(409).json({ error: 'UPLOAD_CANCELED' });
    }

    const meta = readChunkMeta(uploadId);
    if (!meta) {
      safeRmSync(incomingPath);
      return res.status(404).json({ error: '업로드 세션을 찾을 수 없습니다.' });
    }

    assertChunkOwner(req, meta);

    if (chunkIndex >= meta.totalChunks) {
      safeRmSync(incomingPath);
      return res.status(400).json({ error: '청크 번호가 범위를 벗어났습니다.' });
    }

    if (!req.file || !incomingPath || !fs.existsSync(incomingPath)) {
      return res.status(400).json({ error: '청크 파일이 없습니다.' });
    }

    const expectedStart = chunkIndex * meta.chunkSize;
    const writeStart = Number.isFinite(startByte) ? startByte : expectedStart;

    if (writeStart !== expectedStart) {
      safeRmSync(incomingPath);
      return res.status(400).json({ error: '청크 offset이 올바르지 않습니다.' });
    }

    if (req.file.size > meta.chunkSize) {
      safeRmSync(incomingPath);
      return res.status(400).json({ error: '청크 크기가 너무 큽니다.' });
    }

    if (isChunkUploadCanceled(uploadId)) {
      safeRmSync(incomingPath);
      return res.status(409).json({ error: 'UPLOAD_CANCELED' });
    }

    await pipeline(
      fs.createReadStream(incomingPath),
      fs.createWriteStream(meta.tempPath, { flags: 'r+', start: writeStart })
    );

    safeRmSync(incomingPath);

    if (isChunkUploadCanceled(uploadId)) {
      safeRmSync(meta.tempPath);
      return res.status(409).json({ error: 'UPLOAD_CANCELED' });
    }

    const doneDir = getChunkDoneDir(uploadId);
    ensureDirSync(doneDir);

    fs.writeFileSync(
      path.join(doneDir, 'chunk_' + chunkIndex + '.done'),
      JSON.stringify({
        chunkIndex,
        size: req.file.size,
        startByte: writeStart,
        receivedAt: new Date().toISOString()
      })
    );

    return res.json({
      success: true,
      uploadId,
      chunkIndex,
      receivedChunks: listReceivedChunkIndexes(uploadId).length,
      totalChunks: meta.totalChunks
    });
  } catch (err) {
    safeRmSync(incomingPath);

    if (err && err.message === 'UPLOAD_CANCELED') {
      return res.status(409).json({ error: 'UPLOAD_CANCELED' });
    }

    return res.status(err.status || 500).json({
      error: err.message || '청크 저장 실패'
    });
  }
});

// [청크] 업로드 완료
router.post('/file/chunk/complete', verifyToken, (req, res) => {
  try {
    const uploadId = normalizeUploadId(req.body?.uploadId);
    const meta = readChunkMeta(uploadId);

    if (!meta) {
      return res.status(404).json({ error: '업로드 세션을 찾을 수 없습니다.' });
    }

    assertChunkOwner(req, meta);

    if (isChunkUploadCanceled(uploadId)) {
      safeRmSync(meta.tempPath);
      safeRmSync(getChunkDir(uploadId));
      return res.status(409).json({ error: 'UPLOAD_CANCELED' });
    }

    const received = listReceivedChunkIndexes(uploadId);

    if (received.length !== meta.totalChunks) {
      return res.status(400).json({
        error: '아직 모든 청크가 업로드되지 않았습니다.',
        receivedChunks: received.length,
        totalChunks: meta.totalChunks
      });
    }

    for (let i = 0; i < meta.totalChunks; i++) {
      if (!received.includes(i)) {
        return res.status(400).json({ error: '누락된 청크가 있습니다: ' + i });
      }
    }

    if (!fs.existsSync(meta.tempPath)) {
      return res.status(404).json({ error: '임시 업로드 파일이 없습니다.' });
    }

    fs.truncateSync(meta.tempPath, meta.fileSize);

    const stat = fs.statSync(meta.tempPath);
    if (stat.size !== meta.fileSize) {
      return res.status(400).json({
        error: '최종 파일 크기 검증 실패',
        expected: meta.fileSize,
        actual: stat.size
      });
    }

    if (isChunkUploadCanceled(uploadId)) {
      safeRmSync(meta.tempPath);
      safeRmSync(getChunkDir(uploadId));
      return res.status(409).json({ error: 'UPLOAD_CANCELED' });
    }

    const finalDir = path.dirname(meta.finalPath);
    if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

    fs.renameSync(meta.tempPath, meta.finalPath);
    safeRmSync(getChunkDir(uploadId));

    return res.json({
      success: true,
      fileName: meta.fileName,
      size: meta.fileSize
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || '청크 업로드 완료 처리 실패'
    });
  }
});

// [청크] 업로드 취소
router.post('/file/chunk/cancel', verifyToken, (req, res) => {
  try {
    const uploadId = normalizeUploadId(req.body?.uploadId);

    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId가 필요합니다.' });
    }

    const meta = readChunkMeta(uploadId);
    if (meta) assertChunkOwner(req, meta);

    markChunkUploadCanceled(uploadId);

    if (meta?.tempPath) safeRmSync(meta.tempPath);
    safeRmSync(getChunkDir(uploadId));

    return res.json({
      success: true,
      canceled: true,
      uploadId
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || '청크 업로드 취소 실패'
    });
  }
});


// =========================================================
// PC 바탕화면 연동 Pairing API
// =========================================================

// 웹에서 연동 시작
router.post('/devices/pair/start', verifyToken, (req, res) => {
  try {
    ensureDeviceDataFiles();

    const targetPath = req.body?.path || '/';
    const token = createPairingToken();
    const ownerKey = getDeviceOwnerKey(req.user);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

    // 생성 위치 권한 사전 검증
    getValidatedPath(req.user, targetPath, req.headers['x-nas-password']);

    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE).filter(p => {
      if (!p.expiresAt) return true;
      return new Date(p.expiresAt).getTime() > Date.now();
    });

    const pairing = {
      token,
      ownerKey,
      targetPath,
      userSnapshot: req.user,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt,
      device: null
    };

    pairings.push(pairing);
    writeJsonArrayFile(DEVICE_PAIRINGS_FILE, pairings);

    const agentDownloadName = `NAS-Sync-Agent_${token.replace(/[^a-zA-Z0-9_-]/g, '')}.ps1`;

    return res.json({
      success: true,
      pairingToken: token,
      expiresAt,
      status: 'pending',
      agentDownloadUrl: `/api/devices/agent/windows?token=${encodeURIComponent(token)}`,
      agentDownloadName,
      agentKind: 'powershell'
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '연동 시작 실패' });
  }
});

const buildWindowsPowerShellAgent = (token) => {
  const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '');

  return `# NAS Sync Agent - Windows Realtime Folder Sync
# Pairing token: ${safeToken}
#
# Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File .\\NAS-Sync-Agent_${safeToken}.ps1

$ErrorActionPreference = "Stop"

$ServerBase = "https://filemanager-nas.com"
$PairingToken = "${safeToken}"
$MaxFileBytes = 90MB
$MaxTotalBytes = 50GB
$StateDir = Join-Path $env:LOCALAPPDATA "NAS-Sync-Agent"
$DeviceKeyFile = Join-Path $StateDir "device-key.txt"

function Select-SyncFolder {
  try {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "NAS와 실시간 연동할 폴더를 선택하세요."
    $dialog.ShowNewFolderButton = $false
    if ($env:USERPROFILE) {
      $desktop = Join-Path $env:USERPROFILE "Desktop"
      if (Test-Path -LiteralPath $desktop -PathType Container) { $dialog.SelectedPath = $desktop }
    }
    $result = $dialog.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) { return $dialog.SelectedPath }
  } catch {
    Write-Host "폴더 선택 창을 열 수 없어 경로 직접 입력으로 전환합니다."
  }

  $manualPath = Read-Host "NAS와 실시간 연동할 폴더 전체 경로를 입력하세요"
  if ($manualPath -and (Test-Path -LiteralPath $manualPath -PathType Container)) { return $manualPath }
  throw "연동할 폴더가 선택되지 않았거나 존재하지 않습니다."
}

function Get-OrCreateDeviceKey {
  if (-not (Test-Path -LiteralPath $StateDir -PathType Container)) {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
  }
  if (Test-Path -LiteralPath $DeviceKeyFile -PathType Leaf) {
    $existing = (Get-Content -LiteralPath $DeviceKeyFile -Raw).Trim()
    if ($existing) { return $existing }
  }
  $next = [Guid]::NewGuid().ToString("N")
  Set-Content -LiteralPath $DeviceKeyFile -Value $next -Encoding ASCII
  return $next
}

function Get-FolderSummary($root) {
  $totalBytes = 0
  $fileCount = 0
  $folderCount = 0
  $failedCount = 0
  Get-ChildItem -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue -ErrorVariable scanErrors | ForEach-Object {
    if ($_.PSIsContainer) { $folderCount += 1 } else { $totalBytes += $_.Length; $fileCount += 1 }
  }
  if ($scanErrors) { $failedCount = $scanErrors.Count }
  return @{ totalBytes = $totalBytes; fileCount = $fileCount; folderCount = $folderCount; failedCount = $failedCount }
}

function Format-Bytes($bytes) {
  if ($bytes -ge 1TB) { return "{0:N2} TB" -f ($bytes / 1TB) }
  if ($bytes -ge 1GB) { return "{0:N2} GB" -f ($bytes / 1GB) }
  if ($bytes -ge 1MB) { return "{0:N2} MB" -f ($bytes / 1MB) }
  if ($bytes -ge 1KB) { return "{0:N2} KB" -f ($bytes / 1KB) }
  return "$bytes B"
}

function Convert-ToRelPath($root, $fullPath) {
  $rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $fileFull = [System.IO.Path]::GetFullPath($fullPath)
  if ($fileFull.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    $rel = $fileFull.Substring($rootFull.Length).TrimStart([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
    return $rel.Replace("\\", "/")
  }
  return [System.IO.Path]::GetFileName($fullPath)
}

function Get-SafeDeviceName($baseName, $syncFolder) {
  $name = $baseName
  if (-not $name) { $name = $env:COMPUTERNAME }
  if (-not $name) { $name = "Windows-PC" }
  $folderName = Split-Path -Path $syncFolder -Leaf
  if ($folderName) { return "$name - $folderName" }
  return $name
}

function Invoke-AgentJson($endpoint, $body) {
  $json = $body | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Post -Uri "$ServerBase$endpoint" -ContentType "application/json" -Headers @{ "x-agent-token" = $Script:AgentToken } -Body $json
}

function Sync-Folder($fullPath) {
  if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) { return }
  $relPath = Convert-ToRelPath $Script:SyncFolder $fullPath
  if (-not $relPath) { return }
  Invoke-AgentJson "/api/devices/agent/sync-folder" @{ deviceId = $Script:DeviceId; relPath = $relPath } | Out-Null
  Write-Host "[folder] $relPath"
}

function Sync-Delete($fullPath) {
  $relPath = Convert-ToRelPath $Script:SyncFolder $fullPath
  if (-not $relPath) { return }
  Invoke-AgentJson "/api/devices/agent/sync-delete" @{ deviceId = $Script:DeviceId; relPath = $relPath } | Out-Null
  Write-Host "[delete] $relPath"
}

function Sync-File($fullPath) {
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { return }
  $file = Get-Item -LiteralPath $fullPath -Force
  $relPath = Convert-ToRelPath $Script:SyncFolder $file.FullName
  if ($file.Length -gt $MaxFileBytes) {
    Write-Host "[skip >90MB] $relPath"
    return
  }
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { throw "curl.exe was not found. Windows 10/11 includes curl.exe by default." }
  $args = @("-sS", "-X", "POST", "$ServerBase/api/devices/agent/sync-file", "-H", "x-agent-token: $Script:AgentToken", "-F", "deviceId=$Script:DeviceId", "-F", "relPath=$relPath", "-F", "file=@$($file.FullName)")
  $response = & $curl.Source @args
  if ($LASTEXITCODE -ne 0) { throw "curl upload failed with exit code $LASTEXITCODE" }
  Write-Host "[file] $relPath"
}

function Initial-Sync {
  Write-Host ""
  Write-Host "Initial sync started..."
  Get-ChildItem -LiteralPath $Script:SyncFolder -Recurse -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try { Sync-Folder $_.FullName } catch { Write-Host "[folder failed] $($_.FullName) $($_.Exception.Message)" }
  }
  Get-ChildItem -LiteralPath $Script:SyncFolder -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try { Sync-File $_.FullName } catch { Write-Host "[file failed] $($_.FullName) $($_.Exception.Message)" }
  }
  Write-Host "Initial sync complete."
}

function Handle-PathEvent($changeType, $fullPath, $oldFullPath) {
  Start-Sleep -Milliseconds 500
  try {
    if ($changeType -eq "Deleted") {
      Sync-Delete $fullPath
      return
    }
    if ($changeType -eq "Renamed" -and $oldFullPath) {
      Sync-Delete $oldFullPath
    }
    if (Test-Path -LiteralPath $fullPath -PathType Container) {
      Sync-Folder $fullPath
      return
    }
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
      Sync-File $fullPath
    }
  } catch {
    Write-Host "[event failed] $changeType $fullPath $($_.Exception.Message)"
  }
}

Write-Host ""
Write-Host "============================================="
Write-Host " NAS Sync Agent - Realtime Folder Sync"
Write-Host "============================================="
Write-Host ""

$Script:SyncFolder = Select-SyncFolder
$DeviceKey = Get-OrCreateDeviceKey
$DeviceName = Get-SafeDeviceName $env:COMPUTERNAME $Script:SyncFolder
$Summary = Get-FolderSummary $Script:SyncFolder
$TotalText = Format-Bytes $Summary.totalBytes
$LimitText = Format-Bytes $MaxTotalBytes

if ($Summary.totalBytes -gt $MaxTotalBytes) {
  Write-Host ""
  Write-Host "선택한 폴더 용량이 너무 큽니다."
  Write-Host "선택 폴더: $Script:SyncFolder"
  Write-Host "현재 용량: $TotalText"
  Write-Host "허용 용량: $LimitText"
  throw "폴더 용량이 제한을 초과하여 연동을 중단합니다."
}

Write-Host "Server: $ServerBase"
Write-Host "Device: $DeviceName"
Write-Host "Device key: $DeviceKey"
Write-Host "Folder: $Script:SyncFolder"
Write-Host "Files: $($Summary.fileCount)"
Write-Host "Folders: $($Summary.folderCount)"
Write-Host "Size: $TotalText / $LimitText"
Write-Host ""

$RegisterBody = @{
  pairingToken = $PairingToken
  clientDeviceKey = $DeviceKey
  deviceName = $DeviceName
  osType = "windows"
  desktopPath = $Script:SyncFolder
  syncRootPath = $Script:SyncFolder
  syncRootSizeBytes = $Summary.totalBytes
  syncRootFileCount = $Summary.fileCount
  syncRootFolderCount = $Summary.folderCount
} | ConvertTo-Json -Compress

$Register = Invoke-RestMethod -Method Post -Uri "$ServerBase/api/devices/agent/register" -ContentType "application/json" -Body $RegisterBody
if (-not $Register.agentToken -or -not $Register.device.deviceId) { throw "Registration response was invalid." }

$Script:DeviceId = $Register.device.deviceId
$Script:AgentToken = $Register.agentToken

Write-Host "Connected."
Write-Host "NAS folder: $($Register.device.linkedNasPath)"

Initial-Sync

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $Script:SyncFolder
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size'

$handlers = @()
$handlers += Register-ObjectEvent $watcher Created -Action { Handle-PathEvent "Created" $Event.SourceEventArgs.FullPath $null }
$handlers += Register-ObjectEvent $watcher Changed -Action { Handle-PathEvent "Changed" $Event.SourceEventArgs.FullPath $null }
$handlers += Register-ObjectEvent $watcher Deleted -Action { Handle-PathEvent "Deleted" $Event.SourceEventArgs.FullPath $null }
$handlers += Register-ObjectEvent $watcher Renamed -Action { Handle-PathEvent "Renamed" $Event.SourceEventArgs.FullPath $Event.SourceEventArgs.OldFullPath }

Write-Host ""
Write-Host "Realtime sync is running. Keep this window open."
Write-Host "Press Ctrl+C or close this window to stop."
Write-Host ""

try {
  while ($true) { Wait-Event -Timeout 2 | Out-Null }
} finally {
  foreach ($handler in $handlers) {
    if ($handler) { Unregister-Event -SubscriptionId $handler.Id -ErrorAction SilentlyContinue }
  }
  $watcher.Dispose()
}
`;
};

// Windows Agent download. If a compiled exe is available, serve it; otherwise
// generate a PowerShell agent that uses the same register/sync endpoints.
router.get('/devices/agent/windows', verifyToken, (req, res) => {
  try {
    const token = String(req.query.token || '');

    if (!token || !token.startsWith('pair_')) {
      return res.status(400).send('pairing token missing');
    }

    const exePath = path.join(__dirname, 'agents', 'dist', 'NAS-Sync-Agent.exe');
    const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '');

    if (fs.existsSync(exePath)) {
      const downloadName = `NAS-Sync-Agent_${safeToken}.exe`;
      return res.download(exePath, downloadName);
    }

    const script = buildWindowsPowerShellAgent(safeToken);
    const downloadName = `NAS-Sync-Agent_${safeToken}.ps1`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    return res.send(script);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).send(err.message || 'Agent download failed');
    }
  }
});


// 웹에서 pairing 상태 확인
router.get('/devices/pair/status/:token', verifyToken, (req, res) => {
  try {
    const token = String(req.params.token || '');
    const ownerKey = getDeviceOwnerKey(req.user);
    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE);
    const pairing = pairings.find(p => p.token === token && p.ownerKey === ownerKey);

    if (!pairing) return res.status(404).json({ error: '연동 세션을 찾을 수 없습니다.' });

    return res.json({
      success: true,
      status: pairing.status,
      device: pairing.device || null,
      expiresAt: pairing.expiresAt
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || '연동 상태 조회 실패' });
  }
});

// 개발/테스트용 연동 감지.
// 실제 Agent가 생기면 Agent가 /devices/register 같은 API로 이 역할을 수행하게 됨.
router.post('/devices/pair/mock-detect', verifyToken, (req, res) => {
  try {
    ensureDeviceDataFiles();

    const token = String(req.body?.pairingToken || '');
    const ownerKey = getDeviceOwnerKey(req.user);
    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE);
    const idx = pairings.findIndex(p => p.token === token && p.ownerKey === ownerKey);

    if (idx === -1) return res.status(404).json({ error: '연동 세션을 찾을 수 없습니다.' });
    if (new Date(pairings[idx].expiresAt).getTime() <= Date.now()) {
      return res.status(410).json({ error: '연동 세션이 만료되었습니다.' });
    }

    const device = createLinkedDeviceFolder(req.user, pairings[idx].targetPath || '/', {
      deviceId: createDeviceId(),
      deviceName: req.body?.deviceName || '내-PC',
      osType: req.body?.osType || 'unknown'
    });

    pairings[idx].status = 'connected';
    pairings[idx].device = device;
    pairings[idx].connectedAt = new Date().toISOString();

    writeJsonArrayFile(DEVICE_PAIRINGS_FILE, pairings);

    return res.json({
      success: true,
      status: 'connected',
      message: '연동 감지!',
      device
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '연동 감지 처리 실패' });
  }
});



// Agent가 pairingToken으로 실제 PC 등록
router.post('/devices/agent/register', (req, res) => {
  try {
    ensureDeviceDataFiles();

    const token = String(req.body?.pairingToken || '');
    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE);
    const idx = pairings.findIndex(p => p.token === token);

    if (idx === -1) return res.status(404).json({ error: '연동 세션을 찾을 수 없습니다.' });
    if (new Date(pairings[idx].expiresAt).getTime() <= Date.now()) {
      return res.status(410).json({ error: '연동 세션이 만료되었습니다.' });
    }

    const pairing = pairings[idx];
    const userSnapshot = pairing.userSnapshot || {
      id: pairing.ownerKey,
      loginId: pairing.ownerKey,
      userUid: pairing.ownerKey,
      rootPath: path.join('users', pairing.ownerKey)
    };

    const clientDeviceKey = String(req.body?.clientDeviceKey || '').trim();
    const syncRootPath = String(req.body?.syncRootPath || req.body?.desktopPath || '').trim();
    const existingDevice = clientDeviceKey
      ? readJsonArrayFile(LINKED_DEVICES_FILE).find(d =>
        d.ownerKey === pairing.ownerKey &&
        d.clientDeviceKey === clientDeviceKey &&
        d.syncRootPath === syncRootPath
      )
      : null;

    let device = pairing.device || existingDevice;

    if (!device || !device.absolutePath || !fs.existsSync(device.absolutePath)) {
      device = createLinkedDeviceFolder(userSnapshot, pairing.targetPath || '/', {
        deviceId: createDeviceId(),
        deviceName: req.body?.deviceName || '내-PC',
        osType: req.body?.osType || 'unknown'
      });
    }

    const agentToken = createAgentToken();
    const now = new Date().toISOString();

    device = {
      ...device,
      osType: req.body?.osType || device.osType || 'unknown',
      desktopPath: req.body?.desktopPath || device.desktopPath || '',
      syncRootPath,
      syncRootSizeBytes: Number(req.body?.syncRootSizeBytes || device.syncRootSizeBytes || 0),
      syncRootFileCount: Number(req.body?.syncRootFileCount || device.syncRootFileCount || 0),
      syncRootFolderCount: Number(req.body?.syncRootFolderCount || device.syncRootFolderCount || 0),
      clientDeviceKey: clientDeviceKey || device.clientDeviceKey || '',
      agentTokenHash: hashAgentToken(agentToken),
      status: 'connected',
      lastSeenAt: now
    };

    // 폴더 안 meta 업데이트
    if (device.absolutePath && fs.existsSync(device.absolutePath)) {
      fs.writeFileSync(path.join(device.absolutePath, LINKED_DEVICE_META), JSON.stringify({
        ...device,
        agentTokenHash: device.agentTokenHash
      }, null, 2));
    }

    updateLinkedDeviceRecord(device);

    pairings[idx].status = 'connected';
    pairings[idx].device = device;
    pairings[idx].connectedAt = now;
    writeJsonArrayFile(DEVICE_PAIRINGS_FILE, pairings);

    return res.json({
      success: true,
      status: 'connected',
      message: '연동 감지!',
      agentToken,
      device
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 등록 실패' });
  }
});

const getValidatedAgentTarget = (deviceId, agentToken, relPathValue) => {
  const device = getAgentDeviceByToken(deviceId, agentToken);

  if (!device) {
    const err = new Error('Agent 인증 실패');
    err.status = 403;
    throw err;
  }

  if (!device.absolutePath) {
    const err = new Error('연동 폴더 절대 경로가 없습니다. 다시 연동하세요.');
    err.status = 400;
    throw err;
  }

  const linkedRoot = path.resolve(device.absolutePath);
  const relPath = normalizeAgentRelPath(relPathValue);
  const finalPath = path.resolve(linkedRoot, relPath);

  if (!finalPath.startsWith(linkedRoot + path.sep) && finalPath !== linkedRoot) {
    const err = new Error('잘못된 파일 경로입니다.');
    err.status = 400;
    throw err;
  }

  if (finalPath === linkedRoot) {
    const err = new Error('연동 루트 자체는 변경할 수 없습니다.');
    err.status = 400;
    throw err;
  }

  return { device, linkedRoot, relPath, finalPath };
};

const touchLinkedDevice = (device, linkedRoot) => {
  const now = new Date().toISOString();
  const updated = { ...device, lastSeenAt: now, status: 'connected' };
  updateLinkedDeviceRecord(updated);

  try {
    fs.writeFileSync(path.join(linkedRoot, LINKED_DEVICE_META), JSON.stringify(updated, null, 2));
  } catch (err) {}

  return updated;
};

// Agent가 PC 폴더 생성/변경 이벤트를 NAS 폴더로 반영
router.post('/devices/agent/sync-folder', express.json(), (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const { device, linkedRoot, relPath, finalPath } = getValidatedAgentTarget(deviceId, agentToken, req.body?.relPath);

    if (!fs.existsSync(finalPath)) fs.mkdirSync(finalPath, { recursive: true });
    touchLinkedDevice(device, linkedRoot);

    return res.json({ success: true, relPath, type: 'folder' });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 폴더 동기화 실패' });
  }
});

// Agent가 PC 삭제/이름변경 이벤트를 NAS에 안전하게 반영.
// 영구 삭제 대신 .agent_trash 아래로 이동해서 오작동 복구 여지를 남긴다.
router.post('/devices/agent/sync-delete', express.json(), (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const { device, linkedRoot, relPath, finalPath } = getValidatedAgentTarget(deviceId, agentToken, req.body?.relPath);

    if (relPath === '.agent_trash' || relPath.startsWith('.agent_trash/')) {
      return res.status(400).json({ error: 'Agent trash 경로는 동기화 삭제할 수 없습니다.' });
    }

    if (!fs.existsSync(finalPath)) {
      touchLinkedDevice(device, linkedRoot);
      return res.json({ success: true, relPath, missing: true });
    }

    const trashRoot = path.join(linkedRoot, '.agent_trash', new Date().toISOString().replace(/[:.]/g, '-'));
    const trashPath = path.resolve(trashRoot, relPath);

    if (!trashPath.startsWith(trashRoot + path.sep) && trashPath !== trashRoot) {
      return res.status(400).json({ error: '잘못된 휴지통 경로입니다.' });
    }

    fs.mkdirSync(path.dirname(trashPath), { recursive: true });
    fs.renameSync(finalPath, trashPath);
    touchLinkedDevice(device, linkedRoot);

    return res.json({ success: true, relPath, trashed: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 삭제 동기화 실패' });
  }
});

// Agent가 PC 파일 생성/변경 이벤트를 NAS 폴더로 반영
router.post('/devices/agent/sync-file', agentUpload.single('file'), (req, res) => {
  const incomingPath = req.file?.path;

  try {
    const deviceId = String(req.body?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');

    if (!req.file || !incomingPath || !fs.existsSync(incomingPath)) {
      return res.status(400).json({ error: '업로드 파일이 없습니다.' });
    }

    const { device, linkedRoot, relPath, finalPath } = getValidatedAgentTarget(deviceId, agentToken, req.body?.relPath || req.file.originalname);

    const parent = path.dirname(finalPath);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });

    fs.renameSync(incomingPath, finalPath);
    touchLinkedDevice(device, linkedRoot);

    return res.json({
      success: true,
      relPath,
      size: req.file.size
    });
  } catch (err) {
    if (incomingPath) safeRmSync(incomingPath);
    return res.status(err.status || 500).json({ error: err.message || 'Agent 파일 동기화 실패' });
  }
});



module.exports = router;
