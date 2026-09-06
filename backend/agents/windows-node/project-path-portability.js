'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TextDecoder } = require('util');

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_CANDIDATES = 3000;
const CHANGE_REPORT_NAME = 'NAS_PATH_CHANGES.md';
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.env', '.go', '.h', '.hpp', '.html', '.ini',
  '.java', '.js', '.json', '.jsx', '.kt', '.md', '.mjs', '.php', '.properties', '.ps1',
  '.py', '.rb', '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml',
  '.yaml', '.yml', '.code-workspace'
]);
const IGNORED_DIRS = new Set(['.git', '.hg', '.svn', '.venv', 'venv', 'node_modules', 'dist', 'build', 'coverage', '__pycache__']);
const SENSITIVE_NAMES = /(^|[\\/])(?:\.env(?:\.|$)|id_(?:rsa|ed25519)|credentials?|secrets?|tokens?|workspace\.xml|dataSources?)(?:[\\/]|\.|$)/i;
const PATH_TERMINATORS = new Set(['"', "'", '`', '<', '>', '|', '*', '?', '\r', '\n', '\t', ',', ';', ')', ']', '}']);

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function isInside(parent, child) {
  const parentPath = path.resolve(parent);
  const childPath = path.resolve(child);
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function isSensitiveRelative(relative) {
  const normalized = normalizeSlashes(relative);
  return SENSITIVE_NAMES.test(normalized) || normalized === CHANGE_REPORT_NAME;
}

function shouldVisitDirectory(relative) {
  const normalized = normalizeSlashes(relative).toLowerCase();
  const base = path.basename(normalized);
  if (IGNORED_DIRS.has(base)) return false;
  if (normalized === '.idea') return true;
  if (normalized.startsWith('.idea/') && normalized !== '.idea/runconfigurations' && !normalized.startsWith('.idea/runconfigurations/')) return false;
  return true;
}

function decodeUtf8(buffer) {
  try {
    const hasBom = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf;
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? buffer.subarray(3) : buffer), hasBom };
  } catch { return null; }
}

function isLikelyText(filePath, buffer) {
  if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()) && !/^(?:Dockerfile|Makefile|Procfile)$/i.test(path.basename(filePath))) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return !sample.includes(0) && decodeUtf8(buffer) !== null;
}

function normalizedRelative(value) {
  return normalizeSlashes(value).replace(/^\.\//, '').toLowerCase();
}

function isUnavailable(relative, unavailable) {
  const candidate = normalizedRelative(relative);
  for (const blocked of unavailable) {
    if (candidate === blocked || candidate.startsWith(blocked + '/')) return true;
  }
  return false;
}

function walkTextFiles(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const maxFiles = Number(options.maxFiles || DEFAULT_MAX_FILES);
  const maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
  const unavailable = new Set((options.unavailableRelativePaths || []).map(normalizedRelative));
  const result = [];
  const stats = { skippedUnavailable: 0, skippedEncoding: 0, skippedSensitive: 0, skippedLarge: 0, truncatedFiles: false };
  const queue = [root];
  while (queue.length && result.length < maxFiles) {
    const current = queue.shift();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (result.length >= maxFiles) { stats.truncatedFiles = true; break; }
      const full = path.join(current, entry.name);
      const relative = path.relative(root, full);
      if (isUnavailable(relative, unavailable)) { stats.skippedUnavailable += 1; continue; }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (shouldVisitDirectory(relative)) queue.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSensitiveRelative(relative)) { stats.skippedSensitive += 1; continue; }
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.size > maxFileBytes) { stats.skippedLarge += 1; continue; }
      const buffer = fs.readFileSync(full);
      if (!TEXT_EXTENSIONS.has(path.extname(full).toLowerCase()) && !/^(?:Dockerfile|Makefile|Procfile)$/i.test(path.basename(full))) continue;
      if (!isLikelyText(full, buffer)) { stats.skippedEncoding += 1; continue; }
      const decoded = decodeUtf8(buffer);
      result.push({ full, relative, buffer, text: decoded.text, hasBom: decoded.hasBom });
    }
  }
  if (queue.length) stats.truncatedFiles = true;
  return { files: result, stats };
}

function decodedWindowsPath(raw) {
  return raw.replace(/\\\\/g, '\\').replace(/\\\//g, '/');
}

function trimPathCandidate(raw) {
  return raw.replace(/[\s.]+$/, '').replace(/[(:]+$/, '');
}

function scanDelimitedPath(text, start, isWindows) {
  const previous = text[start - 1] || '';
  const quote = previous === '"' || previous === "'" || previous === '`' ? previous : '';
  let end = start;
  while (end < text.length) {
    const char = text[end];
    if (quote) {
      if (char === quote && text[end - 1] !== '\\') break;
    } else if (/\s/.test(char) || PATH_TERMINATORS.has(char) || char === '(' || char === '[' || char === '{') break;
    end += 1;
  }
  const raw = trimPathCandidate(text.slice(start, end));
  if (!raw) return null;
  return { raw, value: isWindows ? decodedWindowsPath(raw) : raw, index: start };
}

function extractAbsolutePaths(text) {
  const source = String(text || '');
  const found = [];
  const windowsStart = /(?<![A-Za-z0-9])[A-Za-z]:(?:\\\\|\\|\/)/g;
  for (const match of source.matchAll(windowsStart)) {
    const item = scanDelimitedPath(source, match.index, true);
    if (item && item.value.length > 3) found.push(item);
  }
  const posixStart = /\/(?!\/)/g;
  for (const match of source.matchAll(posixStart)) {
    const previous = source[match.index - 1] || '';
    if (/[A-Za-z0-9_:/.\\-]/.test(previous)) continue;
    const item = scanDelimitedPath(source, match.index, false);
    if (!item || item.value.length <= 1 || /^\/(?:api|assets?|static|images?|favicon)(?:\/|$)/i.test(item.value)) continue;
    found.push(item);
  }
  return found.sort((a, b) => a.index - b.index).filter((item, index, all) => index === 0 || item.index !== all[index - 1].index);
}

function sourceParts(value) {
  return normalizeSlashes(value).split('/').filter(Boolean);
}

function safeTargetInfo(candidate, allowedRoots) {
  const absolute = path.resolve(candidate);
  const info = fs.lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error('심볼릭 링크 대상은 경로 변경에 사용할 수 없습니다.');
  const real = fs.realpathSync(absolute);
  const allowed = allowedRoots.some(root => {
    try { return isInside(fs.realpathSync(root), real); } catch { return false; }
  });
  if (!allowed) throw new Error('연결된 NAS Drive 밖의 대상은 경로 변경에 사용할 수 없습니다.');
  if (!info.isDirectory() && !info.isFile()) throw new Error('파일 또는 폴더만 경로 변경 대상으로 사용할 수 있습니다.');
  return { absolute, real, type: info.isDirectory() ? 'directory' : 'file' };
}

function existingProjectSuffix(projectRoot, absoluteValue) {
  const parts = sourceParts(absoluteValue);
  for (let length = Math.min(parts.length, 12); length >= 2; length -= 1) {
    const suffix = parts.slice(-length);
    const candidate = path.resolve(projectRoot, ...suffix);
    if (!isInside(projectRoot, candidate)) continue;
    try {
      const info = fs.lstatSync(candidate);
      if (!info.isSymbolicLink() && (info.isFile() || info.isDirectory())) return { target: candidate, suffix: suffix.join(path.sep), matchedParts: length };
    } catch {}
  }
  return null;
}

function buildAllowedIndex(roots, maxEntries = 30000) {
  const index = new Map();
  let count = 0;
  const queue = roots.map(item => path.resolve(item)).filter(item => fs.existsSync(item));
  while (queue.length && count < maxEntries) {
    const current = queue.shift();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (count++ >= maxEntries) break;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && shouldVisitDirectory(path.relative(roots.find(root => isInside(root, full)) || current, full))) queue.push(full);
      if (entry.isDirectory() || entry.isFile()) {
        const key = entry.name.toLowerCase();
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ path: full, type: entry.isDirectory() ? 'directory' : 'file' });
      }
    }
  }
  return index;
}

function uniqueExternalMatch(index, absoluteValue, projectRoot) {
  const parts = sourceParts(absoluteValue);
  const base = (parts[parts.length - 1] || '').toLowerCase();
  if (!base) return null;
  const candidates = (index.get(base) || []).filter(item => !isInside(projectRoot, item.path));
  let best = [];
  let bestLength = 0;
  for (const candidate of candidates) {
    const localParts = normalizeSlashes(candidate.path).split('/').filter(Boolean);
    let matched = 0;
    while (matched < parts.length && matched < localParts.length && parts[parts.length - 1 - matched].toLowerCase() === localParts[localParts.length - 1 - matched].toLowerCase()) matched += 1;
    if (matched > bestLength) { bestLength = matched; best = [candidate]; }
    else if (matched === bestLength) best.push(candidate);
  }
  return bestLength >= 2 && best.length === 1 ? { target: best[0].path, type: best[0].type, matchedParts: bestLength } : null;
}

function lineAndColumn(text, offset) {
  const before = text.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1, lineText: lines[lines.length - 1] + text.slice(offset).split(/\r?\n/)[0] };
}

function encodeReplacementLike(raw, value) {
  if (/\\\\/.test(raw)) return String(value).replace(/\\/g, '\\\\');
  if (/^[A-Za-z]:\//.test(raw)) return String(value).replace(/\\/g, '/');
  return String(value);
}

function portableReplacement(relativeFile, lineText, target, projectRoot) {
  const file = normalizeSlashes(relativeFile).toLowerCase();
  const rel = normalizeSlashes(path.relative(projectRoot, target));
  if (!rel || rel.startsWith('../')) return null;
  if (file === '.vscode/launch.json') return { text: '${workspaceFolder}/' + rel, adapter: 'VS Code launch.json' };
  if (file === '.vscode/tasks.json' && /"(?:command|cwd)"\s*:/.test(lineText)) return { text: '${workspaceFolder}/' + rel, adapter: 'VS Code tasks.json' };
  if (file.endsWith('.code-workspace') && /"path"\s*:/.test(lineText)) {
    const workspaceRelative = normalizeSlashes(path.relative(path.dirname(path.join(projectRoot, relativeFile)), target)) || '.';
    return { text: workspaceRelative, adapter: 'VS Code workspace 상대경로' };
  }
  if ((file.startsWith('.run/') || file.startsWith('.idea/runconfigurations/')) && file.endsWith('.xml') && /name="(?:WORKING_DIRECTORY|SCRIPT_NAME|FILE_PATH|INPUT_FILE)"/i.test(lineText)) {
    return { text: '$PROJECT_DIR$/' + rel, adapter: 'JetBrains project variable' };
  }
  return null;
}

function candidateForMatch({ file, text, match, projectRoot, externalIndex }) {
  const location = lineAndColumn(text, match.index);
  const internal = existingProjectSuffix(projectRoot, match.value);
  const external = internal ? null : uniqueExternalMatch(externalIndex, match.value, projectRoot);
  const target = internal?.target || external?.target || '';
  const portable = internal ? portableReplacement(file.relative, location.lineText, target, projectRoot) : null;
  const replacementValue = portable?.text || target;
  const id = sha256(Buffer.from(`${file.relative}\0${match.index}\0${match.raw}`)).slice(0, 24);
  return {
    id, file: file.relative, line: location.line, column: location.column,
    offset: match.index, oldPath: match.value, oldText: match.raw,
    targetPath: target, targetType: target ? (fs.lstatSync(target).isDirectory() ? 'directory' : 'file') : '',
    replacementText: replacementValue ? encodeReplacementLike(match.raw, replacementValue) : '',
    replacementDisplay: replacementValue,
    adapter: portable?.adapter || (internal ? '이 PC 실제 경로' : external ? '외부 경로 직접 확인' : ''),
    kind: internal ? 'project-root' : external ? 'external-unique' : 'unresolved',
    confidence: internal ? 'safe' : external ? 'review' : 'unresolved',
    targetExists: !!target, selectedByDefault: !!internal,
    reason: internal ? `프로젝트 내부의 동일한 하위 경로(${internal.suffix})가 확인됨${portable ? ` · ${portable.adapter} 형식 사용` : ''}`
      : external ? `허용된 NAS Drive 범위에서 유일한 외부 대상(${external.matchedParts}개 경로 조각 일치)이 확인됨`
      : '대상이 없거나 둘 이상이어서 자동 변경하지 않음',
    expectedFileSha256: sha256(file.buffer)
  };
}

function createPlan({ projectRoot, allowedRoots = [], stateDir, maxFiles, maxFileBytes, maxCandidates, unavailableRelativePaths = [], availabilityVerified = process.platform !== 'win32' } = {}) {
  if (!projectRoot) throw new Error('프로젝트 폴더를 선택해 주세요.');
  if (process.platform === 'win32' && !availabilityVerified) throw new Error('온라인 전용 파일 상태를 확인하지 못해 분석을 중단했습니다. 파일을 내려받거나 다시 시도해 주세요.');
  const root = path.resolve(projectRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error('선택한 프로젝트 경로가 폴더가 아닙니다.');
  const rootReal = fs.realpathSync(root);
  const safeAllowedRoots = allowedRoots.map(item => path.resolve(item)).filter(item => fs.existsSync(item));
  if (!safeAllowedRoots.some(item => { try { return isInside(fs.realpathSync(item), rootReal); } catch { return false; } })) throw new Error('연결된 NAS Drive 안의 프로젝트만 분석할 수 있습니다.');
  const externalIndex = buildAllowedIndex(safeAllowedRoots);
  const candidates = [];
  const walk = walkTextFiles(root, { maxFiles, maxFileBytes, unavailableRelativePaths });
  const candidateLimit = Number(maxCandidates || DEFAULT_MAX_CANDIDATES);
  let truncatedCandidates = false;
  outer: for (const file of walk.files) {
    for (const match of extractAbsolutePaths(file.text)) {
      if (candidates.length >= candidateLimit) { truncatedCandidates = true; break outer; }
      candidates.push(candidateForMatch({ file, text: file.text, match, projectRoot: root, externalIndex }));
    }
  }
  const plan = {
    schemaVersion: 2, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    projectRoot: root, projectRootReal: rootReal, allowedRoots: safeAllowedRoots,
    scanComplete: !walk.stats.truncatedFiles && !truncatedCandidates,
    summary: {
      scannedFiles: walk.files.length,
      safe: candidates.filter(item => item.confidence === 'safe').length,
      review: candidates.filter(item => item.confidence === 'review').length,
      unresolved: candidates.filter(item => item.confidence === 'unresolved').length,
      skippedUnavailable: walk.stats.skippedUnavailable, skippedEncoding: walk.stats.skippedEncoding,
      skippedSensitive: walk.stats.skippedSensitive, skippedLarge: walk.stats.skippedLarge
    }, candidates
  };
  if (stateDir) {
    const planDir = path.join(stateDir, 'path-portability', 'plans');
    fs.mkdirSync(planDir, { recursive: true });
    plan.planFile = path.join(planDir, `${plan.id}.json`);
    atomicWrite(plan.planFile, Buffer.from(JSON.stringify(plan, null, 2), 'utf8'));
  }
  return plan;
}

function atomicWrite(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const swap = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.swap`;
  fs.writeFileSync(temp, buffer);
  let movedExisting = false;
  try {
    if (fs.existsSync(file)) { fs.renameSync(file, swap); movedExisting = true; }
    fs.renameSync(temp, file);
    if (movedExisting) fs.unlinkSync(swap);
  } catch (error) {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
    try { if (movedExisting && !fs.existsSync(file)) fs.renameSync(swap, file); } catch {}
    throw error;
  }
}

function validateCandidate(plan, item) {
  if (!item || !item.id || !item.targetPath || !item.replacementText || item.confidence === 'unresolved') throw new Error('적용할 수 없는 경로 항목입니다.');
  const target = safeTargetInfo(item.targetPath, plan.allowedRoots || []);
  if (item.targetType && target.type !== item.targetType) throw new Error(`${item.file}:${item.line} 대상 종류가 미리보기와 달라졌습니다.`);
  const file = path.resolve(plan.projectRoot, item.file);
  const projectReal = fs.realpathSync(plan.projectRoot);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('심볼릭 링크 파일은 변경할 수 없습니다.');
  if (!isInside(projectReal, fs.realpathSync(file)) || isSensitiveRelative(item.file)) throw new Error('프로젝트 경계를 벗어나거나 제외된 파일은 변경할 수 없습니다.');
  return file;
}

function buildChangeReport(selected, transactionId) {
  const lines = ['# NAS Drive 경로 변경 기록', '', `- 적용 시각: ${new Date().toISOString()}`, `- 작업 ID: ${transactionId}`, '- 전체 절대 경로는 공유·Git 노출을 줄이기 위해 기록하지 않습니다.', '', '## 변경 위치', ''];
  for (const item of selected) lines.push(`- \`${normalizeSlashes(item.file)}:${item.line}\` — ${item.adapter || item.kind}`);
  lines.push('', '자세한 이전/이후 경로와 되돌리기 정보는 이 Windows 계정의 NAS Drive 로컬 상태에만 보관됩니다.', '');
  return Buffer.from(lines.join('\n'), 'utf8');
}

function applyPlan({ plan, candidateIds, stateDir }) {
  if (!plan || Number(plan.schemaVersion || 0) < 1) throw new Error('지원하지 않는 경로 계획입니다. 다시 분석해 주세요.');
  const chosen = new Set(candidateIds || []);
  const selected = plan.candidates.filter(item => chosen.has(item.id));
  if (selected.length === 0) throw new Error('적용할 경로를 하나 이상 선택해 주세요.');
  const byFile = new Map();
  for (const item of selected) {
    const file = validateCandidate(plan, item);
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(item);
  }
  const prepared = [];
  for (const [file, items] of byFile) {
    const original = fs.readFileSync(file);
    const expectedHashes = new Set(items.map(item => item.expectedFileSha256));
    if (expectedHashes.size !== 1 || !expectedHashes.has(sha256(original))) throw new Error(`${path.relative(plan.projectRoot, file)} 파일이 미리보기 이후 변경되어 아무 파일도 변경하지 않았습니다.`);
    const decoded = decodeUtf8(original);
    if (decoded === null) throw new Error(`${path.relative(plan.projectRoot, file)} 파일 인코딩이 달라져 아무 파일도 변경하지 않았습니다.`);
    let text = decoded.text;
    const ascending = [...items].sort((a, b) => a.offset - b.offset);
    for (let index = 1; index < ascending.length; index += 1) {
      if (ascending[index].offset < ascending[index - 1].offset + ascending[index - 1].oldText.length) throw new Error(`${path.relative(plan.projectRoot, file)} 파일의 변경 범위가 겹칩니다.`);
    }
    for (const item of [...ascending].reverse()) {
      if (text.slice(item.offset, item.offset + item.oldText.length) !== item.oldText) throw new Error(`${item.file}:${item.line} 경로가 달라져 아무 파일도 변경하지 않았습니다.`);
      const location = lineAndColumn(text, item.offset);
      const portable = item.kind === 'project-root' ? portableReplacement(item.file, location.lineText, item.targetPath, plan.projectRoot) : null;
      const expectedReplacement = encodeReplacementLike(item.oldText, portable?.text || item.targetPath);
      if (item.replacementText !== expectedReplacement) throw new Error(`${item.file}:${item.line} 변경 내용이 안전한 미리보기와 다릅니다.`);
      text = text.slice(0, item.offset) + item.replacementText + text.slice(item.offset + item.oldText.length);
    }
    const content = Buffer.from(text, 'utf8');
    const next = decoded.hasBom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), content]) : content;
    prepared.push({ file, relative: path.relative(plan.projectRoot, file), original, next, changes: items.length });
  }
  const transaction = { schemaVersion: 2, id: crypto.randomUUID(), planId: plan.id, createdAt: new Date().toISOString(), projectRoot: plan.projectRoot, files: [] };
  const transactionDir = path.join(stateDir, 'path-portability', 'transactions', transaction.id);
  fs.mkdirSync(transactionDir, { recursive: true });
  const reportFile = path.join(plan.projectRoot, CHANGE_REPORT_NAME);
  const reportOriginal = fs.existsSync(reportFile) ? fs.readFileSync(reportFile) : null;
  prepared.push({ file: reportFile, relative: CHANGE_REPORT_NAME, original: reportOriginal, next: buildChangeReport(selected, transaction.id), changes: selected.length, deleteOnUndo: reportOriginal === null });
  for (const item of prepared) {
    const backup = path.join(transactionDir, `${transaction.files.length}.bak`);
    if (item.original !== null) fs.writeFileSync(backup, item.original);
    transaction.files.push({ file: item.relative, backup: item.original === null ? '' : backup, deleteOnUndo: !!item.deleteOnUndo, beforeSha256: item.original === null ? '' : sha256(item.original), afterSha256: sha256(item.next), changes: item.changes });
  }
  transaction.transactionFile = path.join(transactionDir, 'transaction.json');
  atomicWrite(transaction.transactionFile, Buffer.from(JSON.stringify(transaction, null, 2), 'utf8'));
  const applied = [];
  try {
    for (const item of prepared) {
      if (item.original === null) {
        if (fs.existsSync(item.file)) throw new Error(`${item.relative} 파일이 준비 후 생성되었습니다.`);
      } else {
        if (!fs.existsSync(item.file) || sha256(fs.readFileSync(item.file)) !== sha256(item.original)) throw new Error(`${item.relative} 파일이 준비 후 변경되었습니다.`);
      }
      atomicWrite(item.file, item.next); applied.push(item);
    }
  } catch (error) {
    for (const item of applied.reverse()) { try { if (item.original === null) fs.unlinkSync(item.file); else atomicWrite(item.file, item.original); } catch {} }
    throw new Error(`경로 적용 중 오류가 발생해 변경을 복구했습니다: ${error.message}`);
  }
  return transaction;
}

function undoTransaction(transaction) {
  const prepared = [];
  for (const item of transaction.files || []) {
    const file = path.resolve(transaction.projectRoot, item.file);
    if (!isInside(transaction.projectRoot, file)) throw new Error('프로젝트 경계를 벗어난 복구 요청입니다.');
    if (!fs.existsSync(file)) throw new Error(`${item.file} 파일이 없어 아무 파일도 복구하지 않았습니다.`);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`${item.file} 파일이 심볼릭 링크로 바뀌어 아무 파일도 복구하지 않았습니다.`);
    const current = fs.readFileSync(file);
    if (sha256(current) !== item.afterSha256) throw new Error(`${item.file} 파일이 적용 후 다시 변경되어 아무 파일도 복구하지 않았습니다.`);
    prepared.push({ item, file, current, original: item.deleteOnUndo ? null : fs.readFileSync(item.backup) });
  }
  const restored = [];
  try {
    for (const entry of prepared) {
      if (!fs.existsSync(entry.file) || sha256(fs.readFileSync(entry.file)) !== sha256(entry.current)) throw new Error(`${entry.item.file} 파일이 복구 준비 후 변경되었습니다.`);
      if (entry.original === null) fs.unlinkSync(entry.file); else atomicWrite(entry.file, entry.original);
      restored.push(entry);
    }
  } catch (error) {
    for (const entry of restored.reverse()) { try { atomicWrite(entry.file, entry.current); } catch {} }
    throw new Error(`복구 중 오류가 발생해 적용 상태를 유지했습니다: ${error.message}`);
  }
  return { restored: prepared.length };
}

function updatePlanMapping({ plan, candidateId, targetPath }) {
  const candidate = (plan.candidates || []).find(item => item.id === candidateId);
  if (!candidate) throw new Error('선택한 경로 항목을 찾을 수 없습니다. 다시 분석해 주세요.');
  const target = safeTargetInfo(targetPath, plan.allowedRoots || []);
  candidate.targetPath = target.absolute; candidate.targetType = target.type;
  candidate.replacementText = encodeReplacementLike(candidate.oldText, target.absolute);
  candidate.replacementDisplay = target.absolute; candidate.adapter = '사용자 직접 선택';
  candidate.kind = 'manual'; candidate.confidence = 'review'; candidate.targetExists = true; candidate.selectedByDefault = false;
  candidate.reason = '사용자가 연결된 NAS Drive 안에서 대상을 직접 선택함';
  plan.summary.safe = plan.candidates.filter(item => item.confidence === 'safe').length;
  plan.summary.review = plan.candidates.filter(item => item.confidence === 'review').length;
  plan.summary.unresolved = plan.candidates.filter(item => item.confidence === 'unresolved').length;
  return plan;
}

module.exports = { createPlan, applyPlan, undoTransaction, updatePlanMapping, extractAbsolutePaths, isInside, CHANGE_REPORT_NAME };
