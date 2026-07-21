const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DOTENV_PATH = path.join(PROJECT_ROOT, '.env');

const parseDotenvLine = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex <= 0) return null;
  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return key ? [key, value] : null;
};

const loadDotenv = () => {
  if (!fs.existsSync(DOTENV_PATH)) return;
  const lines = fs.readFileSync(DOTENV_PATH, 'utf8').split(/\r?\n/);
  lines.forEach((line) => {
    const parsed = parseDotenvLine(line);
    if (!parsed) return;
    const [key, value] = parsed;
    if (process.env[key] === undefined) process.env[key] = value;
  });
};

loadDotenv();

const text = (key, fallback = '') => {
  const value = process.env[key];
  return value === undefined || value === null || value === '' ? fallback : String(value);
};

const number = (key, fallback) => {
  const parsed = Number.parseInt(text(key, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (key, fallback = false) => {
  const value = text(key, '');
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

const APP_DOMAIN = text('APP_DOMAIN', 'filemanager-nas.com');
const UPLOAD_DOMAIN = text('UPLOAD_DOMAIN', 'upload.filemanager-nas.com');
const PUBLIC_BASE_URL = trimTrailingSlash(text('PUBLIC_BASE_URL', `https://${APP_DOMAIN}`));
const UPLOAD_BASE_URL = trimTrailingSlash(text('UPLOAD_BASE_URL', `https://${UPLOAD_DOMAIN}`));
const NAS_ROOT = path.resolve(text('NAS_ROOT', text('NAS_PATH', '/mnt/nas')));
const CHAT_TEMP_ROOT = path.join(NAS_ROOT, text('CHAT_TEMP_DIR', 'chat_tmp'));

module.exports = {
  PROJECT_ROOT,
  DOTENV_PATH,
  NODE_ENV: text('NODE_ENV', 'production'),
  APP_DOMAIN,
  UPLOAD_DOMAIN,
  PUBLIC_BASE_URL,
  UPLOAD_BASE_URL,
  BACKEND_PORT: number('BACKEND_PORT', 3030),
  FRONTEND_BUILD_PATH: text('FRONTEND_BUILD_PATH', '/var/www/html'),
  NAS_ROOT,
  NAS_BACKUP_PATH: path.join(NAS_ROOT, text('NAS_BACKUP_DIR', 'backup')),
  CHATDATA_ROOT: path.join(NAS_ROOT, text('CHATDATA_DIR', 'chatdata')),
  CHAT_TEMP_ROOT,
  CHAT_INCOMING_ROOT: path.join(CHAT_TEMP_ROOT, '_incoming'),
  COOKIE_DOMAIN: text('COOKIE_DOMAIN', `.${APP_DOMAIN}`),
  JWT_SECRET: text('JWT_SECRET', 'my-service-platform-secure-key-2026'),
  SESSION_DISCONNECT_LOGOUT_MS: number('SESSION_DISCONNECT_LOGOUT_MS', 60 * 1000),
  MEETING_DISCONNECT_GRACE_MS: number('MEETING_DISCONNECT_GRACE_MS', 10 * 60 * 1000),
  AI_PROVIDER: text('AI_PROVIDER', 'openai'),
  OPENAI_API_KEY: text('OPENAI_API_KEY', ''),
  OPENAI_MODEL: text('OPENAI_MODEL', 'gpt-4.1-mini'),
  AI_ENABLED: bool('AI_ENABLED', false) && !!text('OPENAI_API_KEY', ''),
};
