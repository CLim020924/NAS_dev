const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createPdfOcrService, _test } = require('../pdfOcrService');

const createTextPdf = (targetPath, text) => {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 36 Tf 72 700 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  fs.writeFileSync(targetPath, pdf);
};

test('PDF OCR validates page geometry and selection bounds', () => {
  assert.deepEqual(_test.clampRect({ x: -0.1, y: 0.2, width: 0.5, height: 0.4 }), { x: 0, y: 0.2, width: 0.5, height: 0.4 });
  assert.throws(() => _test.clampRect({ x: 0, y: 0, width: 0, height: 1 }), (error) => error.code === 'PDF_OCR_BAD_REGION');
  assert.throws(() => _test.clampRect({ x: 2, y: 0, width: 0.5, height: 1 }), (error) => error.code === 'PDF_OCR_BAD_REGION');
  assert.deepEqual(_test.parsePdfInfo('Pages:          3\nPage    2 size: 612 x 792 pts\n', 2, 180), { pages: 3, widthPx: 1530, heightPx: 1980 });
  assert.throws(() => _test.parsePdfInfo('Pages: 1\nPage size: 612 x 792 pts\n', 2, 180), (error) => error.code === 'PDF_OCR_BAD_PAGE');
});

test('PDF OCR filters the selected visual region and returns layout and plain text', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '5\t1\t1\t1\t1\t1\t100\t100\t50\t20\t96\tAlpha',
    '5\t1\t1\t1\t1\t2\t170\t100\t40\t20\t95\tBeta',
    '5\t1\t1\t1\t2\t1\t130\t140\t80\t20\t94\tIndented',
    '5\t1\t1\t1\t3\t1\t800\t800\t50\t20\t90\tOutside',
  ].join('\n');
  const words = _test.parseTsvWords(tsv, { x: 0, y: 0, width: 0.5, height: 0.5 }, { widthPx: 1000, heightPx: 1000 });
  const result = _test.buildOcrText(words);
  assert.equal(result.layoutText, 'Alpha  Beta\n   Indented');
  assert.equal(result.plainText, 'Alpha Beta\nIndented');
  assert.equal(result.wordCount, 3);
});

test('PDF OCR runtime renders a page and recognizes visible text', { skip: process.env.NAS_TEST_PDF_OCR_RUNTIME !== '1', timeout: 60000 }, async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-pdf-ocr-test-'));
  const targetPath = path.join(tempDir, 'visible-text.pdf');
  try {
    createTextPdf(targetPath, 'HELLO OCR 123');
    const result = await createPdfOcrService().recognize({
      targetPath,
      page: 1,
      rect: { x: 0, y: 0, width: 1, height: 1 },
    });
    assert.match(result.plainText, /HELLO\s+OCR\s+123/i);
    assert.equal(result.engine, 'tesseract-kor-eng');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
