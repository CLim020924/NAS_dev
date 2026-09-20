const test = require('node:test');
const assert = require('node:assert/strict');
const { connectedIdentitySets, isUserOnline } = require('../presence');

test('online means at least one authenticated socket, not a retained login record', () => {
  const sockets = new Map([
    ['tab-a', { userId: 'person', userUid: 'uid-person' }],
    ['tab-b', { userId: 'person', userUid: 'uid-person' }],
    ['guest', {}]
  ]);
  assert.equal(isUserOnline(connectedIdentitySets(sockets), 'person', 'uid-person'), true);
  sockets.delete('tab-a');
  assert.equal(isUserOnline(connectedIdentitySets(sockets), 'person', 'uid-person'), true);
  sockets.delete('tab-b');
  assert.equal(isUserOnline(connectedIdentitySets(sockets), 'person', 'uid-person'), false);
});
