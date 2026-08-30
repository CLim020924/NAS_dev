'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  normalizeProfileDirectory,
  profileToken,
  listPublicBrowserChoices,
  resolvePublicSelection,
  resolveDirectSelection
} = require('../agents/windows-node/web-browser');

test('browser profile identifiers are constrained and exposed as transient HMAC tokens', () => {
  assert.equal(normalizeProfileDirectory('Default'), 'Default');
  assert.equal(normalizeProfileDirectory('Profile 12'), 'Profile 12');
  assert.throws(() => normalizeProfileDirectory('../Default'), /사용할 수 없습니다/);
  assert.throws(() => normalizeProfileDirectory('Guest Profile'), /사용할 수 없습니다/);
  const token = profileToken(Buffer.alloc(32, 7), 'chrome', 'Profile 2');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(token.includes('Profile'), false);
});

test('browser choices always retain a validated system fallback', () => {
  const secret = crypto.randomBytes(32);
  const choices = listPublicBrowserChoices({}, secret);
  assert.equal(choices.some(choice => choice.id === 'system'), true);
  assert.equal(resolvePublicSelection({ browserId: 'system', profileToken: '' }, {}, secret).id, 'system');
  assert.equal(resolveDirectSelection('system').id, 'system');
  assert.throws(() => resolveDirectSelection('system', 'Default'), /기본 브라우저에는 사용자를 지정/);
});
