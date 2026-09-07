const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_ROOT = process.env.WORKSPACE_VIEW_STATE_ROOT || path.join(__dirname, 'data', 'workspace_view_state');
const ALLOWED_KINDS = new Set([
  'workspace', 'workspace-session', 'file-manager', 'note-studio-session',
  'pdf', 'monaco', 'note-block', 'note-monaco', 'hwp', 'office', 'image', 'media'
]);
const MAX_STATE_BYTES = 24 * 1024;
const MAX_ENTRIES = 2000;
const MAX_DEVICES_PER_ENTRY = 8;
const FORBIDDEN_KEY = /password|passwd|secret|token|cookie|authorization|credential/i;

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const codedError = (message, status = 400, code = 'VIEW_STATE_INVALID') => Object.assign(new Error(message), { status, code });

const normalizeKind = (value) => {
  const kind = String(value || '').trim();
  if (!ALLOWED_KINDS.has(kind)) throw codedError('지원하지 않는 작업 위치 형식입니다.');
  return kind;
};

const normalizeDeviceId = (value) => {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw codedError('장치 식별자가 올바르지 않습니다.');
  return id;
};

const sanitizeStateValue = (value, depth = 0) => {
  if (depth > 7) throw codedError('작업 위치 데이터가 너무 깊습니다.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw codedError('작업 위치 숫자가 올바르지 않습니다.');
    return Math.max(-1e9, Math.min(1e9, value));
  }
  if (typeof value === 'string') return value.slice(0, 1000);
  if (Array.isArray(value)) {
    if (value.length > 100) throw codedError('작업 위치 배열이 너무 큽니다.');
    return value.map((item) => sanitizeStateValue(item, depth + 1));
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw codedError('작업 위치 데이터가 올바르지 않습니다.');
  const result = {};
  const entries = Object.entries(value);
  if (entries.length > 100) throw codedError('작업 위치 항목이 너무 많습니다.');
  for (const [rawKey, item] of entries) {
    const key = String(rawKey).slice(0, 80);
    if (!key || FORBIDDEN_KEY.test(key)) throw codedError('작업 위치에는 인증 정보를 저장할 수 없습니다.');
    result[key] = sanitizeStateValue(item, depth + 1);
  }
  return result;
};

const normalizeState = (state) => {
  const normalized = sanitizeStateValue(state);
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') throw codedError('작업 위치가 올바르지 않습니다.');
  if (Buffer.byteLength(JSON.stringify(normalized)) > MAX_STATE_BYTES) throw codedError('작업 위치 데이터가 24KB 제한을 초과했습니다.', 413, 'VIEW_STATE_TOO_LARGE');
  return normalized;
};

const sameIdentity = (left, right) => !!(left && right && String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino) && Number(left.birthtimeMs || 0) === Number(right.birthtimeMs || 0));
const accountPath = (accountKey) => path.join(STORE_ROOT, `${sha256(accountKey)}.json`);
const readStore = (filePath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed?.version === 1 && parsed.entries && typeof parsed.entries === 'object' ? parsed : { version: 1, entries: {} };
  } catch { return { version: 1, entries: {} }; }
};
const writeStore = (filePath, store) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store), { mode: 0o600 });
  fs.renameSync(temp, filePath);
};

const findEntry = (store, resourceKey, identity) => {
  if (store.entries[resourceKey]) return { key: resourceKey, entry: store.entries[resourceKey] };
  if (!identity) return null;
  const match = Object.entries(store.entries).find(([, entry]) => sameIdentity(entry.identity, identity));
  return match ? { key: match[0], entry: match[1] } : null;
};

const loadWorkspaceViewState = ({ accountKey, resourceKey, deviceId, identity }) => {
  const store = readStore(accountPath(accountKey));
  const found = findEntry(store, resourceKey, identity);
  const record = found?.entry?.devices?.[deviceId] || found?.entry?.latest || null;
  return record ? { state: record.state, contentRevision: record.contentRevision ?? null, updatedAt: record.updatedAt, source: found?.entry?.devices?.[deviceId] ? 'device' : 'account' } : null;
};

const saveWorkspaceViewState = ({ accountKey, resourceKey, deviceId, kind, identity, state, contentRevision }) => {
  const filePath = accountPath(accountKey);
  const store = readStore(filePath);
  const found = findEntry(store, resourceKey, identity);
  const entry = found?.entry || { kind, devices: {} };
  if (found && found.key !== resourceKey) delete store.entries[found.key];
  const now = new Date().toISOString();
  const record = { state: normalizeState(state), contentRevision: contentRevision ?? null, updatedAt: now };
  entry.kind = kind;
  entry.identity = identity || entry.identity || null;
  entry.devices = entry.devices && typeof entry.devices === 'object' ? entry.devices : {};
  entry.devices[deviceId] = record;
  const deviceIds = Object.keys(entry.devices).sort((a, b) => String(entry.devices[b].updatedAt).localeCompare(String(entry.devices[a].updatedAt)));
  deviceIds.slice(MAX_DEVICES_PER_ENTRY).forEach((id) => delete entry.devices[id]);
  entry.latest = record;
  store.entries[resourceKey] = entry;
  const keys = Object.keys(store.entries).sort((a, b) => String(store.entries[b].latest?.updatedAt || '').localeCompare(String(store.entries[a].latest?.updatedAt || '')));
  keys.slice(MAX_ENTRIES).forEach((key) => delete store.entries[key]);
  writeStore(filePath, store);
  return { updatedAt: now };
};

module.exports = { ALLOWED_KINDS, normalizeKind, normalizeDeviceId, loadWorkspaceViewState, saveWorkspaceViewState, _test: { normalizeState, sameIdentity } };
