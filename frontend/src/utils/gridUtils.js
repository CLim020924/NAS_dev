import { ensureSlash } from './pathUtils';

export const getNextSlot = (occupied, maxCols) => {
  let gridCol = 0;
  let gridRow = 0;

  while (true) {
    const x = 20 + gridCol * 110;
    const y = 20 + gridRow * 105;

    if (x === 20 && y === 20) {
      gridCol++;
      continue;
    }

    if (!occupied.has(`${x},${y}`)) {
      occupied.add(`${x},${y}`);
      return { x, y };
    }

    gridCol++;
    if (gridCol >= maxCols) {
      gridCol = 0;
      gridRow++;
    }
  }
};

export const getAvailableDesktopSlot = ({ desktopItems, iconPositions, inlineEdit }) => {
  const occupied = new Set();
  occupied.add('20,20');

  desktopItems.forEach(item => {
    const p = ensureSlash(item.fullPath);
    if (iconPositions[p]) occupied.add(`${iconPositions[p].x},${iconPositions[p].y}`);
  });

  if (inlineEdit && inlineEdit.windowId === 'desktop' && inlineEdit.spawnPosition) {
    occupied.add(`${inlineEdit.spawnPosition.x},${inlineEdit.spawnPosition.y}`);
  }

  const maxCols = typeof window !== 'undefined' ? Math.max(1, Math.floor(window.innerWidth / 120)) : 10;
  return getNextSlot(occupied, maxCols);
};

export const snapToDesktopGrid = (spawnPosition) => {
  if (!spawnPosition) return null;

  return {
    x: Math.max(0, Math.round((spawnPosition.x - 20) / 110)) * 110 + 20,
    y: Math.max(0, Math.round((spawnPosition.y - 20) / 105)) * 105 + 20,
  };
};
