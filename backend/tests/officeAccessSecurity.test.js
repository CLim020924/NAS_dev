'use strict';

const assert = require('assert');
const jwt = require('jsonwebtoken');
const { normalizeOfficePath, createOfficeAccessToken, verifyOfficeAccessToken } = require('../officeAccessSecurity');

const secret = 'test-secret-not-production';
const token = createOfficeAccessToken(secret, { userUid: 'usr_test', loginId: 'tester' }, '\\docs\\file.docx');
const payload = verifyOfficeAccessToken(secret, token);
assert.strictEqual(payload.userUid, 'usr_test');
assert.strictEqual(payload.path, '/docs/file.docx');
assert.throws(() => verifyOfficeAccessToken('wrong-secret', token));
const wrongPurpose = jwt.sign({ purpose: 'other', path: '/docs/file.docx' }, secret, { audience: 'onlyoffice' });
assert.throws(() => verifyOfficeAccessToken(secret, wrongPurpose));
assert.strictEqual(normalizeOfficePath('docs/file.docx'), '/docs/file.docx');
console.log('officeAccessSecurity tests passed');
