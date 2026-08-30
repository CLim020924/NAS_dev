import { moveKeyboardSelection, selectClickedPath, toggleFocusedPath } from './fileSelectionModel';

const paths = ['/a', '/b', '/c', '/d', '/e', '/f'];

test('shift click selects one contiguous explorer-style range', () => {
  expect(selectClickedPath({ paths, selectedPaths: ['/b'], clickedPath: '/e', anchorPath: '/b', shiftKey: true }).selectedPaths)
    .toEqual(['/b', '/c', '/d', '/e']);
});

test('arrow keys follow grid columns and shift extends from the stable anchor', () => {
  const moved = moveKeyboardSelection({ paths, selectedPaths: ['/b'], focusPath: '/b', anchorPath: '/b', key: 'ArrowDown', columns: 3 });
  expect(moved).toEqual({ selectedPaths: ['/e'], anchorPath: '/e', focusPath: '/e' });

  const extended = moveKeyboardSelection({ paths, selectedPaths: ['/b'], focusPath: '/b', anchorPath: '/b', key: 'ArrowDown', columns: 3, extend: true });
  expect(extended.selectedPaths).toEqual(['/b', '/c', '/d', '/e']);
  expect(extended.anchorPath).toBe('/b');
});

test('control plus arrow moves focus without discarding the existing selection', () => {
  expect(moveKeyboardSelection({ paths, selectedPaths: ['/a', '/c'], focusPath: '/c', anchorPath: '/a', key: 'ArrowRight', preserveSelection: true }))
    .toEqual({ selectedPaths: ['/a', '/c'], anchorPath: '/a', focusPath: '/d' });
});

test('space toggles the keyboard-focused item', () => {
  expect(toggleFocusedPath({ paths, selectedPaths: ['/a'], focusPath: '/c' }).selectedPaths).toEqual(['/a', '/c']);
  expect(toggleFocusedPath({ paths, selectedPaths: ['/a', '/c'], focusPath: '/c' }).selectedPaths).toEqual(['/a']);
});
