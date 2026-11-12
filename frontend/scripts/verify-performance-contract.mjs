import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, '..');
const read = (relativePath) => fs.readFileSync(path.join(frontendRoot, relativePath), 'utf8');

const app = read('src/App.js');
const nas = read('src/components/NAS.js');
const fileViewer = read('src/components/NAS/FileViewer.js');
const sharedPreview = read('src/components/shared/FilePreviewSurface.js');

assert.match(app, /const NAS = lazy\(loadNasWorkspace\)/, 'NAS workspace must remain lazy-loaded');
assert.match(app, /nasMounted &&/, 'NAS workspace must not mount before first use');
assert.doesNotMatch(app, /socketIOClient|from ['"]socket\.io-client['"]/, 'App must reuse the shared Socket.IO connection');
assert.match(app, /import socket from ['"]\.\/socket['"]/, 'App must use the shared socket');

assert.match(nas, /if \(!showWorkspace\) return undefined;[\s\S]{0,240}\/api\/favorites/, 'hidden NAS must not load favorites');
assert.match(nas, /if \(showWorkspace\) loadDesktopItems\(\)/, 'file list must load when NAS becomes visible');
assert.match(nas, /if \(!showWorkspace\) return undefined;[\s\S]{0,1600}setInterval\(syncFiles/, 'hidden NAS must not keep fallback file polling');

for (const [label, source] of [['NAS file viewer', fileViewer], ['shared preview', sharedPreview]]) {
  assert.doesNotMatch(source, /from ['"]@monaco-editor\/react['"]/, `${label} must not eagerly import Monaco`);
  assert.doesNotMatch(source, /from ['"]react-pdf['"]/, `${label} must not eagerly import PDF.js`);
  assert.doesNotMatch(source, /from ['"]@onlyoffice\/document-editor-react['"]/, `${label} must not eagerly import OnlyOffice`);
}

console.log('Performance contract verified: lazy NAS/viewers, hidden-work pause, single shared socket.');
