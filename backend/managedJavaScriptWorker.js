const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DEFAULT_IMAGE = 'node:22-alpine';
const MAX_CODE_BYTES = 128 * 1024;
const MAX_OUTPUT_BYTES = 64 * 1024;

const safeJobName = () => `msp-javascript-${crypto.randomUUID().replace(/-/g, '')}`;

const buildDockerArgs = ({ name, image = DEFAULT_IMAGE, cpuCores = 0.5, memoryBytes = 256 * 1024 * 1024, pids = 64 }) => [
  'run', '--rm', '--name', name,
  '--network', 'none',
  '--cpus', String(Math.max(0.1, Math.min(Number(cpuCores) || 0.5, 2))),
  '--memory', String(Math.max(128 * 1024 * 1024, Math.floor(Number(memoryBytes) || 0))),
  '--memory-swap', String(Math.max(128 * 1024 * 1024, Math.floor(Number(memoryBytes) || 0))),
  '--pids-limit', String(Math.max(16, Math.min(Math.floor(Number(pids) || 64), 128))),
  '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m',
  '--user', '65534:65534', '-i', image,
  'node', '--input-type=commonjs', '-',
];

const createManagedJavaScriptWorker = ({
  dockerPath = '/usr/bin/docker',
  image = process.env.MSP_JAVASCRIPT_IMAGE || DEFAULT_IMAGE,
  spawnImpl = spawn,
  timeoutMs = 15_000,
} = {}) => {
  const available = () => fs.existsSync(dockerPath) && fs.statSync(dockerPath).isFile();

  const removeContainer = (name) => new Promise((resolve) => {
    const cleanup = spawnImpl(dockerPath, ['rm', '-f', name], { stdio: 'ignore', windowsHide: true });
    cleanup.once('error', () => resolve());
    cleanup.once('exit', () => resolve());
  });

  const run = ({ code, cpuCores = 0.5, memoryBytes = 256 * 1024 * 1024, pids = 64 } = {}) => new Promise((resolve, reject) => {
    if (!available()) return reject(Object.assign(new Error('격리 JavaScript 실행기가 설치되어 있지 않습니다.'), { status: 503, code: 'JAVASCRIPT_WORKER_UNAVAILABLE' }));
    const source = String(code ?? '');
    if (!source.trim()) return reject(Object.assign(new Error('실행할 JavaScript 코드가 없습니다.'), { status: 400, code: 'JAVASCRIPT_EMPTY_CODE' }));
    if (Buffer.byteLength(source, 'utf8') > MAX_CODE_BYTES) return reject(Object.assign(new Error('한 번에 실행할 수 있는 코드는 128KB까지입니다.'), { status: 413, code: 'JAVASCRIPT_CODE_LIMIT' }));

    const name = safeJobName();
    const startedAt = Date.now();
    const child = spawnImpl(dockerPath, buildDockerArgs({ name, image, cpuCores, memoryBytes, pids }), {
      stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true,
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    let exceeded = false;

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
        exceeded = true;
        child.kill('SIGKILL');
        finishError(Object.assign(new Error('출력이 64KB를 넘어 실행을 중단했습니다.'), { status: 413, code: 'JAVASCRIPT_OUTPUT_LIMIT' }));
        return;
      }
      if (kind === 'stdout') stdout = next;
      else stderr = next;
    };
    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));
    child.once('error', (error) => finishError(Object.assign(new Error(`격리 JavaScript 실행을 시작하지 못했습니다: ${error.message}`), { status: 503, code: 'JAVASCRIPT_WORKER_START_FAILED' })));
    child.once('exit', (exitCode, signal) => {
      if (settled || exceeded) return;
      settled = true;
      clearTimeout(timer);
      const result = {
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: signal || null,
        stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'),
        durationMs: Date.now() - startedAt,
      };
      if (exitCode === 0) resolve(result);
      else reject(Object.assign(new Error('JavaScript 코드가 오류와 함께 종료되었습니다.'), { status: 422, code: 'JAVASCRIPT_EXECUTION_FAILED', result }));
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finishError(Object.assign(new Error('JavaScript 실행이 15초 제한을 넘어 중단되었습니다.'), { status: 408, code: 'JAVASCRIPT_TIMEOUT' }));
    }, Math.max(1000, Math.min(Number(timeoutMs) || 15_000, 30_000)));
    child.stdin.on('error', () => {});
    child.stdin.end(source, 'utf8');
  });

  return { available, run };
};

module.exports = { createManagedJavaScriptWorker, buildDockerArgs, DEFAULT_IMAGE, MAX_CODE_BYTES, MAX_OUTPUT_BYTES };
