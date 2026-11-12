const test = require('node:test');
const assert = require('node:assert/strict');
const { isImmutableFrontendAsset } = require('../staticAssetPolicy');

test('hashed frontend assets are immutable cache candidates', () => {
  assert.equal(isImmutableFrontendAsset('/var/www/html/static/js/main.fd398c57.js'), true);
  assert.equal(isImmutableFrontendAsset('/var/www/html/static/css/main.e6650b38.css'), true);
  assert.equal(isImmutableFrontendAsset('/var/www/html/static/media/pdf.worker.min.acde0acd5c1c5605c983.mjs'), true);
  assert.equal(isImmutableFrontendAsset('C:\\site\\static\\media\\rhwp_bg.554342a953962bba1d09.wasm'), true);
});

test('mutable entry files and unhashed assets are not immutable', () => {
  assert.equal(isImmutableFrontendAsset('/var/www/html/index.html'), false);
  assert.equal(isImmutableFrontendAsset('/var/www/html/asset-manifest.json'), false);
  assert.equal(isImmutableFrontendAsset('/var/www/html/static/js/main.js'), false);
});
