'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  hashToken,
  secureHashEquals,
  hashPairingToken,
  findPairingIndexByToken,
  assertRealPathInside,
  hasConcurrentFileChange,
  buildConflictFileName
} = require('../deviceSyncSecurity');
const { hashPassword, verifyPassword } = require('../passwordSecurity');

const token = 'pair_test_secret';
assert.notStrictEqual(hashToken(token), token);
assert.strictEqual(secureHashEquals(hashToken(token), hashToken(token)), true);
assert.strictEqual(secureHashEquals(hashToken(token), hashToken('other')), false);
assert.strictEqual(findPairingIndexByToken([{ tokenHash: hashPairingToken(token) }], token), 0);
assert.strictEqual(findPairingIndexByToken([{ tokenHash: hashPairingToken(token) }], 'wrong'), -1);
assert.strictEqual(findPairingIndexByToken([{ token }], token), 0);

const passwordHash = hashPassword('desktop-login-test-password');
assert.strictEqual(verifyPassword('desktop-login-test-password', passwordHash), true);
assert.strictEqual(verifyPassword('wrong-password', passwordHash), false);

const nasRoutesSource = fs.readFileSync(path.join(__dirname, '..', 'nasRoutes.js'), 'utf8');
const windowsAgentSource = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows-node', 'index.js'), 'utf8');
const windowsLauncherSource = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows-installer', 'Program.cs'), 'utf8');
assert.match(nasRoutesSource, /router\.post\('\/devices\/agent\/login-register'/);
assert.match(nasRoutesSource, /verifyPassword\(password, user\.password\)/);
assert.match(nasRoutesSource, /AGENT_LOGIN_MAX_FAILURES/);
assert.match(nasRoutesSource, /mode: 'personal-drive'/);
assert.match(nasRoutesSource, /router\.post\('\/devices\/agent\/logout'/);
assert.match(nasRoutesSource, /status: 'agent-detected'/);
assert.match(nasRoutesSource, /detectedAt: new Date\(\)\.toISOString\(\)/);
assert.match(nasRoutesSource, /agentTokenHash: null/);
assert.match(nasRoutesSource, /agentTokenHash: hashAgentToken\(agentToken\),[\s\S]{0,180}revokedAt: null/);
assert.match(nasRoutesSource, /revokedAt: null,[\s\S]{0,100}syncState: 'connecting'/);
assert.match(nasRoutesSource, /Registration is not a heartbeat[\s\S]{0,220}lastSeenAt: null/);
assert.match(nasRoutesSource, /const liveDevice = registeredDeviceId/);
assert.match(nasRoutesSource, /device: liveDevice \? sanitizeDeviceForResponse\(liveDevice\)/);
assert.doesNotMatch(nasRoutesSource, /WEB_PAIRING_REQUIRED/);
assert.match(windowsAgentSource, /acquireForegroundLock\(\{ supersedeExisting = false \} = \{\}\)/);
assert.match(windowsAgentSource, /acquireForegroundLock\(\{ supersedeExisting: true \}\)/);
assert.match(windowsAgentSource, /if \(!profile\?\.deviceId\) \{[\s\S]{0,900}profiles: \[\][\s\S]{0,900}return true;/);
assert.match(windowsLauncherSource, /AcquireNativeUiMutexWithPriority\(\)/);
assert.match(windowsLauncherSource, /SupersedeExistingNativeUi\(\)/);
assert.match(windowsLauncherSource, /AcquireWebPickerMutexWithRecovery\(\)/);
assert.match(windowsLauncherSource, /RegisterProcessOwner\(WebPickerPidFile\)/);
assert.match(windowsLauncherSource, /SupersedeRegisteredLauncherRole\(WebPickerPidFile\)/);
assert.match(windowsLauncherSource, /StartBackgroundLauncher\(\);[\s\S]{0,180}HasUsableProfile\(\)/);
assert.match(windowsLauncherSource, /Process\.Start\(new ProcessStartInfo\(launcher, "--background"\)[\s\S]{0,260}SignalNativeTrayRefresh\(\)/);

assert.strictEqual(hasConcurrentFileChange(10_000, 10_000), false);
assert.strictEqual(hasConcurrentFileChange(11_500, 10_000), false);
assert.strictEqual(hasConcurrentFileChange(13_000, 10_000), true);
assert.strictEqual(hasConcurrentFileChange(13_000, 0), false);
assert.strictEqual(
  buildConflictFileName('보고서.docx', '업무/PC', new Date('2026-08-28T01:02:03.000Z'), 0),
  '보고서 (충돌 - 업무_PC - 20260828-010203).docx'
);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-device-security-'));
const inside = path.join(tempRoot, 'inside');
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-device-outside-'));
fs.mkdirSync(inside);
assert.strictEqual(assertRealPathInside(tempRoot, path.join(inside, 'new-file.txt')), path.join(inside, 'new-file.txt'));

const link = path.join(inside, 'escape-link');
try {
  fs.symlinkSync(outside, link, 'dir');
  assert.throws(() => assertRealPathInside(tempRoot, path.join(link, 'secret.txt')), /경계 밖/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

console.log('deviceSyncSecurity tests passed');
