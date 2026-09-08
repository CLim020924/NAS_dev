const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createManagedPythonWorker } = require('../managedPythonWorker');
const { createManagedJavaScriptWorker } = require('../managedJavaScriptWorker');
const { createManagedNotebookTerminal } = require('../managedNotebookTerminal');
const { createManagedCodeSessionManager } = require('../managedCodeSession');

const enabled = process.env.NAS_TEST_CODE_RUNTIME === '1';
const packageSmokeEnabled = enabled && process.env.NAS_TEST_PYTHON_PACKAGES === '1';

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

test('real notebook terminal is writable only through its selected workspace', { skip: !enabled }, async () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-notebook-terminal-'));
  try {
    fs.mkdirSync(path.join(workspacePath, 'src'));
    const result = await createManagedNotebookTerminal().run({
      workspacePath,
      workingDirectory: 'src',
      command: "pwd; printf 'terminal-ok' > result.txt; cat result.txt",
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /^\/workspace\/src\nterminal-ok$/);
    assert.equal(fs.readFileSync(path.join(workspacePath, 'src', 'result.txt'), 'utf8'), 'terminal-ok');

    const networkResult = await createManagedNotebookTerminal().run({
      workspacePath,
      command: "python -c \"import socket; socket.create_connection(('1.1.1.1', 53), 1)\"",
    });
    assert.notEqual(networkResult.exitCode, 0, 'terminal container unexpectedly reached the network');
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
});

test('real interactive code session accepts stdin and remains owner-bound', { skip: !enabled }, async () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-code-session-workspace-'));
  let released = 0;
  try {
    const manager = createManagedCodeSessionManager({ timeoutMs: 8_000 });
    const started = await manager.start({
      ownerKey: 'owner-a', language: 'python', workspacePath,
      code: "name = input('Name: ')\nprint('Hello, ' + name)",
      cpuCores: 0.5, memoryBytes: 256 * 1024 * 1024, pids: 32,
      onFinish: () => { released += 1; },
    });
    assert.throws(() => manager.get({ ownerKey: 'owner-b', sessionId: started.sessionId }), (error) => error.code === 'CODE_SESSION_NOT_FOUND');
    let current = started;
    for (let attempt = 0; attempt < 40 && !current.events.map((event) => event.text).join('').includes('Name:'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      current = manager.get({ ownerKey: 'owner-a', sessionId: started.sessionId });
    }
    assert.match(current.events.map((event) => event.text).join(''), /Name:/);
    manager.input({ ownerKey: 'owner-a', sessionId: started.sessionId, text: 'NAS' });
    for (let attempt = 0; attempt < 80 && current.state === 'running'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      current = manager.get({ ownerKey: 'owner-a', sessionId: started.sessionId });
    }
    assert.equal(current.state, 'finished');
    assert.equal(current.exitCode, 0);
    assert.match(current.events.map((event) => event.text).join(''), /Hello, NAS/);
    assert.equal(released, 1);
  } finally {
    fs.rmSync(workspacePath, { recursive: true, force: true });
  }
});

test('curated Python packages import and compute inside the real sandbox', { skip: !packageSmokeEnabled }, async () => {
  const code = `
import io
import json
import bs4, dateutil, docx, httpx, lxml, matplotlib, numpy, openpyxl
import pandas, PIL, plotly, pypdf, pytz, regex, reportlab, requests
import scipy, seaborn, sklearn, sqlalchemy, statsmodels, sympy, tqdm, xlsxwriter, yaml
matplotlib.use('Agg')
from matplotlib import pyplot as plt
frame = pandas.DataFrame({'value': numpy.array([1, 2, 3])})
figure = plt.figure()
plt.plot(frame['value'])
output = io.BytesIO()
figure.savefig(output, format='png')
print(json.dumps({'sum': int(frame['value'].sum()), 'png': len(output.getvalue()) > 100}))
`;
  const result = await createManagedPythonWorker({ memoryBytes: 512 * 1024 * 1024 }).run({ code });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { sum: 6, png: true });
});
