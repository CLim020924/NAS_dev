const test = require('node:test');
const assert = require('node:assert/strict');
const { LANGUAGE_CATALOG, languageInfo, detectLanguage } = require('../noteStudioLanguageCatalog');

test('catalog assigns an explicit behavior to every Note Studio editor language', () => {
  assert.deepEqual(LANGUAGE_CATALOG.map((item) => item.id), ['plaintext', 'javascript', 'typescript', 'python', 'json', 'html', 'css', 'sql', 'shell', 'yaml', 'markdown']);
  assert.equal(languageInfo('python').mode, 'execute');
  assert.equal(languageInfo('markdown').mode, 'preview');
  assert.equal(languageInfo('plaintext').mode, 'edit');
});

test('language detection prioritizes extensions and then safe content hints', () => {
  assert.equal(detectLanguage({ fileName: 'main.ts', content: '' }).language, 'typescript');
  assert.equal(detectLanguage({ fileName: '', content: '#!/usr/bin/env python3\nprint(177)' }).language, 'python');
  assert.equal(detectLanguage({ fileName: '', content: '{"height":177}' }).language, 'json');
  assert.equal(detectLanguage({ fileName: '', content: 'ordinary note' }).language, 'plaintext');
});
