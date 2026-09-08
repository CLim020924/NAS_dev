import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/components/NoteStudio/NoteStudio.js'), 'utf8');
const required = [
  ['separate notebook scope state', 'const [sidebarNotebookId, setSidebarNotebookId]'],
  ['persisted notebook scope', "sidebarNotebookId: sidebarNotebookId || ''"],
  ['explicit back action', '>BACK</Button>'],
  ['overview tree label', 'aria-label="전체 노트북 목록"'],
  ['scoped search label', "placeholder={sidebarNotebook ? '이 노트북 검색' : '노트북 검색'}"],
  ['scoped page tree', 'sidebarNotebookTree.notes.map'],
  ['scope entry on notebook click', 'onClick={() => enterNotebook(notebook)}'],
];

for (const [label, marker] of required) {
  if (!source.includes(marker)) throw new Error(`Note Studio notebook scope contract missing: ${label}`);
}

if (source.includes('notesByNotebook.map(({ notebook, notes: notebookNotes')) {
  throw new Error('Overview must not render every notebook page tree at once.');
}

console.log('Note Studio notebook scope verifier passed.');
