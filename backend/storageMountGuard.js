const fs = require('fs');
const path = require('path');

const decodeMountField = (value = '') => String(value)
  .replace(/\\040/g, ' ')
  .replace(/\\011/g, '\t')
  .replace(/\\012/g, '\n')
  .replace(/\\134/g, '\\');

const parseMountInfo = (content = '') => String(content).split(/\r?\n/).filter(Boolean).map((line) => {
  const fields = line.split(' ');
  const separator = fields.indexOf('-');
  if (separator < 6) return null;
  return {
    majorMinor: fields[2],
    mountPoint: decodeMountField(fields[4]),
    options: fields[5],
    filesystem: fields[separator + 1] || '',
    source: decodeMountField(fields[separator + 2] || ''),
  };
}).filter(Boolean);

const getNasRootMountStatus = (nasRoot, { required = true, mountInfo } = {}) => {
  const resolvedRoot = path.resolve(nasRoot || '/');
  if (!required || (process.platform !== 'linux' && mountInfo === undefined) || resolvedRoot === '/') {
    return { available: true, required: false, mountPoint: resolvedRoot, source: '', filesystem: '', options: '' };
  }

  try {
    const content = mountInfo === undefined ? fs.readFileSync('/proc/self/mountinfo', 'utf8') : mountInfo;
    const mount = parseMountInfo(content).find((item) => path.resolve(item.mountPoint) === resolvedRoot);
    if (!mount) {
      return {
        available: false,
        required: true,
        mountPoint: resolvedRoot,
        source: '',
        filesystem: '',
        options: '',
        code: 'NAS_STORAGE_UNAVAILABLE',
        reason: 'dedicated-mount-missing',
      };
    }
    return { available: true, required: true, ...mount };
  } catch (error) {
    return {
      available: false,
      required: true,
      mountPoint: resolvedRoot,
      source: '',
      filesystem: '',
      options: '',
      code: 'NAS_STORAGE_UNAVAILABLE',
      reason: 'mount-status-unreadable',
    };
  }
};

const assertNasRootMounted = (nasRoot, options = {}) => {
  const status = getNasRootMountStatus(nasRoot, options);
  if (status.available) return status;
  const error = new Error('NAS 데이터 저장장치 연결이 확인되지 않아 파일 작업을 안전하게 중단했습니다. 관리자에게 저장장치 상태 확인을 요청해주세요.');
  error.status = 503;
  error.code = 'NAS_STORAGE_UNAVAILABLE';
  error.storage = status;
  throw error;
};

module.exports = { decodeMountField, parseMountInfo, getNasRootMountStatus, assertNasRootMounted };
