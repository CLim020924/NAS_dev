const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { NAS_ROOT } = require('../storageQuota');
const { getChatReceivedPaths } = require('../chatReceivedPaths');

test('regular users save and open received files relative to their personal root', () => {
  const paths = getChatReceivedPaths({ loginId: 'ohajun', role: 'USER' });
  assert.equal(paths.accessRoot, path.join(NAS_ROOT, 'users', 'ohajun'));
  assert.equal(paths.receivedDir, path.join(NAS_ROOT, 'users', 'ohajun', '받은 파일'));
  assert.equal(paths.requestRoot, '/받은 파일');
  assert.equal(path.resolve(paths.accessRoot, '.' + paths.requestRoot), paths.receivedDir);
});

for (const role of ['MASTER', 'MANAGER']) {
  test(`${role} saves to personal storage but opens through NAS-root browsing`, () => {
    const paths = getChatReceivedPaths({ loginId: 'dntdlzz', role });
    assert.equal(paths.accessRoot, NAS_ROOT);
    assert.equal(paths.receivedDir, path.join(NAS_ROOT, 'users', 'dntdlzz', '받은 파일'));
    assert.equal(paths.requestRoot, '/users/dntdlzz/받은 파일');
    assert.equal(path.resolve(paths.accessRoot, '.' + paths.requestRoot), paths.receivedDir);
  });
}
