'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const secureHashEquals = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const hashPairingToken = (token) => hashToken(`pairing:${String(token || '')}`);

const findPairingIndexByToken = (pairings, token) => {
  const tokenHash = hashPairingToken(token);
  return pairings.findIndex((pairing) => (
    (pairing.tokenHash && secureHashEquals(pairing.tokenHash, tokenHash)) ||
    (!pairing.tokenHash && pairing.token && secureHashEquals(pairing.token, token))
  ));
};

const assertRealPathInside = (basePath, targetPath) => {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  const realBase = fs.realpathSync(base);
  let existing = target;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const realExisting = fs.realpathSync(existing);
  const rel = path.relative(realBase, realExisting);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error('심볼릭 링크가 사용자 동기화 경계 밖을 가리킵니다.');
    err.status = 403;
    throw err;
  }
  return target;
};

const hasConcurrentFileChange = (currentMtimeMs, baseMtimeMs, toleranceMs = 2000) => {
  const current = Number(currentMtimeMs || 0);
  const base = Number(baseMtimeMs || 0);
  return current > 0 && base > 0 && Math.abs(current - base) > Math.max(0, Number(toleranceMs || 0));
};

const buildConflictFileName = (originalName, deviceName, date = new Date(), attempt = 0) => {
  const parsed = path.parse(String(originalName || 'file'));
  const safeDevice = String(deviceName || '다른-PC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim()
    .slice(0, 40) || '다른-PC';
  const stamp = new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, '').replace('T', '-');
  const suffix = Number(attempt || 0) > 0 ? `-${Number(attempt)}` : '';
  return `${parsed.name} (충돌 - ${safeDevice} - ${stamp}${suffix})${parsed.ext}`;
};

module.exports = {
  hashToken,
  secureHashEquals,
  hashPairingToken,
  findPairingIndexByToken,
  assertRealPathInside,
  hasConcurrentFileChange,
  buildConflictFileName
};
