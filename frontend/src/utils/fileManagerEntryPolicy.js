export const isMasterFileManagerUser = (user = {}) => (
  String(user.role || '').toUpperCase() === 'MASTER' || user.Masters === true
);

const normalizeUserStoragePath = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\\/g, '/');
  if (!normalized.startsWith('/')) return null;
  const segments = normalized.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '..')) return null;
  return segments.length ? `/${segments.join('/')}` : '/';
};

export const getMasterPersonalStoragePath = (user = {}) => {
  if (!isMasterFileManagerUser(user)) return null;

  const configuredPath = normalizeUserStoragePath(user.personalRootPath || user.rootPath);
  if (configuredPath && configuredPath !== '/') return configuredPath;

  const loginId = String(user.loginId || user.id || user.username || '').trim();
  if (!loginId || loginId.includes('/') || loginId.includes('\\') || loginId === '.' || loginId === '..') return null;
  return `/users/${loginId}`;
};

export const getDefaultFileManagerEntryPath = (user = {}, rememberedPath = '/') => {
  if (isMasterFileManagerUser(user)) return '/';
  return typeof rememberedPath === 'string' && rememberedPath.startsWith('/')
    ? rememberedPath
    : '/';
};

export const readDefaultFileManagerEntryPath = (storage, rememberedPath = '/') => {
  try {
    const user = JSON.parse(storage?.getItem('user') || '{}');
    return getDefaultFileManagerEntryPath(user, rememberedPath);
  } catch (error) {
    return '/';
  }
};
