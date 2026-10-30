/** @jest-environment node */

import {
  canBrowseNasRoot,
  getAccountFileManagerPath,
  getDefaultFileManagerEntryPath,
  getMasterPersonalStoragePath,
  isMasterFileManagerUser,
  readDefaultFileManagerEntryPath,
} from './fileManagerEntryPolicy';

test('master accounts always enter the web file manager at NAS root', () => {
  expect(getDefaultFileManagerEntryPath({ role: 'MASTER' }, '/users/master/documents')).toBe('/');
  expect(getDefaultFileManagerEntryPath({ Masters: true }, '/private')).toBe('/');
});

test('non-master accounts enter their personal workspace instead of a remembered subfolder', () => {
  expect(getDefaultFileManagerEntryPath({ role: 'USER', rootPath: '/users/member' }, '/documents')).toBe('/');
  expect(getDefaultFileManagerEntryPath({ role: 'MANAGER', personalRootPath: '/users/manager' }, '/team')).toBe('/users/manager');
  expect(getDefaultFileManagerEntryPath({ role: 'USER', globalAccess: true, loginId: 'auditor' }, '/shared')).toBe('/users/auditor');
});

test('stored user parsing fails closed to root', () => {
  expect(readDefaultFileManagerEntryPath({ getItem: () => '{broken' }, '/documents')).toBe('/');
  expect(isMasterFileManagerUser({ role: 'master' })).toBe(true);
});

test('master personal storage stays separate from root and is hidden from other roles', () => {
  expect(getMasterPersonalStoragePath({ role: 'MASTER', personalRootPath: '/users/master' })).toBe('/users/master');
  expect(getMasterPersonalStoragePath({ Masters: true, rootPath: '/users/legacy-master/' })).toBe('/users/legacy-master');
  expect(getMasterPersonalStoragePath({ role: 'MASTER', loginId: 'owner' })).toBe('/users/owner');
  expect(getMasterPersonalStoragePath({ role: 'MANAGER', personalRootPath: '/users/manager' })).toBeNull();
  expect(getMasterPersonalStoragePath({ role: 'USER', personalRootPath: '/users/member' })).toBeNull();
});

test('account workspace paths preserve privileged personal roots without exposing NAS root to regular users', () => {
  expect(canBrowseNasRoot({ role: 'MANAGER' })).toBe(true);
  expect(canBrowseNasRoot({ role: 'USER' })).toBe(false);
  expect(getAccountFileManagerPath({ role: 'MASTER', personalRootPath: '/users/master' })).toBe('/users/master');
  expect(getAccountFileManagerPath({ role: 'MANAGER', rootPath: '/users/manager' })).toBe('/users/manager');
  expect(getAccountFileManagerPath({ role: 'USER', rootPath: '/users/member' })).toBe('/');
});
