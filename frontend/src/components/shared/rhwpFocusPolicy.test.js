import {
  focusRhwpEditorInput,
  RHWP_EDITOR_INPUT_SELECTOR,
  shouldRestoreRhwpEditorFocus
} from './rhwpFocusPolicy';

const makeIframe = ({ activeElement } = {}) => {
  const doc = {
    activeElement: activeElement || null,
    querySelector: jest.fn()
  };
  const input = {
    matches: jest.fn(() => true),
    focus: jest.fn(() => { doc.activeElement = input; })
  };
  doc.querySelector.mockImplementation((selector) => selector === RHWP_EDITOR_INPUT_SELECTOR ? input : null);
  return {
    iframe: { contentDocument: doc, contentWindow: { focus: jest.fn() } },
    doc,
    input
  };
};

test('restores focus to the hidden rHWP document input instead of the scroll container', () => {
  const { iframe, doc, input } = makeIframe();
  expect(focusRhwpEditorInput(iframe)).toBe(true);
  expect(iframe.contentWindow.focus).toHaveBeenCalledTimes(1);
  expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(doc.activeElement).toBe(input);
});

test('does not steal focus from an editor dialog or toolbar input', () => {
  const dialogInput = { matches: jest.fn(() => true) };
  const { iframe, input } = makeIframe({ activeElement: dialogInput });
  expect(focusRhwpEditorInput(iframe)).toBe(false);
  expect(input.focus).not.toHaveBeenCalled();
});

test('restores only for the active editor without an outer NAS dialog', () => {
  expect(shouldRestoreRhwpEditorFocus({ mode: 'editor', isActive: true, saveAsOpen: false, folderPickerOpen: false })).toBe(true);
  expect(shouldRestoreRhwpEditorFocus({ mode: 'viewer', isActive: true, saveAsOpen: false, folderPickerOpen: false })).toBe(false);
  expect(shouldRestoreRhwpEditorFocus({ mode: 'editor', isActive: false, saveAsOpen: false, folderPickerOpen: false })).toBe(false);
  expect(shouldRestoreRhwpEditorFocus({ mode: 'editor', isActive: true, saveAsOpen: true, folderPickerOpen: false })).toBe(false);
});
