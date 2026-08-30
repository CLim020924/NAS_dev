export const buildMultipartUploadHeaders = (headers = {}) => ({ ...headers });

export const isCanceledUploadError = (err) => {
  const responseError = String(
    err?.response?.data?.error || err?.response?.data?.code || ''
  ).trim().toUpperCase();
  const message = String(err?.message || '').trim().toUpperCase();

  return err?.code === 'ERR_CANCELED' ||
    err?.name === 'CanceledError' ||
    responseError === 'UPLOAD_CANCELED' ||
    message === 'UPLOAD_CANCELED';
};

export const isTransientUploadError = (err) => {
  if (isCanceledUploadError(err)) return false;
  if (!err?.response) return true;
  return [408, 425, 429, 502, 503, 504].includes(Number(err.response.status));
};
