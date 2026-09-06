import { BLOCK_COMMANDS, filterCommands, flattenNoteTree } from './noteStudioCommands';

test('filters block commands with Korean and English aliases', () => {
  expect(filterCommands(BLOCK_COMMANDS, '제목').map((item) => item.id)).toEqual(['heading-1', 'heading-2']);
  expect(filterCommands(BLOCK_COMMANDS, 'quote').map((item) => item.id)).toEqual(['quote']);
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
