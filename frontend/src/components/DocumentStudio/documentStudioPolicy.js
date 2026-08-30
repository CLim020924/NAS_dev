export const DOCUMENT_STUDIO_EXTENSIONS = [
  'pdf', 'ppt', 'pptx', 'pptm', 'odp',
  'doc', 'docx', 'docm', 'odt', 'rtf', 'hwp', 'hwpx',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv', 'cell', 'nxl',
];

export const DOCUMENT_STUDIO_FORMAT_MATRIX = {
  pdf: ['pdf'],
  ppt: ['pdf', 'pptx', 'odp'], pptx: ['pdf', 'pptx', 'odp'], pptm: ['pdf', 'pptx', 'odp'], odp: ['pdf', 'pptx', 'odp'],
  doc: ['pdf', 'docx', 'odt', 'rtf'], docx: ['pdf', 'docx', 'odt', 'rtf'], docm: ['pdf', 'docx', 'odt', 'rtf'], odt: ['pdf', 'docx', 'odt', 'rtf'], rtf: ['pdf', 'docx', 'odt', 'rtf'],
  xls: ['pdf', 'xlsx', 'ods', 'csv'], xlsx: ['pdf', 'xlsx', 'ods', 'csv'], xlsm: ['pdf', 'xlsx', 'ods', 'csv'], xlsb: ['pdf', 'xlsx', 'ods', 'csv'], ods: ['pdf', 'xlsx', 'ods', 'csv'], csv: ['pdf', 'xlsx', 'ods', 'csv'],
  hwp: [], hwpx: [], cell: [], nxl: [],
};

export const FORMAT_LABELS = {
  auto: '자동 감지', pdf: 'PDF', ppt: 'PPT', pptx: 'PPTX', pptm: 'PPTM', odp: 'ODP',
  doc: 'DOC', docx: 'DOCX', docm: 'DOCM', odt: 'ODT', rtf: 'RTF', hwp: 'HWP', hwpx: 'HWPX',
  xls: 'XLS', xlsx: 'XLSX', xlsm: 'XLSM', xlsb: 'XLSB', ods: 'ODS', csv: 'CSV', cell: 'CELL', nxl: 'NXL',
};

export const DOCUMENT_STUDIO_ACCEPT = Object.entries(DOCUMENT_STUDIO_FORMAT_MATRIX)
  .filter(([, outputs]) => outputs.length > 0)
  .map(([extension]) => `.${extension}`)
  .join(',');

export const getStudioExtension = (name = '') => String(name).split('.').pop().toLowerCase();

export const getStudioAccept = (sourceFormat = 'auto', matrix = DOCUMENT_STUDIO_FORMAT_MATRIX) => {
  if (sourceFormat !== 'auto') return (matrix[sourceFormat] || []).length ? `.${sourceFormat}` : '';
  return Object.entries(matrix).filter(([, outputs]) => outputs.length > 0).map(([format]) => `.${format}`).join(',');
};

export const isDocumentStudioFile = (name, sourceFormat = 'auto', matrix = DOCUMENT_STUDIO_FORMAT_MATRIX) => {
  const extension = getStudioExtension(name);
  if (sourceFormat !== 'auto') return extension === sourceFormat && (matrix[sourceFormat] || []).length > 0;
  return (matrix[extension] || []).length > 0;
};

export const getAvailableOutputFormats = (sourceFormat = 'auto', items = [], matrix = DOCUMENT_STUDIO_FORMAT_MATRIX) => {
  const formats = sourceFormat === 'auto'
    ? [...new Set(items.map((item) => getStudioExtension(item.name)))]
    : [sourceFormat];
  if (formats.length === 0) return ['pdf'];
  return formats.reduce((shared, format, index) => {
    const outputs = matrix[format] || [];
    return index === 0 ? [...outputs] : shared.filter((output) => outputs.includes(output));
  }, []);
};

export const sanitizeStudioUploadName = (name = '문서') => {
  const leafName = String(name || '문서').split(/[\\/]/).pop();
  return [...leafName]
    .map((character) => (character.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(character) ? '_' : character))
    .join('') || '문서';
};

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

export const validateDocumentStudioSelection = (mode, items = [], { sourceFormat = 'auto', outputFormat = 'pdf', matrix = DOCUMENT_STUDIO_FORMAT_MATRIX } = {}) => {
  if (items.length === 0) return '작업할 파일을 선택하세요.';
  if (['merge-pdf', 'merge-mixed-pdf', 'merge-pptx'].includes(mode) && items.length < 2) return '합치기에는 파일이 두 개 이상 필요합니다.';
  if (mode === 'merge-pptx' && items.some((item) => getStudioExtension(item.name) !== 'pptx')) return 'PPTX 합치기에는 PPTX 파일만 사용할 수 있습니다.';
  if (mode === 'template-pptx' && (items.length !== 1 || getStudioExtension(items[0].name) !== 'pptx')) return '템플릿 일괄 만들기에는 PPTX 파일 한 개를 선택하세요.';
  if (mode === 'merge-pdf' && items.some((item) => getStudioExtension(item.name) !== 'pdf')) {
    return 'PDF 합치기에는 PDF 파일만 사용할 수 있습니다.';
  }
  if (mode === 'convert-pdf') {
    if (items.some((item) => !isDocumentStudioFile(item.name, sourceFormat, matrix))) return '선택한 원본 형식과 다른 파일이 포함되어 있습니다.';
    if (!getAvailableOutputFormats(sourceFormat, items, matrix).includes(outputFormat)) return '선택한 파일에서 만들 수 없는 결과 형식입니다.';
  }
  return '';
};
