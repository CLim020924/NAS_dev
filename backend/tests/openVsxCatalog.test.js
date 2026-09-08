const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenVsxCatalog, normalizeExtensionId, normalizeQuery } = require('../openVsxCatalog');

test('normalizes only safe Open VSX extension identifiers and queries', () => {
  assert.equal(normalizeExtensionId('MS-Python.Python'), 'ms-python.python');
  assert.equal(normalizeQuery('  python   tools  '), 'python tools');
  assert.throws(() => normalizeExtensionId('../bad'), (error) => error.code === 'INVALID_EXTENSION_ID');
  assert.throws(() => normalizeQuery('x'), (error) => error.code === 'INVALID_EXTENSION_QUERY');
});

test('search bounds results, sanitizes URLs and uses a short-lived cache', async () => {
  let calls = 0;
  let clock = 1000;
  const http = { get: async () => {
    calls += 1;
    return { data: { totalSize: 1, extensions: [{ namespace: 'safe', name: 'tool', displayName: 'Tool', version: '1.0.0', files: { icon: 'javascript:alert(1)' }, downloadCount: 42 }] } };
  } };
  const catalog = createOpenVsxCatalog({ http, now: () => clock });
  const first = await catalog.search('tool', 1000);
  const second = await catalog.search('tool', 1000);
  assert.equal(first.extensions[0].id, 'safe.tool');
  assert.equal(first.extensions[0].iconUrl, '');
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
  clock += 6 * 60 * 1000;
  await catalog.search('tool', 1000);
  assert.equal(calls, 2);
});

test('detail reports web compatibility without claiming NAS execution support', async () => {
  const http = { get: async () => ({ data: { namespace: 'safe', name: 'web-tool', displayName: 'Web Tool', version: '2.0.0', extensionKind: ['workspace', 'web'], tags: ['__web_extension'], license: 'MIT' } }) };
  const extension = await createOpenVsxCatalog({ http }).detail('safe.web-tool');
  assert.equal(extension.webCompatible, true);
  assert.equal(extension.nasCompatibility, 'adapter-required');
  assert.deepEqual(extension.extensionKind, ['workspace', 'web']);
});
