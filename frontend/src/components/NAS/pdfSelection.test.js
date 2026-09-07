import { getPdfHighlightRects, normalizeDragRect, reconstructPdfPlainText, reconstructPdfRegionText } from './pdfSelection';

describe('PDF region text reconstruction', () => {
  test('preserves inferred word spacing, line breaks, and indentation', () => {
    const items = [
      { text: '첫째', left: 10, right: 30, top: 10, bottom: 20, width: 20, height: 10 },
      { text: '줄', left: 40, right: 50, top: 10, bottom: 20, width: 10, height: 10 },
      { text: '들여쓴', left: 30, right: 60, top: 30, bottom: 40, width: 30, height: 10 },
      { text: '줄', left: 70, right: 80, top: 30, bottom: 40, width: 10, height: 10 },
    ];
    const region = { left: 0, right: 100, top: 0, bottom: 100 };
    const text = reconstructPdfRegionText(items, region);
    expect(text).toBe('첫째 줄\n  들여쓴 줄');
    expect(reconstructPdfPlainText(items, region)).toBe('첫째 줄\n들여쓴 줄');
  });

  test('selects only intersecting items and normalizes reverse drags', () => {
    const rect = normalizeDragRect({ x: 80, y: 60 }, { x: 20, y: 10 }, { width: 100, height: 100 });
    expect(rect).toEqual({ left: 20, top: 10, right: 80, bottom: 60, width: 60, height: 50 });
    expect(reconstructPdfRegionText([
      { text: 'inside', left: 30, right: 50, top: 20, bottom: 30, width: 20, height: 10 },
      { text: 'outside', left: 81, right: 99, top: 20, bottom: 30, width: 18, height: 10 },
    ], rect)).toBe('inside');
  });

  test('clips highlight rectangles to actual text spans', () => {
    const rects = getPdfHighlightRects([
      { text: 'one', left: 10, right: 40, top: 10, bottom: 20 },
      { text: 'two', left: 10, right: 40, top: 30, bottom: 40 },
    ], { left: 20, right: 50, top: 0, bottom: 35 });
    expect(rects).toEqual([
      { left: 20, right: 40, top: 10, bottom: 20, width: 20, height: 10 },
      { left: 20, right: 40, top: 30, bottom: 35, width: 20, height: 5 },
    ]);
  });
});
