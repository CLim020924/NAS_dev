'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  captureFileVersion,
  listFileVersions,
  restoreFileVersion,
  createDriveRestorePoint,
  listDriveRestorePoints,
  restoreDriveFromPoint,
  listActivity,
  listFavorites,
  setFavorite,
  listRecentFiles
} = require('../fileVersioning');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-versioning-'));

try {
  const documentPath = path.join(root, '문서.txt');
  fs.writeFileSync(documentPath, '첫 번째 내용', 'utf8');
  const first = captureFileVersion(root, documentPath, { source: 'test', actor: 'tester' });
  assert(first.versionId);

  const replacement = path.join(root, '.replacement');
  fs.writeFileSync(replacement, '두 번째 내용', 'utf8');
  fs.renameSync(replacement, documentPath);
  const second = captureFileVersion(root, documentPath, { source: 'test', actor: 'tester' });
  assert(second.versionId);
  assert.strictEqual(listFileVersions(root, documentPath).length, 2);

  restoreFileVersion(root, documentPath, first.versionId, { actor: 'tester' });
  assert.strictEqual(fs.readFileSync(documentPath, 'utf8'), '첫 번째 내용');
  assert.strictEqual(listFileVersions(root, documentPath).length, 3, '복원 직전 현재 파일도 버전으로 남아야 한다.');
  setFavorite(root, documentPath, true);
  assert.strictEqual(listFavorites(root)[0].fullPath, '/문서.txt');
  assert(listRecentFiles(root, 10).items.some((item) => item.fullPath === '/문서.txt'));
  setFavorite(root, documentPath, false);
  assert.strictEqual(listFavorites(root).length, 0);

  fs.mkdirSync(path.join(root, '폴더'), { recursive: true });
  fs.writeFileSync(path.join(root, '폴더', '기준.txt'), '복구 기준', 'utf8');
  const point = createDriveRestorePoint(root, { label: '테스트 지점', actor: 'tester' });
  assert(point.restorePointId);
  assert.strictEqual(listDriveRestorePoints(root).some((item) => item.restorePointId === point.restorePointId), true);

  const changed = path.join(root, '폴더', '.changed');
  fs.writeFileSync(changed, '변경됨', 'utf8');
  fs.renameSync(changed, path.join(root, '폴더', '기준.txt'));
  fs.writeFileSync(path.join(root, '복구후사라질파일.txt'), '새 파일', 'utf8');
  fs.rmSync(documentPath);

  const restored = restoreDriveFromPoint(root, point.restorePointId, { actor: 'tester' });
  assert.strictEqual(fs.readFileSync(path.join(root, '폴더', '기준.txt'), 'utf8'), '복구 기준');
  assert.strictEqual(fs.readFileSync(documentPath, 'utf8'), '첫 번째 내용');
  assert.strictEqual(fs.existsSync(path.join(root, '복구후사라질파일.txt')), false);
  assert(restored.safetyRestorePoint.restorePointId, '전체 복원 직전 안전 지점이 만들어져야 한다.');

  restoreDriveFromPoint(root, restored.safetyRestorePoint.restorePointId, { actor: 'tester' });
  assert.strictEqual(fs.readFileSync(path.join(root, '폴더', '기준.txt'), 'utf8'), '변경됨');
  assert.strictEqual(fs.existsSync(documentPath), false);
  assert.strictEqual(fs.readFileSync(path.join(root, '복구후사라질파일.txt'), 'utf8'), '새 파일');
  assert(listActivity(root, 20).some((entry) => entry.type === 'drive-restored'));

  console.log('file versioning tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
