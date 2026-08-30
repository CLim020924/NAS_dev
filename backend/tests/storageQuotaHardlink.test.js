'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _test } = require('../storageQuota');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-quota-hardlink-'));
try {
  const original = path.join(root, 'original.bin');
  fs.writeFileSync(original, Buffer.alloc(4096, 7));
  fs.mkdirSync(path.join(root, '.agent_versions', 'one'), { recursive: true });
  fs.linkSync(original, path.join(root, '.agent_versions', 'one', 'content'));
  fs.linkSync(original, path.join(root, '.agent_versions', 'one', 'second-link'));
  assert.strictEqual(_test.countPathSize(root), 4096, '같은 inode의 버전 하드링크는 quota에서 한 번만 계산해야 한다.');
  console.log('storage quota hardlink tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
