/** @jest-environment node */

import { BLOCK_COMMANDS, filterCommands, flattenNoteTree, nextBlockIndent, normalizeBlockIndent, parseSlashQuery, tabShortcutForParagraph } from './noteStudioCommands';

test('filters block commands with Korean and English aliases', () => {
  expect(filterCommands(BLOCK_COMMANDS, '제목').map((item) => item.id)).toEqual(['heading-1', 'heading-2', 'heading-3']);
  expect(filterCommands(BLOCK_COMMANDS, 'quote').map((item) => item.id)).toEqual(['quote']);
  expect(filterCommands(BLOCK_COMMANDS, 'page').map((item) => item.id)).toEqual(['subpage']);
});

test('flattens a note tree in parent-before-child order', () => {
  const flat = flattenNoteTree([
    { id: 'child', parentId: 'root', title: 'child' },
    { id: 'root', parentId: null, title: 'root' },
    { id: 'grandchild', parentId: 'child', title: 'grandchild' }
  ]);
  expect(flat.map((item) => [item.id, item.depth])).toEqual([['root', 0], ['child', 1], ['grandchild', 2]]);
});

test('keeps orphaned or cyclic legacy rows visible once', () => {
  const flat = flattenNoteTree([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }, { id: 'orphan', parentId: 'missing' }]);
  expect(new Set(flat.map((item) => item.id))).toEqual(new Set(['a', 'b', 'orphan']));
  expect(flat).toHaveLength(3);
});

test('detects only a slash command next to the caret', () => {
  expect(parseSlashQuery('/제목')).toBe('제목');
  expect(parseSlashQuery('문단 다음 /code')).toBe('code');
  expect(parseSlashQuery('https://example.com')).toBeNull();
});

test('maps explicit Tab patterns without changing normal prose', () => {
  expect(tabShortcutForParagraph('1')).toBe('ordered-list');
  expect(tabShortcutForParagraph('-')).toBe('bullet-list');
  expect(tabShortcutForParagraph('---')).toBe('divider');
  expect(tabShortcutForParagraph('[ ]')).toBe('task-list');
  expect(tabShortcutForParagraph('###')).toBe('heading-3');
  expect(tabShortcutForParagraph('>')).toBe('quote');
  expect(tabShortcutForParagraph('```')).toBe('code-block');
  expect(tabShortcutForParagraph('일반 문장')).toBeNull();
});

test('clamps block indentation and reverses it with Shift+Tab', () => {
  expect(nextBlockIndent(0)).toBe(1);
  expect(nextBlockIndent(7)).toBe(8);
  expect(nextBlockIndent(8)).toBe(8);
  expect(nextBlockIndent(3, true)).toBe(2);
  expect(nextBlockIndent(0, true)).toBe(0);
  expect(normalizeBlockIndent('invalid')).toBe(0);
});
