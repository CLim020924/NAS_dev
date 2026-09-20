/** @jest-environment node */
import { withWindowDirtyState } from './windowDirtyState';

test('an unchanged PDF dirty flag does not rerender its parent window list', () => {
  const windows = [{ id: 'pdf', hasUnsavedChanges: false }, { id: 'other', hasUnsavedChanges: true }];
  expect(withWindowDirtyState(windows, 'pdf', false)).toBe(windows);
  const changed = withWindowDirtyState(windows, 'pdf', true);
  expect(changed).not.toBe(windows);
  expect(changed[1]).toBe(windows[1]);
  expect(withWindowDirtyState(changed, 'pdf', true)).toBe(changed);
  expect(withWindowDirtyState(changed, 'missing', false)).toBe(changed);
});
