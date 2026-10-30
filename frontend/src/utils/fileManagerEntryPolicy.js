export const isMasterFileManagerUser = (user = {}) => (
  String(user.role || '').toUpperCase() === 'MASTER' || user.Masters === true
);

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
