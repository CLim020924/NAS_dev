export const BLOCK_COMMANDS = [
  { id: 'subpage', label: '하위 페이지', keywords: 'page subpage child 페이지 하위' },
  { id: 'paragraph', label: '본문', keywords: 'text paragraph 본문 문단' },
  { id: 'heading-1', label: '제목 1', keywords: 'heading title h1 제목' },
  { id: 'heading-2', label: '제목 2', keywords: 'heading title h2 소제목' },
  { id: 'heading-3', label: '제목 3', keywords: 'heading title h3 작은 제목' },
  { id: 'bullet-list', label: '글머리표 목록', keywords: 'bullet list 목록' },
  { id: 'ordered-list', label: '번호 목록', keywords: 'number ordered list 번호' },
  { id: 'task-list', label: '할 일 목록', keywords: 'todo task checkbox check 할일 체크' },
  { id: 'quote', label: '인용문', keywords: 'quote blockquote 인용' },
  { id: 'code-block', label: '코드 블록', keywords: 'code pre 코드' },
  { id: 'divider', label: '구분선', keywords: 'divider horizontal rule 구분선' }
];

export const filterCommands = (commands, query = '') => {
  const needle = String(query || '').trim().toLocaleLowerCase('ko-KR');
  if (!needle) return commands;
  return commands.filter((command) => `${command.label} ${command.keywords || ''}`.toLocaleLowerCase('ko-KR').includes(needle));
};

export const parseSlashQuery = (textBeforeCaret = '') => {
  const match = String(textBeforeCaret).match(/(?:^|\s)\/([^\s/]*)$/u);
  return match ? match[1] : null;
};

export const tabShortcutForParagraph = (text = '') => {
  const value = String(text).trim();
  if (value === '1' || value === '1.') return 'ordered-list';
  if (value === '-' || value === '*') return 'bullet-list';
  if (value === '[]' || value === '[ ]' || value.toLowerCase() === '[x]') return 'task-list';
  if (value === '#') return 'heading-1';
  if (value === '##') return 'heading-2';
  if (value === '###') return 'heading-3';
  if (value === '>' || value === '"') return 'quote';
  if (value === '```') return 'code-block';
  if (value === '---' || value === '===') return 'divider';
  return null;
};

export const flattenNoteTree = (notes = []) => {
  const byParent = new Map();
  const ids = new Set(notes.map((note) => note.id));
  for (const note of notes) {
    const parentId = note.parentId && ids.has(note.parentId) ? note.parentId : null;
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId).push(note);
  }
  const result = [];
  const visited = new Set();
  const walk = (parentId, depth) => {
    for (const note of byParent.get(parentId) || []) {
      if (visited.has(note.id)) continue;
      visited.add(note.id);
      result.push({ ...note, depth });
      walk(note.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const note of notes) if (!visited.has(note.id)) result.push({ ...note, depth: 0 });
  return result;
};
