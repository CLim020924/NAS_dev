/** @jest-environment node */

import {
  getDefaultFileManagerEntryPath,
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
