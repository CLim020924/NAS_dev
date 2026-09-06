export const LEGACY_FILE_MANAGER_PATH_KEY = 'nas_file_manager_path';

export const getWorkspaceUserIdentity = (user = {}) => String(
  user.userUid || user.loginId || user.id || user.username || ''
).trim();

export const readStoredWorkspaceIdentity = (storage) => {
  try {
    return getWorkspaceUserIdentity(JSON.parse(storage?.getItem('user') || '{}'));
  } catch (error) {
    return '';
  }
};

export const getFileManagerPathStorageKey = (identity) => (
  identity ? `nas_file_manager_path:${encodeURIComponent(identity)}` : ''
);

export const readWorkspaceFileManagerPath = (storage, identity) => {
  const key = getFileManagerPathStorageKey(identity);
  if (!key) return '/';
  const value = storage?.getItem(key);
  return value && value !== 'undefined' ? value : '/';
};

export const getWorkspaceIdentityTransition = (storage, previousIdentity, nextIdentity) => {
  if (previousIdentity === nextIdentity) return null;
  return {
    identity: nextIdentity,
    fileManagerPath: readWorkspaceFileManagerPath(storage, nextIdentity),
    openWindows: [],
    taskbarOrder: [],
    focusedContext: 'desktop',
    topZIndex: 100,
  };
};

