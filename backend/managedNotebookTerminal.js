const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { DEFAULT_IMAGE } = require('./pythonRuntimeCatalog');

const MAX_COMMAND_BYTES = 16 * 1024;
const MAX_OUTPUT_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

const safeContainerName = () => `msp-terminal-${crypto.randomUUID().replace(/-/g, '')}`;
const clamp = (value, minimum, maximum, fallback) => Math.max(minimum, Math.min(Number(value) || fallback, maximum));

const normalizeTerminalRelativePath = (value = '') => {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  if (!raw || raw === '.' || raw === '/' || raw === '~' || raw === '/workspace') return '';
  const withoutRoot = raw.startsWith('/workspace/') ? raw.slice('/workspace/'.length) : raw.replace(/^\/+/, '');
  const normalized = path.posix.normalize(withoutRoot);
  if (!normalized || normalized === '.') return '';
  if (normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw Object.assign(new Error('터미널 작업 경로가 현재 노트북을 벗어날 수 없습니다.'), { status: 400, code: 'TERMINAL_PATH_ESCAPE' });
  }
  return normalized;
};

const resolveTerminalDirectory = (workspacePath, relativePath = '') => {
  const workspace = fs.realpathSync(workspacePath);
  const normalized = normalizeTerminalRelativePath(relativePath);
  const candidate = path.resolve(workspace, ...normalized.split('/').filter(Boolean));
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    throw Object.assign(new Error('터미널에서 열 폴더를 찾을 수 없습니다.'), { status: 404, code: 'TERMINAL_DIRECTORY_MISSING' });
  }
  const resolved = fs.realpathSync(candidate);
  const relative = path.relative(workspace, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw Object.assign(new Error('터미널 작업 경로가 현재 노트북을 벗어날 수 없습니다.'), { status: 400, code: 'TERMINAL_PATH_ESCAPE' });
  }
  return relative.replace(/\\/g, '/');
};

const buildDockerArgs = ({
  name,
  workspacePath,
  workingDirectory = '',
  command,
  image = DEFAULT_IMAGE,
  cpuCores = 0.5,
  memoryBytes = 256 * 1024 * 1024,
  pids = 64,
  uid = 65534,
  gid = 65534,
}) => {
  const relativeWorkingDirectory = String(workingDirectory || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const containerWorkingDirectory = relativeWorkingDirectory ? `/workspace/${relativeWorkingDirectory}` : '/workspace';
  return [
    'run', '--rm', '--name', name,
    '--network', 'none',
    '--cpus', String(clamp(cpuCores, 0.1, 1, 0.5)),
    '--memory', String(Math.floor(clamp(memoryBytes, 128 * 1024 * 1024, 512 * 1024 * 1024, 256 * 1024 * 1024))),
    '--memory-swap', String(Math.floor(clamp(memoryBytes, 128 * 1024 * 1024, 512 * 1024 * 1024, 256 * 1024 * 1024))),
    '--pids-limit', String(Math.floor(clamp(pids, 16, 96, 64))),
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=64m',
    '--env', 'HOME=/tmp', '--env', 'TERM=xterm-256color',
    '--user', `${Math.max(1, Number(uid) || 65534)}:${Math.max(1, Number(gid) || 65534)}`,
    '--volume', `${path.resolve(workspacePath)}:/workspace:rw`,
    '--workdir', containerWorkingDirectory,
    '-i', image, 'sh', '-lc', command,
  ];
};

const createManagedNotebookTerminal = ({
  dockerPath = '/usr/bin/docker',
  image = process.env.MSP_PYTHON_IMAGE || DEFAULT_IMAGE,
  spawnImpl = spawn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const available = () => fs.existsSync(dockerPath) && fs.statSync(dockerPath).isFile();
  const removeContainer = (name) => new Promise((resolve) => {
    const cleanup = spawnImpl(dockerPath, ['rm', '-f', name], { stdio: 'ignore', windowsHide: true });
    cleanup.once('error', () => resolve());
    cleanup.once('exit', () => resolve());
  });

  const run = ({ workspacePath, workingDirectory = '', command, cpuCores, memoryBytes, pids } = {}) => new Promise((resolve, reject) => {
    if (!available()) return reject(Object.assign(new Error('격리 터미널 실행기가 준비되지 않았습니다.'), { status: 503, code: 'TERMINAL_WORKER_UNAVAILABLE' }));
    const source = String(command || '');
    if (!source.trim()) return reject(Object.assign(new Error('실행할 명령을 입력해 주세요.'), { status: 400, code: 'TERMINAL_EMPTY_COMMAND' }));
    if (Buffer.byteLength(source, 'utf8') > MAX_COMMAND_BYTES) return reject(Object.assign(new Error('한 번에 실행할 명령은 16KB까지입니다.'), { status: 413, code: 'TERMINAL_COMMAND_LIMIT' }));
    const workspace = path.resolve(String(workspacePath || ''));
    if (!workspacePath || !fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) return reject(Object.assign(new Error('터미널 작업 폴더를 찾을 수 없습니다.'), { status: 409, code: 'TERMINAL_WORKSPACE_MISSING' }));
    const stat = fs.statSync(workspace);
    const name = safeContainerName();
    const startedAt = Date.now();
    const child = spawnImpl(dockerPath, buildDockerArgs({ name, workspacePath: workspace, workingDirectory, command: source, image, cpuCores, memoryBytes, pids, uid: stat.uid, gid: stat.gid }), {
      stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;

    const finishError = async (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await removeContainer(name);
      reject(error);
    };
    const collect = (kind, chunk) => {
      if (settled) return;
      const next = Buffer.concat([kind === 'stdout' ? stdout : stderr, chunk]);
      if (next.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL');
        finishError(Object.assign(new Error('출력이 128KB를 넘어 터미널 작업을 중단했습니다.'), { status: 413, code: 'TERMINAL_OUTPUT_LIMIT' }));
        return;
      }
      if (kind === 'stdout') stdout = next;
      else stderr = next;
    };
    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));
    child.once('error', (error) => finishError(Object.assign(new Error(`격리 터미널을 시작하지 못했습니다: ${error.message}`), { status: 503, code: 'TERMINAL_START_FAILED' })));
    child.once('exit', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: signal || null,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        durationMs: Date.now() - startedAt,
      });
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finishError(Object.assign(new Error('터미널 명령이 20초 제한을 넘어 중단되었습니다.'), { status: 408, code: 'TERMINAL_TIMEOUT' }));
    }, clamp(timeoutMs, 1000, 30_000, DEFAULT_TIMEOUT_MS));
  });

  return { available, run };
};

module.exports = { createManagedNotebookTerminal, buildDockerArgs, normalizeTerminalRelativePath, resolveTerminalDirectory, MAX_COMMAND_BYTES, MAX_OUTPUT_BYTES, DEFAULT_TIMEOUT_MS };
