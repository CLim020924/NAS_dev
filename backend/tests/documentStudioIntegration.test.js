const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const {
  getDocumentStudioCapabilities,
  processDocumentStudioJob,
} = require('../documentStudioService');

const execFileAsync = promisify(execFile);
const capabilities = getDocumentStudioCapabilities();

test('document studio converts two documents and produces one merged PDF', {
  skip: !capabilities.libreoffice || !capabilities.pdfMerge,
  timeout: 60000,
}, async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'document-studio-integration-'));
  try {
    const sourceDir = path.join(root, 'sources');
    const profileDir = path.join(root, 'source-profile');
    await Promise.all([fsp.mkdir(sourceDir, { recursive: true }), fsp.mkdir(profileDir, { recursive: true })]);
    const firstText = path.join(sourceDir, 'first.txt');
    const secondText = path.join(sourceDir, 'second.txt');
    await Promise.all([fsp.writeFile(firstText, 'first document', 'utf8'), fsp.writeFile(secondText, 'second document', 'utf8')]);
    await execFileAsync('/usr/bin/libreoffice', [
      '--headless', '--nologo', '--nodefault', '--nolockcheck', '--nofirststartwizard',
      `-env:UserInstallation=${new URL(`file://${profileDir}`).href}`,
      '--convert-to', 'odt', '--outdir', sourceDir, firstText, secondText,
    ], { timeout: 30000, env: { ...process.env, HOME: root } });

    const results = await processDocumentStudioJob({
      mode: 'merge-mixed-pdf',
      sources: [
        { path: path.join(sourceDir, 'first.odt'), name: 'first.odt' },
        { path: path.join(sourceDir, 'second.odt'), name: 'second.odt' },
      ],
      workspaceDir: path.join(root, 'workspace'),
      outputName: 'merged.pdf',
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'merged.pdf');
    assert.equal(fs.readFileSync(results[0].path, 'utf8', 0, 5).startsWith('%PDF'), true);
    assert.ok(fs.statSync(results[0].path).size > 1000);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('document studio converts an ODT document to DOCX and preserves same-format copies', {
  skip: !capabilities.libreoffice,
  timeout: 60000,
}, async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'document-studio-format-integration-'));
  try {
    const sourceDir = path.join(root, 'sources');
    const profileDir = path.join(root, 'source-profile');
    await Promise.all([fsp.mkdir(sourceDir, { recursive: true }), fsp.mkdir(profileDir, { recursive: true })]);
    const textPath = path.join(sourceDir, 'format-source.txt');
    await fsp.writeFile(textPath, 'format conversion test', 'utf8');
    await execFileAsync('/usr/bin/libreoffice', [
      '--headless', '--nologo', '--nodefault', '--nolockcheck', '--nofirststartwizard',
      `-env:UserInstallation=${new URL(`file://${profileDir}`).href}`,
      '--convert-to', 'odt', '--outdir', sourceDir, textPath,
    ], { timeout: 30000, env: { ...process.env, HOME: root } });

    const sourcePath = path.join(sourceDir, 'format-source.odt');
    const converted = await processDocumentStudioJob({
      mode: 'convert-pdf',
      sourceFormat: 'odt',
      outputFormat: 'docx',
      sources: [{ path: sourcePath, name: 'format-source.odt' }],
      workspaceDir: path.join(root, 'docx-workspace'),
    });
    assert.equal(converted[0].name, 'format-source.docx');
    assert.equal(converted[0].outputFormat, 'docx');
    assert.ok(fs.statSync(converted[0].path).size > 1000);

    const copied = await processDocumentStudioJob({
      mode: 'convert-pdf',
      sourceFormat: 'odt',
      outputFormat: 'odt',
      sources: [{ path: sourcePath, name: 'format-source.odt' }],
      workspaceDir: path.join(root, 'copy-workspace'),
    });
    assert.equal(copied[0].compatibility, 'original-format-copy');
    assert.deepEqual(await fsp.readFile(copied[0].path), await fsp.readFile(sourcePath));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
