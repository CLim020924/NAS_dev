const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_ROOT = path.join(__dirname, 'data', 'pdf_annotations');
const MAX_ANNOTATIONS = 5000;
const MAX_POINTS_PER_STROKE = 5000;
const MAX_TEXT_LENGTH = 4000;
const MAX_SERIALIZED_BYTES = 2 * 1024 * 1024;
const TYPES = new Set(['highlight', 'ink', 'text']);

const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;

const getFilesystemIdentity = (targetPath) => {
  const stat = fs.statSync(targetPath);
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    birthtimeMs: Math.round(finite(stat.birthtimeMs)),
    size: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
  };
};

const sameIdentity = (left, right) => !!(
  left && right &&
  String(left.dev) === String(right.dev) &&
  String(left.ino) === String(right.ino) &&
  Number(left.birthtimeMs || 0) === Number(right.birthtimeMs || 0)
);

const normalizeAnnotation = (value, index) => {
  if (!value || !TYPES.has(value.type)) return null;
  const base = {
    id: String(value.id || `annotation-${index + 1}`).slice(0, 120),
    type: value.type,
    page: Math.max(1, Math.min(100000, Math.trunc(finite(value.page, 1)))),
    color: safeColor(value.color, value.type === 'highlight' ? '#fde047' : '#dc2626'),
    opacity: Math.max(0.05, Math.min(1, finite(value.opacity, value.type === 'highlight' ? 0.38 : 1))),
    createdAt: String(value.createdAt || new Date().toISOString()).slice(0, 40),
  };

  if (value.type === 'ink') {
    const points = Array.isArray(value.points) ? value.points.slice(0, MAX_POINTS_PER_STROKE) : [];
    if (points.length < 2) return null;
    return {
      ...base,
      width: Math.max(0.5, Math.min(20, finite(value.width, 2.5))),
      points: points.map((point) => ({ x: clamp01(point?.x), y: clamp01(point?.y) })),
    };
  }

  const rect = {
    x: clamp01(value.x),
    y: clamp01(value.y),
    width: Math.max(0.002, Math.min(1, finite(value.width, 0.1))),
    height: Math.max(0.002, Math.min(1, finite(value.height, 0.03))),
  };
  if (rect.x + rect.width > 1) rect.width = 1 - rect.x;
  if (rect.y + rect.height > 1) rect.height = 1 - rect.y;

  if (value.type === 'text') {
    const text = String(value.text || '').slice(0, MAX_TEXT_LENGTH);
    if (!text.trim()) return null;
    return {
      ...base,
      ...rect,
      text,
      fontSize: Math.max(8, Math.min(72, finite(value.fontSize, 16))),
      background: safeColor(value.background, '#ffffff'),
    };
  }
  return { ...base, ...rect };
};

const normalizeAnnotations = (values) => {
  if (!Array.isArray(values)) return [];
  if (values.length > MAX_ANNOTATIONS) {
    const error = new Error(`PDF 주석은 파일당 ${MAX_ANNOTATIONS.toLocaleString()}개까지 저장할 수 있습니다.`);
    error.status = 413;
    throw error;
  }
  return values.map(normalizeAnnotation).filter(Boolean);
};

const getStorePaths = (basePath, targetPath) => {
  const relativePath = path.relative(basePath, targetPath).replace(/\\/g, '/');
  const accountDir = path.join(STORE_ROOT, sha256(path.resolve(basePath)));
  return {
    relativePath,
    accountDir,
    recordPath: path.join(accountDir, `${sha256(relativePath)}.json`),
  };
};

const readRecord = (recordPath) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
    return parsed && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
};

const findMovedRecord = (accountDir, identity, requestedPath) => {
  if (!fs.existsSync(accountDir)) return null;
  for (const entry of fs.readdirSync(accountDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const candidatePath = path.join(accountDir, entry.name);
    if (candidatePath === requestedPath) continue;
    const candidate = readRecord(candidatePath);
    if (sameIdentity(candidate?.pdf?.identity, identity)) return { candidate, candidatePath };
  }
  return null;
};

const loadPdfAnnotations = (basePath, targetPath) => {
  const paths = getStorePaths(basePath, targetPath);
  const identity = getFilesystemIdentity(targetPath);
  let record = readRecord(paths.recordPath);
  let movedFrom = null;
  if (!record) {
    const moved = findMovedRecord(paths.accountDir, identity, paths.recordPath);
    record = moved?.candidate || null;
    movedFrom = moved?.candidatePath || null;
  }
  return {
    revision: Math.max(0, Number(record?.revision || 0)),
    annotations: normalizeAnnotations(record?.annotations || []),
    identity,
    movedFrom,
    ...paths,
  };
};

const savePdfAnnotations = (basePath, targetPath, { expectedRevision, annotations }) => {
  const loaded = loadPdfAnnotations(basePath, targetPath);
  const expected = Number(expectedRevision);
  if (!Number.isInteger(expected) || expected < 0) {
    const error = new Error('PDF 주석 revision이 필요합니다.');
    error.status = 400;
    throw error;
  }
  if (expected !== loaded.revision) {
    const error = new Error('다른 창에서 PDF 주석이 변경되었습니다. 최신 내용을 다시 불러와 주세요.');
    error.status = 409;
    error.code = 'PDF_ANNOTATION_CONFLICT';
    error.current = { revision: loaded.revision, annotations: loaded.annotations };
    throw error;
  }

  const normalized = normalizeAnnotations(annotations);
  const record = {
    version: 1,
    revision: loaded.revision + 1,
    pdf: {
      relativePath: loaded.relativePath,
      identity: loaded.identity,
      size: loaded.identity.size,
      mtimeMs: loaded.identity.mtimeMs,
    },
    annotations: normalized,
    updatedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized) > MAX_SERIALIZED_BYTES) {
    const error = new Error('PDF 주석 데이터가 파일당 2MB 제한을 초과했습니다.');
    error.status = 413;
    throw error;
  }

  fs.mkdirSync(loaded.accountDir, { recursive: true, mode: 0o700 });
  const tempPath = `${loaded.recordPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, serialized, { mode: 0o600 });
  fs.renameSync(tempPath, loaded.recordPath);
  if (loaded.movedFrom && loaded.movedFrom !== loaded.recordPath) {
    try { fs.unlinkSync(loaded.movedFrom); } catch {}
  }
  return { revision: record.revision, annotations: normalized, updatedAt: record.updatedAt };
};

module.exports = {
  MAX_ANNOTATIONS,
  loadPdfAnnotations,
  savePdfAnnotations,
  _test: { normalizeAnnotation, normalizeAnnotations, sameIdentity, getStorePaths },
};
