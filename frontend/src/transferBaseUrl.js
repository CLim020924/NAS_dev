const DEFAULT_TRANSFER_BASE_URL = '';

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

export const getTransferBaseUrl = () => {
  const configured = normalizeBaseUrl(process.env.REACT_APP_TRANSFER_BASE_URL || DEFAULT_TRANSFER_BASE_URL);
  if (!configured || configured === window.location.origin) return '';
  return configured;
};

export const transferUrl = (path = '') => {
  const base = getTransferBaseUrl();
  const safePath = String(path || '');
  if (!base) return safePath;
  return `${base}${safePath.startsWith('/') ? safePath : `/${safePath}`}`;
};
