const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { replacePptxTemplate, mergePptxFiles } = require('../pptxPackageService');

const makeDeck = async (target, text) => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
  zip.file('ppt/presentation.xml', '<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>');
  zip.file('ppt/_rels/presentation.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>');
  zip.file('ppt/slides/slide1.xml', `<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>${text}</a:t></p:sld>`);
  await fs.writeFile(target, await zip.generateAsync({ type: 'nodebuffer' }));
};

test('PPTX template replacement preserves the package and replaces placeholders', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-template-'));
  try {
    const source = path.join(root, 'source.pptx');
    const output = path.join(root, 'output.pptx');
    await makeDeck(source, '{이름} 님');
    const result = await replacePptxTemplate(source, output, { 이름: '홍길동' });
    const zip = await JSZip.loadAsync(await fs.readFile(output));
    assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /홍길동 님/);
    assert.equal(result.replacementsApplied, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('template replacement handles placeholders split across styled text runs', async () => {
  const { replaceAcrossTextRuns } = require('../pptxPackageService')._test;
  const result = replaceAcrossTextRuns('<a:t>{이</a:t><a:t>름}</a:t><a:t> 님</a:t>', { '{이름}': '홍길동' });
  assert.equal(result.replacementsApplied, 1);
  assert.equal(result.xml, '<a:t>홍길동</a:t><a:t></a:t><a:t> 님</a:t>');
});

test('PPTX merge appends slides in source order', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pptx-merge-'));
  try {
    const first = path.join(root, 'first.pptx');
    const second = path.join(root, 'second.pptx');
    const output = path.join(root, 'merged.pptx');
    await makeDeck(first, '첫째');
    await makeDeck(second, '둘째');
    await mergePptxFiles([first, second], output);
    const zip = await JSZip.loadAsync(await fs.readFile(output));
    assert.match(await zip.file('ppt/slides/slide1.xml').async('string'), /첫째/);
    assert.match(await zip.file('ppt/slides/slide2.xml').async('string'), /둘째/);
    assert.equal((await zip.file('ppt/presentation.xml').async('string')).match(/<p:sldId\b/g).length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
