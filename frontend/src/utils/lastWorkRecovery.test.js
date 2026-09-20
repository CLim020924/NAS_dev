/** @jest-environment node */

import { RECOVERY_LOGIN_KEY, normalizeLastWork, recoveryOfferForAccount } from './lastWorkRecovery';

test('keeps only supported, bounded work targets', () => {
  expect(normalizeLastWork({ type: 'file', path: '/users/a/report.pdf', label: 'Report' })).toEqual({ type: 'file', path: '/users/a/report.pdf', label: 'Report' });
  expect(normalizeLastWork({ type: 'folder', path: '/a/../b' })).toBeNull();
  expect(normalizeLastWork({ type: 'app', appId: 'note-studio', label: 'Notes' })).toEqual({ type: 'app', appId: 'note-studio', label: 'Notes' });
  expect(normalizeLastWork({ type: 'app', appId: 'unknown' })).toBeNull();
});

test('recovery is offered only after this account has just signed in', () => {
  const storage = { getItem: (key) => key === RECOVERY_LOGIN_KEY ? 'user-a' : null };
  const saved = { target: { type: 'file', path: '/draft.pdf', label: 'Draft' } };
  expect(recoveryOfferForAccount(storage, 'user-a', saved)).toEqual(saved.target);
  expect(recoveryOfferForAccount(storage, 'user-b', saved)).toBeNull();
  expect(recoveryOfferForAccount({ getItem: () => null }, 'user-a', saved)).toBeNull();
});
