const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildCodeSessionDockerArgs, runtimeFor, SANDBOX_UID } = require('../managedCodeSession');

test('interactive code session keeps stdin and mounts only code plus selected workspace', () => {
  const codeDirectory = path.resolve('/tmp/msp-code-session-test');
  const workspacePath = path.resolve('/mnt/nas/users/example/NOTE MANAGER/project');
  const args = buildCodeSessionDockerArgs({
    name: 'msp-code-session-test', runtime: runtimeFor('python', { python: 'python:test' }),
    codeDirectory, workspacePath, cpuCores: 0.75, memoryBytes: 512 * 1024 * 1024, pids: 64, timeoutSeconds: 120,
  });
  const joined = args.join(' ');
  assert.match(joined, /--network none/);
  assert.match(joined, /--read-only/);
  assert.match(joined, /--cap-drop ALL/);
  assert.match(joined, /--security-opt no-new-privileges/);
  assert.ok(args.includes(`${SANDBOX_UID}:${SANDBOX_UID}`));
  assert.ok(args.includes(`${codeDirectory}:/code:ro`));
  assert.ok(args.includes(`${workspacePath}:/workspace:rw`));
  assert.ok(args.includes('-i'));
  assert.deepEqual(args.slice(-7), ['timeout', '-s', 'KILL', '120', 'python', '-I', '-B', '-u', '/code/main.py'].slice(-7));
});

test('interactive session supports only prepared Python and JavaScript runtimes', () => {
  assert.equal(runtimeFor('javascript').fileName, 'main.js');
  assert.throws(() => runtimeFor('shell'), (error) => error.code === 'CODE_SESSION_LANGUAGE');
});
