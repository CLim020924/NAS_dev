export const normalizeRhwpMode = (mode) => mode === 'editor' ? 'editor' : 'viewer';

export const shouldApplyRequestedEditorMode = (previousMode, nextMode) => (
  normalizeRhwpMode(previousMode) !== 'editor' && normalizeRhwpMode(nextMode) === 'editor'
);

export const shouldRestorePersistedRhwpMode = (selectionRevisionAtRequest, currentSelectionRevision, persistedMode) => (
  Number(selectionRevisionAtRequest) === Number(currentSelectionRevision)
  && (persistedMode === 'viewer' || persistedMode === 'editor')
);
