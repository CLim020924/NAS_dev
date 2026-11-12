const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const {
  inspectZip,
  extractZipToDirectory,
  normalizeEntryPath,
  isSymlinkEntry,
  defaultFolderName
} = require('../zipExtractionService');

test('normalizes portable ZIP entry paths and rejects traversal', () => {
  assert.equal(normalizeEntryPath('폴더\\문서.txt'), '폴더/문서.txt');
  assert.throws(() => normalizeEntryPath('../secret.txt'), /상위 폴더/);
  assert.throws(() => normalizeEntryPath('/etc/passwd'), /안전하지 않은 경로/);
  assert.throws(() => normalizeEntryPath('C:\\Windows\\win.ini'), /안전하지 않은 경로/);
});

test('detects Unix symbolic-link entries', () => {
  assert.equal(isSymlinkEntry({ externalFileAttributes: 0o120777 << 16 }), true);
  assert.equal(isSymlinkEntry({ externalFileAttributes: 0o100644 << 16 }), false);
});

test('derives a user-editable default folder name', () => {
  assert.equal(defaultFolderName('보고서 묶음.zip'), '보고서 묶음');
  assert.equal(defaultFolderName('.zip'), '압축 해제');
});

test('inspects and streams a ZIP into a new directory', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-zip-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const zipPath = path.join(root, 'sample.zip');
  const output = path.join(root, 'output');
  const zip = new JSZip();
  zip.file('문서/readme.txt', '안녕하세요');
  zip.file('empty.txt', '');
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

  const inspection = await inspectZip(zipPath);
  assert.equal(inspection.fileCount, 2);
  assert.equal(inspection.totalUncompressedBytes, Buffer.byteLength('안녕하세요'));
  assert.deepEqual(inspection.topLevelNames.sort(), ['empty.txt', '문서']);

  const result = await extractZipToDirectory(zipPath, output, inspection);
  assert.equal(result.writtenBytes, inspection.totalUncompressedBytes);
  assert.equal(fs.readFileSync(path.join(output, '문서', 'readme.txt'), 'utf8'), '안녕하세요');
  assert.equal(fs.readFileSync(path.join(output, 'empty.txt')).length, 0);
});

test('accepts an empty ZIP so an empty folder can round-trip', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-empty-zip-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const zipPath = path.join(root, 'empty.zip');
  const output = path.join(root, 'output');
  const zip = new JSZip();
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer' }));

  const inspection = await inspectZip(zipPath);
  assert.equal(inspection.entryCount, 0);
  const result = await extractZipToDirectory(zipPath, output, inspection);
  assert.equal(result.writtenBytes, 0);
  assert.equal(fs.statSync(output).isDirectory(), true);
});
