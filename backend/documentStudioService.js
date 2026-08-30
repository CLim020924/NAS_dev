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
  '.xls', '.xlsx', '.xlsm', '.xlsb', '.ods', '.csv', '.cell', '.nxl',
]);
const ACCEPTED_EXTENSIONS = new Set(['.pdf', ...CONVERTIBLE_EXTENSIONS]);
const MODES = new Set(['convert-pdf', 'merge-pdf', 'merge-mixed-pdf']);
const FORMAT_MATRIX = Object.freeze({
  pdf: ['pdf'],
  ppt: ['pdf', 'pptx', 'odp'],
  pptx: ['pdf', 'pptx', 'odp'],
  pptm: ['pdf', 'pptx', 'odp'],
  odp: ['pdf', 'pptx', 'odp'],
  doc: ['pdf', 'docx', 'odt', 'rtf'],
  docx: ['pdf', 'docx', 'odt', 'rtf'],
  docm: ['pdf', 'docx', 'odt', 'rtf'],
  odt: ['pdf', 'docx', 'odt', 'rtf'],
  rtf: ['pdf', 'docx', 'odt', 'rtf'],
  xls: ['pdf', 'xlsx', 'ods', 'csv'],
  xlsx: ['pdf', 'xlsx', 'ods', 'csv'],
  xlsm: ['pdf', 'xlsx', 'ods', 'csv'],
  xlsb: ['pdf', 'xlsx', 'ods', 'csv'],
  ods: ['pdf', 'xlsx', 'ods', 'csv'],
  csv: ['pdf', 'xlsx', 'ods', 'csv'],
  // 현재 NAS의 LibreOffice에는 HWP/HWPX·한셀 입력 filter가 없다. UI가
  // 가능하다고 거짓 표시하지 않도록 감지는 하되 출력 선택은 열지 않는다.
  hwp: [],
  hwpx: [],
  cell: [],
  nxl: [],
});
const OUTPUT_FORMATS = new Set([...new Set(Object.values(FORMAT_MATRIX).flat())]);

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
  formatMatrix: FORMAT_MATRIX,
  outputFormats: [...OUTPUT_FORMATS],
  unavailableSourceFormats: Object.entries(FORMAT_MATRIX).filter(([, outputs]) => outputs.length === 0).map(([format]) => format),
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

const normalizeSourceFormat = (sourceFormat = 'auto') => {
  const normalized = String(sourceFormat || 'auto').toLowerCase().replace(/^\./, '');
  if (normalized !== 'auto' && !Object.hasOwn(FORMAT_MATRIX, normalized)) throw createHttpError('지원하지 않는 원본 형식입니다.');
  return normalized;
};

const getSharedOutputFormats = (formats) => {
  const normalized = [...new Set(formats.map((format) => String(format || '').toLowerCase().replace(/^\./, '')))];
  if (normalized.length === 0) return [];
  return normalized.reduce((shared, format, index) => {
    const outputs = FORMAT_MATRIX[format] || [];
    return index === 0 ? [...outputs] : shared.filter((output) => outputs.includes(output));
  }, []);
};

const normalizeOutputFormat = (outputFormat, sourceFormats) => {
  const normalized = String(outputFormat || 'pdf').toLowerCase().replace(/^\./, '');
  if (!OUTPUT_FORMATS.has(normalized)) throw createHttpError('지원하지 않는 결과 형식입니다.');
  const allowed = getSharedOutputFormats(sourceFormats);
  if (!allowed.includes(normalized)) {
    const sourceLabel = [...new Set(sourceFormats)].map((format) => format.toUpperCase()).join(', ');
    throw createHttpError(`${sourceLabel || '선택한 원본'}에서 ${normalized.toUpperCase()} 형식으로 변환할 수 없습니다.`);
  }
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

const uniqueResultName = (name, outputFormat, usedNames) => {
  const extension = `.${outputFormat}`;
  const base = sanitizeFileName(name, `문서${extension}`).replace(/\.[^.]+$/, '') || '문서';
  let candidate = `${base}${extension}`;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) candidate = `${base} (${index++})${extension}`;
  usedNames.add(candidate.toLowerCase());
  return candidate;
};

const convertSourceToFormat = async (source, outputFormat, workspaceDir, usedNames) => {
  const resultName = uniqueResultName(source.name, outputFormat, usedNames);
  const resultPath = path.join(workspaceDir, 'results', resultName);
  await fsp.mkdir(path.dirname(resultPath), { recursive: true });

  if (source.extension === `.${outputFormat}`) {
    await fsp.copyFile(source.path, resultPath);
    return { path: resultPath, name: resultName, sourceName: source.name, sourceFormat: source.extension.slice(1), outputFormat, compatibility: outputFormat === 'pdf' ? 'original-pdf' : 'original-format-copy' };
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
    '--convert-to', outputFormat, '--outdir', convertDir, stagedInput,
  ], {
    cwd: workspaceDir,
    env: { HOME: workspaceDir, SAL_DISABLE_OPENCL: '1' },
  });

  const convertedPath = path.join(convertDir, `${path.parse(stagedInput).name}.${outputFormat}`);
  if (!fs.existsSync(convertedPath) || !fs.statSync(convertedPath).isFile()) {
    throw createHttpError(`${source.name}을 ${outputFormat.toUpperCase()} 형식으로 변환하지 못했습니다.`, 422);
  }
  await fsp.rename(convertedPath, resultPath);
  return { path: resultPath, name: resultName, sourceName: source.name, sourceFormat: source.extension.slice(1), outputFormat, compatibility: 'libreoffice-compatible' };
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

const processDocumentStudioJob = async ({ mode, sources, workspaceDir, outputName, sourceFormat = 'auto', outputFormat = 'pdf' }) => {
  const normalizedMode = normalizeMode(mode);
  const inspected = inspectSources(sources);
  const normalizedSourceFormat = normalizeSourceFormat(sourceFormat);
  if (normalizedSourceFormat !== 'auto' && inspected.some((source) => source.extension !== `.${normalizedSourceFormat}`)) {
    throw createHttpError(`원본 형식을 ${normalizedSourceFormat.toUpperCase()}로 선택했습니다. 같은 형식의 파일만 추가하세요.`);
  }
  if (normalizedMode === 'merge-pdf' && inspected.some((source) => source.extension !== '.pdf')) {
    throw createHttpError('PDF 합치기에는 PDF 파일만 사용할 수 있습니다. 다른 문서는 혼합 문서 합치기를 선택하세요.');
  }

  const requestedOutputFormat = normalizedMode === 'convert-pdf'
    ? normalizeOutputFormat(outputFormat, inspected.map((source) => source.extension.slice(1)))
    : 'pdf';
  const usedNames = new Set();
  const convertedResults = [];
  for (const source of inspected) convertedResults.push(await convertSourceToFormat(source, requestedOutputFormat, workspaceDir, usedNames));
  if (normalizedMode === 'convert-pdf') return convertedResults;
  const pdfResults = convertedResults;
  return [await mergePdfResults(pdfResults, workspaceDir, outputName)];
};

module.exports = {
  ACCEPTED_EXTENSIONS,
  CONVERTIBLE_EXTENSIONS,
  MAX_SOURCES,
  FORMAT_MATRIX,
  getDocumentStudioCapabilities,
  getSharedOutputFormats,
  normalizeMode,
  normalizeSourceFormat,
  normalizeOutputFormat,
  sanitizeFileName,
  inspectSources,
  processDocumentStudioJob,
  _test: { uniqueResultName, firstExecutable },
};
