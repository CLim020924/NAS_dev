const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_DPI = 180;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_RENDER_PIXELS = 35 * 1024 * 1024;
const MAX_QUEUE = 4;

const serviceError = (message, status = 500, code = 'PDF_OCR_FAILED') => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

const clampRect = (value) => {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const width = Number(value?.width);
  const height = Number(value?.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw serviceError('인식할 PDF 영역이 올바르지 않습니다.', 400, 'PDF_OCR_BAD_REGION');
  }
  const left = Math.max(0, Math.min(1, x));
  const top = Math.max(0, Math.min(1, y));
  const normalized = {
    x: left,
    y: top,
    width: Math.max(0, Math.min(1 - left, width)),
    height: Math.max(0, Math.min(1 - top, height)),
  };
  if (normalized.width <= 0 || normalized.height <= 0) {
    throw serviceError('인식할 PDF 영역이 페이지 밖에 있습니다.', 400, 'PDF_OCR_BAD_REGION');
  }
  return normalized;
};

const parsePdfInfo = (text, page, dpi) => {
  const pages = Number(String(text).match(/^Pages:\s+(\d+)/m)?.[1] || 0);
  if (!Number.isInteger(page) || page < 1 || (pages && page > pages)) {
    throw serviceError('PDF 페이지 번호가 올바르지 않습니다.', 400, 'PDF_OCR_BAD_PAGE');
  }
  const pageSizePattern = new RegExp(`^Page\\s+${page}\\s+size:\\s+([\\d.]+)\\s+x\\s+([\\d.]+)\\s+pts`, 'm');
  const sizeMatch = String(text).match(pageSizePattern) || String(text).match(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/m);
  if (!sizeMatch) throw serviceError('PDF 페이지 크기를 확인하지 못했습니다.', 422, 'PDF_OCR_PAGE_SIZE');
  const widthPx = Math.ceil(Number(sizeMatch[1]) * dpi / 72);
  const heightPx = Math.ceil(Number(sizeMatch[2]) * dpi / 72);
  if (!widthPx || !heightPx || widthPx * heightPx > MAX_RENDER_PIXELS) {
    throw serviceError('이 PDF 페이지는 글자 인식 허용 크기를 초과합니다.', 413, 'PDF_OCR_PAGE_TOO_LARGE');
  }
  return { pages, widthPx, heightPx };
};

const parseTsvWords = (tsv, selection, pageSize) => {
  const bounds = {
    left: selection.x * pageSize.widthPx,
    top: selection.y * pageSize.heightPx,
    right: (selection.x + selection.width) * pageSize.widthPx,
    bottom: (selection.y + selection.height) * pageSize.heightPx,
  };
  return String(tsv).split(/\r?\n/).slice(1).map((line) => {
    const columns = line.split('\t');
    if (columns.length < 12 || Number(columns[0]) !== 5) return null;
    const left = Number(columns[6]);
    const top = Number(columns[7]);
    const width = Number(columns[8]);
    const height = Number(columns[9]);
    const text = columns.slice(11).join('\t').trim();
    const confidence = Number(columns[10]);
    if (!text || ![left, top, width, height].every(Number.isFinite) || confidence < 0) return null;
    const right = left + width;
    const bottom = top + height;
    if (!(left < bounds.right && right > bounds.left && top < bounds.bottom && bottom > bounds.top)) return null;
    return {
      block: Number(columns[2]), paragraph: Number(columns[3]), line: Number(columns[4]),
      left, top, right, bottom, width, height, text, confidence,
    };
  }).filter(Boolean);
};

const buildOcrText = (words) => {
  if (!words.length) return { layoutText: '', plainText: '', wordCount: 0 };
  const lines = new Map();
  words.forEach((word) => {
    const key = `${word.block}:${word.paragraph}:${word.line}`;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(word);
  });
  const orderedLines = Array.from(lines.values())
    .map((line) => line.sort((a, b) => a.left - b.left))
    .sort((a, b) => a[0].top - b[0].top || a[0].left - b[0].left);
  const characterWidths = words.map((word) => word.width / Math.max(1, Array.from(word.text).length)).filter((value) => value > 0).sort((a, b) => a - b);
  const charWidth = characterWidths[Math.floor(characterWidths.length / 2)] || 8;
  const baseLeft = Math.min(...orderedLines.map((line) => line[0].left));
  const layoutText = orderedLines.map((line) => {
    let result = ' '.repeat(Math.max(0, Math.round((line[0].left - baseLeft) / charWidth)));
    line.forEach((word, index) => {
      if (index > 0) {
        const gap = word.left - line[index - 1].right;
        result += ' '.repeat(Math.max(1, Math.round(gap / charWidth)));
      }
      result += word.text;
    });
    return result.trimEnd();
  }).join('\n');
  const plainText = orderedLines.map((line) => line.map((word) => word.text).join(' ')).join('\n');
  return { layoutText, plainText, wordCount: words.length };
};

const runProcess = (command, args, options) => new Promise((resolve) => {
  execFile(command, args, options, (error, stdout, stderr) => {
    resolve({ error, status: error ? error.code : 0, stdout, stderr });
  });
});

const runChecked = async (runner, command, args, options, missingMessage) => {
  const result = await runner(command, args, options);
  if (result.error?.code === 'ENOENT') throw serviceError(missingMessage, 503, 'PDF_OCR_UNAVAILABLE');
  if (result.error?.code === 'ETIMEDOUT' || result.error?.killed) throw serviceError('PDF 글자 인식 시간이 초과되었습니다.', 504, 'PDF_OCR_TIMEOUT');
  if (result.status !== 0) throw serviceError('PDF 글자 인식 도구가 문서를 처리하지 못했습니다.', 422, 'PDF_OCR_PROCESS_FAILED');
  return result;
};

const createPdfOcrService = ({ runner = runProcess, dpi = DEFAULT_DPI, maxQueue = MAX_QUEUE } = {}) => {
  let active = false;
  const queue = [];

  const execute = async ({ targetPath, page, rect }) => {
    const fileStat = fs.statSync(targetPath);
    if (!fileStat.isFile() || fileStat.size > MAX_PDF_BYTES) throw serviceError('PDF가 없거나 글자 인식 허용 크기를 초과합니다.', 413, 'PDF_OCR_FILE_TOO_LARGE');
    const selection = clampRect(rect);
    const pageNumber = Math.trunc(Number(page));
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-pdf-ocr-'));
    try {
      const info = await runChecked(runner, 'pdfinfo', ['-f', String(pageNumber), '-l', String(pageNumber), targetPath], { encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024 }, 'PDF 정보 도구가 설치되어 있지 않습니다.');
      const pageSize = parsePdfInfo(info.stdout, pageNumber, dpi);
      const outputPrefix = path.join(tempDir, 'page');
      await runChecked(runner, 'pdftoppm', ['-f', String(pageNumber), '-l', String(pageNumber), '-singlefile', '-r', String(dpi), '-png', targetPath, outputPrefix], { encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 }, 'PDF 렌더링 도구가 설치되어 있지 않습니다.');
      const imagePath = `${outputPrefix}.png`;
      if (!fs.existsSync(imagePath)) throw serviceError('PDF 페이지 이미지를 만들지 못했습니다.', 422, 'PDF_OCR_RENDER_FAILED');
      const ocr = await runChecked(runner, 'tesseract', [imagePath, 'stdout', '-l', 'kor+eng', '--psm', '6', 'tsv'], { encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024 }, '서버에 PDF 글자 인식기가 준비되지 않았습니다.');
      return { ...buildOcrText(parseTsvWords(ocr.stdout, selection, pageSize)), engine: 'tesseract-kor-eng' };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };

  const drain = () => {
    if (active || !queue.length) return;
    active = true;
    const item = queue.shift();
    Promise.resolve()
      .then(() => execute(item.request))
      .then(item.resolve, item.reject)
      .finally(() => { active = false; drain(); });
  };

  const recognize = (request) => new Promise((resolve, reject) => {
    if (queue.length >= maxQueue) {
      reject(serviceError('PDF 글자 인식 대기 작업이 많습니다. 잠시 뒤 다시 시도해 주세요.', 429, 'PDF_OCR_QUEUE_FULL'));
      return;
    }
    queue.push({ request, resolve, reject });
    drain();
  });

  return { recognize, getQueueState: () => ({ active, queued: queue.length }) };
};

module.exports = {
  createPdfOcrService,
  _test: { clampRect, parsePdfInfo, parseTsvWords, buildOcrText },
};
