const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDockerArgs } = require('../managedJavaScriptWorker');

test('JavaScript worker Docker arguments enforce the non-root offline sandbox', () => {
  const args = buildDockerArgs({ name: 'msp-javascript-test', image: 'node:test', cpuCores: 0.5, memoryBytes: 256 * 1024 * 1024, pids: 64 });
  const joined = args.join(' ');
  assert.match(joined, /--network none/);
  assert.match(joined, /--read-only/);
  assert.match(joined, /--cap-drop ALL/);
  assert.match(joined, /--security-opt no-new-privileges/);
  assert.match(joined, /--user 65534:65534/);
  assert.match(joined, /--memory 268435456 --memory-swap 268435456/);
  assert.match(joined, /--pids-limit 64/);
  assert.deepEqual(args.slice(-4), ['node:test', 'node', '--input-type=commonjs', '-']);
});
