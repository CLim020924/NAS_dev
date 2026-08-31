import {
  exportRhwpWithRecovery,
  getNasRhwpShortcutAction,
  isRecoverableHwpxExportError,
  replaceRhwpExtension
} from './rhwpSavePolicy';

test('recognizes the rHWP unregistered char style failure', () => {
  expect(isRecoverableHwpxExportError(new Error('렌더링 오류: XML 쓰기 실패: 미등록 ID 참조 발견: charPrIDRef: [0]'))).toBe(true);
  expect(isRecoverableHwpxExportError(new Error('network failed'))).toBe(false);
});

test('falls back to HWP without losing the editable document', async () => {
  const editor = {
    exportHwpx: jest.fn().mockRejectedValue(new Error('미등록 ID 참조 발견: charPrIDRef: [0]')),
    exportHwp: jest.fn().mockResolvedValue(Uint8Array.from([1, 2, 3]))
  };
  await expect(exportRhwpWithRecovery(editor, 'hwpx')).resolves.toMatchObject({ format: 'hwp', recovered: true });
  expect(editor.exportHwp).toHaveBeenCalledTimes(1);
});

test('only NAS save shortcuts are intercepted', () => {
  expect(getNasRhwpShortcutAction({ key: 's', ctrlKey: true })).toBe('save');
  expect(getNasRhwpShortcutAction({ key: 'S', ctrlKey: true, shiftKey: true })).toBe('save-as');
  expect(getNasRhwpShortcutAction({ key: 'p', ctrlKey: true })).toBeNull();
  expect(getNasRhwpShortcutAction({ key: 'z', ctrlKey: true })).toBeNull();
});

test('changes only the HWP family extension', () => {
  expect(replaceRhwpExtension('보고서.hwpx', 'hwp')).toBe('보고서.hwp');
  expect(replaceRhwpExtension('보고서', 'hwpx')).toBe('보고서.hwpx');
});
