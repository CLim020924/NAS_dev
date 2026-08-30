import {
  isDocumentStudioFile,
  makeUniqueStudioNames,
  sanitizeStudioUploadName,
  validateDocumentStudioSelection,
} from './documentStudioPolicy';

describe('document studio file policy', () => {
  test('accepts supported documents and sanitizes upload names', () => {
    expect(isDocumentStudioFile('보고서.PPTX')).toBe(true);
    expect(isDocumentStudioFile('script.exe')).toBe(false);
    expect(sanitizeStudioUploadName('../bad:name.pdf')).toBe('bad_name.pdf');
  });

  test('keeps selected file names unique and validates merge modes', () => {
    expect(makeUniqueStudioNames([{ name: 'a.pdf' }, { name: 'a.pdf' }])).toEqual(['a.pdf', 'a (2).pdf']);
    expect(validateDocumentStudioSelection('merge-pdf', [{ name: 'a.pdf' }])).toContain('두 개');
    expect(validateDocumentStudioSelection('merge-pdf', [{ name: 'a.pdf' }, { name: 'b.docx' }])).toContain('PDF 파일만');
    expect(validateDocumentStudioSelection('merge-mixed-pdf', [{ name: 'a.pdf' }, { name: 'b.docx' }])).toBe('');
  });
});
