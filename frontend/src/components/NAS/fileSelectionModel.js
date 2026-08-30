const uniqueExistingPaths = (paths, selectedPaths) => {
  const allowed = new Set(paths);
  return [...new Set(selectedPaths || [])].filter((path) => allowed.has(path));
};

export const selectClickedPath = ({ paths, selectedPaths, clickedPath, anchorPath, ctrlOrMeta, shiftKey }) => {
  if (!paths.includes(clickedPath)) {
    return { selectedPaths: [clickedPath], anchorPath: clickedPath, focusPath: clickedPath };
  }

  if (shiftKey) {
    const anchor = paths.includes(anchorPath) ? anchorPath : clickedPath;
    const start = paths.indexOf(anchor);
    const end = paths.indexOf(clickedPath);
    const range = paths.slice(Math.min(start, end), Math.max(start, end) + 1);
    return {
      selectedPaths: ctrlOrMeta ? [...new Set([...uniqueExistingPaths(paths, selectedPaths), ...range])] : range,
      anchorPath: anchor,
      focusPath: clickedPath,
    };
  }

  if (ctrlOrMeta) {
    const existing = uniqueExistingPaths(paths, selectedPaths);
    const selected = existing.includes(clickedPath)
      ? existing.filter((path) => path !== clickedPath)
      : [...existing, clickedPath];
    return { selectedPaths: selected, anchorPath: clickedPath, focusPath: clickedPath };
  }

  return { selectedPaths: [clickedPath], anchorPath: clickedPath, focusPath: clickedPath };
};

export const moveKeyboardSelection = ({
  paths,
  selectedPaths,
  focusPath,
  anchorPath,
  key,
  columns = 1,
  extend = false,
  preserveSelection = false,
}) => {
  if (!paths.length) return { selectedPaths: [], anchorPath: null, focusPath: null };

  const selected = uniqueExistingPaths(paths, selectedPaths);
  const currentPath = paths.includes(focusPath)
    ? focusPath
    : (selected.length ? selected[selected.length - 1] : paths[0]);
  const currentIndex = Math.max(0, paths.indexOf(currentPath));
  const safeColumns = Math.max(1, Number(columns) || 1);
  const deltas = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -safeColumns,
    ArrowDown: safeColumns,
  };

  let nextIndex = currentIndex;
  if (key === 'Home') nextIndex = 0;
  else if (key === 'End') nextIndex = paths.length - 1;
  else if (Object.prototype.hasOwnProperty.call(deltas, key)) nextIndex = currentIndex + deltas[key];
  nextIndex = Math.max(0, Math.min(paths.length - 1, nextIndex));

  const nextPath = paths[nextIndex];
  if (preserveSelection && !extend) {
    return { selectedPaths: selected, anchorPath: paths.includes(anchorPath) ? anchorPath : currentPath, focusPath: nextPath };
  }

  if (extend) {
    const anchor = paths.includes(anchorPath) ? anchorPath : currentPath;
    const anchorIndex = paths.indexOf(anchor);
    return {
      selectedPaths: paths.slice(Math.min(anchorIndex, nextIndex), Math.max(anchorIndex, nextIndex) + 1),
      anchorPath: anchor,
      focusPath: nextPath,
    };
  }

  return { selectedPaths: [nextPath], anchorPath: nextPath, focusPath: nextPath };
};

export const toggleFocusedPath = ({ paths, selectedPaths, focusPath }) => {
  if (!paths.length) return { selectedPaths: [], anchorPath: null, focusPath: null };
  const target = paths.includes(focusPath) ? focusPath : paths[0];
  const selected = uniqueExistingPaths(paths, selectedPaths);
  return {
    selectedPaths: selected.includes(target) ? selected.filter((path) => path !== target) : [...selected, target],
    anchorPath: target,
    focusPath: target,
  };
};
