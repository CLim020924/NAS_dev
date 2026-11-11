const assert = require('node:assert/strict');
const test = require('node:test');
const { parseMountInfo, getNasRootMountStatus, assertNasRootMounted } = require('../storageMountGuard');

const mountInfo = [
  '24 1 259:2 / / rw,relatime - ext4 /dev/nvme0n1p2 rw',
  '31 24 259:4 / /mnt/nas rw,relatime - ext4 /dev/nvme1n1p1 rw',
].join('\n');

test('parses and recognizes the dedicated NAS mount', () => {
  assert.equal(parseMountInfo(mountInfo)[1].source, '/dev/nvme1n1p1');
  const status = getNasRootMountStatus('/mnt/nas', { required: true, mountInfo });
  assert.equal(status.available, true);
  assert.equal(status.filesystem, 'ext4');
});

test('fails closed instead of treating the OS directory as NAS storage', () => {
  const status = getNasRootMountStatus('/mnt/nas', { required: true, mountInfo: mountInfo.split('\n')[0] });
  assert.equal(status.available, false);
  assert.throws(
    () => assertNasRootMounted('/mnt/nas', { required: true, mountInfo: mountInfo.split('\n')[0] }),
    (error) => error.code === 'NAS_STORAGE_UNAVAILABLE' && error.status === 503
  );
});
