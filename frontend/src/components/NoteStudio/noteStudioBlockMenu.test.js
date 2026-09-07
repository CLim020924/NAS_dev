/** @jest-environment node */

import { BLOCK_BACKGROUNDS, BLOCK_COLORS, BLOCK_TRANSFORMS, blockTextStats } from './noteStudioBlockMenu';

test('exposes unique Notion-style transform and color choices', () => {
  for (const options of [BLOCK_TRANSFORMS, BLOCK_COLORS, BLOCK_BACKGROUNDS]) {
    expect(new Set(options.map((item) => item.id)).size).toBe(options.length);
  }
  expect(BLOCK_TRANSFORMS.map((item) => item.id)).toEqual(expect.arrayContaining([
    'paragraph', 'heading-1', 'heading-2', 'heading-3', 'bullet-list', 'ordered-list', 'task-list', 'quote', 'code-block',
  ]));
  expect(BLOCK_COLORS[0]).toMatchObject({ id: 'default', value: null });
  expect(BLOCK_BACKGROUNDS[0]).toMatchObject({ id: 'default', value: null });
});

test('counts block words and Unicode characters without counting surrounding spaces', () => {
  expect(blockTextStats('  한글 block\n두 줄  ')).toEqual({ words: 4, characters: 16 });
  expect(blockTextStats('')).toEqual({ words: 0, characters: 0 });
});
