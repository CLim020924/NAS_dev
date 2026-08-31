const fs = require('fs');
const path = require('path');
const config = require('./config/env');

const NAS_ROOT = config.NAS_ROOT;
const DATA_DIR = path.join(__dirname, 'data');
const MEMBERS_FILE = path.join(DATA_DIR, 'members.json');
const USAGE_CACHE_FILE = path.join(DATA_DIR, 'storage_usage_cache.json');
const CHAT_ATTACHMENTS_FILE = path.join(DATA_DIR, 'chatAttachments.json');
const CHAT_TMP_ROOT = path.join(NAS_ROOT, 'chat_tmp');
const GIB = 1024 * 1024 * 1024;
const DEFAULT_USER_QUOTA_BYTES = 50 * GIB;
const MIN_SYSTEM_RESERVE_BYTES = 10 * GIB;
const SYSTEM_RESERVE_RATIO = 0.05;

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

const normalizePersonalRelativeRoot = (user = {}) => {
  const loginId = getLoginId(user) || 'default';
  const explicitPersonalRoot = String(user.personalRootPath || '').trim();
  const legacyRoot = String(user.rootPath || '').trim();
  const candidate = explicitPersonalRoot
    || (legacyRoot && legacyRoot !== '/' && legacyRoot !== '\\' ? legacyRoot : path.join('users', loginId));
  const relative = candidate.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const resolved = path.resolve(NAS_ROOT, relative || path.join('users', loginId));
  if (!isSameOrChild(NAS_ROOT, resolved)) return path.join('users', loginId);
  return path.relative(NAS_ROOT, resolved).replace(/\\/g, '/') || path.join('users', loginId);
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
    const err = new Error('요청한 경로가 허용된 저장공간을 벗어났습니다.');
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
  return path.resolve(NAS_ROOT, normalizePersonalRelativeRoot(user));
};

const ensurePersonalStorageRoot = (user = {}) => {
  const personalRoot = getQuotaBasePath(user);
  if (!fs.existsSync(personalRoot)) fs.mkdirSync(personalRoot, { recursive: true });
  return personalRoot;
};

const normalizeQuotaFields = (user = {}) => {
  const role = getRole(user);
  const next = { ...user, role };

  // Every account, including managers and masters, owns a finite personal space.
  // Elevated roles keep NAS-root access separately through getAccessBasePath().
  next.storageQuotaMode = 'limited';
  next.personalRootPath = `/${normalizePersonalRelativeRoot(next)}`;

  const quotaNumber = Number(next.storageQuotaBytes);
  next.storageQuotaBytes = Number.isFinite(quotaNumber) && quotaNumber > 0
    ? Math.floor(quotaNumber)
    : DEFAULT_USER_QUOTA_BYTES;

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
  return { mode: 'limited', quotaBytes: normalized.storageQuotaBytes || DEFAULT_USER_QUOTA_BYTES };
};

const getFilesystemStats = () => {
  try {
    const stat = fs.statfsSync(NAS_ROOT);
    const totalBytes = Number(stat.blocks) * Number(stat.bsize);
    const freeBytes = Number(stat.bavail) * Number(stat.bsize);
    return {
      totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
      freeBytes: Number.isFinite(freeBytes) ? freeBytes : 0
    };
  } catch (err) {
    return { totalBytes: 0, freeBytes: 0 };
  }
};

const calculateCapacityLedger = ({
  totalBytes = 0,
  freeBytes = 0,
  allocatedBytes = 0,
  actualUserBytes = 0,
  pendingReservedBytes = 0,
  reserveBytes
} = {}) => {
  const total = Math.max(0, Number(totalBytes) || 0);
  const free = Math.max(0, Math.min(total, Number(freeBytes) || 0));
  const actual = Math.max(0, Number(actualUserBytes) || 0);
  const allocated = Math.max(0, Number(allocatedBytes) || 0);
  const pending = Math.max(0, Number(pendingReservedBytes) || 0);
  const reserve = Math.max(
    0,
    Math.min(total, Number.isFinite(Number(reserveBytes))
      ? Number(reserveBytes)
      : Math.max(MIN_SYSTEM_RESERVE_BYTES, Math.floor(total * SYSTEM_RESERVE_RATIO)))
  );
  const used = Math.max(0, total - free);
  const nonAccountUsed = Math.max(0, used - actual);
  const quotaPool = Math.max(0, total - reserve - nonAccountUsed);
  const committed = allocated + pending;
  const logicalAvailable = Math.max(0, quotaPool - committed);
  const physicalAvailable = Math.max(0, free - reserve);
  const availableForAllocation = Math.min(logicalAvailable, physicalAvailable);

  return {
    totalBytes: total,
    usedBytes: used,
    freeBytes: free,
    systemReserveBytes: reserve,
    nonAccountUsedBytes: nonAccountUsed,
    quotaPoolBytes: quotaPool,
    actualUserBytes: actual,
    allocatedBytes: allocated,
    pendingReservedBytes: pending,
    committedBytes: committed,
    logicalAvailableBytes: logicalAvailable,
    physicalAvailableBytes: physicalAvailable,
    availableForAllocationBytes: availableForAllocation,
    overAllocatedBytes: Math.max(0, committed - quotaPool),
    defaultQuotaBytes: DEFAULT_USER_QUOTA_BYTES,
    signupAvailable: availableForAllocation >= DEFAULT_USER_QUOTA_BYTES
  };
};

const getStorageCapacitySummary = (users = [], pendingRequests = []) => {
  const normalizedUsers = (Array.isArray(users) ? users : []).map(normalizeQuotaFields);
  let actualUserBytes = 0;
  for (const user of normalizedUsers) {
    actualUserBytes += getUserStorageSummary(user).usedBytes;
  }
  const allocatedBytes = normalizedUsers.reduce(
    (total, user) => total + Number(user.storageQuotaBytes || DEFAULT_USER_QUOTA_BYTES),
    0
  );
  const pendingCount = Array.isArray(pendingRequests) ? pendingRequests.length : 0;
  const stats = getFilesystemStats();
  return {
    ...calculateCapacityLedger({
      ...stats,
      allocatedBytes,
      actualUserBytes,
      pendingReservedBytes: pendingCount * DEFAULT_USER_QUOTA_BYTES
    }),
    accountCount: normalizedUsers.length,
    pendingCount
  };
};

const getUserStorageSummary = (user = {}) => {
  const basePath = getQuotaBasePath(user);
  const usage = getCachedPathUsage(basePath);
  const chatAttachmentBytes = getChatAttachmentUsage(user);
  const quota = getQuotaInfo(user);
  let totalBytes = null;
  let freeBytes = null;

  const stats = getFilesystemStats();
  totalBytes = stats.totalBytes || null;
  freeBytes = stats.freeBytes || null;

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
  if (bytes <= 0) return;

  let replacedBytes = 0;
  try {
    if (changedPath && fs.existsSync(changedPath) && fs.statSync(changedPath).isFile()) {
      replacedBytes = fs.statSync(changedPath).size;
    }
  } catch (err) {}
  const additionalBytes = Math.max(0, bytes - replacedBytes);

  const stats = getFilesystemStats();
  const reserveBytes = Math.max(MIN_SYSTEM_RESERVE_BYTES, Math.floor(stats.totalBytes * SYSTEM_RESERVE_RATIO));
  if (additionalBytes > Math.max(0, stats.freeBytes - reserveBytes)) {
    const err = new Error('NAS의 안전 여유 공간이 부족합니다. 불필요한 파일을 정리하거나 할당량을 조정해주세요.');
    err.status = 507;
    err.code = 'STORAGE_CAPACITY_LOW';
    err.storage = { freeBytes: stats.freeBytes, reserveBytes, incomingBytes: bytes, additionalBytes };
    throw err;
  }

  const quotaBasePath = getQuotaBasePath(user);
  const targetIsPersonal = !changedPath || isSameOrChild(quotaBasePath, changedPath);
  if (!targetIsPersonal && isStorageAdmin(user)) {
    if (changedPath) invalidateUsageCache(changedPath);
    return;
  }

  const summary = getUserStorageSummary(user);
  if (summary.usedBytes + additionalBytes > quota.quotaBytes) {
    const err = new Error('개인 저장공간 할당량을 초과합니다. 불필요한 파일을 정리하거나 관리자에게 용량 증설을 요청해주세요.');
    err.status = 413;
    err.code = 'STORAGE_QUOTA_EXCEEDED';
    err.storage = {
      usedBytes: summary.usedBytes,
      quotaBytes: quota.quotaBytes,
      incomingBytes: bytes,
      additionalBytes
    };
    throw err;
  }

  if (changedPath) invalidateUsageCache(changedPath);
};

module.exports = {
  NAS_ROOT,
  DEFAULT_USER_QUOTA_BYTES,
  MIN_SYSTEM_RESERVE_BYTES,
  getLoginId,
  getRole,
  isStorageAdmin,
  normalizeQuotaFields,
  readMembers,
  writeMembers,
  findMemberByAnyId,
  getAccessBasePath,
  getQuotaBasePath,
  ensurePersonalStorageRoot,
  resolveInside,
  isSameOrChild,
  getCachedPathUsage,
  getUserStorageSummary,
  getStorageCapacitySummary,
  invalidateUsageCache,
  assertQuotaAvailable,
  _test: { countPathSize, calculateCapacityLedger, normalizePersonalRelativeRoot }
};
