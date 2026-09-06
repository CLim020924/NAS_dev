const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDockerArgs } = require('../managedPythonWorker');

test('Python worker Docker arguments enforce the non-root offline sandbox', () => {
  const args = buildDockerArgs({ name: 'msp-python-test', image: 'python:test', cpuCores: 0.5, memoryBytes: 256 * 1024 * 1024, pids: 64 });
  const joined = args.join(' ');
  assert.match(joined, /--network none/);
  assert.match(joined, /--read-only/);
  assert.match(joined, /--cap-drop ALL/);
  assert.match(joined, /--security-opt no-new-privileges/);
  assert.match(joined, /--user 65534:65534/);
  assert.match(joined, /--memory 268435456 --memory-swap 268435456/);
  assert.match(joined, /--pids-limit 64/);
  assert.deepEqual(args.slice(-5), ['python:test', 'python', '-I', '-B', '-u', '-'].slice(-5));
});
