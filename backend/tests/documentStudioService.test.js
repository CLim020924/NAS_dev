const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getDocumentStudioCapabilities,
  getSharedOutputFormats,
  inspectSources,
  normalizeMode,
  normalizeOutputFormat,
  normalizeSourceFormat,
  sanitizeFileName,
  _test,
} = require('../documentStudioService');

test('document studio constrains modes and output file names', () => {
  assert.equal(normalizeMode('merge-pdf'), 'merge-pdf');
  assert.throws(() => normalizeMode('run-shell'));
  assert.equal(sanitizeFileName('../bad:name.pdf'), 'bad_name.pdf');
  const used = new Set();
  assert.equal(_test.uniqueResultName('보고서.docx', 'pdf', used), '보고서.pdf');
  assert.equal(_test.uniqueResultName('보고서.xlsx', 'pdf', used), '보고서 (2).pdf');
  assert.equal(normalizeSourceFormat('.PPTX'), 'pptx');
  assert.deepEqual(getSharedOutputFormats(['pptx', 'odp']), ['pdf', 'pptx', 'odp']);
  assert.deepEqual(getSharedOutputFormats(['pptx', 'docx']), ['pdf']);
  assert.throws(() => normalizeOutputFormat('docx', ['hwp']));
  assert.throws(() => normalizeOutputFormat('xlsx', ['docx']));
});

test('document studio accepts regular supported files and rejects links or unknown formats', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'document-studio-test-'));
  try {
    const pdf = path.join(root, 'one.pdf');
    const executable = path.join(root, 'bad.exe');
    fs.writeFileSync(pdf, '%PDF-test');
    fs.writeFileSync(executable, 'bad');
    assert.equal(inspectSources([{ path: pdf, name: 'one.pdf' }])[0].extension, '.pdf');
    assert.throws(() => inspectSources([{ path: executable, name: 'bad.exe' }]));
    if (process.platform !== 'win32') {
      const link = path.join(root, 'link.pdf');
      fs.symlinkSync(pdf, link);
      assert.throws(() => inspectSources([{ path: link, name: 'link.pdf' }]));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('document studio reports conversion capabilities without exposing command paths', () => {
  const capabilities = getDocumentStudioCapabilities();
  assert.equal(Array.isArray(capabilities.acceptedExtensions), true);
  assert.equal(capabilities.acceptedExtensions.includes('pdf'), true);
  assert.deepEqual(capabilities.formatMatrix.pptx, ['pdf', 'pptx', 'odp']);
  assert.deepEqual(capabilities.formatMatrix.hwp, []);
  assert.equal(capabilities.unavailableSourceFormats.includes('cell'), true);
  assert.equal(Object.values(capabilities).some((value) => typeof value === 'string' && value.includes('/usr/bin')), false);
});
