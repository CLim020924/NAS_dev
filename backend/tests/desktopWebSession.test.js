'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createDesktopWebSession,
  consumeDesktopWebSession,
  normalizeNextPath
} = require('../desktopWebSession');

test('desktop web session is single-use and preserves the bound account metadata', () => {
  const created = createDesktopWebSession({
    deviceId: 'device-test',
    ownerKey: 'owner-test',
    userUid: 'user-test',
    loginId: 'login-test',
    next: '/nas?path=%2Fdocs'
  });
  assert.match(created.token, /^desktop_[A-Za-z0-9_-]+$/);
  const consumed = consumeDesktopWebSession(created.token);
  assert.equal(consumed.deviceId, 'device-test');
  assert.equal(consumed.userUid, 'user-test');
  assert.equal(consumed.next, '/nas?path=%2Fdocs');
  assert.equal(consumeDesktopWebSession(created.token), null);
});

test('desktop web session redirect is restricted to NAS application paths', () => {
  assert.equal(normalizeNextPath('https://evil.example/steal'), '/nas');
  assert.equal(normalizeNextPath('//evil.example'), '/nas');
  assert.equal(normalizeNextPath('/platform?pcConnect=1'), '/platform?pcConnect=1');
});
