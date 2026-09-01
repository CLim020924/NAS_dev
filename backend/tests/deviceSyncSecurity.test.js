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
  getDeviceConnectionState,
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

const connectionNow = Date.parse('2026-09-01T00:02:00.000Z');
assert.strictEqual(getDeviceConnectionState({ status: 'revoked', lastSeenAt: '2026-09-01T00:02:00.000Z' }, { now: connectionNow }), 'revoked');
assert.strictEqual(getDeviceConnectionState({ syncState: 'connecting', createdAt: '2026-09-01T00:01:00.000Z' }, { now: connectionNow }), 'connecting');
assert.strictEqual(getDeviceConnectionState({ syncState: 'connecting', createdAt: '2026-08-31T23:59:00.000Z' }, { now: connectionNow }), 'offline');
assert.strictEqual(getDeviceConnectionState({ syncState: 'up-to-date', lastSeenAt: '2026-09-01T00:01:45.000Z' }, { now: connectionNow }), 'online');
assert.strictEqual(getDeviceConnectionState({ syncState: 'up-to-date', lastSeenAt: '2026-09-01T00:01:20.000Z' }, { now: connectionNow }), 'offline');

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
assert.match(nasRoutesSource, /DEVICE_OFFLINE_AFTER_MS = 30 \* 1000/);
assert.match(nasRoutesSource, /DEVICE_CONNECT_GRACE_MS = 90 \* 1000/);
assert.match(nasRoutesSource, /first-heartbeat-pending/);
assert.match(nasRoutesSource, /'offline', 'updating', 'error'/);
assert.match(nasRoutesSource, /const liveDevice = registeredDeviceId/);
assert.match(nasRoutesSource, /device: liveDevice \? sanitizeDeviceForResponse\(liveDevice\)/);
assert.doesNotMatch(nasRoutesSource, /WEB_PAIRING_REQUIRED/);
assert.match(windowsAgentSource, /acquireForegroundLock\(\{ supersedeExisting = false \} = \{\}\)/);
assert.match(windowsAgentSource, /acquireForegroundLock\(\{ supersedeExisting: true \}\)/);
assert.match(windowsAgentSource, /if \(!profile\?\.deviceId\) \{[\s\S]{0,900}profiles: \[\][\s\S]{0,900}return true;/);
assert.match(windowsAgentSource, /Persist the local[\s\S]{0,420}saveConfig\(nextConfig\);[\s\S]{0,300}devices\/agent\/logout/);
assert.match(windowsAgentSource, /restartBackground\(\);[\s\S]{0,180}await sendHeartbeat\(profile, 'connecting'\);[\s\S]{0,300}first heartbeat deferred to background/);
assert.match(windowsAgentSource, /post-registration provider setup deferred/);
assert.match(windowsAgentSource, /unprotectAgentToken\(profile\.accountKey\) !== profile\.agentToken/);
assert.match(windowsAgentSource, /연결 생성을 취소했습니다/);
assert.match(windowsLauncherSource, /AcquireNativeUiMutexWithPriority\(\)/);
assert.match(windowsLauncherSource, /SupersedeExistingNativeUi\(\)/);
assert.match(windowsLauncherSource, /AcquireWebPickerMutexWithRecovery\(\)/);
assert.match(windowsLauncherSource, /RegisterProcessOwner\(WebPickerPidFile\)/);
assert.match(windowsLauncherSource, /SupersedeRegisteredLauncherRole\(WebPickerPidFile\)/);
assert.match(windowsLauncherSource, /StartBackgroundLauncher\(\);[\s\S]{0,180}HasUsableProfile\(\)/);
assert.match(windowsLauncherSource, /Process\.Start\(new ProcessStartInfo\(launcher, "--background"\)[\s\S]{0,260}SignalNativeTrayRefresh\(\)/);
assert.match(windowsLauncherSource, /--restart-background/);
assert.match(windowsLauncherSource, /NAS Drive 재시작/);
assert.match(windowsLauncherSource, /CleanupRuntimeStateFiles\(/);
assert.match(windowsLauncherSource, /DeletePidFileWhenOwnerIsGone\(NativeUiPidFile, launcherExe\)/);
assert.match(windowsLauncherSource, /DeletePidFileWhenOwnerIsGone\(WebPickerPidFile, launcherExe\)/);
assert.match(windowsLauncherSource, /RegisterWindowMessage\("TaskbarCreated"\)/);
assert.match(windowsLauncherSource, /startupRestoreTick == 1 \|\| startupRestoreTick == 3 \|\| startupRestoreTick == 6/);
assert.match(windowsLauncherSource, /EmergencyLocalLogout\(\)/);
assert.match(windowsLauncherSource, /profiles"\] = remainingProfiles\.ToArray\(\)/);
assert.match(windowsLauncherSource, /try \{ exitCode = await Task\.Run\(\(\) => RunLogout\(\)\); \} catch \{ \}/);
assert.match(windowsLauncherSource, /--open-drive-after-install/);
assert.match(windowsLauncherSource, /OpenDriveForegroundWhenReady\(openDriveDeviceId\)/);
assert.match(windowsLauncherSource, /DrivePathForDeviceId\(deviceId\)/);
assert.match(windowsLauncherSource, /FindExplorerWindow\(drive\)/);
assert.match(windowsLauncherSource, /AttachThreadInput\(currentThread, foregroundThread, true\)/);
const servicePlatformSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'ServicePlatform.js'), 'utf8');
const nasFrontendSource = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'NAS.js'), 'utf8');
assert.match(servicePlatformSource, /if \(liveState === 'connecting'\) return 'connecting'/);
assert.match(servicePlatformSource, /error\.response\?\.status === 410 \|\| error\.response\?\.status === 404[\s\S]{0,180}pcPairingTokenRef\.current = ''/);
assert.match(servicePlatformSource, /설치된 NAS Drive 열기/);
assert.match(servicePlatformSource, /window\.location\.href = 'nas-sync:\/\/open-drive'/);
assert.doesNotMatch(servicePlatformSource, /if \(!saved\?\.deviceId\) \{[\s\S]{0,100}startPcSyncFlow\(\)/);
assert.match(nasFrontendSource, /heartbeatConfirmed[\s\S]{0,220}connectionState === 'online'[\s\S]{0,160}lastSeenAt/);

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
  try {
    fs.symlinkSync(outside, link, 'dir');
    assert.throws(() => assertRealPathInside(tempRoot, path.join(link, 'secret.txt')), /경계 밖/);
  } catch (error) {
    // Non-elevated Windows commonly denies symlink creation. The same escape
    // assertion remains mandatory on Linux/NAS where production runs.
    if (error?.code !== 'EPERM') throw error;
    console.log('symlink escape test skipped: Windows Developer Mode or elevation is required');
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
}

console.log('deviceSyncSecurity tests passed');
