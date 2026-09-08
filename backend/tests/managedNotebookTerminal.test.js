const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { buildDockerArgs, normalizeTerminalRelativePath, resolveTerminalDirectory } = require('../managedNotebookTerminal');

test('notebook terminal Docker arguments expose only one bounded notebook workspace', () => {
  const workspacePath = path.resolve('/srv/users/example/NOTE MANAGER/개발 노트');
  const args = buildDockerArgs({
    name: 'msp-terminal-test', workspacePath, workingDirectory: 'src/tools',
    command: 'pwd && ls', image: 'python:test', uid: 1001, gid: 1002,
  });
  const joined = args.join(' ');
  assert.match(joined, /--network none/);
  assert.match(joined, /--read-only/);
  assert.match(joined, /--cap-drop ALL/);
  assert.match(joined, /--security-opt no-new-privileges/);
  assert.match(joined, /--memory 268435456 --memory-swap 268435456/);
  assert.match(joined, /--pids-limit 64/);
  assert.ok(args.includes('1001:1002'));
  assert.ok(args.includes(`${workspacePath}:/workspace:rw`));
  assert.ok(args.includes('/workspace/src/tools'));
  assert.deepEqual(args.slice(-4), ['python:test', 'sh', '-lc', 'pwd && ls']);
  assert.equal(args.filter((value) => String(value).endsWith(':/workspace:rw')).length, 1);
});

test('terminal paths remain inside the selected notebook', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-terminal-path-'));
  try {
    fs.mkdirSync(path.join(root, 'src', 'tools'), { recursive: true });
    assert.equal(normalizeTerminalRelativePath('/workspace/src/tools'), 'src/tools');
    assert.equal(resolveTerminalDirectory(root, 'src/tools'), 'src/tools');
    assert.throws(() => normalizeTerminalRelativePath('../../outside'), (error) => error.code === 'TERMINAL_PATH_ESCAPE');
    assert.throws(() => resolveTerminalDirectory(root, 'missing'), (error) => error.code === 'TERMINAL_DIRECTORY_MISSING');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
