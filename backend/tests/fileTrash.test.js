'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
const router = require('../nasRoutes');
const {
  moveToUserTrash,
  readUserTrashItem,
  restoreUserTrashItem,
  cleanupExpiredUserTrash
} = router.__testHooks;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-trash-test-'));
try {
  const original = path.join(root, 'sample.txt');
  fs.writeFileSync(original, 'recoverable-content', 'utf8');
  const moved = moveToUserTrash(root, original, '/sample.txt');
  assert.ok(!fs.existsSync(original));
  const item = readUserTrashItem(root, moved.trashId);
  assert.strictEqual(fs.readFileSync(item.contentPath, 'utf8'), 'recoverable-content');

  fs.writeFileSync(original, 'new-content', 'utf8');
  const restored = restoreUserTrashItem(root, moved.trashId);
  assert.notStrictEqual(restored, original);
  assert.strictEqual(fs.readFileSync(restored, 'utf8'), 'recoverable-content');
  assert.strictEqual(fs.readFileSync(original, 'utf8'), 'new-content');

  const expiredSource = path.join(root, 'expired.txt');
  fs.writeFileSync(expiredSource, 'expired', 'utf8');
  const expired = moveToUserTrash(root, expiredSource, '/expired.txt');
  const expiredItem = readUserTrashItem(root, expired.trashId);
  const expiredMetaPath = path.join(expiredItem.itemRoot, 'meta.json');
  const expiredMeta = JSON.parse(fs.readFileSync(expiredMetaPath, 'utf8'));
  expiredMeta.deletedAt = '2000-01-01T00:00:00.000Z';
  fs.writeFileSync(expiredMetaPath, JSON.stringify(expiredMeta), 'utf8');
  cleanupExpiredUserTrash(root);
  assert.ok(!fs.existsSync(expiredItem.itemRoot));
  console.log('file trash tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
