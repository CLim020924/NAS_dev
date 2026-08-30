import { getAppWindowLayerZIndex } from './windowLayerPolicy';

describe('global app window layer policy', () => {
  const windows = [
    { id: 'app_document-studio', winType: 'app' },
    { id: 'file_/result.pdf', winType: 'file' },
  ];

  test('puts app windows above the NAS layer only while an app owns focus', () => {
    expect(getAppWindowLayerZIndex(windows, 'app_document-studio')).toBe(80);
    expect(getAppWindowLayerZIndex(windows, 'file_/result.pdf')).toBe(20);
    expect(getAppWindowLayerZIndex(windows, 'desktop')).toBe(20);
  });
});
