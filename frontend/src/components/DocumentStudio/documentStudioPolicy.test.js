import {
  getAvailableOutputFormats,
  getStudioAccept,
  isDocumentStudioFile,
  makeUniqueStudioNames,
  sanitizeStudioUploadName,
  validateDocumentStudioSelection,
} from './documentStudioPolicy';

describe('document studio file policy', () => {
  test('accepts supported documents and sanitizes upload names', () => {
    expect(isDocumentStudioFile('보고서.PPTX')).toBe(true);
    expect(isDocumentStudioFile('보고서.PPTX', 'pptx')).toBe(true);
    expect(isDocumentStudioFile('보고서.PPTX', 'docx')).toBe(false);
    expect(isDocumentStudioFile('문서.hwp')).toBe(false);
    expect(isDocumentStudioFile('script.exe')).toBe(false);
    expect(getStudioAccept('pptx')).toBe('.pptx');
    expect(sanitizeStudioUploadName('../bad:name.pdf')).toBe('bad_name.pdf');
  });

  test('keeps selected file names unique and validates merge modes', () => {
    expect(makeUniqueStudioNames([{ name: 'a.pdf' }, { name: 'a.pdf' }])).toEqual(['a.pdf', 'a (2).pdf']);
    expect(validateDocumentStudioSelection('merge-pdf', [{ name: 'a.pdf' }])).toContain('두 개');
    expect(validateDocumentStudioSelection('merge-pdf', [{ name: 'a.pdf' }, { name: 'b.docx' }])).toContain('PDF 파일만');
    expect(validateDocumentStudioSelection('merge-mixed-pdf', [{ name: 'a.pdf' }, { name: 'b.docx' }])).toBe('');
  });

  test('derives only real output formats from the selected source format or files', () => {
    expect(getAvailableOutputFormats('pptx')).toEqual(['pdf', 'pptx', 'odp']);
    expect(getAvailableOutputFormats('auto', [{ name: 'a.pptx' }, { name: 'b.odp' }])).toEqual(['pdf', 'pptx', 'odp']);
    expect(getAvailableOutputFormats('auto', [{ name: 'a.pptx' }, { name: 'b.docx' }])).toEqual(['pdf']);
    expect(validateDocumentStudioSelection('convert-pdf', [{ name: 'a.pptx' }], { sourceFormat: 'pptx', outputFormat: 'pptx' })).toBe('');
    expect(validateDocumentStudioSelection('convert-pdf', [{ name: 'a.docx' }], { sourceFormat: 'docx', outputFormat: 'xlsx' })).toContain('만들 수 없는');
  });
});
