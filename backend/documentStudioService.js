const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const MAX_SOURCES = 40;
const MAX_TOTAL_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const CONVERTIBLE_EXTENSIONS = new Set([
  '.ppt', '.pptx', '.pptm', '.odp',
  '.doc', '.docx', '.docm', '.odt', '.rtf',
  '.hwp', '.hwpx',
  '.xls', '.xlsx', '.xlsm', '.xlsb', '.ods', '.csv',
]);
const ACCEPTED_EXTENSIONS = new Set(['.pdf', ...CONVERTIBLE_EXTENSIONS]);
const MODES = new Set(['convert-pdf', 'merge-pdf', 'merge-mixed-pdf']);

const commandCandidates = {
  libreoffice: ['/usr/bin/libreoffice', '/usr/bin/soffice'],
  pdfunite: ['/usr/bin/pdfunite'],
};

const firstExecutable = (candidates = []) => candidates.find((candidate) => {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}) || '';

const getDocumentStudioCapabilities = () => ({
  libreoffice: !!firstExecutable(commandCandidates.libreoffice),
  pdfMerge: !!firstExecutable(commandCandidates.pdfunite),
  modes: [...MODES],
  acceptedExtensions: [...ACCEPTED_EXTENSIONS].map((extension) => extension.slice(1)),
  maxSources: MAX_SOURCES,
});

const createHttpError = (message, status = 400) => Object.assign(new Error(message), { status });

const sanitizeFileName = (value, fallback = '완료.pdf') => {
  const cleaned = path.basename(String(value || fallback))
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || fallback;
};

const normalizeMode = (mode) => {
  const normalized = String(mode || '');
  if (!MODES.has(normalized)) throw createHttpError('지원하지 않는 문서 작업입니다.');
  return normalized;
};

const inspectSources = (sources) => {
  if (!Array.isArray(sources) || sources.length === 0) throw createHttpError('작업할 파일을 선택하세요.');
  if (sources.length > MAX_SOURCES) throw createHttpError(`한 작업에는 최대 ${MAX_SOURCES}개 파일을 사용할 수 있습니다.`);

  let totalBytes = 0;
  const inspected = sources.map((source, index) => {
    const sourcePath = path.resolve(String(source?.path || ''));
    const stat = fs.lstatSync(sourcePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw createHttpError('일반 파일만 문서 작업에 사용할 수 있습니다.');
    const extension = path.extname(sourcePath).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.has(extension)) {
      throw createHttpError(`${path.basename(sourcePath)} 형식은 현재 PDF 작업에서 지원하지 않습니다.`);
    }
    totalBytes += stat.size;
    return {
      index,
      path: sourcePath,
      name: sanitizeFileName(source?.name || path.basename(sourcePath), `문서-${index + 1}${extension}`),
      extension,
      size: stat.size,
    };
  });

  if (totalBytes > MAX_TOTAL_SOURCE_BYTES) throw createHttpError('한 작업의 원본 파일 합계는 4GB를 넘을 수 없습니다.', 413);
  return inspected;
};

const runCommand = (command, args, { cwd, env = {}, timeoutMs = COMMAND_TIMEOUT_MS } = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  const trimOutput = (value) => String(value || '').slice(-12000);
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(createHttpError('문서 처리 시간이 5분을 초과했습니다.', 504));
  }, timeoutMs);

  child.stdout.on('data', (chunk) => { stdout = trimOutput(stdout + chunk); });
  child.stderr.on('data', (chunk) => { stderr = trimOutput(stderr + chunk); });
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(createHttpError(`문서 처리 도구를 시작하지 못했습니다: ${error.message}`, 503));
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code === 0) return resolve({ stdout, stderr });
    reject(createHttpError(`문서 처리 도구가 실패했습니다. (${code}) ${stderr || stdout}`.trim(), 422));
  });
});

const uniquePdfName = (name, usedNames) => {
  const base = sanitizeFileName(name, '문서.pdf').replace(/\.[^.]+$/, '') || '문서';
  let candidate = `${base}.pdf`;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) candidate = `${base} (${index++}).pdf`;
  usedNames.add(candidate.toLowerCase());
  return candidate;
};

const convertSourceToPdf = async (source, workspaceDir, usedNames) => {
  const resultName = uniquePdfName(source.name, usedNames);
  const resultPath = path.join(workspaceDir, 'results', resultName);
  await fsp.mkdir(path.dirname(resultPath), { recursive: true });

  if (source.extension === '.pdf') {
    await fsp.copyFile(source.path, resultPath);
    return { path: resultPath, name: resultName, sourceName: source.name, compatibility: 'original-pdf' };
  }

  const libreoffice = firstExecutable(commandCandidates.libreoffice);
  if (!libreoffice) throw createHttpError('LibreOffice 변환 도구가 준비되지 않았습니다.', 503);
  const inputDir = path.join(workspaceDir, 'inputs');
  const convertDir = path.join(workspaceDir, 'converted', String(source.index + 1));
  const profileDir = path.join(workspaceDir, 'libreoffice-profile', String(source.index + 1));
  await Promise.all([fsp.mkdir(inputDir, { recursive: true }), fsp.mkdir(convertDir, { recursive: true }), fsp.mkdir(profileDir, { recursive: true })]);
  const stagedInput = path.join(inputDir, `source-${String(source.index + 1).padStart(3, '0')}${source.extension}`);
  await fsp.copyFile(source.path, stagedInput);

  await runCommand(libreoffice, [
    '--headless', '--nologo', '--nodefault', '--nolockcheck', '--nofirststartwizard',
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--convert-to', 'pdf', '--outdir', convertDir, stagedInput,
  ], {
    cwd: workspaceDir,
    env: { HOME: workspaceDir, SAL_DISABLE_OPENCL: '1' },
  });

  const convertedPath = path.join(convertDir, `${path.parse(stagedInput).name}.pdf`);
  if (!fs.existsSync(convertedPath) || !fs.statSync(convertedPath).isFile()) {
    throw createHttpError(`${source.name}을 PDF로 변환하지 못했습니다.`, 422);
  }
  await fsp.rename(convertedPath, resultPath);
  return { path: resultPath, name: resultName, sourceName: source.name, compatibility: 'libreoffice-compatible' };
};

const mergePdfResults = async (pdfResults, workspaceDir, outputName) => {
  if (pdfResults.length < 2) throw createHttpError('합치기에는 파일이 두 개 이상 필요합니다.');
  const pdfunite = firstExecutable(commandCandidates.pdfunite);
  if (!pdfunite) throw createHttpError('PDF 합치기 도구가 준비되지 않았습니다.', 503);
  const name = sanitizeFileName(outputName, '합친 문서.pdf').replace(/\.pdf$/i, '') + '.pdf';
  const resultPath = path.join(workspaceDir, 'merged', name);
  await fsp.mkdir(path.dirname(resultPath), { recursive: true });
  await runCommand(pdfunite, [...pdfResults.map((item) => item.path), resultPath], { cwd: workspaceDir });
  if (!fs.existsSync(resultPath) || !fs.statSync(resultPath).isFile()) throw createHttpError('PDF 결과 파일을 만들지 못했습니다.', 422);
  return { path: resultPath, name, compatibility: pdfResults.some((item) => item.compatibility !== 'original-pdf') ? 'mixed-compatible' : 'original-pdf-merge' };
};

const processDocumentStudioJob = async ({ mode, sources, workspaceDir, outputName }) => {
  const normalizedMode = normalizeMode(mode);
  const inspected = inspectSources(sources);
  if (normalizedMode === 'merge-pdf' && inspected.some((source) => source.extension !== '.pdf')) {
    throw createHttpError('PDF 합치기에는 PDF 파일만 사용할 수 있습니다. 다른 문서는 혼합 문서 합치기를 선택하세요.');
  }

  const usedNames = new Set();
  const pdfResults = [];
  for (const source of inspected) pdfResults.push(await convertSourceToPdf(source, workspaceDir, usedNames));
  if (normalizedMode === 'convert-pdf') return pdfResults;
  return [await mergePdfResults(pdfResults, workspaceDir, outputName)];
};

module.exports = {
  ACCEPTED_EXTENSIONS,
  CONVERTIBLE_EXTENSIONS,
  MAX_SOURCES,
  getDocumentStudioCapabilities,
  normalizeMode,
  sanitizeFileName,
  inspectSources,
  processDocumentStudioJob,
  _test: { uniquePdfName, firstExecutable },
};
