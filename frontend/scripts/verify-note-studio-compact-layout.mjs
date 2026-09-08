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
const aiAgent = read('src/components/AiAgentPanel.js');
const documentStudio = read('src/components/DocumentStudio/DocumentStudio.js');
const terminal = read('src/components/NoteStudio/NoteStudioTerminal.js');
const commands = read('src/components/NoteStudio/noteStudioCommands.js');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(noteStudio.includes('className="note-studio-shell"'), 'Note Studio must scope compact label rules.');
assert(noteStudio.includes('minHeight: 40, maxHeight: 40'), 'The note title/action row must remain 40px tall.');
assert(noteStudio.includes("codeRunning ? '실행 중' : '실행'"), 'The code action must use the compact run label.');
assert(!noteStudio.includes("'Python' : 'JavaScript'} 실행`}</Button>"), 'Language names must not be repeated inside the run button.');
assert(noteStudio.includes('>문서</Button>'), 'The connected-document action must use a compact label.');
assert(noteStudio.includes('aria-label="페이지 작업 더보기"') && noteStudio.includes('primary="버전 기록"') && noteStudio.includes('primary="파일로 내보내기"'), 'Secondary page actions must remain grouped in the overflow menu.');
assert(noteStudio.includes('justifyContent="space-between" className="note-studio-compact-controls"'), 'Sidebar controls must remain separated into navigation and creation groups.');
assert(!noteStudio.includes('NOTE MANAGER의 개인 작업대'), 'The redundant Note Studio sidebar heading must be removed.');
assert(noteCss.includes('.note-studio-shell .MuiButton-root') && noteCss.includes('white-space: nowrap'), 'Note Studio controls must never wrap labels.');
assert(appWindows.includes("const compactAppChrome = win.appId === 'note-studio'"), 'The Note Studio app chrome must be compact.');
assert(appWindows.includes('compactAppChrome ? 30 : 46'), 'The compact app chrome must be 30px tall.');
assert(platform.includes("inlineApp.id !== 'note-studio'"), 'Inline Note Studio must not duplicate the app heading.');
assert(theme.includes("whiteSpace: 'nowrap'") && theme.includes('flexShrink: 0'), 'Global NAS buttons must not split into multiple lines.');
assert(aiAgent.includes('>답변 이어가기</Button>') && !aiAgent.includes('>작업 재실행 없이 답변 이어받기</Button>'), 'Long AI continuation labels must be compact.');
assert(platform.includes('>설치 앱 연결</Button>') && platform.includes('>탐색기 열기</Button>'), 'PC connection dialog actions must use compact labels.');
assert(documentStudio.includes('>결과 폴더</Button>'), 'Document Studio result toolbar must use a compact folder label.');
assert(noteStudio.includes('role="tree" aria-label="노트북과 페이지 트리"'), 'Notebook pages must expose a real accessible tree.');
assert(noteStudio.includes('className="note-page-tree-row"') && noteStudio.includes('collapsedPageIds'), 'Individual pages must render tree guides and retain collapse state.');
assert(noteStudio.includes('이름 바꾸기 · F2') && noteStudio.includes('휴지통으로 이동'), 'Page context actions must include edit and trash operations.');
assert(terminal.includes('role="tree" aria-label="노트북 파일 트리"') && terminal.includes('className="note-file-tree-row"'), 'Project files must expose a guided explorer tree.');
assert(terminal.includes("startEdit('new-file'") && terminal.includes("startEdit('new-folder'") && terminal.includes("startEdit('rename'"), 'Project explorer must support common create and rename actions.');
assert(commands.includes('visibleNoteTree') && commands.includes('noteChildCounts'), 'Page tree visibility must be derived by tested pure helpers.');

console.log('Note Studio compact layout, tree navigation, and single-line control policy verified.');
