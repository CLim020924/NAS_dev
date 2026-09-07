const intersects = (a, b) => (
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
);

const median = (values) => {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return 7;
  return sorted[Math.floor(sorted.length / 2)];
};

export const reconstructPdfRegionText = (items = [], selectionRect) => {
  const selected = items
    .filter((item) => String(item.text || '').trim() && intersects(item, selectionRect))
    .map((item) => ({ ...item, text: String(item.text) }))
    .sort((a, b) => a.top - b.top || a.left - b.left);
  if (!selected.length) return '';

  const charWidth = median(selected.map((item) => item.width / Math.max(1, item.text.length)));
  const lines = [];
  selected.forEach((item) => {
    const tolerance = Math.max(3, item.height * 0.55);
    const line = lines.find((candidate) => Math.abs(candidate.top - item.top) <= tolerance);
    if (line) {
      line.items.push(item);
      line.top = (line.top + item.top) / 2;
    } else {
      lines.push({ top: item.top, items: [item] });
    }
  });
  lines.sort((a, b) => a.top - b.top);

  const baseLeft = Math.min(...lines.map((line) => Math.min(...line.items.map((item) => item.left))));
  return lines.map((line) => {
    const ordered = line.items.sort((a, b) => a.left - b.left);
    const indent = Math.max(0, Math.round((ordered[0].left - baseLeft) / charWidth));
    let text = ' '.repeat(indent);
    ordered.forEach((item, index) => {
      if (index > 0) {
        const previous = ordered[index - 1];
        const gap = item.left - previous.right;
        if (gap > charWidth * 0.2) text += ' '.repeat(Math.max(1, Math.round(gap / charWidth)));
      }
      text += item.text;
    });
    return text.replace(/[ \t]+$/g, '');
  }).join('\n');
};

export const collectPdfTextItems = (pageElement) => {
  if (!pageElement) return [];
  const pageRect = pageElement.getBoundingClientRect();
  return Array.from(pageElement.querySelectorAll('.react-pdf__Page__textContent span')).map((span) => {
    const rect = span.getBoundingClientRect();
    return {
      text: span.textContent || '',
      left: rect.left - pageRect.left,
      right: rect.right - pageRect.left,
      top: rect.top - pageRect.top,
      bottom: rect.bottom - pageRect.top,
      width: rect.width,
      height: rect.height,
    };
  });
};

export const getPdfHighlightRects = (items = [], selectionRect) => items
  .filter((item) => String(item.text || '').trim() && intersects(item, selectionRect))
  .map((item) => ({
    left: Math.max(selectionRect.left, item.left),
    top: Math.max(selectionRect.top, item.top),
    right: Math.min(selectionRect.right, item.right),
    bottom: Math.min(selectionRect.bottom, item.bottom),
  }))
  .map((rect) => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }))
  .filter((rect) => rect.width > 1 && rect.height > 1);

export const normalizeDragRect = (start, end, bounds) => {
  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(bounds.width, Math.max(start.x, end.x));
  const bottom = Math.min(bounds.height, Math.max(start.y, end.y));
  return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
};
