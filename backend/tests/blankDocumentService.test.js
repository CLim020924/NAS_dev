const assert = require('assert');
const JSZip = require('jszip');
const { createBlankOfficeDocument } = require('../blankDocumentService');

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
  console.log('blank document service tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
