const BACKGROUND_LAYER = 20;
const ACTIVE_LAYER = 80;

export const getWindowLayerZIndex = (
  layerWindows = [],
  focusedContext = 'desktop'
) => (
  layerWindows.some((win) => win.id === focusedContext)
    ? ACTIVE_LAYER
    : BACKGROUND_LAYER
);

export const getAppWindowLayerZIndex = (openWindows = [], focusedContext = 'desktop') => (
  getWindowLayerZIndex(openWindows.filter((win) => win.winType === 'app'), focusedContext)
);

export const getNasWindowLayerZIndex = (openWindows = [], focusedContext = 'desktop', isNasRoute = false) => {
  const fileWindows = openWindows.filter((win) => win.winType === 'folder' || win.winType === 'file');
  if (fileWindows.some((win) => win.id === focusedContext)) return ACTIVE_LAYER;
  return isNasRoute && focusedContext === 'desktop' ? 40 : 10;
};

export const getTaskSwitcherWindows = (openWindows = [], taskbarOrder = []) => {
  const byId = new Map(openWindows.map((win) => [win.id, win]));
  const ordered = [];

  [...taskbarOrder].reverse().forEach((id) => {
    const win = byId.get(id);
    if (!win) return;
    ordered.push(win);
    byId.delete(id);
  });

  return [
    ...ordered,
    ...Array.from(byId.values()).sort((a, b) => Number(b.zIndex || 0) - Number(a.zIndex || 0))
  ];
};

export const getInitialTaskSwitcherIndex = (windows = [], focusedContext = 'desktop') => {
  if (windows.length < 2) return 0;
  return windows[0]?.id === focusedContext ? 1 : 0;
};

export const moveTaskSwitcherIndex = (currentIndex, itemCount, direction = 1) => {
  if (itemCount <= 0) return -1;
  return (currentIndex + direction + itemCount) % itemCount;
};
