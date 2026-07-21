const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const archiver = require('archiver');
const { exec } = require('child_process');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const config = require('./config/env');
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
const canceledSessions = new Set();
// =========================================================
// PC 바탕화면 연동 / Device Pairing 기초 구조
// =========================================================
const LINKED_DEVICE_META = '.msp-linked-device.json';
const DEVICE_DATA_DIR = path.join(__dirname, 'data');
const MEMBERS_FILE = path.join(DEVICE_DATA_DIR, 'members.json');
const DEVICE_PAIRINGS_FILE = path.join(DEVICE_DATA_DIR, 'device_pairings.json');
const LINKED_DEVICES_FILE = path.join(DEVICE_DATA_DIR, 'linked_devices.json');
const UNLINKED_SYNC_ROOTS_FILE = path.join(DEVICE_DATA_DIR, 'unlinked_sync_roots.json');
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

const removeLinkedDeviceRecord = (deviceId) => {
  if (!deviceId) return;
  const devices = readJsonArrayFile(LINKED_DEVICES_FILE).filter(d => d.deviceId !== deviceId);
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
  for (const f of [DEVICE_PAIRINGS_FILE, LINKED_DEVICES_FILE, UNLINKED_SYNC_ROOTS_FILE]) {
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

const getUserLoginId = (user = {}) => getLoginId(user);

const normalizeAgentUser = (user = {}) => {
  const loginId = getUserLoginId(user);
  return {
    ...user,
    id: loginId,
    loginId,
    username: user.username || loginId,
    userUid: user.userUid || `usr_${crypto.createHash('sha256').update(loginId).digest('hex').slice(0, 32)}`,
    displayName: user.displayName || user.nickname || user.username || loginId,
    rootPath: user.rootPath || path.join('users', loginId)
  };
};

const readApprovedUsersForAgent = () => {
  try {
    const rows = JSON.parse(fs.readFileSync(MEMBERS_FILE, 'utf8'));
    return Array.isArray(rows) ? rows.map(normalizeAgentUser) : [];
  } catch (err) {
    return [];
  }
};

const findAgentLoginUser = (loginId, password) => {
  const safeLoginId = String(loginId || '').trim();
  return readApprovedUsersForAgent().find(user => (
    getUserLoginId(user) === safeLoginId &&
    String(user.password || '') === String(password || '') &&
    !user.disabled
  ));
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
  if (!device) return null;
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
  const basePath = getUserBasePath(user);
  const deviceRoot = path.resolve(device.absolutePath);
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
  if (req.query.oosecret === 'nas_office_2026') {
    const isActuallyAdmin = req.query.officeAdmin === 'true';
    const officeLoginId = req.query.officeUid || 'office';
    req.user = normalizeQuotaFields({
      id: officeLoginId,
      loginId: officeLoginId,
      userUid: officeLoginId,
      Masters: isActuallyAdmin,
      globalAccess: isActuallyAdmin,
      rootPath: isActuallyAdmin ? '' : decodeURIComponent(req.query.officeRoot || '')
    });
    return next();
  }
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
    const currentLinkedMeta = readLinkedDeviceMeta(targetPath);
    if (currentLinkedMeta) migrateLegacyDeviceContentsToSyncRoot(currentLinkedMeta);
    const ownerKey = getDeviceOwnerKey(req.user);
    const items = fs.readdirSync(targetPath).map(item => {
      if (item === LINKED_DEVICE_META) return null;

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
        invalidateUsageCache(req.file.path);
        const summary = await getUserStorageSummary(req.user);
        if (summary.quotaMode === 'limited' && summary.usedBytes > summary.quotaBytes) {
          safeRmSync(req.file.path);
          invalidateUsageCache(req.file.path);
          return res.status(413).json({ error: `저장공간이 부족합니다. 기본 할당량은 ${Math.round(summary.quotaBytes / 1024 / 1024 / 1024)}GB입니다.` });
        }
        return res.json({ success: true });
      } catch (e) {
        safeRmSync(req.file.path);
        return res.status(e.status || 500).json({ error: e.message || '저장공간 제한을 확인하지 못했습니다.' });
      }
    })();
    return;
  }
  try {
    const { targetPath } = getValidatedPath(req.user, path.join(req.body.path || '', req.body.folderName), req.headers['x-nas-password']);
    if (!fs.existsSync(targetPath)) fs.mkdirSync(targetPath, { recursive: true });
    invalidateUsageCache(targetPath);
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

    cleanupLinkedDeviceDeletion(targetPath);

    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      invalidateUsageCache(targetPath);
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
router.post('/file/copy', verifyToken, async (req, res) => {
  try {
    const { sourcePaths, destinationFolder } = req.body;
    if (!sourcePaths || !Array.isArray(sourcePaths)) return res.status(400).json({ error: '잘못된 요청' });

    let destReqPath = destinationFolder;
    if (!destReqPath || destReqPath === 'undefined') destReqPath = '/';
    const { targetPath: destDir } = getValidatedPath(req.user, destReqPath);

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
      invalidateUsageCache(fullOldPath);
      invalidateUsageCache(fullNewPath);
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
      const https = require('https');
      const fs = require('fs');
      const path = require('path');
      
      const officeUser = normalizeQuotaFields(findMemberByAnyId({ loginId: uid, id: uid, username: uid }) || {
        id: uid || 'office',
        loginId: uid || 'office',
        username: uid || 'office',
        role: isAdmin ? 'MASTER' : 'USER',
        Masters: isAdmin,
        globalAccess: isAdmin
      });
      const basePath = getAccessBasePath(officeUser);
      const absoluteFilePath = resolveInside(basePath, relPath || '');
      const parentDir = path.dirname(absoluteFilePath);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

      console.log('[onlyoffice callback]', {
        status,
        relPath,
        uid,
        isAdmin,
        target: absoluteFilePath,
        downloadUrl: url
      });

      const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 120000,
        maxRedirects: 5,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      });
      const contentLength = Number(response.headers['content-length'] || 0);
      if (contentLength > 0) await assertQuotaAvailable(officeUser, contentLength, absoluteFilePath);
      const writer = fs.createWriteStream(absoluteFilePath);
      response.data.pipe(writer);
      
      writer.on('finish', () => {
        invalidateUsageCache(absoluteFilePath);
        res.json({ error: 0 });
      });
      writer.on('error', (err) => {
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

    fs.renameSync(meta.tempPath, meta.finalPath);
    invalidateUsageCache(meta.finalPath);
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
    const { targetPath: pairingTargetAbs } = getValidatedPath(req.user, targetPath, req.headers['x-nas-password']);
    const targetDevice = fs.existsSync(pairingTargetAbs) && fs.statSync(pairingTargetAbs).isDirectory()
      ? findLinkedDeviceByAbsolutePath(ownerKey, pairingTargetAbs)
      : null;
    const pairingMode = targetDevice ? 'add-folder' : 'install-device';

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
      targetDeviceId: targetDevice?.deviceId || null,
      mode: pairingMode,
      userSnapshot: req.user,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt,
      device: null
    };

    pairings.push(pairing);
    writeJsonArrayFile(DEVICE_PAIRINGS_FILE, pairings);

    const agentDownloadName = `NAS-Sync-Agent_${token.replace(/[^a-zA-Z0-9_-]/g, '')}.exe`;

    return res.json({
      success: true,
      pairingToken: token,
      expiresAt,
      status: 'pending',
      agentDownloadUrl: `/api/devices/agent/windows?token=${encodeURIComponent(token)}`,
      agentDownloadName,
      agentKind: fs.existsSync(path.join(__dirname, 'agents', 'dist', 'NAS-Sync-Agent.exe')) ? 'windows-exe' : 'windows-cmd',
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

    const exePath = path.join(__dirname, 'agents', 'dist', 'NAS-Sync-Agent.exe');
    const safeToken = token.replace(/[^a-zA-Z0-9_-]/g, '');

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



// Agent가 pairingToken + PC 고유키로 기존 등록 장치인지 확인
router.post('/devices/agent/lookup', express.json(), (req, res) => {
  try {
    ensureDeviceDataFiles();

    const token = String(req.body?.pairingToken || '');
    const clientDeviceKey = String(req.body?.clientDeviceKey || '').trim();
    const pairings = readJsonArrayFile(DEVICE_PAIRINGS_FILE);
    const pairing = pairings.find(p => p.token === token);

    if (!pairing) return res.status(404).json({ error: '연동 세션을 찾을 수 없습니다.' });
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
    const canAddFolder = !!(
      device &&
      pairing.mode === 'add-folder' &&
      pairing.targetDeviceId &&
      pairing.targetDeviceId === device.deviceId
    );

    return res.json({
      success: true,
      exists: !!device && getLiveSyncRoots(device).length > 0,
      mode: pairing.mode || 'install-device',
      canAddFolder,
      device: device ? {
        deviceId: device.deviceId,
        deviceName: device.deviceName || device.name || '',
        name: device.name || device.deviceName || '',
        linkedNasPath: device.linkedNasPath || '',
        syncRoots: getLiveSyncRoots(device).map(root => ({
          syncRootId: root.syncRootId,
          name: root.name,
          localPath: root.localPath || '',
          linkedNasPath: root.linkedNasPath || ''
        }))
      } : null
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 장치 조회 실패' });
  }
});

 

// Agent standalone login + PC registration.
// Used by the installed Windows app when launched directly without a browser pairing token.
router.post('/devices/agent/login-register', express.json(), (req, res) => {
  try {
    ensureDeviceDataFiles();

    const user = findAgentLoginUser(req.body?.loginId || req.body?.id, req.body?.password);
    if (!user) return res.status(401).json({ error: 'NAS account login failed.' });

    const clientDeviceKey = String(req.body?.clientDeviceKey || '').trim();
    const syncRootPath = String(req.body?.syncRootPath || req.body?.desktopPath || '').trim();
    const requestedDeviceName = String(req.body?.deviceName || '').trim();

    if (!clientDeviceKey) return res.status(400).json({ error: 'PC device key is required.' });
    if (!syncRootPath) return res.status(400).json({ error: 'Sync folder path is required.' });

    const ownerKey = getDeviceOwnerKey(user);
    const rawExistingDevice = readJsonArrayFile(LINKED_DEVICES_FILE).find(d =>
      d.ownerKey === ownerKey &&
      d.clientDeviceKey === clientDeviceKey
    );
    const existingDevice = getActiveLinkedDevice(rawExistingDevice);
    const hasLiveSyncRoots = existingDevice && getLiveSyncRoots(existingDevice).length > 0;

    if (existingDevice && hasLiveSyncRoots) {
      return res.status(409).json({
        code: 'DEVICE_ALREADY_REGISTERED',
        error: 'This PC is already linked to this NAS account.',
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

    let device = existingDevice || rawExistingDevice;
    if (!device || !device.absolutePath || !fs.existsSync(device.absolutePath)) {
      device = createLinkedDeviceFolder(user, '/', {
        deviceId: createDeviceId(),
        deviceName: requestedDeviceName || req.body?.hostName || 'Windows-PC',
        osType: req.body?.osType || 'windows'
      });
    }

    const agentToken = createAgentToken();
    const now = new Date().toISOString();
    const deviceName = device.deviceName || requestedDeviceName || req.body?.hostName || 'Windows-PC';

    device = {
      ...device,
      deviceName,
      name: device.name || deviceName,
      originalDeviceName: device.originalDeviceName || requestedDeviceName || deviceName,
      osType: req.body?.osType || device.osType || 'windows',
      desktopPath: req.body?.desktopPath || device.desktopPath || '',
      syncRootPath,
      syncRootSizeBytes: Number(req.body?.syncRootSizeBytes || device.syncRootSizeBytes || 0),
      syncRootFileCount: Number(req.body?.syncRootFileCount || device.syncRootFileCount || 0),
      syncRootFolderCount: Number(req.body?.syncRootFolderCount || device.syncRootFolderCount || 0),
      clientDeviceKey,
      agentTokenHash: hashAgentToken(agentToken),
      status: 'connected',
      lastSeenAt: now
    };

    const rootResult = addSyncRootToDevice(device, user, syncRootPath, {
      sizeBytes: Number(req.body?.syncRootSizeBytes || 0),
      fileCount: Number(req.body?.syncRootFileCount || 0),
      folderCount: Number(req.body?.syncRootFolderCount || 0)
    });

    device = {
      ...rootResult.device,
      agentTokenHash: device.agentTokenHash,
      lastSeenAt: now,
      status: 'connected'
    };
    const syncRoot = rootResult.syncRoot;

    writeLinkedDeviceMeta(device);
    updateLinkedDeviceRecord(device);

    return res.json({
      success: true,
      status: 'connected',
      message: 'Agent login and registration completed.',
      agentToken,
      device,
      syncRoot
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent login registration failed.' });
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
    const rawExistingDevice = clientDeviceKey
      ? readJsonArrayFile(LINKED_DEVICES_FILE).find(d =>
        d.ownerKey === pairing.ownerKey &&
        d.clientDeviceKey === clientDeviceKey
      )
      : null;
    const existingDevice = getActiveLinkedDevice(rawExistingDevice);
    const hasLiveSyncRoots = existingDevice && getLiveSyncRoots(existingDevice).length > 0;

    if (existingDevice && hasLiveSyncRoots && pairing.mode !== 'add-folder') {
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
      device = createLinkedDeviceFolder(userSnapshot, '/', {
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
      lastSeenAt: now
    };

    const rootResult = addSyncRootToDevice(device, userSnapshot, syncRootPath, {
      sizeBytes: Number(req.body?.syncRootSizeBytes || 0),
      fileCount: Number(req.body?.syncRootFileCount || 0),
      folderCount: Number(req.body?.syncRootFolderCount || 0)
    });
    device = {
      ...rootResult.device,
      agentTokenHash: device.agentTokenHash,
      lastSeenAt: now,
      status: 'connected'
    };
    const syncRoot = rootResult.syncRoot;

    // 폴더 안 meta 업데이트
    writeLinkedDeviceMeta(device);

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
      device,
      syncRoot
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

  if (!isSameOrChildPath(device.absolutePath, syncRoot.absolutePath)) {
    const err = new Error('잘못된 연동 루트입니다.');
    err.status = 400;
    throw err;
  }

  const linkedRoot = path.resolve(syncRoot.absolutePath);
  const relPath = normalizeAgentRelPath(relPathValue);
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

  if (finalPath === linkedRoot) {
    const err = new Error('연동 루트 자체는 변경할 수 없습니다.');
    err.status = 400;
    throw err;
  }

  return { device, linkedRoot, syncRoot, relPath, finalPath };
};

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

    const trashRoot = path.join(linkedRoot, '.agent_trash', new Date().toISOString().replace(/[:.]/g, '-'));
    const trashPath = path.resolve(trashRoot, relPath);

    if (!trashPath.startsWith(trashRoot + path.sep) && trashPath !== trashRoot) {
      return res.status(400).json({ error: '잘못된 휴지통 경로입니다.' });
    }

    fs.mkdirSync(path.dirname(trashPath), { recursive: true });
    fs.renameSync(finalPath, trashPath);
    invalidateUsageCache(finalPath);
    invalidateUsageCache(trashPath);
    touchLinkedDevice(device, linkedRoot);

    return res.json({ success: true, relPath, trashed: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'Agent 삭제 동기화 실패' });
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

    const { device, linkedRoot, relPath, finalPath } = getValidatedAgentTarget(deviceId, agentToken, req.body?.relPath || req.file.originalname, req.body?.syncRootId);
    const ownerUser = normalizeQuotaFields(findMemberByAnyId({
      userUid: device.userUid,
      loginId: device.loginId || device.ownerKey,
      id: device.ownerKey
    }) || {});
    await assertQuotaAvailable(ownerUser, Number(req.file.size || 0), finalPath);

    const parent = path.dirname(finalPath);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });

    fs.renameSync(incomingPath, finalPath);
    invalidateUsageCache(finalPath);
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

const listAgentManifestEntries = (linkedRoot) => {
  const entries = [];
  const walk = (currentPath) => {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const fullPath = path.join(currentPath, entry.name);
      const relPath = path.relative(linkedRoot, fullPath).replace(/\\/g, '/');

      if (!relPath || relPath === LINKED_DEVICE_META) continue;
      if (relPath === '.agent_trash' || relPath.startsWith('.agent_trash/')) continue;

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

// Agent가 NAS 폴더의 현재 상태를 가져와 PC에 없는/변경된 항목을 pull 한다.
router.get('/devices/agent/manifest', (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '');
    const syncRootId = String(req.query.syncRootId || '');
    const agentToken = String(req.headers['x-agent-token'] || '');
    const device = getAgentDeviceByToken(deviceId, agentToken);

    if (!device) return res.status(403).json({ error: 'Agent 인증 실패' });
    if (!device.absolutePath || !fs.existsSync(device.absolutePath)) {
      return res.status(404).json({ error: '연동 폴더를 찾을 수 없습니다.' });
    }

    const syncRoot = normalizeDeviceSyncRoots(device).find(root => root.syncRootId === syncRootId) || normalizeDeviceSyncRoots(device)[0];
    if (!syncRoot || !syncRoot.absolutePath || !fs.existsSync(syncRoot.absolutePath)) {
      return res.status(404).json({ error: '연동 루트를 찾을 수 없습니다.' });
    }

    const linkedRoot = path.resolve(syncRoot.absolutePath);
    touchLinkedDevice(device, linkedRoot);

    return res.json({
      success: true,
      deviceId,
      syncRootId: syncRoot.syncRootId,
      generatedAt: new Date().toISOString(),
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



module.exports = router;
