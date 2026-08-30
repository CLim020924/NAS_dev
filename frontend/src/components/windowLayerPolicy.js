export const getAppWindowLayerZIndex = (openWindows = [], focusedContext = 'desktop') => (
  openWindows.some((win) => win.id === focusedContext && win.winType === 'app') ? 80 : 20
);
