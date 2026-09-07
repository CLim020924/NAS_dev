export const NAS_IMMERSIVE_LAYER_Z_INDEX = 1600;

export const getNasWorkspaceLayerSx = ({ isNasRoute, hasImmersiveNasWindow, layerZIndex }) => ({
  position: hasImmersiveNasWindow ? 'fixed' : 'absolute',
  inset: 0,
  width: hasImmersiveNasWindow ? '100vw' : '100%',
  height: hasImmersiveNasWindow ? '100dvh' : '100%',
  overflow: 'hidden',
  zIndex: hasImmersiveNasWindow
    ? NAS_IMMERSIVE_LAYER_Z_INDEX
    : (Number.isFinite(layerZIndex) ? layerZIndex : (isNasRoute ? 40 : 10)),
  pointerEvents: (isNasRoute || hasImmersiveNasWindow) ? 'auto' : 'none',
});
