import assert from 'node:assert/strict';
import fs from 'node:fs';
import { transformSync } from '@babel/core';

const loadSourceModule = (relativePath) => {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const output = transformSync(source, {
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' }, modules: 'commonjs' }]],
  });
  const loaded = { exports: {} };
  Function('module', 'exports', output.code)(loaded, loaded.exports);
  return loaded.exports;
};

const policy = loadSourceModule('../src/components/windowLayerPolicy.js');
const fullscreen = loadSourceModule('../src/components/NAS/fullscreenLayout.js');
const topBarSource = fs.readFileSync(new URL('../src/components/TopBar.js', import.meta.url), 'utf8');

const windows = [
  { id: 'file_a', winType: 'file', zIndex: 103 },
  { id: 'app_b', winType: 'app', zIndex: 105 },
  { id: 'chat_c', winType: 'chat', zIndex: 104 },
];

assert.equal(policy.getNasWindowLayerZIndex(windows, 'file_a', false), 80);
assert.equal(policy.getAppWindowLayerZIndex(windows, 'app_b'), 80);
assert.equal(policy.getWindowLayerZIndex([windows[2]], 'chat_c'), 80);
assert.equal(policy.getWindowLayerZIndex([windows[2]], 'file_a'), 20);
assert.deepEqual(
  policy.getTaskSwitcherWindows(windows, ['file_a', 'chat_c']).map((win) => win.id),
  ['chat_c', 'file_a', 'app_b']
);
assert.equal(policy.getInitialTaskSwitcherIndex([{ id: 'chat_c' }, { id: 'file_a' }], 'chat_c'), 1);
assert.equal(policy.moveTaskSwitcherIndex(0, 3, -1), 2);
assert.equal(policy.moveTaskSwitcherIndex(2, 3, 1), 0);
assert.equal(policy.moveTaskSwitcherIndex(0, 0, 1), -1);
assert.match(topBarSource, /aria-pressed=\{taskSwitcherOpen\}/);
assert.match(topBarSource, /열려 있는 창이 없습니다\./);
assert.doesNotMatch(topBarSource, /if \(taskSwitcherWindows\.length === 0\)[\s\S]{0,120}setTaskSwitcherOpen\(false\)/);
assert.equal(
  fullscreen.getNasWorkspaceLayerSx({ isNasRoute: true, hasImmersiveNasWindow: false, layerZIndex: 80 }).zIndex,
  80
);
assert.equal(
  fullscreen.getNasWorkspaceLayerSx({ isNasRoute: true, hasImmersiveNasWindow: true, layerZIndex: 20 }).zIndex,
  fullscreen.NAS_IMMERSIVE_LAYER_Z_INDEX
);

console.log('[window manager] MRU ordering, persistent toggle, layer ownership, cycling, and immersive priority verified');
