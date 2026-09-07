const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const storeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-view-state-store-'));
process.env.WORKSPACE_VIEW_STATE_ROOT = storeRoot;
const store = require('../workspaceViewStateStore');

test('workspace view state rejects credentials and oversized structures', () => {
  assert.throws(() => store._test.normalizeState({ accessToken: 'no' }), (error) => error.code === 'VIEW_STATE_INVALID');
  assert.throws(() => store._test.normalizeState({ values: Array.from({ length: 100 }, () => 'x'.repeat(1000)) }), (error) => error.code === 'VIEW_STATE_TOO_LARGE');
  assert.deepEqual(store._test.normalizeState({ page: 2, zoom: 1.15, selection: { anchor: 4, head: 8 } }), { page: 2, zoom: 1.15, selection: { anchor: 4, head: 8 } });
});

test('filesystem identity comparison follows a renamed resource', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'view-state-'));
  try {
    const first = path.join(dir, 'a.txt');
    const second = path.join(dir, 'b.txt');
    fs.writeFileSync(first, 'state');
    const before = fs.statSync(first);
    fs.renameSync(first, second);
    const after = fs.statSync(second);
    assert.equal(store._test.sameIdentity({ dev: before.dev, ino: before.ino, birthtimeMs: Math.round(before.birthtimeMs) }, { dev: after.dev, ino: after.ino, birthtimeMs: Math.round(after.birthtimeMs) }), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('device state wins locally and the latest account state is the cross-device fallback', () => {
  const base = { accountKey: 'account-a', resourceKey: 'file:notes/a.txt', kind: 'monaco', identity: null };
  store.saveWorkspaceViewState({ ...base, deviceId: 'device-one', state: { line: 3 } });
  store.saveWorkspaceViewState({ ...base, deviceId: 'device-two', state: { line: 8 } });
  assert.equal(store.loadWorkspaceViewState({ ...base, deviceId: 'device-one' }).state.line, 3);
  const fallback = store.loadWorkspaceViewState({ ...base, deviceId: 'device-three' });
  assert.equal(fallback.state.line, 8);
  assert.equal(fallback.source, 'account');
  assert.equal(store.loadWorkspaceViewState({ ...base, accountKey: 'account-b', deviceId: 'device-one' }), null);
});

test.after(() => fs.rmSync(storeRoot, { recursive: true, force: true }));
