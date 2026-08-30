'use strict';

const crypto = require('crypto');

const PREFIX = 'scrypt';
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

const isPasswordHash = (value) => String(value || '').startsWith(`${PREFIX}$`);

const hashPassword = (password) => {
  const plain = String(password || '');
  if (!plain) return '';
  if (isPasswordHash(plain)) return plain;
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(plain, salt, KEY_LENGTH, { N, r: R, p: P, maxmem: MAX_MEMORY }).toString('base64url');
  return `${PREFIX}$${N}$${R}$${P}$${salt}$${hash}`;
};

const verifyPassword = (password, storedValue) => {
  const stored = String(storedValue || '');
  if (!isPasswordHash(stored)) {
    const left = Buffer.from(String(password || ''), 'utf8');
    const right = Buffer.from(stored, 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }
  const [prefix, nText, rText, pText, salt, expectedText] = stored.split('$');
  if (prefix !== PREFIX || !salt || !expectedText) return false;
  const expected = Buffer.from(expectedText, 'base64url');
  const actual = crypto.scryptSync(String(password || ''), salt, expected.length, {
    N: Number(nText), r: Number(rText), p: Number(pText), maxmem: MAX_MEMORY
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

module.exports = { isPasswordHash, hashPassword, verifyPassword };
