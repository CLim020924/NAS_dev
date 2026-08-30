'use strict';

const assert = require('assert');
const { isPasswordHash, hashPassword, verifyPassword } = require('../passwordSecurity');

const hash = hashPassword('correct horse battery staple');
assert.strictEqual(isPasswordHash(hash), true);
assert.strictEqual(hash.includes('correct horse battery staple'), false);
assert.strictEqual(verifyPassword('correct horse battery staple', hash), true);
assert.strictEqual(verifyPassword('wrong', hash), false);
assert.strictEqual(verifyPassword('legacy-password', 'legacy-password'), true);
assert.strictEqual(verifyPassword('wrong', 'legacy-password'), false);
assert.strictEqual(hashPassword(hash), hash);
console.log('passwordSecurity tests passed');
