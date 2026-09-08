const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createNoteStudioStore, getFilesystemIdentity, findPathByFilesystemIdentity, MAX_VERSIONS_PER_NOTE, NOTE_MANAGER_ROOT } = require('../noteStudioService');

const withStore = (run) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-note-studio-'));
  try { return run(createNoteStudioStore({ personalRootPath: root }), root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
};

test('creates independent block, markdown, text and code notes', () => withStore((store, root) => {
  const types = ['block', 'markdown', 'text', 'code'];
  const notes = types.map((type) => store.create({ title: type, type, language: type === 'code' ? 'javascript' : '' }));
  assert.deepEqual(store.list().map((note) => note.type).sort(), types.sort());
  assert.equal(store.get(notes[0].id).content.type, 'doc');
  assert.equal(store.get(notes[3].id).language, 'javascript');
  assert.ok(fs.existsSync(path.join(root, '.note_studio', 'index.json')));
}));

test('requires an exact revision and preserves a version before saving', () => withStore((store) => {
  const note = store.create({ title: '원본', type: 'text', content: 'one' });
  const saved = store.update(note.id, { expectedRevision: 1, title: '수정', content: 'two', reason: 'manual' });
  assert.equal(saved.revision, 2);
  assert.equal(saved.content, 'two');
  const versions = store.versions(note.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].revision, 1);
  assert.throws(() => store.update(note.id, { expectedRevision: 1, content: 'stale' }), (error) => error.status === 409 && error.code === 'NOTE_REVISION_CONFLICT');
}));

test('moves notes to trash, restores them and only permanently deletes trashed notes', () => withStore((store) => {
  const note = store.create({ title: '삭제 테스트', type: 'markdown', content: '# hello' });
  assert.throws(() => store.removePermanently(note.id), (error) => error.status === 409);
  const trashed = store.moveToTrash(note.id, 1);
  assert.equal(store.list().length, 0);
  assert.equal(store.list({ deleted: true }).length, 1);
  const restored = store.restore(note.id);
  assert.equal(restored.deletedAt, null);
  store.moveToTrash(note.id, restored.revision);
  store.removePermanently(note.id);
  assert.throws(() => store.get(note.id), (error) => error.status === 404);
}));

test('searches title and content without leaking another store', () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-note-a-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-note-b-'));
  try {
    const a = createNoteStudioStore({ personalRootPath: rootA });
    const b = createNoteStudioStore({ personalRootPath: rootB });
    a.create({ title: '회의', type: 'text', content: '알파 일정' });
    b.create({ title: '개인', type: 'text', content: '알파 비밀' });
    assert.equal(a.list({ query: '알파' }).length, 1);
    assert.equal(b.list({ query: '회의' }).length, 0);
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test('restores an immutable prior version as a new revision', () => withStore((store) => {
  const note = store.create({ title: 'v1', type: 'text', content: 'first' });
  const v2 = store.update(note.id, { expectedRevision: 1, title: 'v2', content: 'second' });
  const firstVersion = store.versions(note.id).find((version) => version.revision === 1);
  const restored = store.restoreVersion(note.id, firstVersion.versionId, v2.revision);
  assert.equal(restored.title, 'v1');
  assert.equal(restored.content, 'first');
  assert.equal(restored.revision, 3);
}));

test('adds and removes opaque attachment records with revision checks', () => withStore((store) => {
  const note = store.create({ title: '첨부', type: 'text' });
  const added = store.addAttachment(note.id, { name: '보고서.pdf', path: '/업무/보고서.pdf', kind: 'file' }, 1);
  assert.equal(added.note.revision, 2);
  assert.equal(added.note.attachments.length, 1);
  assert.match(added.attachment.id, /^[0-9a-f-]{36}$/i);
  assert.throws(() => store.removeAttachment(note.id, added.attachment.id, 1), (error) => error.status === 409);
  const removed = store.removeAttachment(note.id, added.attachment.id, 2);
  assert.equal(removed.revision, 3);
  assert.deepEqual(removed.attachments, []);
}));

test('rewrites exact attachment paths after a NAS file rename', () => withStore((store) => {
  const note = store.create({ title: '문서 링크', type: 'block' });
  store.addAttachment(note.id, { name: '초안.docx', path: '/업무/초안.docx', kind: 'file' }, note.revision);
  const result = store.rewriteAttachmentPaths('/업무/초안.docx', '/업무/최종.docx');
  const refreshed = store.get(note.id);

  assert.deepEqual(result, { attachmentCount: 1, noteCount: 1 });
  assert.equal(refreshed.revision, 3);
  assert.equal(refreshed.attachments[0].path, '/업무/최종.docx');
  assert.equal(refreshed.attachments[0].name, '최종.docx');
  assert.ok(refreshed.attachments[0].movedAt);
}));

test('rewrites descendant attachment paths when a NAS folder moves', () => withStore((store) => {
  const first = store.create({ title: '첫 문서', type: 'text' });
  const second = store.create({ title: '둘째 문서', type: 'text' });
  store.addAttachment(first.id, { name: 'a.pdf', path: '/프로젝트/문서/a.pdf', kind: 'file' }, first.revision);
  store.addAttachment(second.id, { name: 'other.pdf', path: '/다른곳/other.pdf', kind: 'file' }, second.revision);

  const result = store.rewriteAttachmentPaths('/프로젝트', '/보관/프로젝트', { directory: true });
  assert.deepEqual(result, { attachmentCount: 1, noteCount: 1 });
  assert.equal(store.get(first.id).attachments[0].path, '/보관/프로젝트/문서/a.pdf');
  assert.equal(store.get(second.id).attachments[0].path, '/다른곳/other.pdf');
}));

test('recovers an externally renamed attachment by stable filesystem identity', () => withStore((store, root) => {
  const original = path.join(root, 'original.txt');
  const renamed = path.join(root, 'renamed.txt');
  fs.writeFileSync(original, 'stable');
  const identity = getFilesystemIdentity(original);
  fs.renameSync(original, renamed);
  assert.equal(findPathByFilesystemIdentity(root, identity), renamed);

  const note = store.create({ title: '외부 이동', type: 'text' });
  const added = store.addAttachment(note.id, { name: 'original.txt', path: '/original.txt', kind: 'file', identity }, note.revision);
  const updated = store.updateAttachmentLocation(note.id, added.attachment.id, { path: '/renamed.txt', identity }, added.note.revision);
  assert.equal(updated.attachments[0].path, '/renamed.txt');
  assert.equal(updated.attachments[0].name, 'renamed.txt');
}));

test('hydrates current page and attachment names into stable block references', () => withStore((store) => {
  const parent = store.create({ title: '부모', type: 'block' });
  const child = store.create({ title: '현재 하위 이름', type: 'block', parentId: parent.id });
  const attached = store.addAttachment(parent.id, { name: '현재 문서.docx', path: '/현재 문서.docx', kind: 'file' }, parent.revision);
  store.update(parent.id, {
    expectedRevision: attached.note.revision,
    content: { type: 'doc', content: [
      { type: 'noteLink', attrs: { noteId: child.id, label: '오래된 하위 이름' } },
      { type: 'nasResourceLink', attrs: { attachmentId: attached.attachment.id, label: '오래된 문서.docx' } }
    ] }
  });
  const content = store.get(parent.id).content.content;
  assert.equal(content[0].attrs.label, '현재 하위 이름');
  assert.equal(content[1].attrs.label, '현재 문서.docx');
}));

test('allows hierarchy changes but rejects parent cycles', () => withStore((store) => {
  const root = store.create({ title: 'root', type: 'text' });
  const child = store.create({ title: 'child', type: 'text', parentId: root.id });
  const grandchild = store.create({ title: 'grandchild', type: 'text', parentId: child.id });
  assert.throws(() => store.update(root.id, { expectedRevision: root.revision, parentId: grandchild.id }), (error) => error.status === 409 && error.code === 'NOTE_TREE_CYCLE');
  const detached = store.update(child.id, { expectedRevision: child.revision, parentId: null });
  assert.equal(detached.parentId, null);
}));

test('rejects oversized notes and bounds retained history', () => withStore((store) => {
  assert.throws(() => store.create({ type: 'text', content: 'x'.repeat(6 * 1024 * 1024) }), (error) => error.status === 413);
  let note = store.create({ type: 'text', content: '0' });
  for (let i = 0; i < MAX_VERSIONS_PER_NOTE + 3; i += 1) {
    note = store.update(note.id, { expectedRevision: note.revision, content: String(i) });
  }
  assert.equal(store.versions(note.id).length, MAX_VERSIONS_PER_NOTE);
}));

test('creates a visible NOTE MANAGER root without migrating legacy notes', () => withStore((store, root) => {
  const legacy = store.create({ title: '기존 노트', type: 'text' });
  assert.equal(legacy.notebookId, null);
  assert.equal(legacy.storageRelativePath, null);
  assert.ok(fs.statSync(path.join(root, NOTE_MANAGER_ROOT)).isDirectory());
  assert.deepEqual(store.listNotebooks(), []);
}));

test('creates notebook, page and child page as contained physical directories', () => withStore((store, root) => {
  const notebook = store.createNotebook({ title: '개발 / 노트북' });
  const page = store.create({ title: 'API: 설계', type: 'block', notebookId: notebook.id });
  const child = store.create({ title: '하위 * 페이지', type: 'code', parentId: page.id, language: 'python' });
  assert.equal(page.notebookId, notebook.id);
  assert.equal(child.notebookId, notebook.id);
  assert.equal(child.parentId, page.id);
  assert.ok(fs.statSync(path.join(root, ...page.storageRelativePath.split('/'))).isDirectory());
  assert.ok(fs.statSync(path.join(root, ...child.storageRelativePath.split('/'))).isDirectory());
  assert.ok(child.storageRelativePath.startsWith(`${page.storageRelativePath}/`));
  assert.ok(!page.directoryName.includes(':'));
}));

test('resolves a notebook terminal workspace without exposing another notebook', () => withStore((store, root) => {
  const first = store.createNotebook({ title: '첫 작업' });
  const second = store.createNotebook({ title: '둘째 작업' });
  const resolved = store.getNotebookWorkspace(first.id);
  assert.equal(resolved.notebook.id, first.id);
  assert.equal(resolved.notebook.path, `/${NOTE_MANAGER_ROOT}/${first.directoryName}`);
  assert.equal(resolved.absolutePath, path.join(root, NOTE_MANAGER_ROOT, first.directoryName));
  assert.notEqual(resolved.absolutePath, path.join(root, NOTE_MANAGER_ROOT, second.directoryName));
}));

test('resolves duplicate notebook and page folder names without overwriting', () => withStore((store, root) => {
  const first = store.createNotebook({ title: '업무' });
  const second = store.createNotebook({ title: '업무' });
  assert.equal(first.directoryName, '업무');
  assert.equal(second.directoryName, '업무 (2)');
  const a = store.create({ title: '회의', notebookId: first.id });
  const b = store.create({ title: '회의', notebookId: first.id });
  assert.equal(a.directoryName, '회의');
  assert.equal(b.directoryName, '회의 (2)');
  assert.ok(fs.existsSync(path.join(root, NOTE_MANAGER_ROOT, first.directoryName, b.directoryName)));
}));

test('enforces notebook boundaries and blocks unsafe logical-only page moves', () => withStore((store) => {
  const left = store.createNotebook({ title: '왼쪽' });
  const right = store.createNotebook({ title: '오른쪽' });
  const leftPage = store.create({ title: 'A', notebookId: left.id });
  const rightPage = store.create({ title: 'B', notebookId: right.id });
  assert.throws(() => store.create({ title: '침범', notebookId: right.id, parentId: leftPage.id }), (error) => error.code === 'NOTEBOOK_BOUNDARY');
  assert.throws(() => store.update(leftPage.id, { expectedRevision: 1, parentId: rightPage.id }), (error) => error.code === 'PHYSICAL_PAGE_MOVE_REQUIRED');
}));

test('keeps notebook registries isolated by account root', () => {
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-notebook-a-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-notebook-b-'));
  try {
    const a = createNoteStudioStore({ personalRootPath: rootA });
    const b = createNoteStudioStore({ personalRootPath: rootB });
    a.createNotebook({ title: 'A 전용' });
    assert.equal(a.listNotebooks().length, 1);
    assert.equal(b.listNotebooks().length, 0);
  } finally {
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  }
});

test('reports an externally missing notebook path and returns a stable conflict', () => withStore((store, root) => {
  const notebook = store.createNotebook({ title: '이동될 노트북' });
  fs.rmdirSync(path.join(root, NOTE_MANAGER_ROOT, notebook.directoryName));
  const listed = store.listNotebooks()[0];
  assert.equal(listed.available, false);
  assert.equal(listed.pathState, 'NOTE_PATH_MISSING');
  assert.throws(() => store.create({ title: '페이지', notebookId: notebook.id }), (error) => error.status === 409 && error.code === 'NOTE_PATH_MISSING');
}));

test('blocks deleting a managed parent while an active child remains', () => withStore((store) => {
  const notebook = store.createNotebook({ title: '보호' });
  const parent = store.create({ title: '부모', notebookId: notebook.id });
  store.create({ title: '자식', parentId: parent.id });
  assert.throws(() => store.moveToTrash(parent.id, parent.revision), (error) => error.status === 409 && error.code === 'NOTE_HAS_CHILDREN');
}));
