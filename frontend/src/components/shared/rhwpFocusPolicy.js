export const RHWP_EDITOR_INPUT_SELECTOR = '[aria-label="문서 편집 입력"]';

const isInteractiveEditorControl = (element) => {
  if (!element?.matches) return false;
  return element.matches('input, textarea, select, [contenteditable="true"], [role="dialog"] *');
};

export const focusRhwpEditorInput = (iframe, { preserveInteractiveFocus = true } = {}) => {
  try {
    const doc = iframe?.contentDocument;
    const input = doc?.querySelector(RHWP_EDITOR_INPUT_SELECTOR);
    if (!doc || !input) return false;

    const activeElement = doc.activeElement;
    if (preserveInteractiveFocus && activeElement && activeElement !== input && isInteractiveEditorControl(activeElement)) {
      return false;
    }

    iframe.contentWindow?.focus?.();
    try {
      input.focus({ preventScroll: true });
    } catch (error) {
      input.focus();
    }
    return doc.activeElement === input;
  } catch (error) {
    // The iframe may be navigating or may no longer be same-origin.
    return false;
  }
};

export const shouldRestoreRhwpEditorFocus = ({ mode, isActive, saveAsOpen, folderPickerOpen }) => (
  mode === 'editor' && isActive !== false && !saveAsOpen && !folderPickerOpen
);
