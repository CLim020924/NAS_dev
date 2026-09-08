const path = require('path');

const LANGUAGE_CATALOG = Object.freeze([
  { id: 'plaintext', label: 'Plain text', mode: 'edit', extensions: ['.txt'], executable: false, previewable: false },
  { id: 'javascript', label: 'JavaScript', mode: 'execute', extensions: ['.js', '.mjs', '.cjs', '.jsx'], executable: true, interactive: true },
  { id: 'typescript', label: 'TypeScript', mode: 'execute', extensions: ['.ts', '.mts', '.cts', '.tsx'], executable: true, interactive: true, note: 'Node.js 내장 type stripping 범위에서 실행' },
  { id: 'python', label: 'Python', mode: 'execute', extensions: ['.py', '.pyw'], executable: true, interactive: true },
  { id: 'json', label: 'JSON', mode: 'validate', extensions: ['.json', '.jsonc'], executable: true, interactive: false },
  { id: 'html', label: 'HTML', mode: 'preview', extensions: ['.html', '.htm'], executable: false, previewable: true },
  { id: 'css', label: 'CSS', mode: 'preview', extensions: ['.css'], executable: false, previewable: true },
  { id: 'sql', label: 'SQL (SQLite)', mode: 'execute', extensions: ['.sql'], executable: true, interactive: false },
  { id: 'shell', label: 'Shell', mode: 'execute', extensions: ['.sh', '.bash'], executable: true, interactive: true },
  { id: 'yaml', label: 'YAML', mode: 'validate', extensions: ['.yaml', '.yml'], executable: true, interactive: false },
  { id: 'markdown', label: 'Markdown', mode: 'preview', extensions: ['.md', '.markdown', '.mdx'], executable: false, previewable: true },
]);

const byId = new Map(LANGUAGE_CATALOG.map((item) => [item.id, item]));
const extensionMap = new Map(LANGUAGE_CATALOG.flatMap((item) => item.extensions.map((extension) => [extension, item.id])));

const languageInfo = (language) => byId.get(String(language || '').toLowerCase()) || null;

const detectLanguage = ({ fileName = '', content = '' } = {}) => {
  const name = path.basename(String(fileName || '')).toLowerCase();
  const extension = path.extname(name);
  if (extensionMap.has(extension)) return { language: extensionMap.get(extension), source: 'extension', confidence: 1 };
  if (['dockerfile', 'makefile'].includes(name)) return { language: 'shell', source: 'filename', confidence: 0.8 };
  const head = String(content || '').slice(0, 4096).trimStart();
  if (/^#!.*\bpython(?:3)?\b/m.test(head)) return { language: 'python', source: 'shebang', confidence: 0.95 };
  if (/^#!.*\b(?:bash|sh|zsh)\b/m.test(head)) return { language: 'shell', source: 'shebang', confidence: 0.95 };
  if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(head)) {
    try { JSON.parse(head); return { language: 'json', source: 'content', confidence: 0.85 }; } catch {}
  }
  if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(head)) return { language: 'html', source: 'content', confidence: 0.9 };
  if (/\b(?:def|import|from)\s+[A-Za-z_]/.test(head) && /:\s*(?:#.*)?(?:\r?\n|$)/.test(head)) return { language: 'python', source: 'content', confidence: 0.65 };
  if (/\b(?:const|let|var|function|console\.)\b/.test(head)) return { language: 'javascript', source: 'content', confidence: 0.6 };
  return { language: 'plaintext', source: 'fallback', confidence: 0 };
};

module.exports = { LANGUAGE_CATALOG, languageInfo, detectLanguage };
