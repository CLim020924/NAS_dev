const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const archiver = require('archiver');
const { exec } = require('child_process');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { pathToFileURL } = require('url');
const config = require('./config/env');
const {
  hashToken,
  secureHashEquals,
  hashPairingToken,
  findPairingIndexByToken,
  assertRealPathInside,
  hasConcurrentFileChange,
  buildConflictFileName
} = require('./deviceSyncSecurity');
const {
  normalizeOfficePath,
  createOfficeAccessToken,
  verifyOfficeAccessToken
} = require('./officeAccessSecurity');
const {
  NAS_ROOT,
  getLoginId,
  normalizeQuotaFields,
  findMemberByAnyId,
  getAccessBasePath,
  getQuotaBasePath,
  resolveInside,
  getCachedPathUsage,
  getUserStorageSummary,
  invalidateUsageCache,
  assertQuotaAvailable
} = require('./storageQuota');
const {
  VERSION_ROOT_DIR,
  captureFileVersion,
  listFileVersions,
  getFileVersion,
  restoreFileVersion,
  createDriveRestorePoint,
  listDriveRestorePoints,
  restoreDriveFromPoint,
  appendActivity,
  listActivity,
  listFavorites,
  setFavorite,
  listRecentFiles
} = require('./fileVersioning');
const { verifyPassword } = require('./passwordSecurity');
const { createDesktopWebSession } = require('./desktopWebSession');

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

const nasPath = NAS_ROOT;
const JWT_SECRET = config.JWT_SECRET;
const USER_TRASH_DIR = '.nas_trash';
const USER_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const canceledSessions = new Set();
let serverRhwpPromise = null;

const ensureServerRhwp = async () => {
  if (!serverRhwpPromise) {
    serverRhwpPromise = (async () => {
      const corePath = path.join(__dirname, '..', 'frontend', 'node_modules', '@rhwp', 'core', 'rhwp.js');
      const wasmPath = path.join(__dirname, '..', 'frontend', 'node_modules', '@rhwp', 'core', 'rhwp_bg.wasm');
      const mod = await import(pathToFileURL(corePath).href);
      globalThis.measureTextWidth = globalThis.measureTextWidth || ((font, text) => String(text || '').length * 10);
      await mod.default({ module_or_path: fs.readFileSync(wasmPath) });
      return mod;
    })();
  }
  return serverRhwpPromise;
};
// =========================================================
// PC 바탕화면 연동 / Device Pairing 기초 구조
// =========================================================
const LINKED_DEVICE_META = '.msp-linked-device.json';
const DEVICE_DATA_DIR = path.join(__dirname, 'data');
const DEVICE_PAIRINGS_FILE = path.join(DEVICE_DATA_DIR, 'device_pairings.json');
const LINKED_DEVICES_FILE = path.join(DEVICE_DATA_DIR, 'linked_devices.json');
const UNLINKED_SYNC_ROOTS_FILE = path.join(DEVICE_DATA_DIR, 'unlinked_sync_roots.json');
const AGENT_INCOMING_ROOT = path.join(nasPath, '.agent_incoming');
const AGENT_CHUNK_ROOT = path.join(AGENT_INCOMING_ROOT, 'chunks');
const WEB_INCOMING_ROOT = path.join(AGENT_INCOMING_ROOT, 'web');
const AGENT_MAX_FILE_BYTES = 250 * 1024 * 1024 * 1024;
const AGENT_MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const WINDOWS_AGENT_VERSION = '1.10.17';
const DEVICE_OFFLINE_AFTER_MS = 9 * 1000;
let windowsAgentBuildCache = null;
const agentMutationWindows = new Map();
const agentLoginAttempts = new Map();
const AGENT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const AGENT_LOGIN_MAX_FAILURES = 5;
const getActivityActor = (user = {}) => String(user.userUid || user.loginId || user.id || user.username || 'web-user');

const assertAgentMutationAllowed = (device, operation) => {
  if (device.syncPaused) {
    const err = new Error('NAS Drive 동기화가 일시 중지되어 있습니다. 웹의 PC 연결 관리에서 다시 시작하세요.');
    err.status = 423;
    throw err;
  }
  const now = Date.now();
  const cutoff = now - 60_000;
  const previous = (agentMutationWindows.get(device.deviceId) || []).filter(event => event.at >= cutoff);
  previous.push({ at: now, operation });
  agentMutationWindows.set(device.deviceId, previous);
  const writes = previous.filter(event => event.operation === 'write').length;
  const deletes = previous.filter(event => event.operation === 'delete').length;
  if (writes <= 500 && deletes <= 50) return;
  const updated = advanceDeviceState(device, {
    syncPaused: true,
    syncState: 'error',
    lastError: '비정상적으로 많은 파일 변경을 감지해 데이터 보호를 위해 자동으로 중지했습니다.',
    pausedAt: new Date().toISOString()
  });
  updateLinkedDeviceRecord(updated);
  const err = new Error(updated.lastError);
  err.status = 423;
  throw err;
};

const createAgentToken = () => {
  return 'agt_' + crypto.randomBytes(32).toString('hex');
};

const getWindowsAgentBuild = () => {
  const filePath = path.join(__dirname, 'agents', 'dist', 'NAS-Sync-Agent.exe');
  if (!fs.existsSync(filePath)) return null;
  const stat = fs.statSync(filePath);
  if (!windowsAgentBuildCache || windowsAgentBuildCache.mtimeMs !== stat.mtimeMs || windowsAgentBuildCache.size !== stat.size) {
    windowsAgentBuildCache = {
      version: WINDOWS_AGENT_VERSION,
      filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    };
  }
  return windowsAgentBuildCache;
};

const hashAgentToken = (token) => {
  return hashToken(token);
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

const removeLinkedDeviceRecord = (deviceId) => {
  if (!deviceId) return;
  const devices = readJsonArrayFile(LINKED_DEVICES_FILE).filter(d => d.deviceId !== deviceId);
  writeJsonArrayFile(LINKED_DEVICES_FILE, devices);
};

const getAgentDeviceByToken = (deviceId, agentToken) => {
  const devices = readJsonArrayFile(LINKED_DEVICES_FILE);
  const device = devices.find(d => d.deviceId === deviceId);

  if (!device || device.status === 'revoked' || device.revokedAt || !device.agentTokenHash) return null;
  if (!secureHashEquals(device.agentTokenHash, hashAgentToken(agentToken))) return null;

  return device;
};

router.post('/devices/agent/web-session', express.json(), (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || '').trim();
    const agentToken = String(req.headers['x-agent-token'] || '').trim();
    const device = getAgentDeviceByToken(deviceId, agentToken);
    if (!device) return res.status(403).json({ error: 'Agent 인증 실패' });
    const owner = getCurrentDeviceOwner(device);
    const created = createDesktopWebSession({
      deviceId: device.deviceId,
      ownerKey: getDeviceOwnerKey(owner),
      userUid: owner.userUid,
      loginId: getUserLoginId(owner),
      next: req.body?.next
    });
    const publicBase = String(config.PUBLIC_BASE_URL || 'https://filemanager-nas.com').replace(/\/$/, '');
    return res.json({
      success: true,
      expiresInMs: created.expiresInMs,
      openUrl: `${publicBase}/api/auth/desktop-handoff?token=${encodeURIComponent(created.token)}`
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '웹 로그인 주소 생성 실패' });
  }
});

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

const agentChunkUpload = multer({
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
      cb(null, Date.now() + '_' + Math.random().toString(36).slice(2) + '.agentchunk');
    }
  }),
  limits: {
    fileSize: AGENT_MAX_CHUNK_BYTES
  }
});


const ensureDeviceDataFiles = () => {
  if (!fs.existsSync(DEVICE_DATA_DIR)) fs.mkdirSync(DEVICE_DATA_DIR, { recursive: true });
  for (const f of [DEVICE_PAIRINGS_FILE, LINKED_DEVICES_FILE, UNLINKED_SYNC_ROOTS_FILE]) {
    if (!fs.existsSync(f)) fs.writeFileSync(f, '[]');
  }
};

const readJsonArrayFile = (filePath) => {
  try {
    ensureDeviceDataFiles();
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(data)) return [];
    if (filePath !== DEVICE_PAIRINGS_FILE) return data;

    let changed = false;
    const sanitized = data.map((row) => {
      const next = { ...row };
      if (next.token && !next.tokenHash) {
        next.tokenHash = hashPairingToken(next.token);
        next.tokenHint = String(next.token).slice(-8);
        delete next.token;
        changed = true;
      }
      if (next.userSnapshot) {
        delete next.userSnapshot;
        changed = true;
      }
      return next;
    });
    if (changed) fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2));
    return sanitized;
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

const getUserLoginId = (user = {}) => getLoginId(user);

const getDeviceUserBasePath = (user = {}) => {
  const loginId = getUserLoginId(user);
  const relativeRoot = String(user.rootPath || path.join('users', loginId || 'default')).replace(/^(\/|\\)+/, '');
  return resolveInside(nasPath, relativeRoot);
};

const getValidatedDeviceUserPath = (user, requestedPath = '/') => {
  const basePath = getDeviceUserBasePath(user);
  const targetPath = resolveInside(basePath, requestedPath);
  assertRealPathInside(basePath, targetPath);
  return { basePath, targetPath };
};

const getCurrentDeviceOwner = (device = {}) => {
  const owner = findMemberByAnyId({
    userUid: device.userUid || device.ownerKey,
    loginId: device.loginId || device.ownerKey,
    id: device.ownerKey,
    username: device.ownerKey
  });
  if (!owner || owner.disabled) {
    const err = new Error('장치 소유자 계정이 없거나 비활성화되었습니다.');
    err.status = 403;
    throw err;
  }
  return normalizeQuotaFields(owner);
};

const getDeviceConnectionState = (device = {}) => {
  if (device.status === 'revoked' || device.revokedAt) return 'revoked';
  const lastSeenMs = new Date(device.lastSeenAt || 0).getTime();
  if (!Number.isFinite(lastSeenMs) || lastSeenMs <= 0) return 'offline';
  return Date.now() - lastSeenMs <= DEVICE_OFFLINE_AFTER_MS ? 'online' : 'offline';
};

const getDeviceReason = (device = {}) => {
  const connectionState = getDeviceConnectionState(device);
  if (connectionState === 'revoked') return { code: 'relationship-revoked', label: '이 계정과 PC의 연결이 해제되었습니다.' };
  if (connectionState === 'offline') return { code: 'pc-heartbeat-timeout', label: 'PC 상태 신호가 끊겼습니다. PC 전원·인터넷·NAS Drive 실행 상태를 확인하세요.' };
  if (device.syncPaused || device.syncState === 'paused') return { code: 'sync-paused', label: '파일 동기화가 일시 중지되었습니다.' };
  if (device.syncState === 'error') return { code: 'sync-error', label: device.lastError || '파일 동기화 오류가 발생했습니다.' };
  if (device.syncState === 'connecting') return { code: 'connecting', label: 'PC와 계정 연결을 확인하고 있습니다.' };
  if (device.syncState === 'syncing') return { code: 'syncing', label: '파일 변경 사항을 동기화하고 있습니다.' };
  return { code: 'online', label: 'PC가 온라인이며 계정 연결이 유효합니다.' };
};

const advanceDeviceState = (device = {}, patch = {}, now = new Date().toISOString()) => {
  const previousSignature = JSON.stringify([
    device.status || '', device.syncState || '', !!device.syncPaused, device.lastError || '', device.revokedAt || ''
  ]);
  const updated = { ...device, ...patch };
  const nextSignature = JSON.stringify([
    updated.status || '', updated.syncState || '', !!updated.syncPaused, updated.lastError || '', updated.revokedAt || ''
  ]);
  return {
    ...updated,
    stateRevision: Math.max(0, Number(device.stateRevision || 0)) + 1,
    stateChangedAt: previousSignature === nextSignature ? (device.stateChangedAt || now) : now
  };
};

const sanitizeDeviceForResponse = (device = {}) => {
  const reason = getDeviceReason(device);
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName || device.name || '',
    osType: device.osType || 'unknown',
    status: device.status || 'unknown',
    relationshipState: device.status === 'revoked' || device.revokedAt ? 'revoked' : 'linked',
    connectionState: getDeviceConnectionState(device),
    syncState: device.syncPaused ? 'paused' : (device.syncState || 'unknown'),
    syncPaused: !!device.syncPaused,
    lastError: device.lastError || '',
    reasonCode: reason.code,
    reasonLabel: reason.label,
    stateRevision: Math.max(0, Number(device.stateRevision || 0)),
    stateChangedAt: device.stateChangedAt || device.lastSeenAt || device.createdAt || null,
    lastConfirmedAt: device.lastSeenAt || null,
    offlineAfterMs: DEVICE_OFFLINE_AFTER_MS,
    syncMode: device.syncMode || 'safe-bidirectional',
    createdAt: device.createdAt || null,
    lastSeenAt: device.lastSeenAt || null,
    revokedAt: device.revokedAt || null,
    syncRoots: normalizeDeviceSyncRoots(device).map(root => ({
      syncRootId: root.syncRootId,
      name: root.name,
      kind: root.kind || 'folder-sync',
      localPath: root.localPath || '',
      linkedNasPath: root.linkedNasPath || '',
      createdAt: root.createdAt || null,
      lastSeenAt: root.lastSeenAt || null
    }))
  };
};

const emitDeviceStatus = (req, device) => {
  const io = req?.app?.get?.('io');
  if (!io || !device) return;
  const payload = {
    device: sanitizeDeviceForResponse(device),
    serverTime: new Date().toISOString()
  };
  const roomKeys = new Set([device.userUid, device.ownerKey, device.loginId].filter(Boolean).map(String));
  for (const key of roomKeys) io.to(`user:${key}`).emit('device:status', payload);
};

const createPairingToken = () => {
  if (typeof crypto.randomUUID === 'function') {
    return 'pair_' + crypto.randomUUID().replace(/-/g, '');
  }
  return 'pair_' + crypto.randomBytes(16).toString('hex');
};

const getAgentLoginAttemptKey = (req, loginId) => {
  const forwarded = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const sourceIp = forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
  return `${sourceIp}:${String(loginId || '').toLowerCase()}`;
};

const getActiveAgentLoginAttempt = (key) => {
  const current = agentLoginAttempts.get(key);
  if (!current || current.expiresAt <= Date.now()) {
    agentLoginAttempts.delete(key);
    return null;
  }
  return current;
};

const recordAgentLoginFailure = (key) => {
  const current = getActiveAgentLoginAttempt(key);
  agentLoginAttempts.set(key, {
    count: (current?.count || 0) + 1,
    expiresAt: Date.now() + AGENT_LOGIN_WINDOW_MS
  });
};

const createDeviceId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return 'dev_' + crypto.randomUUID().replace(/-/g, '');
  }
  return 'dev_' + crypto.randomBytes(16).toString('hex');
};

const createSyncRootId = () => {
  if (typeof crypto.randomUUID === 'function') {
    return 'root_' + crypto.randomUUID().replace(/-/g, '');
  }
  return 'root_' + crypto.randomBytes(16).toString('hex');
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

const writeLinkedDeviceMeta = (device) => {
  if (!device?.absolutePath) return;
  const personalRoot = normalizeDeviceSyncRoots(device).find(root => root.kind === 'personal-drive');
  if (personalRoot?.absolutePath && path.resolve(personalRoot.absolutePath) === path.resolve(device.absolutePath)) return;
  if (!fs.existsSync(device.absolutePath)) fs.mkdirSync(device.absolutePath, { recursive: true });
  fs.writeFileSync(path.join(device.absolutePath, LINKED_DEVICE_META), JSON.stringify(device, null, 2));
};

const isSameOrChildPath = (parent, child) => {
  const parentPath = path.resolve(parent);
  const childPath = path.resolve(child);
  return childPath === parentPath || childPath.startsWith(parentPath + path.sep);
};

const normalizeDeviceSyncRoots = (device = {}) => {
  const roots = Array.isArray(device.syncRoots) ? device.syncRoots.filter(Boolean) : [];
  if (Array.isArray(device.syncRoots)) return roots;
  if (!device.absolutePath) return [];

  return [{
    syncRootId: device.syncRootId || 'root_default',
    name: device.syncRootName || device.deviceName || device.name || 'Synced Folder',
    kind: device.syncMode === 'personal-drive' ? 'personal-drive' : 'folder-sync',
    localPath: device.syncRootPath || device.desktopPath || '',
    linkedNasPath: device.linkedNasPath || '',
    absolutePath: device.absolutePath,
    createdAt: device.createdAt || new Date().toISOString(),
    lastSeenAt: device.lastSeenAt || new Date().toISOString(),
    fileCount: Number(device.syncRootFileCount || 0),
    folderCount: Number(device.syncRootFolderCount || 0),
    sizeBytes: Number(device.syncRootSizeBytes || 0)
  }];
};

const findLinkedDeviceByAbsolutePath = (ownerKey, absolutePath) => {
  const target = path.resolve(absolutePath);
  return readJsonArrayFile(LINKED_DEVICES_FILE).find((device) => (
    device.ownerKey === ownerKey &&
    device.absolutePath &&
    path.resolve(device.absolutePath) === target
  ));
};

const getLiveSyncRoots = (device = {}) => {
  return normalizeDeviceSyncRoots(device).filter(root => (
    root?.absolutePath &&
    fs.existsSync(root.absolutePath) &&
    fs.statSync(root.absolutePath).isDirectory()
  ));
};

const persistLinkedDevice = (device) => {
  writeLinkedDeviceMeta(device);
  updateLinkedDeviceRecord(device);
  return device;
};

const rememberUnlinkedSyncRoot = (device, root, reason = 'deleted-from-nas') => {
  if (!device || !root) return;
  const tombstones = readJsonArrayFile(UNLINKED_SYNC_ROOTS_FILE);
  const next = tombstones.filter(row => !(
    row.deviceId === device.deviceId &&
    row.syncRootId === root.syncRootId
  ));

  next.push({
    deviceId: device.deviceId,
    syncRootId: root.syncRootId || '',
    ownerKey: device.ownerKey || '',
    clientDeviceKey: device.clientDeviceKey || '',
    linkedNasPath: root.linkedNasPath || '',
    absolutePath: root.absolutePath || '',
    localPath: root.localPath || '',
    reason,
    deletedAt: new Date().toISOString()
  });

  writeJsonArrayFile(UNLINKED_SYNC_ROOTS_FILE, next);
};

const isUnlinkedSyncRoot = (device, syncRootIdValue, absolutePathValue) => {
  const syncRootId = String(syncRootIdValue || '').trim();
  const absolutePath = absolutePathValue ? path.resolve(absolutePathValue) : '';
  return readJsonArrayFile(UNLINKED_SYNC_ROOTS_FILE).some(row => {
    if (row.deviceId !== device.deviceId) return false;
    if (syncRootId && row.syncRootId && row.syncRootId === syncRootId) return true;
    if (absolutePath && row.absolutePath && path.resolve(row.absolutePath) === absolutePath) return true;
    return false;
  });
};

const forgetUnlinkedSyncRoot = (device, root) => {
  if (!device || !root) return;
  const absolutePath = root.absolutePath ? path.resolve(root.absolutePath) : '';
  const next = readJsonArrayFile(UNLINKED_SYNC_ROOTS_FILE).filter(row => {
    if (row.deviceId !== device.deviceId) return true;
    if (root.syncRootId && row.syncRootId === root.syncRootId) return false;
    if (absolutePath && row.absolutePath && path.resolve(row.absolutePath) === absolutePath) return false;
    if (root.localPath && row.localPath && String(row.localPath).toLowerCase() === String(root.localPath).toLowerCase()) return false;
    return true;
  });
  writeJsonArrayFile(UNLINKED_SYNC_ROOTS_FILE, next);
};

const cleanupLinkedDeviceDeletion = (targetPath) => {
  const target = path.resolve(targetPath);
  const devices = readJsonArrayFile(LINKED_DEVICES_FILE);
  let changed = false;
  const nextDevices = [];

  for (const device of devices) {
    const deviceRoot = device.absolutePath ? path.resolve(device.absolutePath) : '';
    if (deviceRoot && target === deviceRoot) {
      for (const root of normalizeDeviceSyncRoots(device)) {
        rememberUnlinkedSyncRoot(device, root, 'deleted-device-root-from-nas');
      }
      changed = true;
      continue;
    }

    const roots = normalizeDeviceSyncRoots(device);
    const nextRoots = roots.filter(root => {
      const rootPath = root.absolutePath ? path.resolve(root.absolutePath) : '';
      const deleted = rootPath && (target === rootPath || rootPath.startsWith(target + path.sep));
      if (deleted) rememberUnlinkedSyncRoot(device, root, 'deleted-sync-root-from-nas');
      return rootPath && !deleted;
    });

    if (nextRoots.length !== roots.length) {
      changed = true;
      const updated = {
        ...device,
        syncRoots: nextRoots,
        status: nextRoots.length > 0 ? (device.status || 'connected') : 'needs-setup',
        lastSeenAt: new Date().toISOString()
      };
      nextDevices.push(updated);
      try {
        if (updated.absolutePath && fs.existsSync(updated.absolutePath)) writeLinkedDeviceMeta(updated);
      } catch (err) {}
    } else {
      nextDevices.push(device);
    }
  }

  if (changed) writeJsonArrayFile(LINKED_DEVICES_FILE, nextDevices);
};

const pruneMissingSyncRoots = (device = {}) => {
  if (!device?.absolutePath || !fs.existsSync(device.absolutePath)) {
    return { device, deviceMissing: true, removedRoots: normalizeDeviceSyncRoots(device).length };
  }

  const roots = normalizeDeviceSyncRoots(device);
  const liveRoots = roots.filter(root => (
    root?.absolutePath &&
    fs.existsSync(root.absolutePath) &&
    fs.statSync(root.absolutePath).isDirectory()
  ));

  if (liveRoots.length !== roots.length || !Array.isArray(device.syncRoots)) {
    const updated = {
      ...device,
      syncRoots: liveRoots,
      status: liveRoots.length > 0 ? (device.status || 'connected') : 'needs-setup',
      lastSeenAt: new Date().toISOString()
    };
    persistLinkedDevice(updated);
    return { device: updated, deviceMissing: false, removedRoots: roots.length - liveRoots.length };
  }

  return { device, deviceMissing: false, removedRoots: 0 };
};

const migrateLegacyDeviceContentsToSyncRoot = (device = {}) => {
  if (!device?.absolutePath || !fs.existsSync(device.absolutePath) || Array.isArray(device.syncRoots)) {
    return device;
  }

  const deviceRoot = path.resolve(device.absolutePath);
  const existingNames = fs.readdirSync(deviceRoot).filter(name => name !== LINKED_DEVICE_META);
  if (existingNames.length === 0) {
    const updated = { ...device, syncRoots: [] };
    persistLinkedDevice(updated);
    return updated;
  }

  const rootName = sanitizeDeviceFolderName(
    path.basename(String(device.syncRootPath || device.desktopPath || '').replace(/[\\\/]+$/, '')) ||
    'Synced Folder'
  );
  const { finalName, finalPath } = makeUniqueFolderPath(deviceRoot, rootName);
  fs.mkdirSync(finalPath, { recursive: true });

  for (const name of existingNames) {
    const from = path.join(deviceRoot, name);
    if (path.resolve(from) === path.resolve(finalPath)) continue;
    fs.renameSync(from, path.join(finalPath, name));
  }

  const linkedDevicePath = String(device.linkedNasPath || path.basename(deviceRoot)).replace(/^\/+|\/+$/g, '');
  const now = new Date().toISOString();
  const stat = fs.statSync(finalPath);
  const syncRoot = {
    syncRootId: device.syncRootId || 'root_default',
    name: finalName,
    localPath: device.syncRootPath || device.desktopPath || '',
    linkedNasPath: [linkedDevicePath, finalName].filter(Boolean).join('/'),
    absolutePath: finalPath,
    createdAt: device.createdAt || now,
    lastSeenAt: now,
    fileCount: Number(device.syncRootFileCount || 0),
    folderCount: Number(device.syncRootFolderCount || 0),
    sizeBytes: Number(device.syncRootSizeBytes || stat.size || 0)
  };

  const updated = {
    ...device,
    syncRoots: [syncRoot],
    lastSeenAt: now,
    status: 'connected'
  };
  persistLinkedDevice(updated);
  return updated;
};

const getActiveLinkedDevice = (device = {}) => {
  if (!device || device.status === 'revoked' || device.revokedAt) return null;
  let current = migrateLegacyDeviceContentsToSyncRoot(device);
  const pruned = pruneMissingSyncRoots(current);
  if (pruned.deviceMissing) {
    removeLinkedDeviceRecord(device.deviceId);
    return null;
  }
  current = pruned.device;
  return { ...current, syncRoots: getLiveSyncRoots(current) };
};

const addSyncRootToDevice = (device, user, localPath, summary = {}) => {
  const basePath = getDeviceUserBasePath(user);
  const deviceRoot = path.resolve(device.absolutePath);
  resolveInside(basePath, path.relative(basePath, deviceRoot));
  assertRealPathInside(basePath, deviceRoot);
  const hasExplicitRoots = Array.isArray(device.syncRoots);
  const hasLegacyContents = !hasExplicitRoots && fs.existsSync(deviceRoot)
    ? fs.readdirSync(deviceRoot).some(name => name !== LINKED_DEVICE_META)
    : false;
  const roots = hasExplicitRoots
    ? device.syncRoots.filter(Boolean)
    : (hasLegacyContents ? normalizeDeviceSyncRoots(device) : []);
  const safeName = sanitizeDeviceFolderName(path.basename(String(localPath || '').replace(/[\\\/]+$/, '')) || 'Synced Folder');
  const existingByLocalPath = roots.find(root => String(root.localPath || '').toLowerCase() === String(localPath || '').toLowerCase());

  if (existingByLocalPath) {
    return { device, syncRoot: existingByLocalPath, alreadyLinked: true };
  }

  const { finalName, finalPath } = makeUniqueFolderPath(deviceRoot, safeName);
  fs.mkdirSync(finalPath, { recursive: true });

  const now = new Date().toISOString();
  const syncRoot = {
    syncRootId: createSyncRootId(),
    name: finalName,
    localPath,
    linkedNasPath: path.relative(basePath, finalPath).replace(/\\/g, '/'),
    absolutePath: finalPath,
    createdAt: now,
    lastSeenAt: now,
    fileCount: Number(summary.fileCount || 0),
    folderCount: Number(summary.folderCount || 0),
    sizeBytes: Number(summary.sizeBytes || 0)
  };

  const updated = {
    ...device,
    syncRoots: [...roots, syncRoot],
    lastSeenAt: now,
    status: 'connected'
  };

  writeLinkedDeviceMeta(updated);
  updateLinkedDeviceRecord(updated);
  forgetUnlinkedSyncRoot(updated, syncRoot);
  return { device: updated, syncRoot, alreadyLinked: false };
};

const ensurePersonalDriveRoot = (device, user, localPath) => {
  const basePath = getDeviceUserBasePath(user);
  if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
  assertRealPathInside(basePath, basePath);
  const roots = normalizeDeviceSyncRoots(device);
  const existing = roots.find(root => root.kind === 'personal-drive');
  const loginId = getUserLoginId(user) || '개인';
  const now = new Date().toISOString();
  const syncRoot = existing ? {
    ...existing,
    localPath: localPath || existing.localPath || '',
    absolutePath: basePath,
    linkedNasPath: '',
    kind: 'personal-drive',
    lastSeenAt: now
  } : {
    syncRootId: createSyncRootId(),
    name: `NAS Drive - ${loginId}`,
    kind: 'personal-drive',
    localPath: localPath || '',
    linkedNasPath: '',
    absolutePath: basePath,
    createdAt: now,
    lastSeenAt: now,
    fileCount: 0,
    folderCount: 0,
    sizeBytes: 0
  };
  const nextRoots = roots.filter(root => root.syncRootId !== syncRoot.syncRootId && root.kind !== 'personal-drive');
  const updated = {
    ...device,
    syncMode: 'personal-drive',
    direction: 'bidirectional',
    deletePolicy: 'trash-first',
    conflictPolicy: 'keep-conflict-copy',
    syncRoots: [...nextRoots, syncRoot],
    status: 'connected',
    lastSeenAt: now
  };
  updateLinkedDeviceRecord(updated);
  return { device: updated, syncRoot, alreadyLinked: !!existing };
};

const createPersonalDriveDevice = (user, deviceInfo = {}) => {
  const basePath = getDeviceUserBasePath(user);
  if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
  const now = new Date().toISOString();
  return {
    deviceId: deviceInfo.deviceId || createDeviceId(),
    deviceName: sanitizeDeviceFolderName(deviceInfo.deviceName || 'Windows-PC'),
    originalDeviceName: deviceInfo.deviceName || 'Windows-PC',
    osType: deviceInfo.osType || 'windows',
    ownerKey: getDeviceOwnerKey(user),
    userUid: user.userUid || '',
    loginId: getUserLoginId(user),
    linkedNasPath: '',
    absolutePath: basePath,
    syncMode: 'personal-drive',
    direction: 'bidirectional',
    deletePolicy: 'trash-first',
    conflictPolicy: 'keep-conflict-copy',
    status: 'connected',
    createdAt: now,
    lastSeenAt: now,
    syncRoots: []
  };
};

const createLinkedDeviceFolder = (user, parentReqPath, deviceInfo = {}) => {
  const { basePath, targetPath: parentDir } = getValidatedDeviceUserPath(user, parentReqPath || '/');

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

  writeLinkedDeviceMeta(meta);

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
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: '???? ?????.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const latestUser = findMemberByAnyId(decoded);
    req.user = normalizeQuotaFields({ ...decoded, ...(latestUser || {}) });
    next();
  } catch (e) {
    res.status(401).json({ error: '??? ??????.' });
  }
};

const getValidatedPath = (user, requestedPath) => {
  const normalizedUser = normalizeQuotaFields(user || {});
  const basePath = getAccessBasePath(normalizedUser);
  const targetPath = resolveInside(basePath, requestedPath || '');
  return { basePath, targetPath };
};

const getUserBasePath = (user) => getAccessBasePath(normalizeQuotaFields(user || {}));

const getOnlyOfficeUser = (req) => {
  const access = verifyOfficeAccessToken(JWT_SECRET, req.query.officeToken);
  const latestOfficeUser = findMemberByAnyId({
    userUid: access.userUid,
    loginId: access.loginId,
    id: access.loginId,
    username: access.loginId
  });
  if (!latestOfficeUser || latestOfficeUser.disabled) {
    const err = new Error('onlyoffice account is missing or disabled');
    err.status = 401;
    throw err;
  }
  req.officeAccess = access;
  return normalizeQuotaFields(latestOfficeUser);
};

router.post('/onlyoffice/access', verifyToken, (req, res) => {
  try {
    const requestedPath = normalizeOfficePath(req.body?.path);
    const { targetPath } = getValidatedPath(req.user, requestedPath);
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    const fileStat = fs.statSync(targetPath);
    if (!fileStat.isFile()) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }
    const token = createOfficeAccessToken(JWT_SECRET, req.user, requestedPath);
    const documentKey = crypto
      .createHash('sha256')
      .update(`${requestedPath}\0${fileStat.size}\0${Math.trunc(fileStat.mtimeMs)}`)
      .digest('base64url')
      .slice(0, 40);
    return res.json({
      success: true,
      token,
      documentKey,
      fileRevision: {
        size: fileStat.size,
        mtimeMs: Math.trunc(fileStat.mtimeMs)
      },
      expiresInSeconds: 12 * 60 * 60
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'OnlyOffice 접근 토큰 발급 실패' });
  }
});

router.get(['/onlyoffice/file', '/onlyoffice/file/:fileName'], (req, res) => {
  try {
    const officeUser = getOnlyOfficeUser(req);
    const basePath = getAccessBasePath(officeUser);
    const requestedPath = req.query.path64
      ? Buffer.from(String(req.query.path64), 'base64url').toString('utf8')
      : (req.query.path || '');
    if (normalizeOfficePath(requestedPath) !== req.officeAccess.path) {
      return res.status(403).send('onlyoffice token path mismatch');
    }
    const targetPath = resolveInside(basePath, requestedPath);
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      return res.status(404).send('file not found');
    }
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(path.basename(targetPath))}`);
    return res.sendFile(targetPath);
  } catch (err) {
    return res.status(err.status || 403).send(err.message || 'forbidden');
  }
});

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

const SEARCH_MAX_RESULTS = 200;
const SEARCH_MAX_VISITED = 60000;
const SEARCH_SKIP_NAMES = new Set([
  '.agent_incoming',
  '.agent_trash',
  VERSION_ROOT_DIR,
  USER_TRASH_DIR,
  '.msp_chunk_uploads',
  '.msp_chunk_canceled'
]);

const toNasRelativePath = (basePath, targetPath) => {
  const rel = path.relative(basePath, targetPath).replace(/\\/g, '/');
  return rel ? `/${rel}` : '/';
};

const searchFilesRecursive = (basePath, query) => {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];

  const results = [];
  let visited = 0;

  const walk = (currentPath) => {
    if (results.length >= SEARCH_MAX_RESULTS || visited >= SEARCH_MAX_VISITED) return;

    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      if (results.length >= SEARCH_MAX_RESULTS || visited >= SEARCH_MAX_VISITED) break;
      if (SEARCH_SKIP_NAMES.has(entry.name)) continue;

      const fullPath = path.join(currentPath, entry.name);
      visited += 1;

      let stat = null;
      try {
        stat = fs.lstatSync(fullPath);
      } catch (err) {
        continue;
      }

      if (stat.isSymbolicLink()) continue;

      const isDirectory = entry.isDirectory();
      const type = isDirectory ? 'folder' : 'file';
      const relPath = toNasRelativePath(basePath, fullPath);

      if (entry.name.toLowerCase().includes(needle)) {
        results.push({
          name: entry.name,
          type,
          fullPath: relPath,
          parentPath: toNasRelativePath(basePath, path.dirname(fullPath)),
          size: stat.isFile() ? stat.size : null,
          modifiedAt: stat.mtime.toISOString()
        });
      }

      if (isDirectory) walk(fullPath);
    }
  };

  walk(basePath);

  return results.sort((a, b) => {
    const aExact = a.name.toLowerCase() === needle ? 0 : 1;
    const bExact = b.name.toLowerCase() === needle ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.fullPath.localeCompare(b.fullPath, 'ko');
  });
};

router.get('/files/search', verifyToken, (req, res) => {
  try {
    ensureFixedSystemFolders(req.user);
    const query = String(req.query.q || '').trim();
    if (query.length < 2) return res.json({ results: [] });

    const { basePath } = getValidatedPath(req.user, '/');
    const results = searchFilesRecursive(basePath, query);
    res.json({
      query,
      results,
      limited: results.length >= SEARCH_MAX_RESULTS
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || '검색에 실패했습니다.' });
  }
});

router.get('/storage/me', verifyToken, async (req, res) => {
  try {
    const summary = await getUserStorageSummary(req.user);
    res.json(summary);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || '저장공간 정보를 불러오지 못했습니다.' });
  }
});

router.get('/storage/path', verifyToken, async (req, res) => {
  try {
    const { targetPath } = getValidatedPath(req.user, req.query.path || '/');
    const usage = await getCachedPathUsage(targetPath);
    res.json({
      path: req.query.path || '/',
      absolutePath: targetPath,
      sizeBytes: usage.sizeBytes,
      files: usage.files,
      directories: usage.directories,
      cached: usage.cached,
      updatedAt: usage.updatedAt
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || '경로 용량을 계산하지 못했습니다.' });
  }
});

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
      fs.mkdirSync(WEB_INCOMING_ROOT, { recursive: true });
      cb(null, WEB_INCOMING_ROOT);
    } catch(e){ cb(e); }
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(10).toString('hex')}.webupload`)
})});

// [1] 파일 목록 조회
router.get('/files', verifyToken, (req, res) => {
  try {
    ensureFixedSystemFolders(req.user);
    const { basePath, targetPath } = getValidatedPath(req.user, req.query.path, req.headers['x-nas-password']);
    if (!fs.existsSync(targetPath)) return res.json([]); 
    const currentLinkedMeta = readLinkedDeviceMeta(targetPath);
    if (currentLinkedMeta) migrateLegacyDeviceContentsToSyncRoot(currentLinkedMeta);
    const ownerKey = getDeviceOwnerKey(req.user);
    const items = fs.readdirSync(targetPath).map(item => {
      if (item === LINKED_DEVICE_META || SEARCH_SKIP_NAMES.has(item)) return null;

      const full = path.join(targetPath, item);

      try {
        const stat = fs.statSync(full);
        const rel = path.relative(basePath, full).replace(/\\/g, '/');

        if (stat.isDirectory()) {
          const linkedMeta = readLinkedDeviceMeta(full);
          const activeLinkedDevice = linkedMeta && linkedMeta.ownerKey === ownerKey
            ? getActiveLinkedDevice(linkedMeta)
            : null;
          if (activeLinkedDevice && getLiveSyncRoots(activeLinkedDevice).length > 0) {
            return {
              name: item,
              type: 'linked-device',
              fullPath: rel,
              deviceId: activeLinkedDevice.deviceId,
              osType: activeLinkedDevice.osType || 'unknown',
              syncMode: activeLinkedDevice.syncMode || 'safe-bidirectional',
              deviceStatus: activeLinkedDevice.status || 'connected'
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
  if (req.file) {
    (async () => {
      try {
        const fileName = sanitizeUploadFileName(Buffer.from(req.file.originalname, 'latin1').toString('utf8'));
        if (!fileName) {
          safeRmSync(req.file.path);
          return res.status(400).json({ error: '올바른 파일 이름이 필요합니다.' });
        }
        const folderPath = req.body.path || req.query.path || '/';
        const { basePath, targetPath: targetDir } = getValidatedPath(req.user, folderPath, req.headers['x-nas-password']);
        const finalPath = resolveInside(targetDir, fileName);
        assertRealPathInside(basePath, path.dirname(finalPath));
        if (fs.existsSync(finalPath) && !fs.statSync(finalPath).isFile()) {
          safeRmSync(req.file.path);
          return res.status(409).json({ error: '같은 이름의 폴더가 이미 있습니다.' });
        }
        await assertQuotaAvailable(req.user, req.file.size, finalPath);
        const previousVersion = fs.existsSync(finalPath)
          ? captureFileVersion(basePath, finalPath, { source: 'web-upload', actor: getActivityActor(req.user), reason: 'overwrite' })
          : null;
        fs.mkdirSync(path.dirname(finalPath), { recursive: true });
        fs.renameSync(req.file.path, finalPath);
        invalidateUsageCache(finalPath);
        appendActivity(basePath, { type: previousVersion ? 'file-updated' : 'file-created', path: toNasRelativePath(basePath, finalPath), actor: getActivityActor(req.user), source: 'web-upload' });
        return res.json({ success: true, versionId: previousVersion?.versionId || null });
      } catch (e) {
        safeRmSync(req.file.path);
        return res.status(e.status || 500).json({ error: e.message || '저장공간 제한을 확인하지 못했습니다.' });
      }
    })();
    return;
  }
  try {
    const { basePath, targetPath } = getValidatedPath(req.user, path.join(req.body.path || '', req.body.folderName), req.headers['x-nas-password']);
    if (!fs.existsSync(targetPath)) fs.mkdirSync(targetPath, { recursive: true });
    invalidateUsageCache(targetPath);
    appendActivity(basePath, { type: 'folder-created', path: toNasRelativePath(basePath, targetPath), actor: getActivityActor(req.user), source: 'web' });
    res.json({ success: true });
  } catch (e) { res.status(403).json({ error: e.message }); }
});

const getUserTrashRoot = (basePath) => path.join(basePath, USER_TRASH_DIR);

const cleanupExpiredUserTrash = (basePath) => {
  const trashRoot = getUserTrashRoot(basePath);
  if (!fs.existsSync(trashRoot)) return;
  const cutoff = Date.now() - USER_TRASH_RETENTION_MS;
  for (const entry of fs.readdirSync(trashRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{20,80}$/i.test(entry.name)) continue;
    const dir = path.join(trashRoot, entry.name);
    try {
      const metaPath = path.join(dir, 'meta.json');
      const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
      const deletedAt = Date.parse(meta.deletedAt || 0) || fs.statSync(dir).mtimeMs;
      if (deletedAt < cutoff) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
};

const moveToUserTrash = (basePath, targetPath, requestPath) => {
  const trashRoot = getUserTrashRoot(basePath);
  const relative = path.relative(basePath, targetPath).replace(/\\/g, '/');
  if (!relative || relative === USER_TRASH_DIR || relative.startsWith(USER_TRASH_DIR + '/')) {
    const err = new Error('휴지통 자체는 일반 삭제할 수 없습니다.');
    err.status = 400;
    throw err;
  }
  cleanupExpiredUserTrash(basePath);
  fs.mkdirSync(trashRoot, { recursive: true });
  const trashId = `${Date.now().toString(16)}-${crypto.randomBytes(10).toString('hex')}`;
  const itemRoot = path.join(trashRoot, trashId);
  const contentPath = path.join(itemRoot, 'content');
  fs.mkdirSync(itemRoot, { recursive: true });
  fs.renameSync(targetPath, contentPath);
  const stat = fs.statSync(contentPath);
  fs.writeFileSync(path.join(itemRoot, 'meta.json'), JSON.stringify({
    trashId,
    originalPath: requestPath.startsWith('/') ? requestPath : `/${requestPath}`,
    originalRelativePath: relative,
    name: path.basename(targetPath),
    type: stat.isDirectory() ? 'folder' : 'file',
    size: stat.isFile() ? stat.size : null,
    deletedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  invalidateUsageCache(targetPath);
  invalidateUsageCache(trashRoot);
  return { trashId, deletedAt: new Date().toISOString() };
};

const readUserTrashItem = (basePath, trashIdValue) => {
  const trashId = String(trashIdValue || '');
  if (!/^[a-f0-9-]{20,80}$/i.test(trashId)) throw Object.assign(new Error('잘못된 휴지통 항목입니다.'), { status: 400 });
  const trashRoot = getUserTrashRoot(basePath);
  const itemRoot = path.resolve(trashRoot, trashId);
  if (!itemRoot.startsWith(path.resolve(trashRoot) + path.sep)) throw Object.assign(new Error('잘못된 휴지통 경로입니다.'), { status: 400 });
  const metaPath = path.join(itemRoot, 'meta.json');
  const contentPath = path.join(itemRoot, 'content');
  if (!fs.existsSync(metaPath) || !fs.existsSync(contentPath)) throw Object.assign(new Error('휴지통 항목을 찾을 수 없습니다.'), { status: 404 });
  return { trashId, itemRoot, contentPath, meta: JSON.parse(fs.readFileSync(metaPath, 'utf8')) };
};

const restoreUserTrashItem = (basePath, trashId) => {
  const item = readUserTrashItem(basePath, trashId);
  const requestedTarget = resolveInside(basePath, item.meta.originalRelativePath);
  let restoreTarget = requestedTarget;
  if (fs.existsSync(restoreTarget)) {
    const parsed = path.parse(restoreTarget);
    let attempt = 1;
    do {
      restoreTarget = path.join(parsed.dir, `${parsed.name} (복원됨 ${attempt})${parsed.ext}`);
      attempt += 1;
    } while (fs.existsSync(restoreTarget));
  }
  assertRealPathInside(basePath, path.dirname(restoreTarget));
  fs.mkdirSync(path.dirname(restoreTarget), { recursive: true });
  fs.renameSync(item.contentPath, restoreTarget);
  fs.rmSync(item.itemRoot, { recursive: true, force: true });
  invalidateUsageCache(restoreTarget);
  return restoreTarget;
};

router.get('/trash', verifyToken, (req, res) => {
  try {
    const { basePath } = getValidatedPath(req.user, '/');
    cleanupExpiredUserTrash(basePath);
    const trashRoot = getUserTrashRoot(basePath);
    if (!fs.existsSync(trashRoot)) return res.json({ success: true, items: [], retentionDays: 30 });
    const items = fs.readdirSync(trashRoot, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
      try { return readUserTrashItem(basePath, entry.name).meta; } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
    return res.json({ success: true, items, retentionDays: 30 });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '휴지통을 불러오지 못했습니다.' });
  }
});

router.post('/trash/:trashId/restore', verifyToken, express.json(), (req, res) => {
  try {
    const { basePath } = getValidatedPath(req.user, '/');
    const restoreTarget = restoreUserTrashItem(basePath, req.params.trashId);
    appendActivity(basePath, { type: 'trash-restored', path: toNasRelativePath(basePath, restoreTarget), actor: getActivityActor(req.user), source: 'web' });
    return res.json({ success: true, path: toNasRelativePath(basePath, restoreTarget) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '휴지통 항목을 복원하지 못했습니다.' });
  }
});

router.delete('/trash/:trashId', verifyToken, (req, res) => {
  try {
    const { basePath } = getValidatedPath(req.user, '/');
    const item = readUserTrashItem(basePath, req.params.trashId);
    const deletedPath = item.meta.originalPath || item.meta.originalRelativePath || item.meta.name;
    fs.rmSync(item.itemRoot, { recursive: true, force: true });
    invalidateUsageCache(getUserTrashRoot(basePath));
    appendActivity(basePath, { type: 'trash-permanently-deleted', path: deletedPath, actor: getActivityActor(req.user), source: 'web' });
    return res.json({ success: true, permanentlyDeleted: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '휴지통 항목을 삭제하지 못했습니다.' });
  }
});

// [3] 파일/폴더 삭제: 즉시 영구 삭제하지 않고 계정별 30일 휴지통으로 이동한다.
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

    cleanupLinkedDeviceDeletion(targetPath);

    if (fs.existsSync(targetPath)) {
      const trash = moveToUserTrash(basePath, targetPath, requestPath);
      appendActivity(basePath, { type: 'moved-to-trash', path: requestPath, trashId: trash.trashId, actor: getActivityActor(req.user), source: 'web' });
      return res.json({ success: true, trashed: true, ...trash });
    }
    res.json({ success: true, missing: true });
  } catch (e) { res.status(403).json({ error: e.message }); }
});

router.get('/file/versions', verifyToken, (req, res) => {
  try {
    const { basePath, targetPath } = getValidatedPath(req.user, req.query.path, req.headers['x-nas-password']);
    const versions = listFileVersions(basePath, targetPath);
    return res.json({ success: true, path: toNasRelativePath(basePath, targetPath), retentionDays: 30, maxVersions: 100, versions });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '파일 버전 기록을 불러오지 못했습니다.' });
  }
});

router.get('/file/versions/:versionId/download', verifyToken, (req, res) => {
  try {
    const { basePath, targetPath } = getValidatedPath(req.user, req.query.path, req.headers['x-nas-password']);
    const version = getFileVersion(basePath, targetPath, req.params.versionId);
    return res.download(version.contentPath, version.meta.name || path.basename(targetPath));
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '파일 버전을 다운로드하지 못했습니다.' });
  }
});

router.post('/file/versions/:versionId/restore', verifyToken, express.json(), async (req, res) => {
  try {
    const { basePath, targetPath } = getValidatedPath(req.user, req.body?.path, req.headers['x-nas-password']);
    const version = getFileVersion(basePath, targetPath, req.params.versionId);
    await assertQuotaAvailable(req.user, Number(version.meta.size || 0), targetPath);
    const restored = restoreFileVersion(basePath, targetPath, req.params.versionId, { actor: getActivityActor(req.user), source: 'web' });
    invalidateUsageCache(targetPath);
    return res.json({ success: true, path: toNasRelativePath(basePath, targetPath), restoredVersion: restored });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '파일 버전을 복원하지 못했습니다.' });
  }
});

router.get('/drive/restore-points', verifyToken, (req, res) => {
  try {
    const basePath = getDeviceUserBasePath(req.user);
    fs.mkdirSync(basePath, { recursive: true });
    assertRealPathInside(basePath, basePath);
    return res.json({ success: true, retentionDays: 30, restorePoints: listDriveRestorePoints(basePath) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '드라이브 복구 지점을 불러오지 못했습니다.' });
  }
});

router.post('/drive/restore-points', verifyToken, express.json(), (req, res) => {
  try {
    const basePath = getDeviceUserBasePath(req.user);
    fs.mkdirSync(basePath, { recursive: true });
    assertRealPathInside(basePath, basePath);
    const restorePoint = createDriveRestorePoint(basePath, {
      label: req.body?.label || '사용자 복구 지점',
      source: 'web',
      actor: getActivityActor(req.user)
    });
    invalidateUsageCache(basePath);
    return res.json({ success: true, restorePoint });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '드라이브 복구 지점을 만들지 못했습니다.' });
  }
});

router.post('/drive/restore-points/:restorePointId/restore', verifyToken, express.json(), (req, res) => {
  try {
    if (req.body?.confirmation !== 'RESTORE_DRIVE') {
      return res.status(400).json({ error: '전체 드라이브 복원 확인 값이 필요합니다.' });
    }
    const basePath = getDeviceUserBasePath(req.user);
    fs.mkdirSync(basePath, { recursive: true });
    assertRealPathInside(basePath, basePath);
    const result = restoreDriveFromPoint(basePath, req.params.restorePointId, { actor: getActivityActor(req.user) });
    invalidateUsageCache(basePath);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '드라이브를 복원하지 못했습니다.' });
  }
});

router.get('/activity', verifyToken, (req, res) => {
  try {
    const basePath = getDeviceUserBasePath(req.user);
    fs.mkdirSync(basePath, { recursive: true });
    assertRealPathInside(basePath, basePath);
    return res.json({ success: true, activities: listActivity(basePath, req.query.limit) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '활동 기록을 불러오지 못했습니다.' });
  }
});

router.get('/favorites', verifyToken, (req, res) => {
  try {
    const basePath = getDeviceUserBasePath(req.user);
    fs.mkdirSync(basePath, { recursive: true });
    assertRealPathInside(basePath, basePath);
    return res.json({ success: true, items: listFavorites(basePath) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '즐겨찾기를 불러오지 못했습니다.' });
  }
});

router.put('/favorites', verifyToken, express.json(), (req, res) => {
  try {
    const { basePath, targetPath } = getValidatedDeviceUserPath(req.user, req.body?.path);
    const result = setFavorite(basePath, targetPath, req.body?.favorite !== false);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '즐겨찾기를 변경하지 못했습니다.' });
  }
});

router.get('/recent', verifyToken, (req, res) => {
  try {
    const basePath = getDeviceUserBasePath(req.user);
    fs.mkdirSync(basePath, { recursive: true });
    assertRealPathInside(basePath, basePath);
    return res.json({ success: true, ...listRecentFiles(basePath, req.query.limit) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '최근 파일을 불러오지 못했습니다.' });
  }
});

// [4] 단일 파일 다운로드
router.get('/file/download', verifyToken, (req, res) => {
  try { 
    const { basePath, targetPath } = getValidatedPath(req.user, req.query.path, req.headers['x-nas-password']);
    appendActivity(basePath, { type: req.query.inline === 'true' ? 'file-opened' : 'file-downloaded', path: toNasRelativePath(basePath, targetPath), actor: getActivityActor(req.user), source: 'web' });
    if (req.query.inline === 'true') {
      res.sendFile(targetPath); // 브라우저 자체 뷰어로 열기 (모바일 43페이지 스크롤 가능!)
    } else {
      res.download(targetPath); // 일반 파일 다운로드
    }
  } 
  catch(e){ res.status(403).send(); }
});

router.get('/hwp/render', verifyToken, async (req, res) => {
  try {
    const { targetPath } = getValidatedPath(req.user, req.query.path, req.headers['x-nas-password']);
    const ext = path.extname(targetPath).toLowerCase();
    if (!['.hwp', '.hwpx'].includes(ext)) {
      return res.status(400).json({ error: '지원하지 않는 한글 문서 형식입니다.' });
    }
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }

    const { HwpDocument } = await ensureServerRhwp();
    const bytes = fs.readFileSync(targetPath);
    const doc = new HwpDocument(new Uint8Array(bytes));
    const pageCount = Math.max(0, Number(doc.pageCount?.() || 0));
    const pages = [];
    for (let index = 0; index < pageCount; index += 1) {
      pages.push(doc.renderPageSvg(index));
    }

    return res.json({
      success: true,
      fileName: path.basename(targetPath),
      size: bytes.length,
      pageCount,
      pages
    });
  } catch (e) {
    console.error('[RHWP] server render failed', e);
    return res.status(e.status || 500).json({ error: e.message || '한글 문서를 렌더링하지 못했습니다.' });
  }
});

// [5] 파일/폴더 복사 (Ctrl+C / Ctrl+V)
router.post('/file/copy', verifyToken, async (req, res) => {
  try {
    const { sourcePaths, destinationFolder } = req.body;
    if (!sourcePaths || !Array.isArray(sourcePaths)) return res.status(400).json({ error: '잘못된 요청' });

    let destReqPath = destinationFolder;
    if (!destReqPath || destReqPath === 'undefined') destReqPath = '/';
    const { basePath, targetPath: destDir } = getValidatedPath(req.user, destReqPath);

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    let incomingBytes = 0;
    const preparedCopies = [];
    for (const src of sourcePaths) {
      const { targetPath: srcPath } = getValidatedPath(req.user, src);
      if (!fs.existsSync(srcPath)) continue;

      const fileName = path.basename(srcPath);
      let finalDest = path.join(destDir, fileName);
      let counter = 1;

      while(fs.existsSync(finalDest)) {
        const ext = path.extname(fileName);
        const name = path.basename(fileName, ext);
        finalDest = path.join(destDir, `${name} - 복사본 (${counter})${ext}`);
        counter++;
      }
      const usage = await getCachedPathUsage(srcPath);
      incomingBytes += Number(usage.sizeBytes || 0);
      preparedCopies.push({ srcPath, finalDest });
    }

    await assertQuotaAvailable(req.user, incomingBytes, destDir);

    preparedCopies.forEach(({ srcPath, finalDest }) => {
      fs.cpSync(srcPath, finalDest, { recursive: true });
      invalidateUsageCache(finalDest);
      appendActivity(basePath, { type: 'item-copied', path: toNasRelativePath(basePath, finalDest), actor: getActivityActor(req.user), source: 'web' });
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

    const { basePath, targetPath: fullOldPath } = getValidatedPath(req.user, oldPath);
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
      invalidateUsageCache(fullOldPath);
      invalidateUsageCache(fullNewPath);
      appendActivity(basePath, { type: 'item-moved', path: toNasRelativePath(basePath, fullNewPath), previousPath: toNasRelativePath(basePath, fullOldPath), actor: getActivityActor(req.user), source: 'web' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});


// 🔥 [복구] ONLYOFFICE 저장 콜백 API (문서 편집 후 저장 담당)
router.post('/onlyoffice/callback', async (req, res) => {
  const { status, url } = req.body;
  let officeAccess;
  try {
    officeAccess = verifyOfficeAccessToken(JWT_SECRET, req.query.officeToken);
  } catch (err) {
    return res.status(401).json({ error: 1, message: 'invalid onlyoffice callback token' });
  }
  const relPath = normalizeOfficePath(req.query.path);
  if (relPath !== officeAccess.path) {
    return res.status(403).json({ error: 1, message: 'onlyoffice callback path mismatch' });
  }
  const uid = officeAccess.userUid || officeAccess.loginId;

  if (status === 2 || status === 6) { 
    try {
      const axios = require('axios');
      const https = require('https');
      const fs = require('fs');
      const path = require('path');
      
      const latestOfficeUser = findMemberByAnyId({
        userUid: officeAccess.userUid,
        loginId: officeAccess.loginId,
        id: officeAccess.loginId,
        username: officeAccess.loginId
      });
      if (!latestOfficeUser || latestOfficeUser.disabled) {
        return res.status(401).json({ error: 1, message: 'onlyoffice account is missing or disabled' });
      }
      const officeUser = normalizeQuotaFields(latestOfficeUser);
      const basePath = getAccessBasePath(officeUser);
      const absoluteFilePath = resolveInside(basePath, relPath || '');
      const parentDir = path.dirname(absoluteFilePath);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

      console.log('[onlyoffice callback]', {
        status,
        relPath,
        uid,
        isAdmin: !!(officeUser.Masters || officeUser.Managers || officeUser.globalAccess),
        target: absoluteFilePath,
        downloadUrl: url
      });

      const downloadUrl = String(url || '').replace(
        /^https?:\/\/(?:www\.)?filemanager-nas\.com\/cache\//i,
        'http://127.0.0.1:8080/cache/'
      );

      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: 120000,
        maxRedirects: 5,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      });
      const contentLength = Number(response.headers['content-length'] || 0);
      if (contentLength > 0) await assertQuotaAvailable(officeUser, contentLength, absoluteFilePath);
      fs.mkdirSync(WEB_INCOMING_ROOT, { recursive: true });
      const officeIncomingPath = path.join(WEB_INCOMING_ROOT, `${Date.now()}_${crypto.randomBytes(10).toString('hex')}.office`);
      const writer = fs.createWriteStream(officeIncomingPath);
      response.data.pipe(writer);
      
      writer.on('finish', () => {
        try {
          const previousVersion = fs.existsSync(absoluteFilePath) && fs.statSync(absoluteFilePath).isFile()
            ? captureFileVersion(basePath, absoluteFilePath, { source: 'onlyoffice', actor: getActivityActor(officeUser), reason: 'office-save' })
            : null;
          fs.renameSync(officeIncomingPath, absoluteFilePath);
          invalidateUsageCache(absoluteFilePath);
          appendActivity(basePath, { type: previousVersion ? 'file-updated' : 'file-created', path: `/${relPath}`, versionId: previousVersion?.versionId || undefined, actor: getActivityActor(officeUser), source: 'onlyoffice' });
          res.json({ error: 0 });
        } catch (finishError) {
          safeRmSync(officeIncomingPath);
          console.error('[onlyoffice callback] atomic commit failed', finishError);
          res.json({ error: 1 });
        }
      });
      writer.on('error', (err) => {
        safeRmSync(officeIncomingPath);
        console.error('[onlyoffice callback] write failed', err);
        res.json({ error: 1 });
      });
    } catch (error) {
      console.error('[onlyoffice callback] failed', {
        message: error.message,
        status,
        relPath,
        uid,
        downloadUrl: url
      });
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
router.post('/file/chunk/init', verifyToken, async (req, res) => {
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

    await assertQuotaAvailable(req.user, fileSize, finalPath);

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

    const { basePath } = getValidatedPath(req.user, '/');
    const previousVersion = fs.existsSync(meta.finalPath) && fs.statSync(meta.finalPath).isFile()
      ? captureFileVersion(basePath, meta.finalPath, { source: 'web-chunk-upload', actor: getActivityActor(req.user), reason: 'overwrite' })
      : null;
    fs.renameSync(meta.tempPath, meta.finalPath);
    invalidateUsageCache(meta.finalPath);
    appendActivity(basePath, { type: previousVersion ? 'file-updated' : 'file-created', path: toNasRelativePath(basePath, meta.finalPath), actor: getActivityActor(req.user), source: 'web-chunk-upload' });
    safeRmSync(getChunkDir(uploadId));

    return res.json({
      success: true,
      fileName: meta.fileName,
      size: meta.fileSize,
      versionId: previousVersion?.versionId || null
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

router.get('/devices', verifyToken, (req, res) => {
  try {
    const ownerKey = getDeviceOwnerKey(req.user);
    const devices = readJsonArrayFile(LINKED_DEVICES_FILE)
      .filter(device => device.ownerKey === ownerKey)
      .map(sanitizeDeviceForResponse);
    return res.json({ success: true, devices, serverTime: new Date().toISOString(), offlineAfterMs: DEVICE_OFFLINE_AFTER_MS });
  } catch (err) {
    return res.status(500).json({ error: err.message || '등록 장치 조회 실패' });
  }
});

router.delete('/devices/:deviceId', verifyToken, (req, res) => {
  try {
    const ownerKey = getDeviceOwnerKey(req.user);
    const deviceId = String(req.params.deviceId || '').trim();
    const devices = readJsonArrayFile(LINKED_DEVICES_FILE);
    const idx = devices.findIndex(device => device.deviceId === deviceId && device.ownerKey === ownerKey);
    if (idx < 0) return res.status(404).json({ error: '등록 장치를 찾을 수 없습니다.' });

    const revokedAt = new Date().toISOString();
    devices[idx] = advanceDeviceState(devices[idx], {
      status: 'revoked',
      revokedAt,
      agentTokenHash: null
    }, revokedAt);
    writeJsonArrayFile(LINKED_DEVICES_FILE, devices);
    try { writeLinkedDeviceMeta(devices[idx]); } catch (err) {}
    emitDeviceStatus(req, devices[idx]);

    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE).map(pairing => (
      pairing.ownerKey === ownerKey && pairing.device?.deviceId === deviceId
        ? { ...pairing, status: 'revoked', revokedAt }
        : pairing
    ));
    writeJsonArrayFile(DEVICE_PAIRINGS_FILE, pairings);

    return res.json({ success: true, device: sanitizeDeviceForResponse(devices[idx]) });
  } catch (err) {
    return res.status(500).json({ error: err.message || '장치 연결 해제 실패' });
  }
});

router.patch('/devices/:deviceId/sync', verifyToken, express.json(), (req, res) => {
  try {
    const ownerKey = getDeviceOwnerKey(req.user);
    const deviceId = String(req.params.deviceId || '').trim();
    const action = String(req.body?.action || '').trim();
    if (!['pause', 'resume'].includes(action)) return res.status(400).json({ error: '지원하지 않는 동기화 작업입니다.' });
    const devices = readJsonArrayFile(LINKED_DEVICES_FILE);
    const idx = devices.findIndex(device => device.deviceId === deviceId && device.ownerKey === ownerKey && device.status !== 'revoked');
    if (idx < 0) return res.status(404).json({ error: '등록 장치를 찾을 수 없습니다.' });
    const now = new Date().toISOString();
    devices[idx] = advanceDeviceState(devices[idx], {
      syncPaused: action === 'pause',
      syncState: action === 'pause' ? 'paused' : 'pending',
      pausedAt: action === 'pause' ? now : null,
      lastError: action === 'resume' ? '' : (devices[idx].lastError || '')
    }, now);
    writeJsonArrayFile(LINKED_DEVICES_FILE, devices);
    if (action === 'resume') agentMutationWindows.delete(deviceId);
    emitDeviceStatus(req, devices[idx]);
    return res.json({ success: true, device: sanitizeDeviceForResponse(devices[idx]) });
  } catch (err) {
    return res.status(500).json({ error: err.message || '동기화 상태 변경 실패' });
  }
});

// 웹에서 연동 시작
router.post('/devices/pair/start', verifyToken, (req, res) => {
  try {
    ensureDeviceDataFiles();

    const targetPath = req.body?.path || '/';
    const token = createPairingToken();
    const ownerKey = getDeviceOwnerKey(req.user);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const { targetPath: pairingTargetAbs } = getValidatedDeviceUserPath(req.user, targetPath);
    const targetDevice = fs.existsSync(pairingTargetAbs) && fs.statSync(pairingTargetAbs).isDirectory()
      ? findLinkedDeviceByAbsolutePath(ownerKey, pairingTargetAbs)
      : null;
    const requestedDriveMode = String(req.body?.driveMode || '').trim();
    const pairingMode = requestedDriveMode === 'personal-drive'
      ? 'personal-drive'
      : (targetDevice ? 'add-folder' : 'install-device');

    // 생성 위치 권한 사전 검증
    getValidatedDeviceUserPath(req.user, targetPath);

    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE).filter(p => {
      if (!p.expiresAt) return true;
      return new Date(p.expiresAt).getTime() > Date.now();
    });

    const pairing = {
      tokenHash: hashPairingToken(token),
      tokenHint: token.slice(-8),
      ownerKey,
      targetPath,
      targetDeviceId: targetDevice?.deviceId || null,
      mode: pairingMode,
      clientIntent: String(req.body?.clientIntent || '').trim(),
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt,
      device: null
    };

    pairings.push(pairing);
    writeJsonArrayFile(DEVICE_PAIRINGS_FILE, pairings);

    const safePairingToken = token.replace(/[^a-zA-Z0-9_-]/g, '');
    const installerPath = path.join(__dirname, 'agents', 'dist', 'NAS-Drive-Setup.exe');
    const agentDownloadName = fs.existsSync(installerPath)
      ? `NAS-Drive-Setup_${safePairingToken}.exe`
      : `NAS-Sync-Agent_${safePairingToken}.exe`;

    return res.json({
      success: true,
      pairingToken: token,
      expiresAt,
      status: 'pending',
      agentDownloadUrl: `/api/devices/agent/windows?token=${encodeURIComponent(token)}`,
      agentDownloadName,
      agentKind: fs.existsSync(installerPath)
        ? 'windows-setup'
        : (fs.existsSync(path.join(__dirname, 'agents', 'dist', 'NAS-Sync-Agent.exe')) ? 'windows-exe' : 'windows-cmd'),
      mode: pairingMode
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

param([switch]$Background, [string]$PairingUrl)

$ErrorActionPreference = "Stop"

$ServerBase = "https://filemanager-nas.com"
$PairingToken = "${safeToken}"
$MaxFileBytes = 90MB
$MaxTotalBytes = 50GB
$StateDir = Join-Path $env:LOCALAPPDATA "NAS-Sync-Agent"
$DeviceKeyFile = Join-Path $StateDir "device-key.txt"
$ConfigFile = Join-Path $StateDir "agent-config.json"
$PullIntervalSeconds = 10
$Script:ApplyingRemoteChange = $false

function Set-PairingTokenFromUrl($url) {
  if (-not $url) { return }
  try {
    $match = [regex]::Match($url, '[?&]token=([^&]+)')
    if ($match.Success) {
      $script:PairingToken = [System.Uri]::UnescapeDataString($match.Groups[1].Value)
    }
  } catch {
    Write-Host "Could not parse pairing URL: $($_.Exception.Message)"
  }
}

Set-PairingTokenFromUrl $PairingUrl

function Ensure-StateDir {
  if (-not (Test-Path -LiteralPath $StateDir -PathType Container)) {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
  }
}

function Save-AgentConfig($config) {
  Ensure-StateDir
  $config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ConfigFile -Encoding UTF8
}

function Load-AgentConfig {
  try {
    if (Test-Path -LiteralPath $ConfigFile -PathType Leaf) {
      return Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
    }
  } catch {}
  return $null
}

function Get-ConfigRoots($config) {
  if ($config -and $config.syncRoots) { return @($config.syncRoots) }
  if ($config -and $config.syncFolder -and $config.deviceId -and $config.agentToken) {
    return @([PSCustomObject]@{
      syncRootId = if ($config.syncRootId) { $config.syncRootId } else { "root_default" }
      name = if ($config.syncRootName) { $config.syncRootName } else { $config.deviceName }
      localPath = $config.syncFolder
      linkedNasPath = $config.linkedNasPath
    })
  }
  return @()
}

function Add-OrUpdateConfigRoot($config, $root) {
  $roots = @()
  if ($config) { $roots = @(Get-ConfigRoots $config) }
  $roots = @($roots | Where-Object { $_.syncRootId -ne $root.syncRootId -and $_.localPath -ne $root.localPath })
  return @($roots + $root)
}

function Get-RootStateFile($root) {
  Ensure-StateDir
  $safeRootId = ($root.syncRootId -replace '[^a-zA-Z0-9_-]', '_')
  return Join-Path $StateDir "state_$safeRootId.json"
}

function Load-RootState($root) {
  try {
    $file = Get-RootStateFile $root
    if (Test-Path -LiteralPath $file -PathType Leaf) {
      return Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    }
  } catch {}
  return $null
}

function Save-RootState($root, $remotePaths) {
  $file = Get-RootStateFile $root
  @{
    syncRootId = $root.syncRootId
    remotePaths = @($remotePaths)
    savedAt = (Get-Date).ToUniversalTime().ToString("o")
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $file -Encoding UTF8
}

function Move-ToLocalTrash($root, $target) {
  if (-not (Test-Path -LiteralPath $target)) { return }
  $safeRootId = ($root.syncRootId -replace '[^a-zA-Z0-9_-]', '_')
  $trashRoot = Join-Path $StateDir ("trash\\" + $safeRootId + "\\" + (Get-Date -Format "yyyyMMdd_HHmmss"))
  $rel = Convert-ToRelPath $root.localPath $target
  if (-not $rel) { return }
  $trashPath = Join-Path $trashRoot ($rel -replace '/', [System.IO.Path]::DirectorySeparatorChar)
  $trashParent = Split-Path -Parent $trashPath
  if ($trashParent -and -not (Test-Path -LiteralPath $trashParent -PathType Container)) {
    New-Item -ItemType Directory -Path $trashParent -Force | Out-Null
  }
  Move-Item -LiteralPath $target -Destination $trashPath -Force
  Write-Host "[nas deleted -> local trash] $rel"
}

function Start-BackgroundAgent {
  if (-not $PSCommandPath) { return }
  $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \`"$PSCommandPath\`" -Background"
  try {
    Set-ItemProperty -Path "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" -Name "NAS Sync Agent" -Value $command -Force | Out-Null
  } catch {
    Write-Host "Startup registration failed: $($_.Exception.Message)"
  }
  Start-Process -FilePath "powershell.exe" -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath, "-Background")
}

function Register-UrlProtocol {
  if (-not $PSCommandPath) { return }
  try {
    $base = "HKCU:\\Software\\Classes\\nas-sync"
    New-Item -Path $base -Force | Out-Null
    Set-Item -Path $base -Value "URL:NAS Sync Agent" -Force
    New-ItemProperty -Path $base -Name "URL Protocol" -Value "" -Force | Out-Null
    $commandKey = "$base\\shell\\open\\command"
    New-Item -Path $commandKey -Force | Out-Null
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \`"$PSCommandPath\`" -PairingUrl \`"%1\`""
    Set-Item -Path $commandKey -Value $command -Force
  } catch {
    Write-Host "Protocol registration failed: $($_.Exception.Message)"
  }
}

function Select-SyncFolder {
  try {
    Add-Type -AssemblyName System.Windows.Forms | Out-Null
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Select a folder to sync with NAS in realtime."
    $dialog.ShowNewFolderButton = $false
    if ($env:USERPROFILE) {
      $desktop = Join-Path $env:USERPROFILE "Desktop"
      if (Test-Path -LiteralPath $desktop -PathType Container) { $dialog.SelectedPath = $desktop }
    }
    $result = $dialog.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) { return $dialog.SelectedPath }
  } catch {
    Write-Host "Folder picker is unavailable. Switching to manual path input."
  }

  $manualPath = Read-Host "Enter the full folder path to sync with NAS"
  if ($manualPath -and (Test-Path -LiteralPath $manualPath -PathType Container)) { return $manualPath }
  throw "No sync folder was selected, or the selected folder does not exist."
}

function Get-OrCreateDeviceKey {
  try {
    $machineGuid = (Get-ItemProperty -LiteralPath "HKLM:\\SOFTWARE\\Microsoft\\Cryptography" -Name MachineGuid -ErrorAction Stop).MachineGuid
    if ($machineGuid) {
      return "win-machine-" + $machineGuid.ToString().Trim()
    }
  } catch {}

  if (-not (Test-Path -LiteralPath $StateDir -PathType Container)) {
    Ensure-StateDir
  }
  if (Test-Path -LiteralPath $DeviceKeyFile -PathType Leaf) {
    $existing = (Get-Content -LiteralPath $DeviceKeyFile -Raw).Trim()
    if ($existing) { return $existing }
  }
  $next = [Guid]::NewGuid().ToString("N")
  Set-Content -LiteralPath $DeviceKeyFile -Value $next -Encoding ASCII
  return $next
}

function Get-DeviceDisplayName($defaultName) {
  Write-Host ""
  Write-Host "Registering this PC as a new NAS sync device."
  Write-Host "Enter the NAS root folder name for this device."
  $entered = Read-Host "Device/sync folder name [$defaultName]"
  if ($entered -and $entered.Trim()) {
    return $entered.Trim()
  }
  return $defaultName
}

function Get-DeviceLookup($deviceKey) {
  try {
    $lookupBody = @{
      pairingToken = $PairingToken
      clientDeviceKey = $deviceKey
    } | ConvertTo-Json -Compress

    return Invoke-RestMethod -Method Post -Uri "$ServerBase/api/devices/agent/lookup" -ContentType "application/json" -Body $lookupBody
  } catch {
    Write-Host "Existing PC lookup failed. Continuing as a new registration."
  }

  return $null
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

function Get-SafeDeviceName($baseName) {
  $name = $baseName
  if (-not $name) { $name = $env:COMPUTERNAME }
  if (-not $name) { $name = "Windows-PC" }
  return $name
}

function Invoke-AgentJson($endpoint, $body) {
  $json = $body | ConvertTo-Json -Compress
  return Invoke-RestMethod -Method Post -Uri "$ServerBase$endpoint" -ContentType "application/json" -Headers @{ "x-agent-token" = $Script:AgentToken } -Body $json
}

function Invoke-AgentGet($endpoint) {
  return Invoke-RestMethod -Method Get -Uri "$ServerBase$endpoint" -Headers @{ "x-agent-token" = $Script:AgentToken }
}

function Sync-Folder($root, $fullPath) {
  if (-not (Test-Path -LiteralPath $fullPath -PathType Container)) { return }
  $relPath = Convert-ToRelPath $root.localPath $fullPath
  if (-not $relPath) { return }
  Invoke-AgentJson "/api/devices/agent/sync-folder" @{ deviceId = $Script:DeviceId; syncRootId = $root.syncRootId; relPath = $relPath } | Out-Null
  Write-Host "[folder] $relPath"
}

function Sync-Delete($root, $fullPath) {
  $relPath = Convert-ToRelPath $root.localPath $fullPath
  if (-not $relPath) { return }
  Invoke-AgentJson "/api/devices/agent/sync-delete" @{ deviceId = $Script:DeviceId; syncRootId = $root.syncRootId; relPath = $relPath } | Out-Null
  Write-Host "[delete] $relPath"
}

function Sync-File($root, $fullPath) {
  if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { return }
  $file = Get-Item -LiteralPath $fullPath -Force
  $relPath = Convert-ToRelPath $root.localPath $file.FullName
  if ($file.Length -gt $MaxFileBytes) {
    Write-Host "[skip >90MB] $relPath"
    return
  }
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if (-not $curl) { throw "curl.exe was not found. Windows 10/11 includes curl.exe by default." }
  $args = @("-sS", "-X", "POST", "$ServerBase/api/devices/agent/sync-file", "-H", "x-agent-token: $Script:AgentToken", "-F", "deviceId=$Script:DeviceId", "-F", "syncRootId=$($root.syncRootId)", "-F", "relPath=$relPath", "-F", "file=@$($file.FullName)")
  $response = & $curl.Source @args
  if ($LASTEXITCODE -ne 0) { throw "curl upload failed with exit code $LASTEXITCODE" }
  Write-Host "[file] $relPath"
}

function Initial-Sync($root) {
  Write-Host ""
  Write-Host "Initial sync started: $($root.localPath)"
  Get-ChildItem -LiteralPath $root.localPath -Recurse -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try { Sync-Folder $root $_.FullName } catch { Write-Host "[folder failed] $($_.FullName) $($_.Exception.Message)" }
  }
  Get-ChildItem -LiteralPath $root.localPath -Recurse -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
    try { Sync-File $root $_.FullName } catch { Write-Host "[file failed] $($_.FullName) $($_.Exception.Message)" }
  }
  Write-Host "Initial sync complete."
}

function Pull-NasChanges($root) {
  try {
    if (-not $Script:DeviceId -or -not $Script:AgentToken -or -not $root.localPath) { return }
    $deviceIdEncoded = [System.Uri]::EscapeDataString($Script:DeviceId)
    $rootIdEncoded = [System.Uri]::EscapeDataString($root.syncRootId)
    $manifest = Invoke-AgentGet "/api/devices/agent/manifest?deviceId=$deviceIdEncoded&syncRootId=$rootIdEncoded"
    if (-not $manifest.entries) { return }
    $state = Load-RootState $root
    $previousPaths = @{}
    if ($state -and $state.remotePaths) {
      foreach ($p in @($state.remotePaths)) {
        if ($p) { $previousPaths[$p] = $true }
      }
    }
    $remotePaths = @{}
    foreach ($entry in @($manifest.entries)) {
      if ($entry.relPath) { $remotePaths[$entry.relPath] = $entry.type }
    }

    $Script:ApplyingRemoteChange = $true

    $manifest.entries | Where-Object { $_.type -eq "folder" } | ForEach-Object {
      $target = Join-Path $root.localPath ($_.relPath -replace '/', [System.IO.Path]::DirectorySeparatorChar)
      if (-not (Test-Path -LiteralPath $target -PathType Container)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Write-Host "[nas folder] $($_.relPath)"
      }
    }

    $manifest.entries | Where-Object { $_.type -eq "file" } | ForEach-Object {
      $target = Join-Path $root.localPath ($_.relPath -replace '/', [System.IO.Path]::DirectorySeparatorChar)
      $parent = Split-Path -Parent $target
      if ($parent -and -not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
      }

      $needsDownload = $true
      if (Test-Path -LiteralPath $target -PathType Leaf) {
        $local = Get-Item -LiteralPath $target -Force
        $remoteTime = [DateTimeOffset]::FromUnixTimeMilliseconds([Int64]$_.mtimeMs).UtcDateTime
        $timeDiff = [Math]::Abs(($local.LastWriteTimeUtc - $remoteTime).TotalSeconds)
        $needsDownload = ($local.Length -ne [Int64]$_.size) -or ($timeDiff -gt 2)
      }

      if ($needsDownload) {
        $relEncoded = [System.Uri]::EscapeDataString($_.relPath)
        $tmp = "$target.nasdownload"
        Invoke-WebRequest -Method Get -Uri "$ServerBase/api/devices/agent/file?deviceId=$deviceIdEncoded&syncRootId=$rootIdEncoded&relPath=$relEncoded" -Headers @{ "x-agent-token" = $Script:AgentToken } -OutFile $tmp
        Move-Item -LiteralPath $tmp -Destination $target -Force
        try {
          (Get-Item -LiteralPath $target -Force).LastWriteTimeUtc = [DateTimeOffset]::FromUnixTimeMilliseconds([Int64]$_.mtimeMs).UtcDateTime
        } catch {}
        Write-Host "[nas file] $($_.relPath)"
      }
    }

    if ($state -and $state.remotePaths) {
      $deletedPaths = @($previousPaths.Keys | Where-Object { -not $remotePaths.ContainsKey($_) } | Sort-Object { $_.Length } -Descending)
      foreach ($rel in $deletedPaths) {
        $target = Join-Path $root.localPath ($rel -replace '/', [System.IO.Path]::DirectorySeparatorChar)
        Move-ToLocalTrash $root $target
      }
    }

    Save-RootState $root @($remotePaths.Keys)
  } catch {
    Write-Host "[nas pull failed] $($_.Exception.Message)"
  } finally {
    $Script:ApplyingRemoteChange = $false
  }
}

function Handle-PathEvent($root, $changeType, $fullPath, $oldFullPath) {
  if ($Script:ApplyingRemoteChange) { return }
  Start-Sleep -Milliseconds 500
  try {
    if ($changeType -eq "Deleted") {
      Sync-Delete $root $fullPath
      return
    }
    if ($changeType -eq "Renamed" -and $oldFullPath) {
      Sync-Delete $root $oldFullPath
    }
    if (Test-Path -LiteralPath $fullPath -PathType Container) {
      Sync-Folder $root $fullPath
      return
    }
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
      Sync-File $root $fullPath
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

$StoredConfig = Load-AgentConfig
$DeviceKey = Get-OrCreateDeviceKey
$Lookup = Get-DeviceLookup $DeviceKey
Register-UrlProtocol

if (-not $Background -and $Lookup -and $Lookup.exists -and -not $Lookup.canAddFolder) {
  Write-Host ""
  Write-Host "This PC is already linked to NAS as '$($Lookup.device.deviceName)'."
  Write-Host "To add another folder, open that linked PC folder in NAS and use Add sync folder."
  if ($StoredConfig) { Start-BackgroundAgent }
  exit 0
}

if (-not $Background) {
  $SelectedFolder = Select-SyncFolder
  $DefaultDeviceName = Get-SafeDeviceName $env:COMPUTERNAME
  if ($Lookup -and $Lookup.exists -and $Lookup.device.deviceName) {
    $DeviceName = $Lookup.device.deviceName
  } else {
    $DeviceName = Get-DeviceDisplayName $DefaultDeviceName
  }

  $Summary = Get-FolderSummary $SelectedFolder
  $TotalText = Format-Bytes $Summary.totalBytes
  $LimitText = Format-Bytes $MaxTotalBytes

  if ($Summary.totalBytes -gt $MaxTotalBytes) {
    Write-Host ""
    Write-Host "The selected folder is too large."
    Write-Host "Selected folder: $SelectedFolder"
    Write-Host "Current size: $TotalText"
    Write-Host "Allowed size: $LimitText"
    throw "Folder size exceeds the sync limit."
  }

  Write-Host "Server: $ServerBase"
  Write-Host "Device folder name: $DeviceName"
  Write-Host "Device key: $DeviceKey"
  Write-Host "Folder: $SelectedFolder"
  Write-Host "Files: $($Summary.fileCount)"
  Write-Host "Folders: $($Summary.folderCount)"
  Write-Host "Size: $TotalText / $LimitText"
  Write-Host ""

  $RegisterBody = @{
    pairingToken = $PairingToken
    clientDeviceKey = $DeviceKey
    deviceName = $DeviceName
    osType = "windows"
    desktopPath = $SelectedFolder
    syncRootPath = $SelectedFolder
    syncRootSizeBytes = $Summary.totalBytes
    syncRootFileCount = $Summary.fileCount
    syncRootFolderCount = $Summary.folderCount
  } | ConvertTo-Json -Compress

  try {
    $Register = Invoke-RestMethod -Method Post -Uri "$ServerBase/api/devices/agent/register" -ContentType "application/json" -Body $RegisterBody
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    if ($status -eq 409) {
      Write-Host "This PC is already linked. Use the linked PC folder in NAS to add another sync folder."
      if ($StoredConfig) { Start-BackgroundAgent }
      exit 0
    }
    throw
  }
  if (-not $Register.agentToken -or -not $Register.device.deviceId -or -not $Register.syncRoot.syncRootId) { throw "Registration response was invalid." }

  $Script:DeviceId = $Register.device.deviceId
  $Script:AgentToken = $Register.agentToken
  $NewRoot = [PSCustomObject]@{
    syncRootId = $Register.syncRoot.syncRootId
    name = $Register.syncRoot.name
    localPath = $SelectedFolder
    linkedNasPath = $Register.syncRoot.linkedNasPath
  }
  $Roots = Add-OrUpdateConfigRoot $StoredConfig $NewRoot

  Save-AgentConfig @{
    serverBase = $ServerBase
    deviceId = $Script:DeviceId
    agentToken = $Script:AgentToken
    deviceName = $DeviceName
    syncRoots = $Roots
    savedAt = (Get-Date).ToUniversalTime().ToString("o")
  }

  Write-Host "Connected."
  Write-Host "NAS folder: $($Register.syncRoot.linkedNasPath)"

  Initial-Sync $NewRoot
  Start-BackgroundAgent
  Write-Host ""
  Write-Host "NAS Sync Agent is now running in the background."
  Write-Host "Startup sync is enabled for this Windows account."
  exit 0
}

if (-not $StoredConfig -or -not $StoredConfig.deviceId -or -not $StoredConfig.agentToken) {
  Write-Host "NAS Sync Agent is not configured yet."
  exit 1
}

$Script:DeviceId = $StoredConfig.deviceId
$Script:AgentToken = $StoredConfig.agentToken
$Roots = @(Get-ConfigRoots $StoredConfig | Where-Object { $_.localPath -and (Test-Path -LiteralPath $_.localPath -PathType Container) })

if ($Roots.Count -eq 0) {
  Write-Host "No valid sync folders are configured."
  exit 1
}

$watchers = @()
$handlers = @()
foreach ($root in $Roots) {
  Pull-NasChanges $root
  $watcher = New-Object System.IO.FileSystemWatcher
  $watcher.Path = $root.localPath
  $watcher.IncludeSubdirectories = $true
  $watcher.EnableRaisingEvents = $true
  $watcher.NotifyFilter = [System.IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size'
  $watchers += $watcher
  $rootForHandler = $root
  $handlers += Register-ObjectEvent $watcher Created -MessageData $rootForHandler -Action { Handle-PathEvent $Event.MessageData "Created" $Event.SourceEventArgs.FullPath $null }
  $handlers += Register-ObjectEvent $watcher Changed -MessageData $rootForHandler -Action { Handle-PathEvent $Event.MessageData "Changed" $Event.SourceEventArgs.FullPath $null }
  $handlers += Register-ObjectEvent $watcher Deleted -MessageData $rootForHandler -Action { Handle-PathEvent $Event.MessageData "Deleted" $Event.SourceEventArgs.FullPath $null }
  $handlers += Register-ObjectEvent $watcher Renamed -MessageData $rootForHandler -Action { Handle-PathEvent $Event.MessageData "Renamed" $Event.SourceEventArgs.FullPath $Event.SourceEventArgs.OldFullPath }
}

Write-Host ""
Write-Host "Realtime sync is running for $($Roots.Count) folder(s)."
Write-Host "Press Ctrl+C or close this window to stop."
Write-Host ""

try {
  $lastPull = (Get-Date).AddSeconds(-1 * $PullIntervalSeconds)
  while ($true) {
    Wait-Event -Timeout 2 | Out-Null
    if (((Get-Date) - $lastPull).TotalSeconds -ge $PullIntervalSeconds) {
      foreach ($root in $Roots) { Pull-NasChanges $root }
      $lastPull = Get-Date
    }
  }
} finally {
  foreach ($handler in $handlers) {
    if ($handler) { Unregister-Event -SubscriptionId $handler.Id -ErrorAction SilentlyContinue }
  }
  foreach ($watcher in $watchers) {
    if ($watcher) { $watcher.Dispose() }
  }
}
`;
};

const buildWindowsCmdAgentLauncher = (token) => {
  const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '');
  const script = buildWindowsPowerShellAgent(safeToken);
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  const chunks = encoded.match(/.{1,76}/g) || [];

  return `@echo off
setlocal
set "AGENT_DIR=%LOCALAPPDATA%\\NAS-Sync-Agent"
set "B64_FILE=%AGENT_DIR%\\NAS-Sync-Agent_${safeToken}.b64"
set "PS1_FILE=%AGENT_DIR%\\NAS-Sync-Agent_${safeToken}.ps1"

if not exist "%AGENT_DIR%" mkdir "%AGENT_DIR%"

> "%B64_FILE%" (
${chunks.map(chunk => `  echo ${chunk}`).join('\r\n')}
)

certutil -f -decode "%B64_FILE%" "%PS1_FILE%" >nul
if errorlevel 1 (
  echo Failed to prepare NAS Sync Agent.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1_FILE%"
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo NAS Sync Agent stopped with error code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
`;
};

// Windows Agent download. If a compiled exe is available, serve it; otherwise
// generate a double-clickable cmd launcher for the PowerShell agent.
router.get('/devices/agent/windows', verifyToken, (req, res) => {
  try {
    const token = String(req.query.token || '');

    if (!token || !token.startsWith('pair_')) {
      return res.status(400).send('pairing token missing');
    }

    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE);
    const pairingIndex = findPairingIndexByToken(pairings, token);
    const pairing = pairingIndex >= 0 ? pairings[pairingIndex] : null;
    if (!pairing || pairing.ownerKey !== getDeviceOwnerKey(req.user)) {
      return res.status(404).send('pairing session not found');
    }
    if (pairing.consumedAt || pairing.status !== 'pending' || new Date(pairing.expiresAt).getTime() <= Date.now()) {
      return res.status(410).send('pairing session expired or already used');
    }

    const installerPath = path.join(__dirname, 'agents', 'dist', 'NAS-Drive-Setup.exe');
    const exePath = path.join(__dirname, 'agents', 'dist', 'NAS-Sync-Agent.exe');
    const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '');

    if (fs.existsSync(installerPath)) {
      return res.download(installerPath, `NAS-Drive-Setup_${safeToken}.exe`);
    }

    if (fs.existsSync(exePath)) {
      const downloadName = `NAS-Sync-Agent_${safeToken}.exe`;
      return res.download(exePath, downloadName);
    }

    const script = buildWindowsCmdAgentLauncher(safeToken);
    const downloadName = `NAS-Sync-Agent_${safeToken}.cmd`;

    res.setHeader('Content-Type', 'application/x-msdownload; charset=utf-8');
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
    const pairingIndex = findPairingIndexByToken(pairings, token);
    const pairing = pairingIndex >= 0 ? pairings[pairingIndex] : null;

    if (!pairing || pairing.ownerKey !== ownerKey) return res.status(404).json({ error: '연동 세션을 찾을 수 없습니다.' });

    const expired = pairing.status !== 'connected' && new Date(pairing.expiresAt).getTime() <= Date.now();

    const registeredDeviceId = pairing.device?.deviceId || '';
    const liveDevice = registeredDeviceId
      ? readJsonArrayFile(LINKED_DEVICES_FILE).find(device => device.deviceId === registeredDeviceId && device.ownerKey === ownerKey)
      : null;

    return res.json({
      success: true,
      status: expired ? 'expired' : pairing.status,
      // Pairing completion means the relationship and token were created. The
      // current linked-device record is the source of truth for whether the
      // background Agent has actually confirmed the connection afterwards.
      device: liveDevice ? sanitizeDeviceForResponse(liveDevice) : (pairing.device ? sanitizeDeviceForResponse(pairing.device) : null),
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
    pairings[idx].device = sanitizeDeviceForResponse(device);
    pairings[idx].connectedAt = new Date().toISOString();

    writeJsonArrayFile(DEVICE_PAIRINGS_FILE, pairings);

    return res.json({
      success: true,
      status: 'connected',
      message: '연동 감지!',
      device: sanitizeDeviceForResponse(device)
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '연동 감지 처리 실패' });
  }
});



// Agent가 pairingToken + PC 고유키로 기존 등록 장치인지 확인
router.post('/devices/agent/lookup', express.json(), (req, res) => {
  try {
    ensureDeviceDataFiles();

    const token = String(req.body?.pairingToken || '');
    const clientDeviceKey = String(req.body?.clientDeviceKey || '').trim();
    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE);
    const pairingIndex = findPairingIndexByToken(pairings, token);
    const pairing = pairingIndex >= 0 ? pairings[pairingIndex] : null;

    if (!pairing) return res.status(404).json({ error: '연동 세션을 찾을 수 없습니다.' });
    if (pairing.consumedAt || pairing.status === 'connected') {
      return res.status(409).json({ code: 'PAIRING_ALREADY_USED', error: '이미 사용된 연동 세션입니다.' });
    }
    if (new Date(pairing.expiresAt).getTime() <= Date.now()) {
      return res.status(410).json({ error: '연동 세션이 만료되었습니다.' });
    }

    if (!clientDeviceKey) {
      return res.json({ success: true, exists: false, device: null });
    }

    const rawDevice = readJsonArrayFile(LINKED_DEVICES_FILE).find(d =>
      d.ownerKey === pairing.ownerKey &&
      d.clientDeviceKey === clientDeviceKey
    );
    const device = getActiveLinkedDevice(rawDevice);
    const accountMember = findMemberByAnyId(pairing.ownerKey) || {};
    const canAddFolder = !!(
      device &&
      pairing.mode === 'add-folder' &&
      pairing.targetDeviceId &&
      pairing.targetDeviceId === device.deviceId
    );

    if (pairing.status === 'pending') {
      pairings[pairingIndex] = {
        ...pairing,
        status: 'agent-detected',
        detectedAt: new Date().toISOString()
      };
      writeJsonArrayFile(DEVICE_PAIRINGS_FILE, pairings);
    }

    return res.json({
      success: true,
      exists: !!device && getLiveSyncRoots(device).length > 0,
      mode: pairing.mode || 'install-device',
      account: {
        ownerKey: pairing.ownerKey,
        userUid: accountMember.userUid || '',
        loginId: getUserLoginId(accountMember),
        displayName: accountMember.displayName || getUserLoginId(accountMember)
      },
      canAddFolder,
      device: device ? {
        deviceId: device.deviceId,
        deviceName: device.deviceName || device.name || '',
        name: device.name || device.deviceName || '',
        linkedNasPath: device.linkedNasPath || '',
        syncRoots: getLiveSyncRoots(device).map(root => ({
          syncRootId: root.syncRootId,
          name: root.name,
          kind: root.kind || 'folder-sync',
          localPath: root.localPath || '',
          linkedNasPath: root.linkedNasPath || ''
        }))
      } : null
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 장치 조회 실패' });
  }
});

 

// Installed Agent login. The password is checked once over HTTPS and is never
// returned or persisted. A short-lived pairing token keeps device registration,
// account-root selection and quota enforcement on the existing pairing path.
router.post('/devices/agent/login-register', express.json({ limit: '16kb' }), (req, res) => {
  try {
    ensureDeviceDataFiles();
    const loginId = String(req.body?.id || req.body?.loginId || '').trim();
    const password = String(req.body?.password || '');
    if (!loginId || loginId.length > 128 || !password || password.length > 1024) {
      return res.status(400).json({ error: '아이디와 비밀번호를 확인해 주세요.' });
    }

    const attemptKey = getAgentLoginAttemptKey(req, loginId);
    const activeAttempt = getActiveAgentLoginAttempt(attemptKey);
    if (activeAttempt?.count >= AGENT_LOGIN_MAX_FAILURES) {
      return res.status(429).json({ error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.' });
    }

    const user = findMemberByAnyId(loginId);
    if (!user || !verifyPassword(password, user.password)) {
      recordAgentLoginFailure(attemptKey);
      return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    if (user.disabled) return res.status(403).json({ error: '비활성화된 계정입니다.' });
    agentLoginAttempts.delete(attemptKey);

    const ownerKey = getDeviceOwnerKey(user);
    const targetPath = '/';
    getValidatedDeviceUserPath(user, targetPath);
    const token = createPairingToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE).filter(pairing => (
      !pairing.expiresAt || new Date(pairing.expiresAt).getTime() > Date.now()
    ));
    pairings.push({
      tokenHash: hashPairingToken(token),
      tokenHint: token.slice(-8),
      ownerKey,
      targetPath,
      targetDeviceId: null,
      mode: 'personal-drive',
      clientIntent: 'desktop-app-login',
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt,
      device: null
    });
    writeJsonArrayFile(DEVICE_PAIRINGS_FILE, pairings);

    return res.json({
      success: true,
      pairingToken: token,
      expiresAt,
      account: {
        ownerKey,
        userUid: user.userUid || '',
        loginId: getUserLoginId(user),
        displayName: user.displayName || user.nickname || getUserLoginId(user)
      }
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'NAS Drive 로그인 준비 실패' });
  }
});

// Explicit desktop logout revokes the device token before local credentials
// are removed. This prevents a copied stale token from remaining usable.
router.post('/devices/agent/logout', express.json({ limit: '8kb' }), (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || '').trim();
    const agentToken = String(req.headers['x-agent-token'] || '').trim();
    const device = getAgentDeviceByToken(deviceId, agentToken);
    if (!device) return res.status(403).json({ error: 'Agent 인증 실패' });

    const revokedAt = new Date().toISOString();
    const revoked = advanceDeviceState(device, {
      status: 'revoked',
      revokedAt,
      agentTokenHash: null,
      syncState: 'signed-out',
      lastError: ''
    }, revokedAt);
    updateLinkedDeviceRecord(revoked);
    try { writeLinkedDeviceMeta(revoked); } catch {}
    emitDeviceStatus(req, revoked);
    return res.json({ success: true, revokedAt });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'NAS Drive 로그아웃 실패' });
  }
});

// Agent가 pairingToken으로 실제 PC 등록
router.post('/devices/agent/register', (req, res) => {
  try {
    ensureDeviceDataFiles();

    const token = String(req.body?.pairingToken || '');
    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE);
    const idx = findPairingIndexByToken(pairings, token);

    if (idx === -1) return res.status(404).json({ error: '연동 세션을 찾을 수 없습니다.' });
    if (pairings[idx].consumedAt || pairings[idx].status === 'connected') {
      return res.status(409).json({ code: 'PAIRING_ALREADY_USED', error: '이미 사용된 연동 세션입니다.' });
    }
    if (new Date(pairings[idx].expiresAt).getTime() <= Date.now()) {
      return res.status(410).json({ error: '연동 세션이 만료되었습니다.' });
    }

    const pairing = pairings[idx];
    const userSnapshot = findMemberByAnyId(pairing.ownerKey);
    if (!userSnapshot || userSnapshot.disabled) {
      return res.status(403).json({ error: '연동을 승인한 계정이 없거나 비활성화되었습니다.' });
    }

    const clientDeviceKey = String(req.body?.clientDeviceKey || '').trim();
    const syncRootPath = String(req.body?.syncRootPath || req.body?.desktopPath || '').trim();
    const rawExistingDevice = clientDeviceKey
      ? readJsonArrayFile(LINKED_DEVICES_FILE).find(d =>
        d.ownerKey === pairing.ownerKey &&
        d.clientDeviceKey === clientDeviceKey
      )
      : null;
    const existingDevice = getActiveLinkedDevice(rawExistingDevice);
    const hasLiveSyncRoots = existingDevice && getLiveSyncRoots(existingDevice).length > 0;

    if (existingDevice && hasLiveSyncRoots && pairing.mode !== 'add-folder' && pairing.mode !== 'personal-drive') {
      return res.status(409).json({
        code: 'DEVICE_ALREADY_REGISTERED',
        error: 'This PC is already linked. Open the linked PC folder in NAS and use Add sync folder.',
        device: {
          deviceId: existingDevice.deviceId,
          deviceName: existingDevice.deviceName || existingDevice.name || '',
          linkedNasPath: existingDevice.linkedNasPath || '',
          syncRoots: getLiveSyncRoots(existingDevice).map(root => ({
            syncRootId: root.syncRootId,
            name: root.name,
            localPath: root.localPath || '',
            linkedNasPath: root.linkedNasPath || ''
          }))
        }
      });
    }

    if (pairing.mode === 'add-folder' && (!existingDevice || existingDevice.deviceId !== pairing.targetDeviceId)) {
      return res.status(403).json({
        code: 'ADD_FOLDER_DEVICE_MISMATCH',
        error: 'This add-folder link belongs to a different registered PC.'
      });
    }

    let device = pairing.device || existingDevice || rawExistingDevice;

    if (!device || !device.absolutePath || !fs.existsSync(device.absolutePath)) {
      device = pairing.mode === 'personal-drive' ? createPersonalDriveDevice(userSnapshot, {
        deviceId: createDeviceId(),
        deviceName: req.body?.deviceName || 'Windows-PC',
        osType: req.body?.osType || 'windows'
      }) : createLinkedDeviceFolder(userSnapshot, '/', {
        deviceId: createDeviceId(),
        deviceName: req.body?.deviceName || '내-PC',
        osType: req.body?.osType || 'unknown'
      });
    }

    const deviceName = device.deviceName || req.body?.deviceName || '내-PC';

    const agentToken = createAgentToken();
    const now = new Date().toISOString();

    device = {
      ...device,
      deviceName,
      name: device.name || deviceName,
      originalDeviceName: device.originalDeviceName || req.body?.deviceName || deviceName,
      osType: req.body?.osType || device.osType || 'unknown',
      desktopPath: req.body?.desktopPath || device.desktopPath || '',
      syncRootPath,
      syncRootSizeBytes: Number(req.body?.syncRootSizeBytes || device.syncRootSizeBytes || 0),
      syncRootFileCount: Number(req.body?.syncRootFileCount || device.syncRootFileCount || 0),
      syncRootFolderCount: Number(req.body?.syncRootFolderCount || device.syncRootFolderCount || 0),
      clientDeviceKey: clientDeviceKey || device.clientDeviceKey || '',
      agentTokenHash: hashAgentToken(agentToken),
      status: 'connected',
      revokedAt: null,
      syncState: 'connecting',
      lastError: '',
      // Registration is not a heartbeat. Keep the connection unconfirmed until
      // the newly issued Agent token is used by /agent/heartbeat.
      lastSeenAt: null
    };

    const rootResult = pairing.mode === 'personal-drive'
      ? ensurePersonalDriveRoot(device, userSnapshot, syncRootPath)
      : addSyncRootToDevice(device, userSnapshot, syncRootPath, {
      sizeBytes: Number(req.body?.syncRootSizeBytes || 0),
      fileCount: Number(req.body?.syncRootFileCount || 0),
      folderCount: Number(req.body?.syncRootFolderCount || 0)
      });
    device = advanceDeviceState(rootResult.device, {
      agentTokenHash: device.agentTokenHash,
      lastSeenAt: null,
      status: 'connected',
      revokedAt: null,
      syncState: 'connecting',
      lastError: ''
    }, now);
    const syncRoot = rootResult.syncRoot;

    // 폴더 안 meta 업데이트
    writeLinkedDeviceMeta(device);

    updateLinkedDeviceRecord(device);

    pairings[idx].status = 'connected';
    pairings[idx].consumedAt = now;
    delete pairings[idx].token;
    pairings[idx].device = sanitizeDeviceForResponse(device);
    pairings[idx].connectedAt = now;
    writeJsonArrayFile(DEVICE_PAIRINGS_FILE, pairings);

    return res.json({
      success: true,
      status: 'connected',
      message: '연동 감지!',
      agentToken,
      device: sanitizeDeviceForResponse(device),
      syncRoot: {
        ...syncRoot,
        absolutePath: undefined
      },
      account: {
        ownerKey: getDeviceOwnerKey(userSnapshot),
        userUid: userSnapshot.userUid || '',
        loginId: getUserLoginId(userSnapshot),
        displayName: userSnapshot.displayName || getUserLoginId(userSnapshot)
      }
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 등록 실패' });
  }
});

const getValidatedAgentTarget = (deviceId, agentToken, relPathValue, syncRootIdValue) => {
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

  const ownerUser = getCurrentDeviceOwner(device);
  const ownerBasePath = getDeviceUserBasePath(ownerUser);
  resolveInside(ownerBasePath, path.relative(ownerBasePath, device.absolutePath));
  assertRealPathInside(ownerBasePath, device.absolutePath);

  const syncRoots = normalizeDeviceSyncRoots(device);
  const syncRootId = String(syncRootIdValue || '').trim();
  const syncRoot = syncRootId
    ? syncRoots.find(root => root.syncRootId === syncRootId)
    : syncRoots[0];

  if (isUnlinkedSyncRoot(device, syncRootId, syncRoot?.absolutePath)) {
    const err = new Error('This sync folder was unlinked from NAS. Add it again from the NAS web app to resume syncing.');
    err.status = 410;
    throw err;
  }

  if (!syncRoot || !syncRoot.absolutePath) {
    const err = new Error('연동 루트를 찾을 수 없습니다.');
    err.status = 400;
    throw err;
  }

  if (syncRoot.kind !== 'personal-drive' && !isSameOrChildPath(device.absolutePath, syncRoot.absolutePath)) {
    const err = new Error('잘못된 연동 루트입니다.');
    err.status = 400;
    throw err;
  }

  const linkedRoot = path.resolve(syncRoot.absolutePath);
  resolveInside(ownerBasePath, path.relative(ownerBasePath, linkedRoot));
  assertRealPathInside(ownerBasePath, linkedRoot);
  const relPath = normalizeAgentRelPath(relPathValue);
  if (SEARCH_SKIP_NAMES.has(relPath.split('/')[0])) {
    const err = new Error('내부 복구 저장소는 동기화할 수 없습니다.');
    err.status = 400;
    throw err;
  }
  const finalPath = path.resolve(linkedRoot, relPath);

  if (!fs.existsSync(linkedRoot) || !fs.statSync(linkedRoot).isDirectory()) {
    const pruned = pruneMissingSyncRoots(device);
    if (pruned.deviceMissing) removeLinkedDeviceRecord(device.deviceId);
    const err = new Error('NAS linked sync folder was removed. Re-link this folder from the NAS web app.');
    err.status = 410;
    throw err;
  }

  if (!finalPath.startsWith(linkedRoot + path.sep) && finalPath !== linkedRoot) {
    const err = new Error('잘못된 파일 경로입니다.');
    err.status = 400;
    throw err;
  }

  assertRealPathInside(linkedRoot, finalPath);

  if (finalPath === linkedRoot) {
    const err = new Error('연동 루트 자체는 변경할 수 없습니다.');
    err.status = 400;
    throw err;
  }

  return { device, ownerUser, linkedRoot, syncRoot, relPath, finalPath };
};

// The native Windows Cloud Files provider is delivered only to an authenticated,
// non-revoked linked device. The web pairing token alone cannot download it.
router.get('/devices/agent/provider/windows', (req, res) => {
  try {
    const deviceId = String(req.query?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    if (!getAgentDeviceByToken(deviceId, agentToken)) {
      return res.status(403).json({ error: 'Agent 인증 실패' });
    }
    const providerPath = path.join(__dirname, 'agents', 'dist', 'NAS-Drive-Provider.exe');
    if (!fs.existsSync(providerPath)) {
      return res.status(503).json({ error: 'Windows NAS Drive 공급자가 준비되지 않았습니다.' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    return res.download(providerPath, 'NAS-Drive-Provider.exe');
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Windows NAS Drive 공급자 다운로드 실패' });
  }
});

// Authenticated, silent Agent updates. Metadata is cheap and the binary is
// downloaded only when the installed semantic version differs.
router.get('/devices/agent/update/windows', (req, res) => {
  try {
    const deviceId = String(req.query?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    if (!getAgentDeviceByToken(deviceId, agentToken)) {
      return res.status(403).json({ error: 'Agent 인증 실패' });
    }
    const build = getWindowsAgentBuild();
    if (!build) return res.status(503).json({ error: 'Windows Agent 업데이트가 준비되지 않았습니다.' });
    res.setHeader('Cache-Control', 'private, no-store');
    if (String(req.query?.download || '') === '1') {
      res.setHeader('X-NAS-Agent-Version', build.version);
      res.setHeader('X-NAS-Agent-SHA256', build.sha256);
      return res.download(build.filePath, 'NAS-Sync-Agent.exe');
    }
    return res.json({
      success: true,
      version: build.version,
      size: build.size,
      sha256: build.sha256,
      downloadUrl: `/api/devices/agent/update/windows?deviceId=${encodeURIComponent(deviceId)}&download=1`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Windows Agent 업데이트 확인 실패' });
  }
});

router.post('/devices/agent/heartbeat', express.json(), (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const device = getAgentDeviceByToken(deviceId, agentToken);
    if (!device) return res.status(403).json({ error: 'Agent 인증 실패' });
    const requestedState = String(req.body?.syncState || 'idle');
    const allowedState = ['idle', 'connecting', 'syncing', 'up-to-date', 'paused', 'offline', 'error'].includes(requestedState) ? requestedState : 'idle';
    const now = new Date().toISOString();
    const updated = advanceDeviceState(device, {
      lastSeenAt: now,
      syncState: device.syncPaused ? 'paused' : allowedState,
      lastError: String(req.body?.lastError || '').slice(0, 500)
    }, now);
    updateLinkedDeviceRecord(updated);
    emitDeviceStatus(req, updated);
    return res.json({ success: true, commands: { paused: !!updated.syncPaused }, device: sanitizeDeviceForResponse(updated) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Agent 상태 갱신 실패' });
  }
});

const touchLinkedDevice = (device, linkedRoot) => {
  const now = new Date().toISOString();
  const updated = { ...device, lastSeenAt: now, status: 'connected' };
  updateLinkedDeviceRecord(updated);

  try {
    writeLinkedDeviceMeta(updated);
  } catch (err) {}

  return updated;
};

// Agent가 PC 폴더 생성/변경 이벤트를 NAS 폴더로 반영
router.post('/devices/agent/sync-folder', express.json(), (req, res) => {
  try {
    const deviceId = String(req.body?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const { device, linkedRoot, relPath, finalPath } = getValidatedAgentTarget(deviceId, agentToken, req.body?.relPath, req.body?.syncRootId);

    if (!fs.existsSync(finalPath)) fs.mkdirSync(finalPath, { recursive: true });
    invalidateUsageCache(finalPath);
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
    const { device, linkedRoot, relPath, finalPath } = getValidatedAgentTarget(deviceId, agentToken, req.body?.relPath, req.body?.syncRootId);

    if (relPath === '.agent_trash' || relPath.startsWith('.agent_trash/')) {
      return res.status(400).json({ error: 'Agent trash 경로는 동기화 삭제할 수 없습니다.' });
    }

    if (!fs.existsSync(finalPath)) {
      touchLinkedDevice(device, linkedRoot);
      return res.json({ success: true, relPath, missing: true });
    }

    assertAgentMutationAllowed(device, 'delete');

    const ownerUser = normalizeQuotaFields(findMemberByAnyId({
      userUid: device.userUid,
      loginId: device.loginId || device.ownerKey,
      id: device.ownerKey
    }) || {});
    const ownerBasePath = getAccessBasePath(ownerUser);
    const deletedVersion = fs.statSync(finalPath).isFile()
      ? captureFileVersion(ownerBasePath, finalPath, {
        source: 'windows-agent',
        actor: device.ownerKey || device.loginId || device.userUid,
        deviceId: device.deviceId,
        reason: 'before-delete'
      })
      : null;

    const trashRoot = path.join(linkedRoot, '.agent_trash', new Date().toISOString().replace(/[:.]/g, '-'));
    const trashPath = path.resolve(trashRoot, relPath);

    if (!trashPath.startsWith(trashRoot + path.sep) && trashPath !== trashRoot) {
      return res.status(400).json({ error: '잘못된 휴지통 경로입니다.' });
    }

    fs.mkdirSync(path.dirname(trashPath), { recursive: true });
    fs.renameSync(finalPath, trashPath);
    invalidateUsageCache(finalPath);
    invalidateUsageCache(trashPath);
    appendActivity(ownerBasePath, {
      type: 'moved-to-agent-trash',
      path: `/${path.relative(ownerBasePath, finalPath).replace(/\\/g, '/')}`,
      versionId: deletedVersion?.versionId || undefined,
      actor: device.ownerKey || device.loginId || device.userUid,
      deviceId: device.deviceId,
      source: 'windows-agent'
    });
    touchLinkedDevice(device, linkedRoot);

    return res.json({ success: true, relPath, trashed: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 삭제 동기화 실패' });
  }
});

const normalizeAgentUploadId = (value) => {
  const uploadId = String(value || '').toLowerCase();
  return /^[a-f0-9]{64}$/.test(uploadId) ? uploadId : '';
};

const getAgentChunkDir = (uploadId) => path.join(AGENT_CHUNK_ROOT, normalizeAgentUploadId(uploadId));
const getAgentChunkMetaPath = (uploadId) => path.join(getAgentChunkDir(uploadId), 'meta.json');
const getAgentChunkPartPath = (uploadId, index) => path.join(getAgentChunkDir(uploadId), `chunk_${index}.part`);

const readAgentChunkMeta = (uploadId) => {
  try {
    return JSON.parse(fs.readFileSync(getAgentChunkMetaPath(uploadId), 'utf8'));
  } catch {
    return null;
  }
};

const writeAgentChunkMeta = (uploadId, meta) => {
  const dir = getAgentChunkDir(uploadId);
  fs.mkdirSync(dir, { recursive: true });
  const target = getAgentChunkMetaPath(uploadId);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...meta, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(temp, target);
};

const removeAgentChunkUpload = (uploadId) => {
  const safeId = normalizeAgentUploadId(uploadId);
  if (!safeId) return;
  fs.rmSync(path.join(AGENT_CHUNK_ROOT, safeId), { recursive: true, force: true });
};

const listAgentReceivedChunks = (uploadId, meta) => {
  const dir = getAgentChunkDir(uploadId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .map(name => {
      const match = name.match(/^chunk_(\d+)\.part$/);
      return match ? Number(match[1]) : -1;
    })
    .filter(index => index >= 0 && index < Number(meta.totalChunks || 0))
    .sort((a, b) => a - b);
};

const cleanupStaleAgentChunks = () => {
  if (!fs.existsSync(AGENT_CHUNK_ROOT)) return;
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(AGENT_CHUNK_ROOT)) {
    if (!/^[a-f0-9]{64}$/.test(name)) continue;
    const dir = path.join(AGENT_CHUNK_ROOT, name);
    try {
      const meta = readAgentChunkMeta(name);
      const updatedAt = Date.parse(meta?.updatedAt || 0) || fs.statSync(dir).mtimeMs;
      if (updatedAt < cutoff) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
};

const getAuthorizedAgentChunk = (deviceId, agentToken, uploadId) => {
  const safeId = normalizeAgentUploadId(uploadId);
  const meta = safeId ? readAgentChunkMeta(safeId) : null;
  if (!meta || meta.deviceId !== deviceId) {
    const err = new Error('분할 업로드 세션을 찾을 수 없습니다.');
    err.status = 404;
    throw err;
  }
  const target = getValidatedAgentTarget(deviceId, agentToken, meta.relPath, meta.syncRootId);
  return { uploadId: safeId, meta, ...target };
};

const commitAgentIncomingFile = async ({ incomingPath, uploadedSize, deviceId, agentToken, syncRootId, relPath, baseMtimeMs, clientMtimeMs, deviceName }) => {
  const { device, linkedRoot, finalPath, relPath: safeRelPath } = getValidatedAgentTarget(deviceId, agentToken, relPath, syncRootId);
  assertAgentMutationAllowed(device, 'write');
  const ownerUser = normalizeQuotaFields(findMemberByAnyId({
    userUid: device.userUid,
    loginId: device.loginId || device.ownerKey,
    id: device.ownerKey
  }) || {});
  const ownerBasePath = getAccessBasePath(ownerUser);
  const currentStat = fs.existsSync(finalPath) && fs.statSync(finalPath).isFile() ? fs.statSync(finalPath) : null;
  const concurrent = !!(currentStat && hasConcurrentFileChange(currentStat.mtimeMs, Number(baseMtimeMs || 0)));
  let destinationPath = finalPath;
  let conflictRelPath = '';
  if (concurrent) {
    const parsed = path.parse(finalPath);
    let attempt = 0;
    do {
      destinationPath = path.join(parsed.dir, buildConflictFileName(parsed.base, deviceName || device.deviceName || device.name || '다른-PC', new Date(), attempt));
      attempt += 1;
    } while (fs.existsSync(destinationPath) && attempt < 100);
    conflictRelPath = path.relative(linkedRoot, destinationPath).replace(/\\/g, '/');
  }
  await assertQuotaAvailable(ownerUser, Number(uploadedSize || 0), destinationPath);
  const previousVersion = !concurrent && currentStat
    ? captureFileVersion(ownerBasePath, finalPath, {
      source: 'windows-agent',
      actor: device.ownerKey || device.loginId || device.userUid,
      deviceId: device.deviceId,
      reason: 'overwrite'
    })
    : null;
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.renameSync(incomingPath, destinationPath);
  const safeClientMtime = Number(clientMtimeMs || 0);
  if (Number.isFinite(safeClientMtime) && safeClientMtime > 0) {
    try { fs.utimesSync(destinationPath, new Date(), new Date(safeClientMtime)); } catch {}
  }
  invalidateUsageCache(destinationPath);
  appendActivity(ownerBasePath, {
    type: concurrent ? 'conflict-copy-created' : (previousVersion ? 'file-updated' : 'file-created'),
    path: `/${path.relative(linkedRoot, destinationPath).replace(/\\/g, '/')}`,
    actor: device.ownerKey || device.loginId || device.userUid,
    deviceId: device.deviceId,
    source: 'windows-agent'
  });
  touchLinkedDevice(device, linkedRoot);
  const finalStat = fs.statSync(destinationPath);
  return {
    success: true,
    relPath: safeRelPath,
    size: finalStat.size,
    mtimeMs: Math.round(finalStat.mtimeMs),
    conflict: concurrent,
    conflictRelPath: conflictRelPath || undefined,
    versionId: previousVersion?.versionId || undefined,
    preservedServerMtimeMs: currentStat ? Math.round(currentStat.mtimeMs) : undefined
  };
};

// 32MB 초과 Agent 파일은 재시작 후에도 이어갈 수 있는 고정 크기 조각으로 전송한다.
router.post('/devices/agent/chunk/init', express.json(), async (req, res) => {
  try {
    cleanupStaleAgentChunks();
    const deviceId = String(req.body?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const syncRootId = String(req.body?.syncRootId || '');
    const fileSize = Number(req.body?.fileSize || 0);
    const chunkSize = Number(req.body?.chunkSize || 0);
    const clientMtimeMs = Number(req.body?.clientMtimeMs || 0);
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0 || fileSize > AGENT_MAX_FILE_BYTES) {
      return res.status(400).json({ error: 'Agent 파일 크기가 허용 범위를 벗어났습니다.' });
    }
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > AGENT_MAX_CHUNK_BYTES) {
      return res.status(400).json({ error: 'Agent 조각 크기가 허용 범위를 벗어났습니다.' });
    }
    const target = getValidatedAgentTarget(deviceId, agentToken, req.body?.relPath, syncRootId);
    const uploadId = crypto.createHash('sha256').update([
      deviceId,
      target.syncRoot.syncRootId,
      target.relPath,
      fileSize,
      Math.round(clientMtimeMs)
    ].join('\n')).digest('hex');
    const totalChunks = Math.ceil(fileSize / chunkSize);
    const existing = readAgentChunkMeta(uploadId);
    const meta = existing && existing.deviceId === deviceId && existing.fileSize === fileSize && existing.chunkSize === chunkSize
      ? existing
      : {
        deviceId,
        syncRootId: target.syncRoot.syncRootId,
        relPath: target.relPath,
        fileSize,
        chunkSize,
        totalChunks,
        baseMtimeMs: Number(req.body?.baseMtimeMs || 0),
        clientMtimeMs: Math.round(clientMtimeMs),
        deviceName: String(req.body?.deviceName || target.device.deviceName || 'Windows-PC').slice(0, 120),
        createdAt: new Date().toISOString()
      };
    if (!existing || existing.fileSize !== fileSize || existing.chunkSize !== chunkSize) removeAgentChunkUpload(uploadId);
    writeAgentChunkMeta(uploadId, meta);
    const ownerUser = normalizeQuotaFields(findMemberByAnyId({
      userUid: target.device.userUid,
      loginId: target.device.loginId || target.device.ownerKey,
      id: target.device.ownerKey
    }) || {});
    await assertQuotaAvailable(ownerUser, fileSize, target.finalPath);
    return res.json({ success: true, uploadId, totalChunks, chunkSize, receivedChunks: listAgentReceivedChunks(uploadId, meta) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 분할 업로드 초기화 실패' });
  }
});

router.post('/devices/agent/chunk', agentChunkUpload.single('chunk'), (req, res) => {
  const incomingPath = req.file?.path;
  try {
    const deviceId = String(req.body?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const { uploadId, meta } = getAuthorizedAgentChunk(deviceId, agentToken, req.body?.uploadId);
    const chunkIndex = Number(req.body?.chunkIndex);
    if (!req.file || !Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= meta.totalChunks) {
      const err = new Error('잘못된 Agent 파일 조각입니다.');
      err.status = 400;
      throw err;
    }
    const expectedSize = chunkIndex === meta.totalChunks - 1
      ? meta.fileSize - (chunkIndex * meta.chunkSize)
      : meta.chunkSize;
    if (req.file.size !== expectedSize) {
      const err = new Error('Agent 파일 조각 크기가 일치하지 않습니다.');
      err.status = 400;
      throw err;
    }
    const expectedHash = String(req.body?.chunkSha256 || '').toLowerCase();
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(incomingPath)).digest('hex');
    if (!/^[a-f0-9]{64}$/.test(expectedHash) || !secureHashEquals(expectedHash, actualHash)) {
      const err = new Error('Agent 파일 조각 무결성 검증에 실패했습니다.');
      err.status = 400;
      throw err;
    }
    const destination = getAgentChunkPartPath(uploadId, chunkIndex);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.renameSync(incomingPath, destination);
    writeAgentChunkMeta(uploadId, meta);
    return res.json({ success: true, uploadId, chunkIndex });
  } catch (err) {
    if (incomingPath) safeRmSync(incomingPath);
    return res.status(err.status || 500).json({ error: err.message || 'Agent 파일 조각 업로드 실패' });
  }
});

router.post('/devices/agent/chunk/complete', express.json(), async (req, res) => {
  let assembledPath = '';
  try {
    const deviceId = String(req.body?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const { uploadId, meta } = getAuthorizedAgentChunk(deviceId, agentToken, req.body?.uploadId);
    const received = listAgentReceivedChunks(uploadId, meta);
    if (received.length !== meta.totalChunks || received.some((value, index) => value !== index)) {
      return res.status(409).json({ error: '아직 도착하지 않은 Agent 파일 조각이 있습니다.', receivedChunks: received });
    }
    assembledPath = path.join(AGENT_INCOMING_ROOT, `${uploadId}.assembling`);
    const handle = await fsp.open(assembledPath, 'w');
    try {
      for (let index = 0; index < meta.totalChunks; index += 1) {
        const part = getAgentChunkPartPath(uploadId, index);
        const stat = fs.statSync(part);
        const expectedSize = index === meta.totalChunks - 1 ? meta.fileSize - (index * meta.chunkSize) : meta.chunkSize;
        if (stat.size !== expectedSize) throw Object.assign(new Error('Agent 파일 조각 크기가 변경되었습니다.'), { status: 409 });
        const buffer = await fsp.readFile(part);
        await handle.write(buffer, 0, buffer.length, index * meta.chunkSize);
      }
    } finally {
      await handle.close();
    }
    if (fs.statSync(assembledPath).size !== meta.fileSize) {
      throw Object.assign(new Error('조립된 Agent 파일 크기가 일치하지 않습니다.'), { status: 409 });
    }
    const result = await commitAgentIncomingFile({
      incomingPath: assembledPath,
      uploadedSize: meta.fileSize,
      deviceId,
      agentToken,
      syncRootId: meta.syncRootId,
      relPath: meta.relPath,
      baseMtimeMs: meta.baseMtimeMs,
      clientMtimeMs: meta.clientMtimeMs,
      deviceName: meta.deviceName
    });
    assembledPath = '';
    removeAgentChunkUpload(uploadId);
    return res.json(result);
  } catch (err) {
    if (assembledPath) safeRmSync(assembledPath);
    return res.status(err.status || 500).json({ error: err.message || 'Agent 분할 업로드 완료 실패' });
  }
});

// Agent가 PC 파일 생성/변경 이벤트를 NAS 폴더로 반영
router.post('/devices/agent/sync-file', agentUpload.single('file'), async (req, res) => {
  const incomingPath = req.file?.path;

  try {
    const deviceId = String(req.body?.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');

    if (!req.file || !incomingPath || !fs.existsSync(incomingPath)) {
      return res.status(400).json({ error: '업로드 파일이 없습니다.' });
    }

    const result = await commitAgentIncomingFile({
      incomingPath,
      uploadedSize: req.file.size,
      deviceId,
      agentToken,
      syncRootId: req.body?.syncRootId,
      relPath: req.body?.relPath || req.file.originalname,
      baseMtimeMs: req.body?.baseMtimeMs,
      clientMtimeMs: req.body?.clientMtimeMs,
      deviceName: req.body?.deviceName
    });
    return res.json(result);
  } catch (err) {
    if (incomingPath) safeRmSync(incomingPath);
    return res.status(err.status || 500).json({ error: err.message || 'Agent 파일 동기화 실패' });
  }
});

const listAgentManifestEntries = (linkedRoot) => {
  const entries = [];
  const walk = (currentPath) => {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const fullPath = path.join(currentPath, entry.name);
      const relPath = path.relative(linkedRoot, fullPath).replace(/\\/g, '/');

      if (!relPath || relPath === LINKED_DEVICE_META) continue;
      if (
        relPath === '.agent_trash' || relPath.startsWith('.agent_trash/') ||
        relPath === VERSION_ROOT_DIR || relPath.startsWith(VERSION_ROOT_DIR + '/') ||
        relPath === USER_TRASH_DIR || relPath.startsWith(USER_TRASH_DIR + '/')
      ) continue;

      const stat = fs.statSync(fullPath);
      if (entry.isDirectory()) {
        entries.push({
          type: 'folder',
          relPath,
          mtimeMs: Math.round(stat.mtimeMs)
        });
        walk(fullPath);
      } else if (entry.isFile()) {
        entries.push({
          type: 'file',
          relPath,
          size: stat.size,
          mtimeMs: Math.round(stat.mtimeMs)
        });
      }
    }
  };

  if (fs.existsSync(linkedRoot)) walk(linkedRoot);
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.relPath.localeCompare(b.relPath);
  });
};

const agentRootMonitors = new Map();
let agentRootRevisionCounter = 0;

const nextAgentRootRevision = () => `${process.pid}-${Date.now()}-${++agentRootRevisionCounter}`;

const ensureAgentRootMonitor = (linkedRoot) => {
  const root = path.resolve(linkedRoot);
  let monitor = agentRootMonitors.get(root);
  if (monitor) return monitor;
  monitor = {
    revision: nextAgentRootRevision(),
    watchers: new Map(),
    refreshTimer: null
  };
  const refresh = () => {
    if (!fs.existsSync(root)) return;
    const directories = new Set();
    const walk = (dir) => {
      directories.add(dir);
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name === '.agent_trash' || entry.name === VERSION_ROOT_DIR || entry.name === USER_TRASH_DIR) continue;
        walk(path.join(dir, entry.name));
      }
    };
    try { walk(root); } catch {}
    for (const [dir, watcher] of monitor.watchers.entries()) {
      if (!directories.has(dir)) {
        try { watcher.close(); } catch {}
        monitor.watchers.delete(dir);
      }
    }
    for (const dir of directories) {
      if (monitor.watchers.has(dir)) continue;
      try {
        const watcher = fs.watch(dir, { persistent: false }, () => {
          monitor.revision = nextAgentRootRevision();
          clearTimeout(monitor.refreshTimer);
          monitor.refreshTimer = setTimeout(refresh, 250);
        });
        watcher.on('error', () => {
          try { watcher.close(); } catch {}
          monitor.watchers.delete(dir);
        });
        monitor.watchers.set(dir, watcher);
      } catch {}
    }
  };
  monitor.refresh = refresh;
  agentRootMonitors.set(root, monitor);
  refresh();
  return monitor;
};

const getValidatedAgentRoot = (deviceId, agentToken, syncRootId) => {
  const device = getAgentDeviceByToken(deviceId, agentToken);
  if (!device) throw Object.assign(new Error('Agent 인증 실패'), { status: 403 });
  const syncRoot = normalizeDeviceSyncRoots(device).find(root => root.syncRootId === syncRootId) || normalizeDeviceSyncRoots(device)[0];
  if (!syncRoot?.absolutePath || !fs.existsSync(syncRoot.absolutePath)) {
    throw Object.assign(new Error('연동 루트를 찾을 수 없습니다.'), { status: 404 });
  }
  const linkedRoot = path.resolve(syncRoot.absolutePath);
  const ownerUser = getCurrentDeviceOwner(device);
  const ownerBasePath = getDeviceUserBasePath(ownerUser);
  resolveInside(ownerBasePath, path.relative(ownerBasePath, linkedRoot));
  assertRealPathInside(ownerBasePath, linkedRoot);
  return { device, syncRoot, linkedRoot };
};

// Agent는 3초마다 전체 파일 목록을 다시 받지 않고, 가벼운 변경 revision만 확인한다.
router.get('/devices/agent/changes', (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '');
    const syncRootId = String(req.query.syncRootId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const { device, linkedRoot } = getValidatedAgentRoot(deviceId, agentToken, syncRootId);
    const monitor = ensureAgentRootMonitor(linkedRoot);
    touchLinkedDevice(device, linkedRoot);
    return res.json({
      success: true,
      changed: String(req.query.revision || '') !== monitor.revision,
      revision: monitor.revision
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 변경 상태 조회 실패' });
  }
});

// Agent가 NAS 폴더의 현재 상태를 가져와 PC에 없는/변경된 항목을 pull 한다.
router.get('/devices/agent/manifest', (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '');
    const syncRootId = String(req.query.syncRootId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const { device, syncRoot, linkedRoot } = getValidatedAgentRoot(deviceId, agentToken, syncRootId);
    const monitor = ensureAgentRootMonitor(linkedRoot);
    touchLinkedDevice(device, linkedRoot);

    return res.json({
      success: true,
      deviceId,
      syncRootId: syncRoot.syncRootId,
      generatedAt: new Date().toISOString(),
      revision: monitor.revision,
      entries: listAgentManifestEntries(linkedRoot)
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent manifest 조회 실패' });
  }
});

// Agent가 NAS 파일을 PC로 내려받는다.
router.get('/devices/agent/file', (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const { device, linkedRoot, relPath, finalPath } = getValidatedAgentTarget(deviceId, agentToken, req.query.relPath, req.query.syncRootId);

    if (!fs.existsSync(finalPath) || !fs.statSync(finalPath).isFile()) {
      return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
    }

    touchLinkedDevice(device, linkedRoot);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(relPath))}"`);
    return res.sendFile(finalPath);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 파일 다운로드 실패' });
  }
});

if (process.env.NODE_ENV === 'test') {
  router.__testHooks = {
    moveToUserTrash,
    readUserTrashItem,
    restoreUserTrashItem,
    cleanupExpiredUserTrash,
    getUserTrashRoot
  };
}

module.exports = router;
