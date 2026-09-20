export const withWindowDirtyState = (windows, id, dirty) => {
  const nextDirty = !!dirty;
  if (!windows.some(window => window.id === id && !!window.hasUnsavedChanges !== nextDirty)) return windows;
  return windows.map(window => window.id === id ? { ...window, hasUnsavedChanges: nextDirty } : window);
};
