export const NAS_IMMERSIVE_LAYER_Z_INDEX = 1600;

export const getNasWorkspaceLayerSx = ({ isNasRoute, hasImmersiveNasWindow }) => ({
  position: hasImmersiveNasWindow ? 'fixed' : 'absolute',
  inset: 0,
  width: hasImmersiveNasWindow ? '100vw' : '100%',
  height: hasImmersiveNasWindow ? '100dvh' : '100%',
  overflow: 'hidden',
  zIndex: hasImmersiveNasWindow ? NAS_IMMERSIVE_LAYER_Z_INDEX : (isNasRoute ? 0 : 30),
  pointerEvents: (isNasRoute || hasImmersiveNasWindow) ? 'auto' : 'none',
});
