import {
  getAppWindowLayerZIndex,
  getInitialTaskSwitcherIndex,
  getNasWindowLayerZIndex,
  getTaskSwitcherWindows,
  getWindowLayerZIndex,
  moveTaskSwitcherIndex,
} from './windowLayerPolicy';

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

  test('uses the same active-layer rule for chat and other window groups', () => {
    const chats = [{ id: 'chat_1', winType: 'chat' }];
    expect(getWindowLayerZIndex(chats, 'chat_1')).toBe(80);
    expect(getWindowLayerZIndex(chats, 'file_/result.pdf')).toBe(20);
  });

  test('raises file windows only when the NAS workspace owns focus', () => {
    expect(getNasWindowLayerZIndex(windows, 'file_/result.pdf', false)).toBe(80);
    expect(getNasWindowLayerZIndex(windows, 'desktop', true)).toBe(40);
    expect(getNasWindowLayerZIndex(windows, 'app_document-studio', true)).toBe(10);
  });

  test('orders the task switcher by most recent use and keeps untracked windows', () => {
    const all = [
      { id: 'file_a', zIndex: 103 },
      { id: 'app_b', zIndex: 105 },
      { id: 'chat_c', zIndex: 104 },
    ];
    expect(getTaskSwitcherWindows(all, ['file_a', 'chat_c'])).toEqual([
      all[2],
      all[0],
      all[1],
    ]);
  });

  test('starts on the previous window and cycles in both directions', () => {
    const ordered = [{ id: 'current' }, { id: 'previous' }, { id: 'older' }];
    expect(getInitialTaskSwitcherIndex(ordered, 'current')).toBe(1);
    expect(moveTaskSwitcherIndex(1, 3, 1)).toBe(2);
    expect(moveTaskSwitcherIndex(0, 3, -1)).toBe(2);
    expect(moveTaskSwitcherIndex(0, 0, 1)).toBe(-1);
  });
});
