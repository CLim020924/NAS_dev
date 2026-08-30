export const WORD_OFFICE_FORMATS = ['docx', 'doc', 'docm', 'odt', 'rtf'];
export const CELL_OFFICE_FORMATS = ['xlsx', 'xls', 'xlsm', 'xlsb', 'ods', 'csv'];
export const SLIDE_OFFICE_FORMATS = ['pptx', 'ppt', 'pptm', 'odp'];
export const ONLY_OFFICE_FORMATS = [...WORD_OFFICE_FORMATS, ...CELL_OFFICE_FORMATS, ...SLIDE_OFFICE_FORMATS];

export const BINARY_VIEWER_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv',
  'mp3', 'wav', 'flac', 'm4a', 'pdf', 'heic', 'heif', ...ONLY_OFFICE_FORMATS,
  'hwp', 'hwpx', 'zip', 'tar', 'gz',
];

export const isOnlyOfficeFormat = (extension) => ONLY_OFFICE_FORMATS.includes(String(extension || '').toLowerCase());

export const getOnlyOfficeDocumentType = (extension) => {
  const normalized = String(extension || '').toLowerCase();
  if (CELL_OFFICE_FORMATS.includes(normalized)) return 'cell';
  if (SLIDE_OFFICE_FORMATS.includes(normalized)) return 'slide';
  return 'word';
};
