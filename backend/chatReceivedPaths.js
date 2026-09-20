const path = require('path');
const {
  getAccessBasePath,
  getQuotaBasePath,
  normalizeQuotaFields,
} = require('./storageQuota');

const getChatReceivedPaths = (user) => {
  const normalized = normalizeQuotaFields(user);
  const accessRoot = getAccessBasePath(normalized);
  const personalRoot = getQuotaBasePath(normalized);
  const receivedDir = path.join(personalRoot, '받은 파일');
  const relative = path.relative(accessRoot, receivedDir);
  const requestRoot = `/${relative.split(path.sep).join('/')}`;
  return { accessRoot, receivedDir, requestRoot };
};

module.exports = { getChatReceivedPaths };
