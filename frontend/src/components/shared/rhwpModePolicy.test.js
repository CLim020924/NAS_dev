import {
  normalizeRhwpMode,
  shouldApplyRequestedEditorMode,
  shouldRestorePersistedRhwpMode
} from './rhwpModePolicy';

test('normalizes unsupported modes to viewer', () => {
  expect(normalizeRhwpMode('editor')).toBe('editor');
  expect(normalizeRhwpMode('view')).toBe('viewer');
});

test('promotes an already open HWP window when edit is newly requested', () => {
  expect(shouldApplyRequestedEditorMode('viewer', 'editor')).toBe(true);
  expect(shouldApplyRequestedEditorMode('editor', 'editor')).toBe(false);
});

test('does not let a stale persisted viewer response undo a user editor click', () => {
  expect(shouldRestorePersistedRhwpMode(0, 0, 'viewer')).toBe(true);
  expect(shouldRestorePersistedRhwpMode(0, 1, 'viewer')).toBe(false);
  expect(shouldRestorePersistedRhwpMode(1, 1, 'unexpected')).toBe(false);
});
