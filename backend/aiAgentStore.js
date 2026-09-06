const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = path.join(__dirname, 'data', 'ai');

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
};

const safeId = (value) => String(value || 'unknown')
  .replace(/[^a-zA-Z0-9_-]/g, '_')
  .slice(0, 80) || 'unknown';

const userDir = (user) => {
  const userId = safeId(user.userUid || user.loginId || user.id || user.username);
  return path.join(DATA_ROOT, 'users', userId);
};

const fileFor = (user, name) => path.join(userDir(user), name);

const readJson = (filePath, fallback) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return fallback;
  }
};

const writeJson = (filePath, value) => {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tempPath, filePath);
  } finally {
    try { if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true }); } catch (err) {}
  }
};

const nowIso = () => new Date().toISOString();

const createId = (prefix) => {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
};

const listMessages = (user, limit = 80) => {
  const messages = readJson(fileFor(user, 'messages.json'), []);
  return Array.isArray(messages) ? messages.slice(-limit) : [];
};

const appendMessages = (user, messages = []) => {
  const next = [...listMessages(user, 4980), ...messages].slice(-5000);
  writeJson(fileFor(user, 'messages.json'), next);
  return next;
};

const searchMessages = (user, query, limit = 20) => {
  const needle = String(query || '').trim().toLocaleLowerCase('ko-KR');
  if (!needle) return [];
  return listMessages(user, 5000)
    .filter((item) => String(item.content || '').toLocaleLowerCase('ko-KR').includes(needle))
    .slice(-Math.max(1, Math.min(Number(limit) || 20, 50)))
    .reverse()
    .map((item) => ({
      role: item.role,
      content: String(item.content || '').slice(0, 4000),
      createdAt: item.createdAt || null,
    }));
};

const listActions = (user) => {
  const actions = readJson(fileFor(user, 'actions.json'), []);
  return Array.isArray(actions) ? actions : [];
};

const createAction = (user, action) => {
  const actions = listActions(user);
  if (action.idempotencyKey) {
    const existing = actions.find((item) => item.idempotencyKey === action.idempotencyKey);
    if (existing) return existing;
  }
  const nextAction = {
    actionId: createId('aiact'),
    status: 'pending',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    requestedByUid: user.userUid || '',
    requestedByLoginId: user.loginId || user.id || user.username || '',
    ...action,
  };
  actions.unshift(nextAction);
  writeJson(fileFor(user, 'actions.json'), actions.slice(0, 200));
  return nextAction;
};

const updateAction = (user, actionId, updater) => {
  const actions = listActions(user);
  const idx = actions.findIndex((item) => item.actionId === actionId);
  if (idx < 0) return null;
  actions[idx] = {
    ...actions[idx],
    ...(typeof updater === 'function' ? updater(actions[idx]) : updater),
    updatedAt: nowIso(),
  };
  writeJson(fileFor(user, 'actions.json'), actions);
  return actions[idx];
};

const getPreferences = (user) => {
  const preferences = readJson(fileFor(user, 'preferences.json'), {});
  return preferences && typeof preferences === 'object' ? preferences : {};
};

const setPreferences = (user, preferences = {}) => {
  const next = { ...getPreferences(user), ...preferences, updatedAt: nowIso() };
  writeJson(fileFor(user, 'preferences.json'), next);
  return next;
};

const getUsage = (user) => {
  const usage = readJson(fileFor(user, 'usage.json'), { days: {} });
  return usage && typeof usage === 'object' ? usage : { days: {} };
};

const recordUsage = (user, delta = {}) => {
  const usage = getUsage(user);
  const day = nowIso().slice(0, 10);
  const current = usage.days?.[day] || {};
  const nextDay = {
    inputTokens: Number(current.inputTokens || 0) + Number(delta.inputTokens || 0),
    outputTokens: Number(current.outputTokens || 0) + Number(delta.outputTokens || 0),
    totalTokens: Number(current.totalTokens || 0) + Number(delta.totalTokens || 0),
    requests: Number(current.requests || 0) + 1,
  };
  const next = { days: { ...(usage.days || {}), [day]: nextDay }, updatedAt: nowIso() };
  const keys = Object.keys(next.days).sort().slice(-90);
  next.days = Object.fromEntries(keys.map((key) => [key, next.days[key]]));
  writeJson(fileFor(user, 'usage.json'), next);
  return nextDay;
};

module.exports = {
  DATA_ROOT,
  listMessages,
  appendMessages,
  searchMessages,
  listActions,
  createAction,
  updateAction,
  getPreferences,
  setPreferences,
  getUsage,
  recordUsage,
};
