const fs = require('fs');
const path = require('path');
const config = require('./config/env');

const NAS_ROOT = config.NAS_ROOT;
const DATA_DIR = path.join(__dirname, 'data');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const USAGE_CACHE_FILE = path.join(DATA_DIR, 'storage_usage_cache.json');
const CHAT_ATTACHMENTS_FILE = path.join(DATA_DIR, 'chatAttachments.json');
const CHAT_TMP_ROOT = path.join(NAS_ROOT, 'chat_tmp');
const DEFAULT_USER_QUOTA_BYTES = 50 * 1024 * 1024 * 1024;

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const readJson = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return fallback;
  }
};

const writeJson = (filePath, value) => {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};

const getLoginId = (user = {}) => String(user.loginId || user.id || user.username || '').trim();

const getRole = (user = {}) => user.role || (user.Masters ? 'MASTER' : (user.Managers ? 'MANAGER' : 'USER'));

const isStorageAdmin = (user = {}) => {
  const role = getRole(user);
  return role === 'MASTER' || role === 'MANAGER' || !!user.Masters || !!user.Managers || !!user.globalAccess;
};

const normalizeRelativeRoot = (user = {}) => {
  const loginId = getLoginId(user);
  return String(user.rootPath || path.join('users', loginId || 'default')).replace(/^(\/|\\)+/, '');
};

const isSameOrChild = (parent, child) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
};

const resolveInside = (basePath, requestedPath = '') => {
  const base = path.resolve(basePath);
  const safeReqPath = String(requestedPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const target = path.resolve(base, safeReqPath);
  if (!isSameOrChild(base, target)) {
    const err = new Error('?? ?? ?????.');
    err.status = 403;
    throw err;
  }
  return target;
};

const getAccessBasePath = (user = {}) => {
  return isStorageAdmin(user)
    ? NAS_ROOT
    : path.resolve(NAS_ROOT, normalizeRelativeRoot(user));
};

const getQuotaBasePath = (user = {}) => {
  return isStorageAdmin(user)
    ? NAS_ROOT
    : path.resolve(NAS_ROOT, normalizeRelativeRoot(user));
};

const normalizeQuotaFields = (user = {}) => {
  const role = getRole(user);
  const next = { ...user, role };

  if (next.storageQuotaMode !== 'unlimited' && next.storageQuotaMode !== 'limited') {
    next.storageQuotaMode = role === 'USER' && !next.globalAccess ? 'limited' : 'unlimited';
  }

  const quotaNumber = Number(next.storageQuotaBytes);
  if (next.storageQuotaMode === 'limited') {
    next.storageQuotaBytes = Number.isFinite(quotaNumber) && quotaNumber > 0
      ? Math.floor(quotaNumber)
      : DEFAULT_USER_QUOTA_BYTES;
  } else {
    next.storageQuotaBytes = null;
  }

  return next;
};

const readMembers = () => {
  const rows = readJson(MEMBERS_FILE, []);
  return Array.isArray(rows) ? rows.map(normalizeQuotaFields) : [];
};

const writeMembers = (rows) => writeJson(MEMBERS_FILE, rows.map(normalizeQuotaFields));

const findMemberByAnyId = (value) => {
  const candidates = value && typeof value === 'object'
    ? [value.userUid, value.loginId, value.id, value.username]
    : [value];
  const keys = candidates.filter(Boolean).map(String);
  return readMembers().find((user) =>
    [user.userUid, user.loginId, user.id, user.username]
      .filter(Boolean)
      .map(String)
      .some((candidate) => keys.includes(candidate))
  );
};

const readUsageCache = () => {
  const cache = readJson(USAGE_CACHE_FILE, {});
  return cache && typeof cache === 'object' ? cache : {};
};

const writeUsageCache = (cache) => writeJson(USAGE_CACHE_FILE, cache || {});

const countPathSize = (targetPath, seenInodes = new Set()) => {
  if (!fs.existsSync(targetPath)) return 0;
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) {
    const inodeKey = `${stat.dev}:${stat.ino}`;
    if (seenInodes.has(inodeKey)) return 0;
    seenInodes.add(inodeKey);
    return stat.size;
  }
  if (!stat.isDirectory()) return 0;

  let total = 0;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const fullPath = path.join(targetPath, entry.name);
    try {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) total += countPathSize(fullPath, seenInodes);
      else if (entry.isFile()) {
        const childStat = fs.lstatSync(fullPath);
        const inodeKey = `${childStat.dev}:${childStat.ino}`;
        if (!seenInodes.has(inodeKey)) {
          seenInodes.add(inodeKey);
          total += childStat.size;
        }
      }
    } catch (err) {}
  }
  return total;
};

const getPathMtimeMs = (targetPath) => {
  try {
    return fs.existsSync(targetPath) ? Math.round(fs.statSync(targetPath).mtimeMs) : 0;
  } catch (err) {
    return 0;
  }
};

const getCachedPathUsage = (targetPath) => {
  const resolved = path.resolve(targetPath);
  const mtimeMs = getPathMtimeMs(resolved);
  const cache = readUsageCache();
  const cached = cache[resolved];

  if (cached && cached.mtimeMs === mtimeMs && Number.isFinite(Number(cached.sizeBytes))) {
    return { sizeBytes: Number(cached.sizeBytes), cached: true, calculatedAt: cached.calculatedAt };
  }

  const sizeBytes = countPathSize(resolved);
  cache[resolved] = {
    sizeBytes,
    mtimeMs,
    calculatedAt: new Date().toISOString()
  };
  writeUsageCache(cache);
  return { sizeBytes, cached: false, calculatedAt: cache[resolved].calculatedAt };
};

const getChatAttachmentUsage = (user = {}) => {
  const loginId = getLoginId(user);
  const userUid = String(user.userUid || '').trim();
  const bundles = readJson(CHAT_ATTACHMENTS_FILE, []);
  if (!Array.isArray(bundles)) return 0;

  return bundles.reduce((total, bundle) => {
    const ownerMatches =
      (userUid && String(bundle.ownerUid || '') === userUid) ||
      (loginId && String(bundle.ownerLoginId || '') === loginId) ||
      (loginId && String(bundle.ownerUid || '') === loginId);

    if (!ownerMatches || bundle.status === 'canceled') return total;
    return total + getCachedPathUsage(path.join(CHAT_TMP_ROOT, bundle.bundleId)).sizeBytes;
  }, 0);
};

const invalidateUsageCache = (changedPath) => {
  if (!changedPath) return;
  const target = path.resolve(changedPath);
  const cache = readUsageCache();
  let changed = false;

  for (const key of Object.keys(cache)) {
    if (isSameOrChild(key, target) || isSameOrChild(target, key)) {
      delete cache[key];
      changed = true;
    }
  }

  if (changed) writeUsageCache(cache);
};

const getQuotaInfo = (user = {}) => {
  const normalized = normalizeQuotaFields(user);
  if (isStorageAdmin(normalized) || normalized.storageQuotaMode === 'unlimited') {
    return { mode: 'unlimited', quotaBytes: null };
  }
  return { mode: 'limited', quotaBytes: normalized.storageQuotaBytes || DEFAULT_USER_QUOTA_BYTES };
};

const getUserStorageSummary = (user = {}) => {
  const basePath = getQuotaBasePath(user);
  const usage = getCachedPathUsage(basePath);
  const chatAttachmentBytes = getChatAttachmentUsage(user);
  const quota = getQuotaInfo(user);
  let totalBytes = null;
  let freeBytes = null;

  try {
    const stat = fs.statfsSync(basePath);
    totalBytes = stat.blocks * stat.bsize;
    freeBytes = stat.bavail * stat.bsize;
  } catch (err) {}

  return {
    basePath,
    usedBytes: usage.sizeBytes + chatAttachmentBytes,
    fileBytes: usage.sizeBytes,
    chatAttachmentBytes,
    quotaMode: quota.mode,
    quotaBytes: quota.quotaBytes,
    totalBytes,
    freeBytes,
    cached: usage.cached,
    calculatedAt: usage.calculatedAt
  };
};

const assertQuotaAvailable = (user = {}, incomingBytes = 0, changedPath = '') => {
  const bytes = Number(incomingBytes) || 0;
  const quota = getQuotaInfo(user);
  if (quota.mode === 'unlimited' || bytes <= 0) return;

  const summary = getUserStorageSummary(user);
  if (summary.usedBytes + bytes > quota.quotaBytes) {
    const err = new Error('????? ?????. ????? ?? ??? ?????.');
    err.status = 413;
    err.code = 'STORAGE_QUOTA_EXCEEDED';
    err.storage = {
      usedBytes: summary.usedBytes,
      quotaBytes: quota.quotaBytes,
      incomingBytes: bytes
    };
    throw err;
  }

  if (changedPath) invalidateUsageCache(changedPath);
};

module.exports = {
  NAS_ROOT,
  DEFAULT_USER_QUOTA_BYTES,
  getLoginId,
  getRole,
  isStorageAdmin,
  normalizeQuotaFields,
  readMembers,
  writeMembers,
  findMemberByAnyId,
  getAccessBasePath,
  getQuotaBasePath,
  resolveInside,
  isSameOrChild,
  getCachedPathUsage,
  getUserStorageSummary,
  invalidateUsageCache,
  assertQuotaAvailable,
  _test: { countPathSize }
};
