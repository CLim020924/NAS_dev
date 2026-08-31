const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  NAS_ROOT,
  DEFAULT_USER_QUOTA_BYTES,
  normalizeQuotaFields,
  getAccessBasePath,
  getQuotaBasePath,
  _test
} = require('../storageQuota');

const GIB = 1024 * 1024 * 1024;

test('capacity ledger reserves pending accounts and non-account NAS data', () => {
  const summary = _test.calculateCapacityLedger({
    totalBytes: 1000 * GIB,
    freeBytes: 600 * GIB,
    actualUserBytes: 300 * GIB,
    allocatedBytes: 700 * GIB,
    pendingReservedBytes: 50 * GIB,
    reserveBytes: 100 * GIB
  });

  assert.equal(summary.nonAccountUsedBytes, 100 * GIB);
  assert.equal(summary.quotaPoolBytes, 800 * GIB);
  assert.equal(summary.committedBytes, 750 * GIB);
  assert.equal(summary.availableForAllocationBytes, 50 * GIB);
  assert.equal(summary.signupAvailable, true);
});

test('capacity ledger blocks signup below the default 50 GiB reservation', () => {
  const summary = _test.calculateCapacityLedger({
    totalBytes: 1000 * GIB,
    freeBytes: 140 * GIB,
    actualUserBytes: 860 * GIB,
    allocatedBytes: 860 * GIB,
    pendingReservedBytes: 0,
    reserveBytes: 100 * GIB
  });

  assert.equal(summary.availableForAllocationBytes, 40 * GIB);
  assert.equal(summary.signupAvailable, false);
});

test('master account has a finite personal quota while retaining NAS-root access', () => {
  const master = normalizeQuotaFields({
    id: 'admin',
    role: 'MASTER',
    Masters: true,
    Managers: true,
    globalAccess: true,
    rootPath: '/',
    storageQuotaMode: 'unlimited',
    storageQuotaBytes: null
  });

  assert.equal(master.storageQuotaMode, 'limited');
  assert.equal(master.storageQuotaBytes, DEFAULT_USER_QUOTA_BYTES);
  assert.equal(master.personalRootPath, '/users/admin');
  assert.equal(path.resolve(getAccessBasePath(master)), path.resolve(NAS_ROOT));
  assert.notEqual(path.resolve(getQuotaBasePath(master)), path.resolve(NAS_ROOT));
  assert.equal(path.resolve(getQuotaBasePath(master)), path.resolve(NAS_ROOT, 'users', 'admin'));
});
