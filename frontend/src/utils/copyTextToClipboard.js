export const copyTextToClipboard = async (value, options = {}) => {
  const text = String(value ?? '');
  const browserNavigator = typeof navigator === 'undefined' ? undefined : navigator;
  const browserDocument = typeof document === 'undefined' ? undefined : document;
  const clipboard = options.clipboard ?? browserNavigator?.clipboard;
  const documentRef = options.document ?? browserDocument;

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // HTTP, browser policy, or permission failures fall through to selection copy.
    }
  }

  if (!documentRef?.body || typeof documentRef.execCommand !== 'function') return false;
  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  documentRef.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return documentRef.execCommand('copy') === true;
  } catch {
    return false;
  } finally {
    documentRef.body.removeChild(textarea);
  }
};
