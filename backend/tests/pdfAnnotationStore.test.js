const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadPdfAnnotations, savePdfAnnotations, _test } = require('../pdfAnnotationStore');

test('normalizes supported PDF annotations and rejects unsafe values', () => {
  const values = _test.normalizeAnnotations([
    { id: 'h1', type: 'highlight', page: 1, x: -1, y: 0.2, width: 3, height: 0.1, color: 'bad' },
    { id: 'i1', type: 'ink', page: 2, points: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.4 }], width: 99 },
    { id: 't1', type: 'text', page: 3, text: '메모', x: 0.2, y: 0.3, width: 0.2, height: 0.1 },
    { type: 'script', text: '<script>' },
  ]);
  assert.equal(values.length, 3);
  assert.equal(values[0].x, 0);
  assert.equal(values[0].width, 1);
  assert.equal(values[0].color, '#fde047');
  assert.equal(values[1].width, 20);
  assert.equal(values[2].text, '메모');
});

test('saves with optimistic revision and follows same-file rename identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-annotations-'));
  let accountDir = null;
  try {
    const original = path.join(root, 'first.pdf');
    const moved = path.join(root, 'moved.pdf');
    fs.writeFileSync(original, '%PDF-1.4\n');
    accountDir = _test.getStorePaths(root, original).accountDir;
    const initial = loadPdfAnnotations(root, original);
    assert.equal(initial.revision, 0);
    const saved = savePdfAnnotations(root, original, {
      expectedRevision: 0,
      annotations: [{ id: 'h1', type: 'highlight', page: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.05 }],
    });
    assert.equal(saved.revision, 1);
    assert.throws(() => savePdfAnnotations(root, original, { expectedRevision: 0, annotations: [] }), (error) => error.code === 'PDF_ANNOTATION_CONFLICT');
    assert.equal(savePdfAnnotations(root, original, { expectedRevision: 1, annotations: saved.annotations }).revision, 2);
    fs.renameSync(original, moved);
    const afterMove = loadPdfAnnotations(root, moved);
    assert.equal(afterMove.revision, 2);
    assert.equal(afterMove.annotations[0].id, 'h1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (accountDir) fs.rmSync(accountDir, { recursive: true, force: true });
  }
});
