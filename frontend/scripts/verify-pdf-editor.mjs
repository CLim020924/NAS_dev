import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformSync } from '@babel/core';

const loadSourceModule = (relativePath) => {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const output = transformSync(source, {
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
  });
  const loaded = { exports: {} };
  Function('module', 'exports', output.code)(loaded, loaded.exports);
  return loaded.exports;
};

const selection = loadSourceModule('../src/components/NAS/pdfSelection.js');
const zoom = loadSourceModule('../src/components/NAS/pdfZoom.js');
const workspaceSource = fs.readFileSync(new URL('../src/components/NAS/PdfWorkspace.js', import.meta.url), 'utf8');

const items = [
  { text: 'Alpha', left: 10, right: 40, top: 10, bottom: 20, width: 30, height: 10 },
  { text: 'Beta', left: 48, right: 72, top: 10, bottom: 20, width: 24, height: 10 },
  { text: 'Indented', left: 28, right: 76, top: 30, bottom: 40, width: 48, height: 10 },
];
const region = { left: 0, right: 100, top: 0, bottom: 100 };
assert.equal(selection.reconstructPdfRegionText(items, region), 'Alpha Beta\n   Indented');
assert.equal(selection.reconstructPdfPlainText(items, region), 'Alpha Beta\nIndented');
assert.equal(selection.getPdfHighlightRects(items, { left: 20, right: 60, top: 0, bottom: 25 }).length, 2);
assert.deepEqual(selection.normalizeDragRect({ x: 90, y: 80 }, { x: 10, y: 20 }, { width: 100, height: 100 }), { left: 10, top: 20, right: 90, bottom: 80, width: 80, height: 60 });
assert.equal(zoom.stepPdfZoom(1, 1), 1.15);
for (const label of ['선택', '형광펜', '펜', '텍스트 상자', '서식 유지 복사', '일반 텍스트 복사', '주석 지우기']) assert.match(workspaceSource, new RegExp(label));
assert.match(workspaceSource, /pdf-annotations/);
assert.match(workspaceSource, /pdf-ocr-region/);
assert.match(workspaceSource, /event\.ctrlKey \|\| event\.metaKey/);
assert.match(workspaceSource, /saveQueuedRef\.current = true/);
assert.match(workspaceSource, /do \{[\s\S]*\} while \(saveQueuedRef\.current\)/);
assert.match(workspaceSource, /saveRetryDelayRef\.current = Math\.min\(30000, delay \* 2\)/);
assert.doesNotMatch(workspaceSource, /setTimeout\(saveAnnotations, 1200\)/);

console.log('[pdf editor] tools, text layout reconstruction, highlight clipping, zoom, and persistence wiring verified');
