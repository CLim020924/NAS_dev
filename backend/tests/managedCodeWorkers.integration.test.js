const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagedPythonWorker } = require('../managedPythonWorker');
const { createManagedJavaScriptWorker } = require('../managedJavaScriptWorker');

const enabled = process.env.NAS_TEST_CODE_RUNTIME === '1';

test('real Python sandbox executes a one-shot program', { skip: !enabled }, async () => {
  const result = await createManagedPythonWorker().run({ code: 'print(6 * 7)' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), '42');
});

test('real JavaScript sandbox executes a one-shot program', { skip: !enabled }, async () => {
  const result = await createManagedJavaScriptWorker().run({ code: 'console.log(6 * 7)' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.trim(), '42');
});
