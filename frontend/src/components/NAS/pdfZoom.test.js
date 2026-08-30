import {
  PDF_ZOOM_MAX,
  PDF_ZOOM_MIN,
  getPdfZoomKeyDirection,
  stepPdfZoom,
} from './pdfZoom';

describe('PDF window zoom policy', () => {
  test('steps and clamps one PDF window zoom', () => {
    expect(stepPdfZoom(1, 1)).toBe(1.15);
    expect(stepPdfZoom(1, -1)).toBe(0.85);
    expect(stepPdfZoom(PDF_ZOOM_MAX, 1)).toBe(PDF_ZOOM_MAX);
    expect(stepPdfZoom(PDF_ZOOM_MIN, -1)).toBe(PDF_ZOOM_MIN);
  });

  test('recognizes browser zoom keys for local interception', () => {
    expect(getPdfZoomKeyDirection('+')).toBe(1);
    expect(getPdfZoomKeyDirection('=')).toBe(1);
    expect(getPdfZoomKeyDirection('-')).toBe(-1);
    expect(getPdfZoomKeyDirection('_')).toBe(-1);
    expect(getPdfZoomKeyDirection('s')).toBe(0);
  });
});
