'use strict';

const jwt = require('jsonwebtoken');

const normalizeOfficePath = (value) => {
  const normalized = String(value || '').replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const createOfficeAccessToken = (secret, user, filePath) => jwt.sign({
  purpose: 'onlyoffice-file-access',
  userUid: user.userUid || '',
  loginId: user.loginId || user.id || user.username || '',
  path: normalizeOfficePath(filePath)
}, secret, { audience: 'onlyoffice', expiresIn: '12h' });

const verifyOfficeAccessToken = (secret, token) => {
  const payload = jwt.verify(String(token || ''), secret, { audience: 'onlyoffice' });
  if (payload.purpose !== 'onlyoffice-file-access' || !payload.path) {
    const err = new Error('invalid onlyoffice access token');
    err.status = 401;
    throw err;
  }
  return { ...payload, path: normalizeOfficePath(payload.path) };
};

module.exports = { normalizeOfficePath, createOfficeAccessToken, verifyOfficeAccessToken };
