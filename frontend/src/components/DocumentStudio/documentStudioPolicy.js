export const DOCUMENT_STUDIO_EXTENSIONS = [
  'pdf', 'ppt', 'pptx', 'pptm', 'odp',
  'doc', 'docx', 'docm', 'odt', 'rtf', 'hwp', 'hwpx',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv',
];

export const DOCUMENT_STUDIO_ACCEPT = DOCUMENT_STUDIO_EXTENSIONS.map((extension) => `.${extension}`).join(',');

export const getStudioExtension = (name = '') => String(name).split('.').pop().toLowerCase();

export const isDocumentStudioFile = (name) => DOCUMENT_STUDIO_EXTENSIONS.includes(getStudioExtension(name));

export const sanitizeStudioUploadName = (name = '문서') => (
  String(name || '문서').split(/[\\/]/).pop().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') || '문서'
);

export const makeUniqueStudioNames = (files = []) => {
  const used = new Set();
  return files.map((file) => {
    const safe = sanitizeStudioUploadName(file.name);
    const dot = safe.lastIndexOf('.');
    const stem = dot > 0 ? safe.slice(0, dot) : safe;
    const extension = dot > 0 ? safe.slice(dot) : '';
    let candidate = safe;
    let index = 2;
    while (used.has(candidate.toLowerCase())) candidate = `${stem} (${index++})${extension}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
};

export const validateDocumentStudioSelection = (mode, items = []) => {
  if (items.length === 0) return '작업할 파일을 선택하세요.';
  if (mode !== 'convert-pdf' && items.length < 2) return '합치기에는 파일이 두 개 이상 필요합니다.';
  if (mode === 'merge-pdf' && items.some((item) => getStudioExtension(item.name) !== 'pdf')) {
    return 'PDF 합치기에는 PDF 파일만 사용할 수 있습니다.';
  }
  return '';
};
