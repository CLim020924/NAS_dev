'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MAX_FILES = 5000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.env', '.go', '.h', '.hpp', '.html', '.ini',
  '.java', '.js', '.json', '.jsx', '.kt', '.md', '.mjs', '.php', '.properties', '.ps1',
  '.py', '.rb', '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.txt', '.vue', '.xml',
  '.yaml', '.yml', '.code-workspace'
]);
const IGNORED_DIRS = new Set(['.git', '.hg', '.svn', '.idea', '.venv', 'venv', 'node_modules', 'dist', 'build', 'coverage', '__pycache__']);
const SENSITIVE_NAMES = /(^|[\\/])(?:\.env(?:\.|$)|id_(?:rsa|ed25519)|credentials?|secrets?|tokens?)(?:[\\/]|\.|$)/i;
const WINDOWS_PATH = /(?:[A-Za-z]:\\(?:[^\x00-\x1f<>:"|?*\r\n]+\\)*[^\x00-\x1f<>:"|?*\r\n]*)/g;
const POSIX_PATH = /(?:^|[\s'"=(,:])((?:\/(?!\/)[^\x00\s'"`<>|;,)]*)+)/g;

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

function isLikelyText(filePath, buffer) {
  if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase()) && !/^(?:Dockerfile|Makefile|Procfile)$/i.test(path.basename(filePath))) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  return !sample.includes(0);
}

function walkTextFiles(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const maxFiles = Number(options.maxFiles || DEFAULT_MAX_FILES);
  const maxFileBytes = Number(options.maxFileBytes || DEFAULT_MAX_FILE_BYTES);
  const result = [];
  const queue = [root];
  while (queue.length && result.length < maxFiles) {
    const current = queue.shift();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (result.length >= maxFiles) break;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name.toLowerCase())) queue.push(full);
        continue;
      }
      if (!entry.isFile() || SENSITIVE_NAMES.test(path.relative(root, full))) continue;
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (stat.size > maxFileBytes) continue;
      const buffer = fs.readFileSync(full);
      if (isLikelyText(full, buffer)) result.push({ full, relative: path.relative(root, full), buffer });
    }
  }
  return result;
}

function extractAbsolutePaths(text) {
  const found = [];
  for (const match of text.matchAll(WINDOWS_PATH)) {
    const value = match[0].replace(/[\s.]+$/, '');
    if (value.length > 3) found.push({ value, index: match.index });
  }
  for (const match of text.matchAll(POSIX_PATH)) {
    const value = match[1].replace(/[\s.]+$/, '');
    const offset = match[0].lastIndexOf(match[1]);
    if (value.length > 1 && !/^\/(?:api|assets?|static|images?|favicon)(?:\/|$)/i.test(value)) found.push({ value, index: match.index + offset });
  }
  return found.sort((a, b) => a.index - b.index).filter((item, index, all) => index === 0 || item.index !== all[index - 1].index);
}

function sourceParts(value) {
  return normalizeSlashes(value).split('/').filter(Boolean);
}

function existingProjectSuffix(projectRoot, absoluteValue) {
  const parts = sourceParts(absoluteValue);
  for (let length = Math.min(parts.length, 12); length >= 2; length -= 1) {
    const suffix = parts.slice(-length);
    const candidate = path.resolve(projectRoot, ...suffix);
    if (!isInside(projectRoot, candidate)) continue;
    try {
      if (fs.existsSync(candidate)) return { target: candidate, suffix: suffix.join(path.sep), matchedParts: length };
    } catch {}
  }
  return null;
}

function buildAllowedIndex(roots, maxEntries = 20000) {
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
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name.toLowerCase())) queue.push(full);
      } else if (entry.isFile()) {
        const key = entry.name.toLowerCase();
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(full);
      }
    }
  }
  return index;
}

function uniqueExternalMatch(index, absoluteValue, projectRoot) {
  const parts = sourceParts(absoluteValue);
  const base = (parts[parts.length - 1] || '').toLowerCase();
  if (!base) return null;
  const candidates = (index.get(base) || []).filter(item => !isInside(projectRoot, item));
  let best = [];
  let bestLength = 0;
  for (const candidate of candidates) {
    const localParts = normalizeSlashes(candidate).split('/').filter(Boolean);
    let matched = 0;
    while (matched < parts.length && matched < localParts.length && parts[parts.length - 1 - matched].toLowerCase() === localParts[localParts.length - 1 - matched].toLowerCase()) matched += 1;
    if (matched > bestLength) { bestLength = matched; best = [candidate]; }
    else if (matched === bestLength) best.push(candidate);
  }
  return bestLength >= 2 && best.length === 1 ? { target: best[0], matchedParts: bestLength } : null;
}

function lineAndColumn(text, offset) {
  const before = text.slice(0, offset);
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

function createPlan({ projectRoot, allowedRoots = [], stateDir, maxFiles, maxFileBytes } = {}) {
  if (!projectRoot) throw new Error('프로젝트 폴더를 선택해 주세요.');
  const root = path.resolve(projectRoot);
  if (!fs.statSync(root).isDirectory()) throw new Error('선택한 프로젝트 경로가 폴더가 아닙니다.');
  const safeAllowedRoots = allowedRoots.map(item => path.resolve(item)).filter(item => fs.existsSync(item));
  const externalIndex = buildAllowedIndex(safeAllowedRoots);
  const candidates = [];
  const files = walkTextFiles(root, { maxFiles, maxFileBytes });
  for (const file of files) {
    const text = file.buffer.toString('utf8');
    for (const match of extractAbsolutePaths(text)) {
      const location = lineAndColumn(text, match.index);
      const internal = existingProjectSuffix(root, match.value);
      const external = internal ? null : uniqueExternalMatch(externalIndex, match.value, root);
      const kind = internal ? 'project-root' : external ? 'external-unique' : 'unresolved';
      const target = internal?.target || external?.target || '';
      const id = sha256(Buffer.from(`${file.relative}\0${match.index}\0${match.value}`)).slice(0, 24);
      candidates.push({
        id, file: file.relative, line: location.line, column: location.column,
        offset: match.index, oldPath: match.value, suggestedPath: target,
        kind, confidence: internal ? 'safe' : external ? 'review' : 'unresolved',
        targetExists: !!target, selectedByDefault: !!internal,
        reason: internal ? `프로젝트 내부의 동일한 하위 경로(${internal.suffix})가 확인됨`
          : external ? `허용된 NAS Drive 범위에서 유일한 외부 대상(${external.matchedParts}개 경로 조각 일치)이 확인됨`
          : '대상이 없거나 둘 이상이어서 자동 변경하지 않음',
        expectedFileSha256: sha256(file.buffer)
      });
    }
  }
  const plan = {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    projectRoot: root,
    allowedRoots: safeAllowedRoots,
    summary: {
      scannedFiles: files.length,
      safe: candidates.filter(item => item.confidence === 'safe').length,
      review: candidates.filter(item => item.confidence === 'review').length,
      unresolved: candidates.filter(item => item.confidence === 'unresolved').length
    },
    candidates
  };
  if (stateDir) {
    const planDir = path.join(stateDir, 'path-portability', 'plans');
    fs.mkdirSync(planDir, { recursive: true });
    plan.planFile = path.join(planDir, `${plan.id}.json`);
    fs.writeFileSync(plan.planFile, JSON.stringify(plan, null, 2), 'utf8');
  }
  return plan;
}

function atomicWrite(file, buffer) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, buffer);
  fs.renameSync(temp, file);
}

function applyPlan({ plan, candidateIds, stateDir }) {
  const chosen = new Set(candidateIds || []);
  const selected = plan.candidates.filter(item => chosen.has(item.id) && item.suggestedPath && item.confidence !== 'unresolved');
  const byFile = new Map();
  for (const item of selected) {
    if (!byFile.has(item.file)) byFile.set(item.file, []);
    byFile.get(item.file).push(item);
  }
  const transaction = { schemaVersion: 1, id: crypto.randomUUID(), planId: plan.id, createdAt: new Date().toISOString(), projectRoot: plan.projectRoot, files: [] };
  const transactionDir = path.join(stateDir, 'path-portability', 'transactions', transaction.id);
  fs.mkdirSync(transactionDir, { recursive: true });
  for (const [relativeFile, items] of byFile) {
    const file = path.resolve(plan.projectRoot, relativeFile);
    if (!isInside(plan.projectRoot, file)) throw new Error('프로젝트 경계를 벗어난 파일은 변경할 수 없습니다.');
    const original = fs.readFileSync(file);
    const expectedHashes = new Set(items.map(item => item.expectedFileSha256));
    if (expectedHashes.size !== 1 || !expectedHashes.has(sha256(original))) throw new Error(`${relativeFile} 파일이 미리보기 이후 변경되어 적용을 중단했습니다.`);
    let text = original.toString('utf8');
    for (const item of [...items].sort((a, b) => b.offset - a.offset)) {
      if (text.slice(item.offset, item.offset + item.oldPath.length) !== item.oldPath) throw new Error(`${relativeFile}:${item.line} 경로가 달라져 적용을 중단했습니다.`);
      text = text.slice(0, item.offset) + item.suggestedPath + text.slice(item.offset + item.oldPath.length);
    }
    const backup = path.join(transactionDir, `${transaction.files.length}.bak`);
    fs.writeFileSync(backup, original);
    atomicWrite(file, Buffer.from(text, 'utf8'));
    transaction.files.push({ file: relativeFile, backup, beforeSha256: sha256(original), afterSha256: sha256(Buffer.from(text, 'utf8')), changes: items.length });
  }
  transaction.transactionFile = path.join(transactionDir, 'transaction.json');
  fs.writeFileSync(transaction.transactionFile, JSON.stringify(transaction, null, 2), 'utf8');
  return transaction;
}

function undoTransaction(transaction) {
  for (const item of transaction.files || []) {
    const file = path.resolve(transaction.projectRoot, item.file);
    if (!isInside(transaction.projectRoot, file)) throw new Error('프로젝트 경계를 벗어난 복구 요청입니다.');
    const current = fs.readFileSync(file);
    if (sha256(current) !== item.afterSha256) throw new Error(`${item.file} 파일이 적용 후 다시 변경되어 자동 복구하지 않았습니다.`);
    atomicWrite(file, fs.readFileSync(item.backup));
  }
  return { restored: (transaction.files || []).length };
}

module.exports = { createPlan, applyPlan, undoTransaction, extractAbsolutePaths, isInside };
