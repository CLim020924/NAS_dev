import {
  BINARY_VIEWER_EXTENSIONS,
  getOnlyOfficeDocumentType,
  isOnlyOfficeFormat,
} from './officeFormats';

describe('office result viewer format policy', () => {
  test('routes open document formats to the matching OnlyOffice editor', () => {
    expect(isOnlyOfficeFormat('odt')).toBe(true);
    expect(isOnlyOfficeFormat('ods')).toBe(true);
    expect(isOnlyOfficeFormat('odp')).toBe(true);
    expect(isOnlyOfficeFormat('rtf')).toBe(true);
    expect(getOnlyOfficeDocumentType('odt')).toBe('word');
    expect(getOnlyOfficeDocumentType('ods')).toBe('cell');
    expect(getOnlyOfficeDocumentType('odp')).toBe('slide');
  });

  test('keeps every supported office result on the binary viewer path', () => {
    for (const extension of ['docx', 'odt', 'rtf', 'xlsx', 'ods', 'csv', 'pptx', 'odp']) {
      expect(BINARY_VIEWER_EXTENSIONS).toContain(extension);
    }
  });
});
