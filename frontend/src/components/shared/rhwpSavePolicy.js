const HWPX_REFERENCE_ERROR = /(?:charPrIDRef|paraPrIDRef|styleIDRef).*(?:미등록|unregistered)|(?:미등록|unregistered).*?(?:charPrIDRef|paraPrIDRef|styleIDRef)/i;

export const isRecoverableHwpxExportError = (error) => HWPX_REFERENCE_ERROR.test(String(error?.message || error || ''));

export const replaceRhwpExtension = (fileName, format) => {
  const safeName = String(fileName || 'document').trim() || 'document';
  return /\.(?:hwp|hwpx)$/i.test(safeName)
    ? safeName.replace(/\.(?:hwp|hwpx)$/i, `.${format}`)
    : `${safeName}.${format}`;
};

export const getNasRhwpShortcutAction = (event) => {
  const key = String(event?.key || '').toLowerCase();
  if ((!event?.ctrlKey && !event?.metaKey) || key !== 's') return null;
  return event?.shiftKey ? 'save-as' : 'save';
};

export const exportRhwpWithRecovery = async (editor, requestedFormat) => {
  if (!editor) throw new Error('한글 편집기가 준비되지 않았습니다.');
  if (requestedFormat !== 'hwpx') {
    return { bytes: await editor.exportHwp(), format: 'hwp', recovered: false };
  }

  try {
    return { bytes: await editor.exportHwpx(), format: 'hwpx', recovered: false };
  } catch (error) {
    if (!isRecoverableHwpxExportError(error)) throw error;
    return {
      bytes: await editor.exportHwp(),
      format: 'hwp',
      recovered: true,
      recoveryReason: String(error?.message || error || '')
    };
  }
};
