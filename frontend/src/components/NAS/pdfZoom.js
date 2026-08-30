export const PDF_ZOOM_MIN = 0.5;
export const PDF_ZOOM_MAX = 3;
export const PDF_ZOOM_STEP = 0.15;

export const clampPdfZoom = (value) => (
  Math.max(PDF_ZOOM_MIN, Math.min(PDF_ZOOM_MAX, Number(Number(value).toFixed(2))))
);

export const stepPdfZoom = (current, direction) => (
  clampPdfZoom(Number(current) + (direction < 0 ? -PDF_ZOOM_STEP : PDF_ZOOM_STEP))
);

export const getPdfZoomKeyDirection = (key) => {
  if (key === '+' || key === '=') return 1;
  if (key === '-' || key === '_') return -1;
  return 0;
};
