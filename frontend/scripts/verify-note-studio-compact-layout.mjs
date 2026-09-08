import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const noteStudio = read('src/components/NoteStudio/NoteStudio.js');
const noteCss = read('src/components/NoteStudio/NoteStudio.css');
const appWindows = read('src/components/GlobalAppWindowLayer.js');
const platform = read('src/components/ServicePlatform.js');
const theme = read('src/contexts/ThemeContext.js');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(noteStudio.includes('className="note-studio-shell"'), 'Note Studio must scope compact label rules.');
assert(noteStudio.includes('minHeight: 40, maxHeight: 40'), 'The note title/action row must remain 40px tall.');
assert(noteStudio.includes("codeRunning ? '실행 중' : '실행'"), 'The code action must use the compact run label.');
assert(!noteStudio.includes("'Python' : 'JavaScript'} 실행`}</Button>"), 'Language names must not be repeated inside the run button.');
assert(noteStudio.includes('>문서</Button>'), 'The connected-document action must use a compact label.');
assert(!noteStudio.includes('NOTE MANAGER의 개인 작업대'), 'The redundant Note Studio sidebar heading must be removed.');
assert(noteCss.includes('.note-studio-shell .MuiButton-root') && noteCss.includes('white-space: nowrap'), 'Note Studio controls must never wrap labels.');
assert(appWindows.includes("const compactAppChrome = win.appId === 'note-studio'"), 'The Note Studio app chrome must be compact.');
assert(appWindows.includes('compactAppChrome ? 30 : 46'), 'The compact app chrome must be 30px tall.');
assert(platform.includes("inlineApp.id !== 'note-studio'"), 'Inline Note Studio must not duplicate the app heading.');
assert(theme.includes("whiteSpace: 'nowrap'") && theme.includes('flexShrink: 0'), 'Global NAS buttons must not split into multiple lines.');

console.log('Note Studio compact layout and single-line control policy verified.');
