'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SHARED_ROOT_NAME,
  normalizeRelativePath,
  shareVirtualBase,
  combineRevision,
  buildSharedManifestEntries,
  resolveSharedFile
} = require('../accountDriveShares');
const { assertRealPathInside } = require('../deviceSyncSecurity');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-account-share-'));
try {
  fs.mkdirSync(path.join(temp, 'docs'));
  fs.writeFileSync(path.join(temp, 'docs', 'report.txt'), 'shared data');
  const share = {
    shareId: 'ash_1234567890abcdef',
    sourceOwnerKey: 'owner-a',
    recipientOwnerKey: 'owner-b',
    sourceRelPath: 'docs',
    sourceItemName: 'docs',
    sourceDisplayName: '계정 A',
    createdAt: '2026-01-01T00:00:00.000Z'
  };
  assert.throws(() => normalizeRelativePath('../secret'), /잘못된/);
  assert.strictEqual(normalizeRelativePath('', { allowEmpty: true }), '');
  const entries = buildSharedManifestEntries(share, temp, root => [{ type: 'file', relPath: 'report.txt', size: 11, mtimeMs: 1 }]);
  const virtualFile = `${shareVirtualBase(share)}/docs/report.txt`;
  assert(entries.some(entry => entry.relPath === SHARED_ROOT_NAME && entry.type === 'folder'));
  assert(entries.some(entry => entry.relPath === virtualFile && entry.type === 'file'));
  const resolved = resolveSharedFile([share], 'owner-b', virtualFile, () => temp);
  assert.strictEqual(resolved.finalPath, path.join(temp, 'docs', 'report.txt'));
  assert.strictEqual(resolved.selectedRoot, path.join(temp, 'docs'));
  assert.throws(() => resolveSharedFile([share], 'owner-c', virtualFile, () => temp), /권한/);
  fs.mkdirSync(path.join(temp, 'private'));
  fs.writeFileSync(path.join(temp, 'private', 'secret.txt'), 'private data');
  try {
    fs.symlinkSync(path.join(temp, 'private'), path.join(temp, 'docs', 'internal-link'), 'dir');
    const escaped = resolveSharedFile([share], 'owner-b', `${shareVirtualBase(share)}/docs/internal-link/secret.txt`, () => temp);
    assert.throws(() => assertRealPathInside(escaped.selectedRoot, escaped.finalPath), /경계 밖/);
  } catch (error) {
    if (error?.code !== 'EPERM') throw error;
    console.log('Account share symlink scope test skipped: Windows Developer Mode or elevation is required');
  }
  assert.notStrictEqual(combineRevision('base', [share], () => 'r1'), combineRevision('base', [share], () => 'r2'));
  console.log('Account Drive share security tests passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
