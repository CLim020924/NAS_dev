import { getNasWorkspaceLayerSx, NAS_IMMERSIVE_LAYER_Z_INDEX } from './fullscreenLayout';

describe('NAS immersive workspace layer', () => {
  test('covers the entire browser viewport above the platform top bar', () => {
    expect(getNasWorkspaceLayerSx({ isNasRoute: true, hasImmersiveNasWindow: true })).toEqual({
      position: 'fixed',
      inset: 0,
      width: '100vw',
      height: '100dvh',
      overflow: 'hidden',
      zIndex: NAS_IMMERSIVE_LAYER_Z_INDEX,
      pointerEvents: 'auto',
    });
    expect(NAS_IMMERSIVE_LAYER_Z_INDEX).toBeGreaterThan(1450);
  });

  test('keeps the normal NAS workspace below the global top bar', () => {
    expect(getNasWorkspaceLayerSx({ isNasRoute: true, hasImmersiveNasWindow: false })).toMatchObject({
      position: 'absolute',
      width: '100%',
      height: '100%',
      zIndex: 40,
      pointerEvents: 'auto',
    });
  });

  test('does not make a hidden background workspace interactive', () => {
    expect(getNasWorkspaceLayerSx({ isNasRoute: false, hasImmersiveNasWindow: false })).toMatchObject({
      position: 'absolute',
      zIndex: 10,
      pointerEvents: 'none',
    });
  });

  test('accepts the shared window manager layer while keeping immersive mode authoritative', () => {
    expect(getNasWorkspaceLayerSx({ isNasRoute: true, hasImmersiveNasWindow: false, layerZIndex: 80 }).zIndex).toBe(80);
    expect(getNasWorkspaceLayerSx({ isNasRoute: true, hasImmersiveNasWindow: true, layerZIndex: 20 }).zIndex).toBe(NAS_IMMERSIVE_LAYER_Z_INDEX);
  });
});
