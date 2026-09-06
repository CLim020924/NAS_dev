/** @jest-environment node */

import {
  getFileManagerPathStorageKey,
  getWorkspaceIdentityTransition,
  readStoredWorkspaceIdentity,
  readWorkspaceFileManagerPath,
} from './windowWorkspaceIdentity';

const createStorage = (initial = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
};

test('account-specific file manager paths never fall back to the legacy shared path', () => {
  const storage = createStorage({
    user: JSON.stringify({ loginId: 'K' }),
    nas_file_manager_path: '/A/b',
    [getFileManagerPathStorageKey('A')]: '/b',
  });

  expect(readStoredWorkspaceIdentity(storage)).toBe('K');
  expect(readWorkspaceFileManagerPath(storage, 'K')).toBe('/');
});

test('switching accounts closes prior windows and restores only the destination account path', () => {
  const storage = createStorage({
    [getFileManagerPathStorageKey('A')]: '/b',
    [getFileManagerPathStorageKey('K')]: '/documents',
  });

  expect(getWorkspaceIdentityTransition(storage, 'A', 'K')).toEqual({
    identity: 'K',
    fileManagerPath: '/documents',
    openWindows: [],
    taskbarOrder: [],
    focusedContext: 'desktop',
    topZIndex: 100,
  });
});

test('logging out always resets the visible workspace to root', () => {
  const storage = createStorage({
    [getFileManagerPathStorageKey('A')]: '/b',
  });

  expect(getWorkspaceIdentityTransition(storage, 'A', '')).toMatchObject({
    identity: '',
    fileManagerPath: '/',
    openWindows: [],
    focusedContext: 'desktop',
  });
});
