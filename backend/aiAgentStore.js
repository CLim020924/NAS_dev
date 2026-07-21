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
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
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
  const next = [...listMessages(user, 240), ...messages].slice(-300);
  writeJson(fileFor(user, 'messages.json'), next);
  return next;
};

const listActions = (user) => {
  const actions = readJson(fileFor(user, 'actions.json'), []);
  return Array.isArray(actions) ? actions : [];
};

const createAction = (user, action) => {
  const actions = listActions(user);
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

module.exports = {
  DATA_ROOT,
  listMessages,
  appendMessages,
  listActions,
  createAction,
  updateAction,
  getPreferences,
  setPreferences,
};
