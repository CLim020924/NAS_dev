const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');
const { createBlankOfficeDocument, createBlankRhwpDocument } = require('../blankDocumentService');

const expectedParts = {
  docx: ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'],
  xlsx: ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'],
  pptx: ['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml']
};

(async () => {
  for (const [format, parts] of Object.entries(expectedParts)) {
    const bytes = await createBlankOfficeDocument(format);
    assert(Buffer.isBuffer(bytes) && bytes.length > 250, `${format} should be a non-empty buffer`);
    const zip = await JSZip.loadAsync(bytes);
    for (const part of parts) assert(zip.file(part), `${format} is missing ${part}`);
  }

  await assert.rejects(() => createBlankOfficeDocument('exe'), /지원하지 않는/);

  const hwpxBytes = createBlankRhwpDocument('hwpx');
  assert(Buffer.isBuffer(hwpxBytes) && hwpxBytes.length > 1000, 'hwpx should use a non-empty template');
  const hwpx = await JSZip.loadAsync(hwpxBytes);
  const header = await hwpx.file('Contents/header.xml').async('string');
  const section = await hwpx.file('Contents/section0.xml').async('string');
  assert(/<hh:charProperties\b[^>]*itemCnt="[1-9]/.test(header), 'hwpx template must register char properties');
  assert(/charPrIDRef="0"/.test(section), 'hwpx template must include the initial character style reference');

  const coreDir = path.join(__dirname, '..', '..', 'frontend', 'node_modules', '@rhwp', 'core');
  const rhwp = await import(pathToFileURL(path.join(coreDir, 'rhwp.js')).href);
  globalThis.measureTextWidth = globalThis.measureTextWidth || ((font, text) => String(text || '').length * 10);
  await rhwp.default({ module_or_path: fs.readFileSync(path.join(coreDir, 'rhwp_bg.wasm')) });
  const parsedBlank = new rhwp.HwpDocument(new Uint8Array(hwpxBytes));
  const roundTrip = parsedBlank.exportHwpx();
  assert(roundTrip.length > 1000, 'blank hwpx must survive an immediate Ctrl+S-style export');
  assert.strictEqual(new rhwp.HwpDocument(roundTrip).pageCount(), 1, 'round-tripped blank hwpx must reopen');

  const fakeHwp = { createEmpty: () => ({ exportHwp: () => Uint8Array.from([1, 2, 3]) }) };
  assert.deepStrictEqual(createBlankRhwpDocument('hwp', fakeHwp), Buffer.from([1, 2, 3]));
  assert.throws(() => createBlankRhwpDocument('txt', fakeHwp), /지원하지 않는/);
  console.log('blank document service tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
