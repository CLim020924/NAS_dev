const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DEFAULT_IMAGE, PACKAGES, getPythonRuntimeCatalog } = require('../pythonRuntimeCatalog');

test('Python runtime catalog matches every pinned direct package', () => {
  const requirements = fs.readFileSync(path.join(__dirname, '..', 'python-runtime', 'requirements.lock'), 'utf8')
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(requirements, PACKAGES.map((item) => `${item.name}==${item.version}`));
  assert.match(DEFAULT_IMAGE, /^msp-python-runtime:\d{4}\.\d{2}\.\d{2}-\d+$/);
});

test('Python runtime remains offline and does not claim external installs are enabled', () => {
  const catalog = getPythonRuntimeCatalog();
  assert.equal(catalog.packageCount, 25);
  assert.equal(catalog.execution.network, 'none');
  assert.equal(catalog.execution.packageInstallDuringRun, false);
  assert.equal(catalog.externalPackages.status, 'designed-not-enabled');
});
