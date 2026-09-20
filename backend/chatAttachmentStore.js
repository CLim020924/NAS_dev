const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config/env');

const DATA_FILE = path.join(__dirname, 'data', 'chatAttachments.json');
const TEMP_ROOT = config.CHAT_TEMP_ROOT;
const INCOMING_ROOT = config.CHAT_INCOMING_ROOT;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

const nowIso = () => new Date().toISOString();
const nowMs = () => Date.now();

const randomId = (prefix) => {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
};

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
};

const ensureStore = (filePath = DATA_FILE) => {
  ensureDir(path.dirname(filePath));
  if (filePath === DATA_FILE) {
    ensureDir(TEMP_ROOT);
    ensureDir(INCOMING_ROOT);
  }
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]\n');
};

const readAll = (filePath = DATA_FILE) => {
  ensureStore(filePath);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
};

const writeAll = (items, filePath = DATA_FILE) => {
  ensureStore(filePath);
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
};

const safeRm = (targetPath) => {
  try {
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
    return !fs.existsSync(targetPath);
  } catch (e) { return false; }
};

const isSafeBundleId = (bundleId) => /^cab_[a-zA-Z0-9_-]+$/.test(String(bundleId || ''));
const getBundleDir = (bundleId) => {
  if (!isSafeBundleId(bundleId)) throw new Error('INVALID_CHAT_BUNDLE_ID');
  return path.join(TEMP_ROOT, bundleId);
};

const ensureUniqueName = (dirPath, wantedName) => {
  const ext = path.extname(wantedName);
  const base = path.basename(wantedName, ext);
  let candidate = wantedName;
  let counter = 1;

  while (fs.existsSync(path.join(dirPath, candidate))) {
    candidate = `${base} (${counter})${ext}`;
    counter += 1;
  }
  return candidate;
};

const isExpiredPendingBundle = (bundle, atMs) => {
  const createdAtMs = new Date(bundle.createdAt || 0).getTime();
  return (bundle.status === 'pending' || bundle.status === 'canceled') &&
    (!createdAtMs || atMs - createdAtMs >= PENDING_TTL_MS);
};

const cleanupExpiredPendingBundles = ({ atMs = nowMs(), dataFile = DATA_FILE, tempRoot = TEMP_ROOT } = {}) => {
  const all = readAll(dataFile);
  const keep = [];

  all.forEach((bundle) => {
    if (isExpiredPendingBundle(bundle, atMs) && isSafeBundleId(bundle.bundleId)) {
      if (safeRm(path.join(tempRoot, bundle.bundleId))) return;
    }
    keep.push(bundle);
  });

  if (keep.length !== all.length) writeAll(keep, dataFile);
  return { removedCount: all.length - keep.length, remainingCount: keep.length };
};

const createBundleRecord = ({ ownerUid, ownerLoginId, sourceType, items }) => {
  ensureStore();
  cleanupExpiredPendingBundles();

  const bundleId = randomId('cab');
  const createdAt = nowIso();
  const record = {
    bundleId,
    ownerUid,
    ownerLoginId,
    sourceType,
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.now() + PENDING_TTL_MS).toISOString(),
    tempRoot: `chat_tmp/${bundleId}`,
    itemCount: Array.isArray(items) ? items.length : 0,
    items: Array.isArray(items) ? items : [],
  };

  const all = readAll();
  all.push(record);
  writeAll(all);
  return record;
};

const getBundle = (bundleId) => {
  cleanupExpiredPendingBundles();
  return readAll().find((item) => item.bundleId === bundleId) || null;
};

const updateBundle = (bundleId, patch) => {
  const all = readAll();
  let updated = null;

  const next = all.map((item) => {
    if (item.bundleId !== bundleId) return item;
    updated = {
      ...item,
      ...patch,
      updatedAt: nowIso(),
    };
    return updated;
  });

  writeAll(next);
  return updated;
};

const cancelBundle = (bundleId) => {
  const bundle = getBundle(bundleId);
  if (!bundle) return null;
  safeRm(getBundleDir(bundleId));
  return updateBundle(bundleId, { status: 'canceled' });
};

module.exports = {
  TEMP_ROOT,
  INCOMING_ROOT,
  ensureStore,
  getBundleDir,
  isSafeBundleId,
  ensureUniqueName,
  cleanupExpiredPendingBundles,
  isExpiredPendingBundle,
  PENDING_TTL_MS,
  createBundleRecord,
  getBundle,
  updateBundle,
  cancelBundle,
};
