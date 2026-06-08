const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'data', 'chatAttachments.json');
const TEMP_ROOT = '/mnt/nas/chat_tmp';
const INCOMING_ROOT = path.join(TEMP_ROOT, '_incoming');
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

const ensureStore = () => {
  ensureDir(path.dirname(DATA_FILE));
  ensureDir(TEMP_ROOT);
  ensureDir(INCOMING_ROOT);
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]\n');
};

const readAll = () => {
  ensureStore();
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
};

const writeAll = (items) => {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(items, null, 2));
};

const safeRm = (targetPath) => {
  try {
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
  } catch (e) {}
};

const getBundleDir = (bundleId) => path.join(TEMP_ROOT, bundleId);

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

const cleanupExpiredPendingBundles = () => {
  const all = readAll();
  const keep = [];
  const now = nowMs();

  all.forEach((bundle) => {
    const createdAtMs = new Date(bundle.createdAt || 0).getTime();
    const expired = !createdAtMs || (now - createdAtMs > PENDING_TTL_MS);
    const removable = bundle.status === 'pending' || bundle.status === 'canceled';

    if (expired && removable) {
      safeRm(getBundleDir(bundle.bundleId));
      return;
    }
    keep.push(bundle);
  });

  if (keep.length !== all.length) writeAll(keep);
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
  ensureUniqueName,
  cleanupExpiredPendingBundles,
  createBundleRecord,
  getBundle,
  updateBundle,
  cancelBundle,
};
