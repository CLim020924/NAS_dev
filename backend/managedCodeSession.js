const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { DEFAULT_IMAGE: DEFAULT_PYTHON_IMAGE } = require('./pythonRuntimeCatalog');

const DEFAULT_JAVASCRIPT_IMAGE = 'node:22-alpine';
const SANDBOX_UID = 65532;
const MAX_CODE_BYTES = 128 * 1024;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const SESSION_TIMEOUT_MS = 120_000;
const RESULT_RETENTION_MS = 10 * 60_000;

const JSON_RUNNER = `'use strict';
const fs = require('fs');
try {
  const value = JSON.parse(fs.readFileSync('/code/input.json', 'utf8'));
  process.stdout.write(JSON.stringify(value, null, 2) + '\\n');
} catch (error) {
  console.error('JSON validation failed: ' + error.message);
  process.exitCode = 1;
}`;

const YAML_RUNNER = `import pathlib, sys, yaml
try:
    value = yaml.safe_load(pathlib.Path('/code/input.yaml').read_text(encoding='utf-8'))
    print(yaml.safe_dump(value, allow_unicode=True, sort_keys=False), end='')
except Exception as exc:
    print(f'YAML validation failed: {exc}', file=sys.stderr)
    raise SystemExit(1)
`;

const SQL_RUNNER = `import pathlib, sqlite3, sys
source = pathlib.Path('/code/query.sql').read_text(encoding='utf-8')
connection = sqlite3.connect(':memory:')
buffer = ''
try:
    for line in source.splitlines(True):
        buffer += line
        if not sqlite3.complete_statement(buffer):
            continue
        statement, buffer = buffer.strip(), ''
        if not statement:
            continue
        cursor = connection.execute(statement)
        if cursor.description:
            print('\\t'.join(column[0] for column in cursor.description))
            for row in cursor.fetchall():
                print('\\t'.join('NULL' if value is None else str(value) for value in row))
    if buffer.strip():
        connection.execute(buffer)
    connection.commit()
except Exception as exc:
    print(f'SQL execution failed: {exc}', file=sys.stderr)
    raise SystemExit(1)
finally:
    connection.close()
`;

const runtimeFor = (language, images = {}) => {
  if (language === 'python') return {
    image: images.python || process.env.MSP_PYTHON_IMAGE || DEFAULT_PYTHON_IMAGE,
    fileName: 'main.py',
    command: ['python', '-I', '-B', '-u', '/code/main.py'],
  };
  if (language === 'javascript') return {
    image: images.javascript || process.env.MSP_JAVASCRIPT_IMAGE || DEFAULT_JAVASCRIPT_IMAGE,
    fileName: 'main.js',
    command: ['node', '/code/main.js'],
  };
  if (language === 'typescript') return {
    image: images.javascript || process.env.MSP_JAVASCRIPT_IMAGE || DEFAULT_JAVASCRIPT_IMAGE,
    fileName: 'main.ts',
    command: ['node', '--experimental-strip-types', '/code/main.ts'],
  };
  if (language === 'shell') return {
    image: images.python || process.env.MSP_PYTHON_IMAGE || DEFAULT_PYTHON_IMAGE,
    fileName: 'main.sh',
    command: ['sh', '-eu', '/code/main.sh'],
  };
  if (language === 'json') return {
    image: images.javascript || process.env.MSP_JAVASCRIPT_IMAGE || DEFAULT_JAVASCRIPT_IMAGE,
    fileName: 'input.json', companionFiles: { 'runner.js': JSON_RUNNER },
    command: ['node', '/code/runner.js'],
  };
  if (language === 'yaml') return {
    image: images.python || process.env.MSP_PYTHON_IMAGE || DEFAULT_PYTHON_IMAGE,
    fileName: 'input.yaml', companionFiles: { 'runner.py': YAML_RUNNER },
    command: ['python', '-I', '-B', '-u', '/code/runner.py'],
  };
  if (language === 'sql') return {
    image: images.python || process.env.MSP_PYTHON_IMAGE || DEFAULT_PYTHON_IMAGE,
    fileName: 'query.sql', companionFiles: { 'runner.py': SQL_RUNNER },
    command: ['python', '-I', '-B', '-u', '/code/runner.py'],
  };
  throw Object.assign(new Error('대화형 실행을 지원하지 않는 언어입니다.'), { status: 400, code: 'CODE_SESSION_LANGUAGE' });
};

const buildCodeSessionDockerArgs = ({ name, runtime, codeDirectory, workspacePath, cpuCores, memoryBytes, pids, timeoutSeconds }) => [
  'run', '--rm', '--name', name,
  '--network', 'none',
  '--cpus', String(cpuCores),
  '--memory', String(memoryBytes), '--memory-swap', String(memoryBytes),
  '--pids-limit', String(pids),
  '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
  '--env', 'HOME=/tmp', '--env', 'PYTHONUNBUFFERED=1',
  '--user', `${SANDBOX_UID}:${SANDBOX_UID}`,
  '--volume', `${path.resolve(codeDirectory)}:/code:ro`,
  '--volume', `${path.resolve(workspacePath)}:/workspace:rw`,
  '--workdir', '/workspace', '-i', runtime.image,
  'timeout', '-s', 'KILL', String(timeoutSeconds), ...runtime.command,
];

const createManagedCodeSessionManager = ({
  dockerPath = '/usr/bin/docker',
  setfaclPath = '/usr/bin/setfacl',
  spawnImpl = spawn,
  execFileImpl = execFile,
  images = {},
  timeoutMs = SESSION_TIMEOUT_MS,
} = {}) => {
  const sessions = new Map();
  const available = () => fs.existsSync(dockerPath) && fs.existsSync(setfaclPath);
  const runFile = (file, args, options = {}) => new Promise((resolve, reject) => {
    execFileImpl(file, args, { windowsHide: true, timeout: 10_000, ...options }, (error) => error ? reject(error) : resolve());
  });
  const removeContainer = (name) => runFile(dockerPath, ['rm', '-f', name]).catch(() => {});
  const removeCodeDirectory = (directory) => {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch {}
  };
  const assertOwner = (session, ownerKey) => {
    if (!session || session.ownerKey !== ownerKey) throw Object.assign(new Error('실행 세션을 찾을 수 없습니다.'), { status: 404, code: 'CODE_SESSION_NOT_FOUND' });
  };
  const snapshot = (session, cursor = 0) => ({
    sessionId: session.id,
    language: session.language,
    state: session.state,
    exitCode: session.exitCode,
    signal: session.signal,
    startedAt: session.startedAt,
    finishedAt: session.finishedAt,
    durationMs: (session.finishedAt ? new Date(session.finishedAt).getTime() : Date.now()) - new Date(session.startedAt).getTime(),
    events: session.events.filter((event) => event.sequence > cursor),
    cursor: session.sequence,
    limit: { timeoutSeconds: Math.round(timeoutMs / 1000), outputKiB: MAX_OUTPUT_BYTES / 1024, inputKiB: MAX_INPUT_BYTES / 1024 },
  });
  const appendEvent = (session, stream, chunk) => {
    if (session.state !== 'running') return;
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
    session.outputBytes += Buffer.byteLength(text, 'utf8');
    if (session.outputBytes > MAX_OUTPUT_BYTES) {
      session.events.push({ sequence: ++session.sequence, stream: 'system', text: '\n[출력이 256KB를 넘어 실행을 중단했습니다.]\n' });
      session.child.kill('SIGKILL');
      removeContainer(session.containerName);
      return;
    }
    session.events.push({ sequence: ++session.sequence, stream, text });
    if (session.events.length > 1024) session.events.splice(0, session.events.length - 1024);
  };
  const finish = (session, { exitCode = null, signal = null, state = 'finished' } = {}) => {
    if (session.state !== 'running') return;
    session.state = state;
    session.exitCode = Number.isInteger(exitCode) ? exitCode : null;
    session.signal = signal || null;
    session.finishedAt = new Date().toISOString();
    clearTimeout(session.timer);
    removeCodeDirectory(session.codeDirectory);
    try { session.onFinish?.(); } catch {}
    session.onFinish = null;
  };

  const start = async ({ ownerKey, language, code, workspacePath, cpuCores, memoryBytes, pids = 64, onFinish } = {}) => {
    if (!available()) throw Object.assign(new Error('대화형 격리 실행기가 준비되지 않았습니다.'), { status: 503, code: 'CODE_SESSION_UNAVAILABLE' });
    const source = String(code ?? '');
    if (!source.trim()) throw Object.assign(new Error('실행할 코드가 없습니다.'), { status: 400, code: 'CODE_SESSION_EMPTY' });
    if (Buffer.byteLength(source, 'utf8') > MAX_CODE_BYTES) throw Object.assign(new Error('한 번에 실행할 수 있는 코드는 128KB까지입니다.'), { status: 413, code: 'CODE_SESSION_CODE_LIMIT' });
    const workspace = fs.realpathSync(workspacePath);
    if (!fs.statSync(workspace).isDirectory()) throw Object.assign(new Error('노트북 작업 경로를 찾을 수 없습니다.'), { status: 409, code: 'CODE_SESSION_WORKSPACE' });
    const runtime = runtimeFor(language, images);
    await runFile(setfaclPath, ['-R', '-m', `u:${SANDBOX_UID}:rwX`, workspace]).catch(() => {
      throw Object.assign(new Error('노트북 실행 권한을 안전하게 준비하지 못했습니다.'), { status: 503, code: 'CODE_SESSION_ACL' });
    });
    const codeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-code-session-'));
    fs.chmodSync(codeDirectory, 0o755);
    fs.writeFileSync(path.join(codeDirectory, runtime.fileName), source, { mode: 0o644, flag: 'wx' });
    for (const [fileName, contents] of Object.entries(runtime.companionFiles || {})) {
      fs.writeFileSync(path.join(codeDirectory, fileName), contents, { mode: 0o644, flag: 'wx' });
    }
    const id = crypto.randomUUID();
    const containerName = `msp-code-session-${id.replace(/-/g, '')}`;
    const session = {
      id, ownerKey, language, containerName, codeDirectory, state: 'running', exitCode: null, signal: null,
      startedAt: new Date().toISOString(), finishedAt: null, events: [], sequence: 0, outputBytes: 0, inputBytes: 0,
      onFinish,
    };
    sessions.set(id, session);
    const timeoutSeconds = Math.max(15, Math.min(120, Math.round(timeoutMs / 1000)));
    let child;
    try {
      child = spawnImpl(dockerPath, buildCodeSessionDockerArgs({
        name: containerName, runtime, codeDirectory, workspacePath: workspace,
        cpuCores: Math.max(0.1, Math.min(Number(cpuCores) || 0.5, 1)),
        memoryBytes: Math.max(128 * 1024 * 1024, Math.min(Number(memoryBytes) || 256 * 1024 * 1024, 512 * 1024 * 1024)),
        pids: Math.max(16, Math.min(Number(pids) || 64, 96)), timeoutSeconds,
      }), { stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    } catch (error) {
      sessions.delete(id);
      removeCodeDirectory(codeDirectory);
      try { onFinish?.(); } catch {}
      throw Object.assign(new Error(`대화형 실행기를 시작하지 못했습니다: ${error.message}`), { status: 503, code: 'CODE_SESSION_START' });
    }
    session.child = child;
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => appendEvent(session, 'stdout', chunk));
    child.stderr.on('data', (chunk) => appendEvent(session, 'stderr', chunk));
    child.once('error', (error) => {
      appendEvent(session, 'system', `\n[실행기를 시작하지 못했습니다: ${error.message}]\n`);
      finish(session, { state: 'failed' });
      removeContainer(containerName);
    });
    child.once('exit', (exitCode, signal) => finish(session, { exitCode, signal, state: session.stopRequested ? 'stopped' : exitCode === 0 ? 'finished' : 'failed' }));
    session.timer = setTimeout(() => {
      appendEvent(session, 'system', `\n[실행 시간이 ${timeoutSeconds}초를 넘어 중단했습니다.]\n`);
      child.kill('SIGKILL');
      removeContainer(containerName);
    }, timeoutSeconds * 1000 + 500);
    return snapshot(session);
  };

  const get = ({ ownerKey, sessionId, cursor = 0 }) => {
    const session = sessions.get(String(sessionId || ''));
    assertOwner(session, ownerKey);
    return snapshot(session, Math.max(0, Number(cursor) || 0));
  };
  const input = ({ ownerKey, sessionId, text }) => {
    const session = sessions.get(String(sessionId || ''));
    assertOwner(session, ownerKey);
    if (session.state !== 'running' || !session.child?.stdin?.writable) throw Object.assign(new Error('이미 종료된 실행에는 입력할 수 없습니다.'), { status: 409, code: 'CODE_SESSION_FINISHED' });
    const value = String(text ?? '');
    const bytes = Buffer.byteLength(value, 'utf8') + 1;
    if (bytes > 8 * 1024 || session.inputBytes + bytes > MAX_INPUT_BYTES) throw Object.assign(new Error('실행 입력 제한을 초과했습니다.'), { status: 413, code: 'CODE_SESSION_INPUT_LIMIT' });
    session.inputBytes += bytes;
    session.child.stdin.write(`${value}\n`, 'utf8');
    return snapshot(session, session.sequence);
  };
  const stop = async ({ ownerKey, sessionId }) => {
    const session = sessions.get(String(sessionId || ''));
    assertOwner(session, ownerKey);
    if (session.state === 'running') {
      appendEvent(session, 'system', '\n[사용자가 실행을 중지했습니다.]\n');
      session.stopRequested = true;
      session.child.kill('SIGKILL');
      await removeContainer(session.containerName);
      finish(session, { signal: 'SIGKILL', state: 'stopped' });
    }
    return snapshot(session);
  };
  const cleanup = () => {
    const cutoff = Date.now() - RESULT_RETENTION_MS;
    for (const [id, session] of sessions) {
      if (session.state !== 'running' && new Date(session.finishedAt || 0).getTime() < cutoff) sessions.delete(id);
    }
  };
  const cleanupTimer = setInterval(cleanup, 60_000);
  cleanupTimer.unref?.();
  return { available, start, get, input, stop, cleanup };
};

module.exports = {
  createManagedCodeSessionManager, buildCodeSessionDockerArgs, runtimeFor,
  SANDBOX_UID, MAX_CODE_BYTES, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, SESSION_TIMEOUT_MS,
};
