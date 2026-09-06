const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const NOTE_STUDIO_ROOT = '.note_studio';
const INDEX_VERSION = 1;
const MAX_NOTE_BYTES = 5 * 1024 * 1024;
const MAX_VERSIONS_PER_NOTE = 100;
const ALLOWED_TYPES = new Set(['block', 'markdown', 'text', 'code']);

const nowIso = () => new Date().toISOString();
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

const atomicWriteJson = (targetPath, value) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${targetPath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporaryPath, targetPath);
  } finally {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
  }
};

const readJson = (targetPath, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
};

const normalizeTitle = (value) => {
  const title = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
  return title || '제목 없는 노트';
};

const normalizeType = (value) => {
  const type = String(value || 'block').toLowerCase();
  if (!ALLOWED_TYPES.has(type)) {
    const error = new Error('지원하지 않는 노트 형식입니다.');
    error.status = 400;
    throw error;
  }
  return type;
};

const emptyContentFor = (type) => type === 'block'
  ? { type: 'doc', content: [{ type: 'paragraph' }] }
  : '';

const validateContent = (type, content) => {
  const normalized = type === 'block'
    ? (content && typeof content === 'object' && !Array.isArray(content) ? content : emptyContentFor(type))
    : String(content ?? '');
  const bytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (bytes > MAX_NOTE_BYTES) {
    const error = new Error('노트 한 개의 최대 크기(5MB)를 초과했습니다.');
    error.status = 413;
    throw error;
  }
  return normalized;
};

const createNoteStudioStore = ({ personalRootPath }) => {
  if (!personalRootPath) throw new Error('personalRootPath is required');
  const root = path.join(path.resolve(personalRootPath), NOTE_STUDIO_ROOT);
  const indexPath = path.join(root, 'index.json');
  const notesRoot = path.join(root, 'notes');

  const ensureStore = () => {
    fs.mkdirSync(notesRoot, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(indexPath)) atomicWriteJson(indexPath, { version: INDEX_VERSION, notes: [] });
  };

  const readIndex = () => {
    ensureStore();
    const index = readJson(indexPath, { version: INDEX_VERSION, notes: [] });
    if (!Array.isArray(index.notes)) throw new Error('노트 인덱스가 손상되었습니다.');
    return index;
  };

  const writeIndex = (index) => atomicWriteJson(indexPath, { version: INDEX_VERSION, notes: index.notes });
  const noteRoot = (id) => {
    if (!isUuid(id)) {
      const error = new Error('잘못된 노트 ID입니다.');
      error.status = 400;
      throw error;
    }
    return path.join(notesRoot, id);
  };
  const contentPath = (id) => path.join(noteRoot(id), 'content.json');
  const versionsRoot = (id) => path.join(noteRoot(id), 'versions');

  const findMeta = (index, id, { includeDeleted = false } = {}) => {
    const meta = index.notes.find((note) => note.id === id);
    if (!meta || (!includeDeleted && meta.deletedAt)) {
      const error = new Error('노트를 찾을 수 없습니다.');
      error.status = 404;
      throw error;
    }
    return meta;
  };

  const readContent = (meta) => {
    const stored = readJson(contentPath(meta.id), null);
    if (!stored) throw Object.assign(new Error('노트 내용 파일이 없습니다.'), { status: 500 });
    return stored;
  };

  const snapshot = (meta, storedContent, reason = 'autosave') => {
    const versionId = `${String(meta.revision).padStart(8, '0')}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    atomicWriteJson(path.join(versionsRoot(meta.id), `${versionId}.json`), {
      versionId,
      noteId: meta.id,
      revision: meta.revision,
      title: meta.title,
      type: meta.type,
      language: meta.language || '',
      content: storedContent.content,
      createdAt: nowIso(),
      reason
    });
    const files = fs.readdirSync(versionsRoot(meta.id)).filter((name) => name.endsWith('.json')).sort();
    for (const oldName of files.slice(0, Math.max(0, files.length - MAX_VERSIONS_PER_NOTE))) {
      fs.rmSync(path.join(versionsRoot(meta.id), oldName), { force: true });
    }
  };

  const list = ({ deleted = false, query = '' } = {}) => {
    const index = readIndex();
    const needle = String(query || '').trim().toLocaleLowerCase('ko-KR');
    return index.notes
      .filter((note) => deleted ? !!note.deletedAt : !note.deletedAt)
      .filter((note) => {
        if (!needle) return true;
        if (`${note.title}\n${note.type}\n${note.language || ''}`.toLocaleLowerCase('ko-KR').includes(needle)) return true;
        try {
          const stored = readContent(note);
          return JSON.stringify(stored.content).toLocaleLowerCase('ko-KR').includes(needle);
        } catch { return false; }
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  };

  const get = (id, options = {}) => {
    const index = readIndex();
    const meta = findMeta(index, id, options);
    return { ...meta, content: readContent(meta).content };
  };

  const create = ({ title, type = 'block', language = '', parentId = null, content } = {}) => {
    const index = readIndex();
    const normalizedType = normalizeType(type);
    if (parentId) findMeta(index, parentId);
    const createdAt = nowIso();
    const meta = {
      id: crypto.randomUUID(),
      title: normalizeTitle(title),
      type: normalizedType,
      language: normalizedType === 'code' ? String(language || 'plaintext').slice(0, 50) : '',
      parentId: parentId || null,
      orderKey: Date.now(),
      revision: 1,
      attachments: [],
      createdAt,
      updatedAt: createdAt,
      deletedAt: null
    };
    const normalizedContent = validateContent(normalizedType, content ?? emptyContentFor(normalizedType));
    atomicWriteJson(contentPath(meta.id), { revision: meta.revision, content: normalizedContent });
    index.notes.push(meta);
    writeIndex(index);
    return { ...meta, content: normalizedContent };
  };

  const update = (id, changes = {}) => {
    const index = readIndex();
    const meta = findMeta(index, id);
    const expectedRevision = Number(changes.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== meta.revision) {
      const error = new Error('다른 창이나 기기에서 노트가 먼저 수정되었습니다.');
      error.status = 409;
      error.code = 'NOTE_REVISION_CONFLICT';
      error.latest = { ...meta };
      throw error;
    }
    const current = readContent(meta);
    snapshot(meta, current, String(changes.reason || 'autosave').slice(0, 40));
    if (Object.prototype.hasOwnProperty.call(changes, 'title')) meta.title = normalizeTitle(changes.title);
    if (Object.prototype.hasOwnProperty.call(changes, 'parentId')) {
      if (changes.parentId === id) throw Object.assign(new Error('노트를 자기 자신 아래로 이동할 수 없습니다.'), { status: 400 });
      if (changes.parentId) findMeta(index, changes.parentId);
      meta.parentId = changes.parentId || null;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'language') && meta.type === 'code') meta.language = String(changes.language || 'plaintext').slice(0, 50);
    const content = Object.prototype.hasOwnProperty.call(changes, 'content')
      ? validateContent(meta.type, changes.content)
      : current.content;
    meta.revision += 1;
    meta.updatedAt = nowIso();
    atomicWriteJson(contentPath(id), { revision: meta.revision, content });
    writeIndex(index);
    return { ...meta, content };
  };

  const moveToTrash = (id, expectedRevision) => {
    const index = readIndex();
    const meta = findMeta(index, id);
    if (Number(expectedRevision) !== meta.revision) throw Object.assign(new Error('삭제 전에 노트가 변경되었습니다.'), { status: 409, code: 'NOTE_REVISION_CONFLICT' });
    meta.deletedAt = nowIso();
    meta.updatedAt = meta.deletedAt;
    meta.revision += 1;
    writeIndex(index);
    return { ...meta };
  };

  const addAttachment = (id, attachment, expectedRevision) => {
    const index = readIndex();
    const meta = findMeta(index, id);
    if (Number(expectedRevision) !== meta.revision) throw Object.assign(new Error('첨부 전에 노트가 변경되었습니다.'), { status: 409, code: 'NOTE_REVISION_CONFLICT' });
    const nextAttachment = {
      id: crypto.randomUUID(),
      name: String(attachment.name || 'NAS 파일').slice(0, 255),
      path: String(attachment.path || ''),
      kind: attachment.kind === 'folder' ? 'folder' : 'file',
      addedAt: nowIso()
    };
    meta.attachments = [...(Array.isArray(meta.attachments) ? meta.attachments : []), nextAttachment];
    meta.revision += 1;
    meta.updatedAt = nowIso();
    writeIndex(index);
    return { note: { ...meta }, attachment: nextAttachment };
  };

  const removeAttachment = (id, attachmentId, expectedRevision) => {
    const index = readIndex();
    const meta = findMeta(index, id);
    if (Number(expectedRevision) !== meta.revision) throw Object.assign(new Error('첨부 제거 전에 노트가 변경되었습니다.'), { status: 409, code: 'NOTE_REVISION_CONFLICT' });
    const attachments = Array.isArray(meta.attachments) ? meta.attachments : [];
    if (!attachments.some((item) => item.id === attachmentId)) throw Object.assign(new Error('첨부 항목을 찾을 수 없습니다.'), { status: 404 });
    meta.attachments = attachments.filter((item) => item.id !== attachmentId);
    meta.revision += 1;
    meta.updatedAt = nowIso();
    writeIndex(index);
    return { ...meta };
  };

  const restore = (id) => {
    const index = readIndex();
    const meta = findMeta(index, id, { includeDeleted: true });
    if (!meta.deletedAt) return { ...meta };
    meta.deletedAt = null;
    meta.updatedAt = nowIso();
    meta.revision += 1;
    writeIndex(index);
    return { ...meta };
  };

  const removePermanently = (id) => {
    const index = readIndex();
    const meta = findMeta(index, id, { includeDeleted: true });
    if (!meta.deletedAt) throw Object.assign(new Error('먼저 노트를 휴지통으로 이동해야 합니다.'), { status: 409 });
    index.notes = index.notes.filter((note) => note.id !== id);
    writeIndex(index);
    fs.rmSync(noteRoot(id), { recursive: true, force: true });
    return { id };
  };

  const versions = (id) => {
    const index = readIndex();
    findMeta(index, id, { includeDeleted: true });
    const dir = versionsRoot(id);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort().reverse().map((name) => {
      const row = readJson(path.join(dir, name), null);
      return row ? { versionId: row.versionId, revision: row.revision, title: row.title, createdAt: row.createdAt, reason: row.reason } : null;
    }).filter(Boolean);
  };

  const restoreVersion = (id, versionId, expectedRevision) => {
    if (!/^[0-9]{8}-[0-9]+-[a-f0-9]{8}$/i.test(String(versionId || ''))) throw Object.assign(new Error('잘못된 버전 ID입니다.'), { status: 400 });
    const version = readJson(path.join(versionsRoot(id), `${versionId}.json`), null);
    if (!version) throw Object.assign(new Error('버전을 찾을 수 없습니다.'), { status: 404 });
    return update(id, { expectedRevision, title: version.title, language: version.language, content: version.content, reason: 'version-restore' });
  };

  return { list, get, create, update, moveToTrash, restore, removePermanently, versions, restoreVersion, addAttachment, removeAttachment };
};

module.exports = {
  NOTE_STUDIO_ROOT,
  MAX_NOTE_BYTES,
  MAX_VERSIONS_PER_NOTE,
  createNoteStudioStore,
  _test: { normalizeTitle, normalizeType, validateContent, atomicWriteJson }
};
