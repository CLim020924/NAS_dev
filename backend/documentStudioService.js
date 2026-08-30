const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const JSZip = require('jszip');
const { mergePptxFiles, replacePptxTemplate } = require('./pptxPackageService');

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
const MODES = new Set(['convert-pdf', 'merge-pdf', 'merge-mixed-pdf', 'merge-pptx', 'template-pptx']);
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
  fcList: ['/usr/bin/fc-list'],
};

const getNativeConverter = () => {
  const configured = String(process.env.DOCUMENT_STUDIO_NATIVE_CONVERTER || '').trim();
  if (!configured || !path.isAbsolute(configured)) return '';
  return firstExecutable([configured]);
};

const firstExecutable = (candidates = []) => candidates.find((candidate) => {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}) || '';

const getEffectiveFormatMatrix = () => {
  if (!getNativeConverter()) return FORMAT_MATRIX;
  return Object.freeze({
    ...FORMAT_MATRIX,
    hwp: ['pdf', 'docx', 'odt'],
    hwpx: ['pdf', 'docx', 'odt'],
    cell: ['pdf', 'xlsx', 'ods'],
    nxl: ['pdf', 'xlsx', 'ods'],
  });
};

const getDocumentStudioCapabilities = () => ({
  libreoffice: !!firstExecutable(commandCandidates.libreoffice),
  pdfMerge: !!firstExecutable(commandCandidates.pdfunite),
  pptxMerge: true,
  pptxTemplate: true,
  nativeConverter: !!getNativeConverter(),
  fontInspection: !!firstExecutable(commandCandidates.fcList),
  modes: [...MODES],
  acceptedExtensions: [...ACCEPTED_EXTENSIONS].map((extension) => extension.slice(1)),
  formatMatrix: getEffectiveFormatMatrix(),
  outputFormats: [...new Set(Object.values(getEffectiveFormatMatrix()).flat())],
  unavailableSourceFormats: Object.entries(getEffectiveFormatMatrix()).filter(([, outputs]) => outputs.length === 0).map(([format]) => format),
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
    const outputs = getEffectiveFormatMatrix()[format] || [];
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

const runCommand = (command, args, { cwd, env = {}, timeoutMs = COMMAND_TIMEOUT_MS, signal } = {}) => new Promise((resolve, reject) => {
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
  const abort = () => {
    child.kill('SIGKILL');
    reject(createHttpError('사용자가 문서 작업을 취소했습니다.', 409));
  };
  if (signal?.aborted) return abort();
  signal?.addEventListener('abort', abort, { once: true });

  child.stdout.on('data', (chunk) => { stdout = trimOutput(stdout + chunk); });
  child.stderr.on('data', (chunk) => { stderr = trimOutput(stderr + chunk); });
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(createHttpError(`문서 처리 도구를 시작하지 못했습니다: ${error.message}`, 503));
  });
  child.on('close', (code) => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
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

const inspectSourceFonts = async (source, { signal } = {}) => {
  const zipExtensions = new Set(['.pptx', '.pptm', '.docx', '.docm', '.xlsx', '.xlsm', '.hwpx']);
  if (!zipExtensions.has(source.extension) || !firstExecutable(commandCandidates.fcList)) return { requested: [], missing: [], checked: false };
  let zip;
  try {
    zip = await JSZip.loadAsync(await fsp.readFile(source.path));
  } catch {
    return { requested: [], missing: [], checked: false };
  }
  const fonts = new Set();
  const xmlNames = Object.keys(zip.files).filter((name) => name.endsWith('.xml'));
  for (const name of xmlNames) {
    if (signal?.aborted) throw createHttpError('사용자가 문서 작업을 취소했습니다.', 409);
    const xml = await zip.file(name).async('string');
    for (const match of xml.matchAll(/(?:typeface|w:name\s+w:val|rFont\s+val)="([^"]+)"/g)) {
      const font = String(match[1] || '').trim();
      if (font && !font.startsWith('+')) fonts.add(font);
    }
  }
  const requested = [...fonts].slice(0, 100);
  const missing = [];
  const fcList = firstExecutable(commandCandidates.fcList);
  for (const font of requested) {
    const { stdout } = await runCommand(fcList, ['--format=%{family}', font], { signal, timeoutMs: 5000 });
    const families = stdout.split(',').map((family) => family.trim().toLowerCase());
    if (!families.includes(font.toLowerCase())) missing.push(font);
  }
  return { requested, missing, checked: true };
};

const convertSourceToFormat = async (source, outputFormat, workspaceDir, usedNames, { signal } = {}) => {
  const fontReport = await inspectSourceFonts(source, { signal });
  const resultName = uniqueResultName(source.name, outputFormat, usedNames);
  const resultPath = path.join(workspaceDir, 'results', resultName);
  await fsp.mkdir(path.dirname(resultPath), { recursive: true });

  if (source.extension === `.${outputFormat}`) {
    await fsp.copyFile(source.path, resultPath);
    return { path: resultPath, name: resultName, sourceName: source.name, sourceFormat: source.extension.slice(1), outputFormat, compatibility: outputFormat === 'pdf' ? 'original-pdf' : 'original-format-copy', fontReport };
  }

  if (['.hwp', '.hwpx', '.cell', '.nxl'].includes(source.extension)) {
    const nativeConverter = getNativeConverter();
    if (!nativeConverter) throw createHttpError(`${source.extension.slice(1).toUpperCase()} 변환에는 한컴 호환 변환 엔진 연결이 필요합니다. 서버에 엔진이 연결되지 않아 원본을 변경하지 않았습니다.`, 503);
    await runCommand(nativeConverter, ['convert', '--input', source.path, '--output', resultPath, '--format', outputFormat], { cwd: workspaceDir, signal });
    if (!fs.existsSync(resultPath) || !fs.statSync(resultPath).isFile()) throw createHttpError('한컴 호환 변환 엔진이 결과 파일을 만들지 못했습니다.', 422);
    return { path: resultPath, name: resultName, sourceName: source.name, sourceFormat: source.extension.slice(1), outputFormat, compatibility: 'native-office', fontReport };
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
    signal,
  });

  const convertedPath = path.join(convertDir, `${path.parse(stagedInput).name}.${outputFormat}`);
  if (!fs.existsSync(convertedPath) || !fs.statSync(convertedPath).isFile()) {
    throw createHttpError(`${source.name}을 ${outputFormat.toUpperCase()} 형식으로 변환하지 못했습니다.`, 422);
  }
  await fsp.rename(convertedPath, resultPath);
  return { path: resultPath, name: resultName, sourceName: source.name, sourceFormat: source.extension.slice(1), outputFormat, compatibility: 'libreoffice-compatible', fontReport };
};

const mergePdfResults = async (pdfResults, workspaceDir, outputName, { signal } = {}) => {
  if (pdfResults.length < 2) throw createHttpError('합치기에는 파일이 두 개 이상 필요합니다.');
  const pdfunite = firstExecutable(commandCandidates.pdfunite);
  if (!pdfunite) throw createHttpError('PDF 합치기 도구가 준비되지 않았습니다.', 503);
  const name = sanitizeFileName(outputName, '합친 문서.pdf').replace(/\.pdf$/i, '') + '.pdf';
  const resultPath = path.join(workspaceDir, 'merged', name);
  await fsp.mkdir(path.dirname(resultPath), { recursive: true });
  await runCommand(pdfunite, [...pdfResults.map((item) => item.path), resultPath], { cwd: workspaceDir, signal });
  if (!fs.existsSync(resultPath) || !fs.statSync(resultPath).isFile()) throw createHttpError('PDF 결과 파일을 만들지 못했습니다.', 422);
  return { path: resultPath, name, compatibility: pdfResults.some((item) => item.compatibility !== 'original-pdf') ? 'mixed-compatible' : 'original-pdf-merge' };
};

const processDocumentStudioJob = async ({ mode, sources, workspaceDir, outputName, sourceFormat = 'auto', outputFormat = 'pdf', templateRows = [], fileNameTemplate = '{이름}', signal, onProgress = () => {} }) => {
  const normalizedMode = normalizeMode(mode);
  const inspected = inspectSources(sources);
  const normalizedSourceFormat = normalizeSourceFormat(sourceFormat);
  if (normalizedSourceFormat !== 'auto' && inspected.some((source) => source.extension !== `.${normalizedSourceFormat}`)) {
    throw createHttpError(`원본 형식을 ${normalizedSourceFormat.toUpperCase()}로 선택했습니다. 같은 형식의 파일만 추가하세요.`);
  }
  if (normalizedMode === 'merge-pdf' && inspected.some((source) => source.extension !== '.pdf')) {
    throw createHttpError('PDF 합치기에는 PDF 파일만 사용할 수 있습니다. 다른 문서는 혼합 문서 합치기를 선택하세요.');
  }

  if (normalizedMode === 'merge-pptx') {
    if (inspected.length < 2 || inspected.some((source) => source.extension !== '.pptx')) throw createHttpError('PPTX 합치기에는 PPTX 파일을 두 개 이상 선택하세요.');
    const name = sanitizeFileName(outputName, '합친 프레젠테이션.pptx').replace(/\.pptx$/i, '') + '.pptx';
    const resultPath = path.join(workspaceDir, 'merged', name);
    await mergePptxFiles(inspected.map((source) => source.path), resultPath, onProgress);
    return [{ path: resultPath, name, outputFormat: 'pptx', compatibility: 'pptx-package-merge' }];
  }
  if (normalizedMode === 'template-pptx') {
    if (inspected.length !== 1 || inspected[0].extension !== '.pptx') throw createHttpError('템플릿 일괄 만들기에는 PPTX 템플릿 한 개를 선택하세요.');
    if (!Array.isArray(templateRows) || templateRows.length === 0 || templateRows.length > 200) throw createHttpError('템플릿 데이터는 1~200행이어야 합니다.');
    const requestedTemplateOutput = ['pptx', 'pdf'].includes(String(outputFormat).toLowerCase()) ? String(outputFormat).toLowerCase() : 'pptx';
    const results = [];
    const usedNames = new Set();
    const templateFontReport = await inspectSourceFonts(inspected[0], { signal });
    for (let index = 0; index < templateRows.length; index += 1) {
      if (signal?.aborted) throw createHttpError('사용자가 문서 작업을 취소했습니다.', 409);
      const row = templateRows[index] || {};
      const rawName = String(fileNameTemplate || '{이름}').replace(/\{([^{}]+)\}/g, (_, key) => String(row[key] ?? '')) || `문서-${index + 1}`;
      const pptxName = uniqueResultName(rawName, 'pptx', usedNames);
      const pptxPath = path.join(workspaceDir, 'results', pptxName);
      const applied = await replacePptxTemplate(inspected[0].path, pptxPath, row);
      if (requestedTemplateOutput === 'pptx') {
        results.push({ path: pptxPath, name: pptxName, sourceName: inspected[0].name, sourceFormat: 'pptx', outputFormat: 'pptx', compatibility: 'pptx-template', replacementsApplied: applied.replacementsApplied, fontReport: templateFontReport });
      } else {
        const converted = await convertSourceToFormat({ ...inspected[0], path: pptxPath, name: pptxName, extension: '.pptx', index }, 'pdf', workspaceDir, usedNames, { signal });
        results.push({ ...converted, compatibility: 'pptx-template-pdf', replacementsApplied: applied.replacementsApplied });
      }
      onProgress({ completed: index + 1, total: templateRows.length, stage: 'template' });
    }
    return results;
  }

  const requestedOutputFormat = normalizedMode === 'convert-pdf'
    ? normalizeOutputFormat(outputFormat, inspected.map((source) => source.extension.slice(1)))
    : 'pdf';
  const usedNames = new Set();
  const convertedResults = [];
  for (const source of inspected) {
    if (signal?.aborted) throw createHttpError('사용자가 문서 작업을 취소했습니다.', 409);
    convertedResults.push(await convertSourceToFormat(source, requestedOutputFormat, workspaceDir, usedNames, { signal }));
    onProgress({ completed: convertedResults.length, total: inspected.length, stage: 'convert' });
  }
  if (normalizedMode === 'convert-pdf') return convertedResults;
  const pdfResults = convertedResults;
  return [await mergePdfResults(pdfResults, workspaceDir, outputName, { signal })];
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
