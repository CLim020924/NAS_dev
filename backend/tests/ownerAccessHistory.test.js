'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { ownerForPath, externalEvent, assertRealOwnerPath } = require('../ownerAccessHistory');

test('identifies canonical account ownership and excludes the owner', () => {
  const root = path.resolve(os.tmpdir(), 'nas-owner-test');
  const members = [{ loginId: 'alice', userUid: 'uid-alice' }, { loginId: 'bob', userUid: 'uid-bob' }];
  const target = path.join(root, 'users', 'alice', 'folder', 'file.txt');
  assert.equal(ownerForPath(root, target, members).relativePath, '/folder/file.txt');
  assert.equal(externalEvent({ nasRoot: root, targetPath: target, members, actor: members[0], type: 'folder-opened' }), null);
  const event = externalEvent({ nasRoot: root, targetPath: target, members, actor: members[1], type: 'file-updated' });
  assert.equal(event.ownerUid, 'uid-alice');
  assert.equal(event.actorUid, 'uid-bob');
  assert.equal(event.restorable, false, 'history alone must not promise a recoverable pre-image');
  assert.equal(ownerForPath(root, path.join(root, 'users', 'alice-other'), members), null);
  assert.equal(ownerForPath(root, path.resolve(root, '..', 'outside'), members), null);
});

test('rejects a symlink that looks like an owner path but escapes the personal root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-owner-real-'));
  try {
    const personal = path.join(root, 'users', 'alice');
    const elsewhere = path.join(root, 'elsewhere');
    fs.mkdirSync(personal, { recursive: true });
    fs.mkdirSync(elsewhere);
    fs.symlinkSync(elsewhere, path.join(personal, 'link'), 'junction');
    assert.equal(assertRealOwnerPath(personal, path.join(personal, 'link')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
