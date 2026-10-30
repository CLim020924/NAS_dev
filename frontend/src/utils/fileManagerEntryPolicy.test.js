/** @jest-environment node */

import {
  getDefaultFileManagerEntryPath,
  getMasterPersonalStoragePath,
  isMasterFileManagerUser,
  readDefaultFileManagerEntryPath,
} from './fileManagerEntryPolicy';

test('master accounts always enter the web file manager at NAS root', () => {
  expect(getDefaultFileManagerEntryPath({ role: 'MASTER' }, '/users/master/documents')).toBe('/');
  expect(getDefaultFileManagerEntryPath({ Masters: true }, '/private')).toBe('/');
});

test('non-master accounts keep their account-scoped remembered path', () => {
  expect(getDefaultFileManagerEntryPath({ role: 'USER' }, '/documents')).toBe('/documents');
  expect(getDefaultFileManagerEntryPath({ role: 'MANAGER' }, '/team')).toBe('/team');
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
