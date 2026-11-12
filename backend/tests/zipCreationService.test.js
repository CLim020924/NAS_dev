const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createZipFromDirectory } = require('../zipCreationService');
const { inspectZip, extractZipToDirectory } = require('../zipExtractionService');

test('streams a folder into a ZIP whose root contains the folder contents', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-zip-create-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, '성세실');
  const nested = path.join(source, '내부');
  const empty = path.join(source, '빈 폴더');
  const zipPath = path.join(root, '성세실.zip');
  const extracted = path.join(root, 'extracted');
  fs.mkdirSync(nested, { recursive: true });
  fs.mkdirSync(empty, { recursive: true });
  fs.writeFileSync(path.join(source, '안내.txt'), 'NAS Drive');
  fs.writeFileSync(path.join(nested, '문서.txt'), '한글 내용');

  const result = await createZipFromDirectory(source, zipPath);
  assert.equal(result.fileCount, 2);
  assert.equal(result.directoryCount, 2);
  assert.equal(result.sourceBytes, Buffer.byteLength('NAS Drive한글 내용'));
  assert.ok(result.zipBytes > 0);

  const inspection = await inspectZip(zipPath);
  assert.deepEqual(inspection.topLevelNames.sort(), ['내부', '빈 폴더', '안내.txt']);
  await extractZipToDirectory(zipPath, extracted, inspection);
  assert.equal(fs.readFileSync(path.join(extracted, '안내.txt'), 'utf8'), 'NAS Drive');
  assert.equal(fs.readFileSync(path.join(extracted, '내부', '문서.txt'), 'utf8'), '한글 내용');
  assert.equal(fs.statSync(path.join(extracted, '빈 폴더')).isDirectory(), true);
});

test('creates and inspects an empty ZIP for an empty folder', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-zip-empty-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'empty');
  const zipPath = path.join(root, 'empty.zip');
  fs.mkdirSync(source);

  const result = await createZipFromDirectory(source, zipPath);
  const inspection = await inspectZip(zipPath);
  assert.equal(result.entryCount, 0);
  assert.equal(inspection.entryCount, 0);
  assert.equal(inspection.totalUncompressedBytes, 0);
});

test('refuses symbolic links instead of following data outside the source folder', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-zip-link-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(root, 'outside.txt'), 'secret');
  try {
    fs.symlinkSync(path.join(root, 'outside.txt'), path.join(source, 'link.txt'));
  } catch (error) {
    t.skip(`이 환경에서는 심볼릭 링크를 만들 수 없습니다: ${error.code}`);
    return;
  }

  await assert.rejects(
    () => createZipFromDirectory(source, path.join(root, 'output.zip')),
    (error) => error.code === 'ZIP_SOURCE_SYMLINK'
  );
});
