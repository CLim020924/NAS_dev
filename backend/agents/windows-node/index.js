#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const {
  listPublicBrowserChoices,
  resolvePublicSelection,
  resolveDirectSelection,
  chooseWebBrowser,
  launchSelectedBrowser
} = require('./web-browser');

const SERVER_BASE = 'https://filemanager-nas.com';
const AGENT_VERSION = '1.10.30';
const PC_CONNECT_NEXT_PATH = '/platform?pcConnect=1';
const MAX_FILE_BYTES = 250 * 1024 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024 * 1024;
const DIRECT_UPLOAD_MAX_BYTES = 32 * 1024 * 1024;
const AGENT_CHUNK_SIZE = 8 * 1024 * 1024;
const PULL_INTERVAL_MS = 3_000;
const REQUEST_TIMEOUT_MS = 5_000;
const STATE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'NAS-Sync-Agent');
const CONFIG_FILE = path.join(STATE_DIR, 'agent-config.json');
const LEGACY_TOKEN_FILE = path.join(STATE_DIR, 'agent-token.dpapi');
const PROVIDER_ASSET = path.join(__dirname, 'assets', 'NAS-Drive-Provider.exe');
const ICON_ASSET = path.join(__dirname, 'assets', 'nas-drive.ico');
const PROVIDER_VERSION = '1.4.3';
const PERSONAL_DRIVE_DESKTOP_INI_MARKER = '; NAS Drive managed icon v1';
const PERSONAL_DRIVE_WEB_SHORTCUT_MARKER = '; NAS Drive managed web shortcut v1';
const PERSONAL_DRIVE_WEB_SHORTCUT_NAME = 'NAS Drive 웹 파일관리.lnk';
const LEGACY_PERSONAL_DRIVE_WEB_SHORTCUT_NAME = 'NAS Drive 웹 파일관리.url';
const BRAND_ICON_SHA256 = '3d305b889728792973c836d41d84d51231ff4e62f1771e813a295b3c96332c07';
const DEVICE_KEY_FILE = path.join(STATE_DIR, 'device-key.txt');
const INSTALL_DIR_FILE = path.join(STATE_DIR, 'install-dir.txt');
const DEFAULT_INSTALL_DIR = STATE_DIR;
const PID_FILE = path.join(STATE_DIR, 'agent.pid');
const FOREGROUND_LOCK_FILE = path.join(STATE_DIR, 'foreground.pid');
const EXIT_FILE = path.join(STATE_DIR, 'agent.exit');
const TRAY_SCRIPT_FILE = path.join(STATE_DIR, 'tray.ps1');
const TRAY_PID_FILE = path.join(STATE_DIR, 'tray.pid');
const SETUP_SCRIPT_FILE = path.join(STATE_DIR, 'setup-wizard.ps1');
const SETUP_PROGRESS_SCRIPT_FILE = path.join(STATE_DIR, 'setup-progress.ps1');
const SETUP_PROGRESS_FILE = path.join(STATE_DIR, 'setup-progress.json');
const LOG_FILE = path.join(STATE_DIR, 'nas-drive.log');
const HEALTH_FILE = path.join(STATE_DIR, 'agent-health.json');
const UPDATE_CHECK_FILE = path.join(STATE_DIR, 'agent-update-check.json');
const OPEN_WEB_DIAGNOSTIC_FILE = path.join(STATE_DIR, 'open-web-last.json');
const UPDATE_SCRIPT_FILE = path.join(STATE_DIR, 'agent-update.ps1');
const STATE_PREFIX = 'state_';

let applyingRemoteChange = false;
let setupProgressActive = false;
const suppressedRemotePaths = new Map();
const explorerStatusCache = new Map();
const explorerViewRefreshAt = new Map();
const rootSyncQueues = new Map();
const rootLocalAuditAt = new Map();
const BRANDED_INSTALL_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'Programs', 'NAS Drive');
let INSTALLED_EXE = path.join(DEFAULT_INSTALL_DIR, 'NAS-Sync-Agent.exe');
let INSTALLED_PROVIDER_EXE = path.join(DEFAULT_INSTALL_DIR, 'NAS-Drive-Provider.exe');
let INSTALLED_PROVIDER_VERSION = path.join(DEFAULT_INSTALL_DIR, 'NAS-Drive-Provider.version');
let INSTALLED_ICON = path.join(DEFAULT_INSTALL_DIR, 'nas-drive.ico');

function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureStateDir();
  const tempFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(tempFile, file);
  } catch (error) {
    try { fs.unlinkSync(file); } catch {}
    fs.renameSync(tempFile, file);
  }
}

function writePowerShellScript(file, script) {
  ensureStateDir();
  fs.writeFileSync(file, `\uFEFF${String(script).trimStart()}`, 'utf8');
}

function getSavedInstallDir() {
  try {
    const saved = fs.readFileSync(INSTALL_DIR_FILE, 'utf8').trim();
    if (saved) return saved;
  } catch {}
  return BRANDED_INSTALL_DIR;
}

function setInstallDir(dir) {
  const nextDir = path.resolve(dir || DEFAULT_INSTALL_DIR);
  ensureStateDir();
  fs.writeFileSync(INSTALL_DIR_FILE, nextDir, 'utf8');
  INSTALLED_EXE = path.join(nextDir, 'NAS-Sync-Agent.exe');
  INSTALLED_PROVIDER_EXE = path.join(nextDir, 'NAS-Drive-Provider.exe');
  INSTALLED_PROVIDER_VERSION = path.join(nextDir, 'NAS-Drive-Provider.version');
  INSTALLED_ICON = path.join(nextDir, 'nas-drive.ico');
  return nextDir;
}

function isSameOrChildLocalPath(parentPath, childPath) {
  const parent = path.resolve(String(parentPath || '')).toLowerCase();
  const child = path.resolve(String(childPath || '')).toLowerCase();
  return !!parent && !!child && (child === parent || child.startsWith(parent + path.sep));
}

function migrateUnsafeInstallDir(config) {
  const currentInstallDir = getSavedInstallDir();
  const syncRoots = getProfiles(config).flatMap(profile => getRoots(profile)).filter(root => root.localPath);
  const overlapsSyncRoot = syncRoots.some(root => (
    isSameOrChildLocalPath(root.localPath, currentInstallDir) ||
    isSameOrChildLocalPath(currentInstallDir, root.localPath)
  ));
  if (!overlapsSyncRoot) return false;
  log('[install dir migration]', currentInstallDir, '=>', BRANDED_INSTALL_DIR);
  setInstallDir(BRANDED_INSTALL_DIR);
  return true;
}

setInstallDir(getSavedInstallDir());

function sleepMs(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {}
}

function stopInstalledAgentProcesses() {
  const target = path.resolve(INSTALLED_EXE);
  const defaultTarget = path.resolve(path.join(DEFAULT_INSTALL_DIR, 'NAS-Sync-Agent.exe'));
  const currentPid = process.pid;
  const psScript = `
$target = ${JSON.stringify(target)}
$defaultTarget = ${JSON.stringify(defaultTarget)}
$currentPid = ${currentPid}
Get-CimInstance Win32_Process |
  Where-Object {
    $_.ProcessId -ne $currentPid -and (
      ($_.ExecutablePath -and [String]::Equals($_.ExecutablePath, $target, [System.StringComparison]::OrdinalIgnoreCase)) -or
      ($_.ExecutablePath -and [String]::Equals($_.ExecutablePath, $defaultTarget, [System.StringComparison]::OrdinalIgnoreCase)) -or
      ($_.CommandLine -and $_.CommandLine.IndexOf($target, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) -or
      ($_.CommandLine -and $_.CommandLine.IndexOf($defaultTarget, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) -or
      ($_.Name -and [String]::Equals($_.Name, "NAS-Sync-Agent.exe", [System.StringComparison]::OrdinalIgnoreCase))
    )
  } |
  ForEach-Object {
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
`;
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
    windowsHide: true,
    stdio: 'ignore'
  });
}

function requestInstalledAgentStop({ force = false } = {}) {
  try { fs.writeFileSync(EXIT_FILE, String(Date.now()), 'utf8'); } catch {}
  sleepMs(700);
  const trayPid = Number(fs.existsSync(TRAY_PID_FILE) ? fs.readFileSync(TRAY_PID_FILE, 'utf8') : 0);
  if (isProcessAlive(trayPid)) {
    try { process.kill(trayPid); } catch {}
  }
  try { fs.unlinkSync(TRAY_PID_FILE); } catch {}
  if (force) stopInstalledAgentProcesses();
}

function installSelf() {
  ensureStateDir();
  const current = path.resolve(process.execPath);
  const target = path.resolve(INSTALLED_EXE);
  if (current.toLowerCase() === target.toLowerCase()) {
    try {
      refreshInstalledBrandAssets();
      createDesktopShortcut(target);
    } catch (err) {
      log('[brand assets refresh failed]', err.message);
    }
    return target;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(current, target);
      refreshInstalledBrandAssets();
      createDesktopShortcut(target);
      return target;
    } catch (err) {
      if (err && (err.code === 'EBUSY' || err.code === 'EPERM') && fs.existsSync(target)) {
        requestInstalledAgentStop({ force: attempt >= 2 });
        sleepMs(1000);
        continue;
      }
      log('[install self failed]', err.message);
      return fs.existsSync(target) ? target : current;
    }
  }

  return fs.existsSync(target) ? target : current;
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function isNativeLauncherAvailable(agentExe = INSTALLED_EXE) {
  const launcher = path.join(path.dirname(agentExe), 'NAS-Drive.exe');
  try {
    if (!fs.existsSync(launcher) || !fs.existsSync(agentExe)) return false;
    return fileSha256(launcher) !== fileSha256(agentExe);
  } catch {
    return false;
  }
}

function refreshInstalledBrandAssets() {
  if (!fs.existsSync(ICON_ASSET)) throw new Error('NAS Drive icon asset is missing.');
  fs.mkdirSync(path.dirname(INSTALLED_ICON), { recursive: true });
  if (!fs.existsSync(INSTALLED_ICON) || fileSha256(INSTALLED_ICON) !== BRAND_ICON_SHA256) {
    fs.copyFileSync(ICON_ASSET, INSTALLED_ICON);
  }
  if (fileSha256(INSTALLED_ICON) !== BRAND_ICON_SHA256) {
    throw new Error('NAS Drive icon asset verification failed.');
  }
  ensureStatusIcons();
}

const EXPLORER_STATUS_COLORS = {
  'up-to-date': [22, 163, 74],
  connecting: [2, 136, 209],
  syncing: [2, 136, 209],
  offline: [237, 139, 0],
  paused: [117, 117, 117],
  'needs-relink': [211, 47, 47],
  updating: [94, 53, 177],
  error: [211, 47, 47]
};

function createStatusIconBuffer(state, rgb) {
  const size = 32;
  const rowBytes = size * 4;
  const xor = Buffer.alloc(rowBytes * size);
  const mask = Buffer.alloc(4 * size);
  const setPixel = (x, y, r, g, b, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const row = size - 1 - y;
    const offset = row * rowBytes + x * 4;
    xor[offset] = b; xor[offset + 1] = g; xor[offset + 2] = r; xor[offset + 3] = a;
  };
  for (let y = 7; y <= 24; y += 1) {
    for (let x = 3; x <= 27; x += 1) {
      const cloud = ((x - 12) ** 2 + (y - 15) ** 2 <= 75)
        || ((x - 20) ** 2 + (y - 13) ** 2 <= 48)
        || (x >= 6 && x <= 25 && y >= 14 && y <= 24);
      if (cloud) setPixel(x, y, rgb[0], rgb[1], rgb[2], 255);
    }
  }
  // Explorer renders navigation icons at roughly 16px. A small status dot was
  // technically present but nearly invisible, so use a large high-contrast
  // lower badge while tinting the cloud with the same canonical state color.
  for (let y = 17; y <= 31; y += 1) {
    for (let x = 17; x <= 31; x += 1) {
      const distance = (x - 24) ** 2 + (y - 24) ** 2;
      if (distance <= 58) setPixel(x, y, 255, 255, 255, 255);
      if (distance <= 42) setPixel(x, y, rgb[0], rgb[1], rgb[2], 255);
    }
  }
  const white = (x, y) => setPixel(x, y, 255, 255, 255, 255);
  const thickPixel = (x, y) => { white(x, y); white(x + 1, y); white(x, y + 1); };
  if (state === 'up-to-date') {
    [[20, 24], [22, 26], [24, 24], [26, 22], [28, 20]].forEach(([x, y]) => thickPixel(x, y));
  } else if (state === 'offline') {
    for (let y = 20; y <= 25; y += 1) thickPixel(24, y);
    thickPixel(24, 28);
  } else if (state === 'paused') {
    for (let y = 21; y <= 27; y += 1) { thickPixel(21, y); thickPixel(26, y); }
  } else if (state === 'needs-relink' || state === 'error') {
    for (let i = 0; i <= 6; i += 1) { thickPixel(21 + i, 21 + i); thickPixel(27 - i, 21 + i); }
  } else {
    for (let x = 20; x <= 27; x += 1) thickPixel(x, 24);
  }
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(xor.length + mask.length, 20);
  const image = Buffer.concat([header, xor, mask]);
  const icon = Buffer.alloc(22);
  icon.writeUInt16LE(0, 0);
  icon.writeUInt16LE(1, 2);
  icon.writeUInt16LE(1, 4);
  icon[6] = size; icon[7] = size;
  icon.writeUInt16LE(1, 10);
  icon.writeUInt16LE(32, 12);
  icon.writeUInt32LE(image.length, 14);
  icon.writeUInt32LE(icon.length, 18);
  return Buffer.concat([icon, image]);
}

function ensureStatusIcons() {
  for (const [state, color] of Object.entries(EXPLORER_STATUS_COLORS)) {
    const target = path.join(path.dirname(INSTALLED_ICON), `nas-drive-status-${state}.ico`);
    const content = createStatusIconBuffer(state, color);
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(content)) fs.writeFileSync(target, content);
  }
}

async function ensureProviderInstalled(profile) {
  try {
    fs.mkdirSync(path.dirname(INSTALLED_PROVIDER_EXE), { recursive: true });
    const installedVersion = fs.existsSync(INSTALLED_PROVIDER_VERSION)
      ? fs.readFileSync(INSTALLED_PROVIDER_VERSION, 'utf8').trim()
      : '';
    if (fs.existsSync(INSTALLED_PROVIDER_EXE) && installedVersion === PROVIDER_VERSION) {
      return INSTALLED_PROVIDER_EXE;
    }
    if (profile) {
      for (const root of getRoots(profile).filter(item => item.kind === 'personal-drive')) stopPersonalDriveProvider(profile, root);
      sleepMs(400);
    }
    const source = fs.existsSync(PROVIDER_ASSET) ? PROVIDER_ASSET : '';
    if (source) {
      fs.copyFileSync(source, INSTALLED_PROVIDER_EXE);
    } else if (profile?.deviceId && profile?.agentToken) {
      const tempPath = `${INSTALLED_PROVIDER_EXE}.download`;
      await downloadFile(`/api/devices/agent/provider/windows?deviceId=${encodeURIComponent(profile.deviceId)}`, tempPath, profile.agentToken);
      fs.renameSync(tempPath, INSTALLED_PROVIDER_EXE);
    } else {
      throw new Error('CFAPI provider download credentials are missing.');
    }
    fs.writeFileSync(INSTALLED_PROVIDER_VERSION, PROVIDER_VERSION, 'utf8');
    return INSTALLED_PROVIDER_EXE;
  } catch (err) {
    log('[provider install failed]', err.message);
    return '';
  }
}

function safeAccountKey(value) {
  return String(value || 'account').replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 96) || 'account';
}

function personalDrivePath(account = {}) {
  const label = String(account.displayName || account.loginId || account.ownerKey || '개인')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim() || '개인';
  return path.join(os.homedir(), `NAS Drive - ${label}`);
}

function validatePersonalDrivePath(value) {
  const target = path.resolve(String(value || ''));
  const root = path.parse(target).root;
  if (!value || target === root) throw new Error('드라이브 전체를 NAS Drive 위치로 사용할 수 없습니다. 사용자 폴더 안의 경로를 선택해 주세요.');
  const blockedRoots = [process.env.WINDIR, process.env.ProgramFiles, process.env['ProgramFiles(x86)'], STATE_DIR, getSavedInstallDir()]
    .filter(Boolean)
    .map(item => path.resolve(item).toLowerCase());
  const lowered = target.toLowerCase();
  if (blockedRoots.some(item => lowered === item || lowered.startsWith(item + path.sep))) {
    throw new Error('Windows 시스템 또는 프로그램 폴더는 NAS Drive 위치로 사용할 수 없습니다.');
  }
  const otherCloudRoots = [process.env.OneDrive, process.env.OneDriveCommercial, process.env.OneDriveConsumer]
    .filter(Boolean)
    .map(item => path.resolve(item).toLowerCase());
  if (otherCloudRoots.some(item => lowered === item || lowered.startsWith(item + path.sep))) {
    throw new Error('다른 클라우드 동기화 폴더 안에는 NAS Drive를 만들 수 없습니다. 동기화 충돌을 막기 위한 제한입니다.');
  }
  if (target.length > 180) throw new Error('NAS Drive 경로가 너무 깁니다. 더 짧은 위치를 선택해 주세요.');
  return target;
}

async function registerPersonalDrive(profile) {
  const provider = await ensureProviderInstalled(profile);
  const root = getRoots(profile).find(item => item.kind === 'personal-drive');
  if (!provider || !root?.localPath) return false;
  fs.mkdirSync(root.localPath, { recursive: true });
  setPersonalDriveFolderIcon(root.localPath, true);
  setPersonalDriveWebShortcut(root.localPath, profile, true);
  const result = spawnSync(provider, [
    'register',
    '--root', root.localPath,
    '--account', profile.accountKey,
    '--display-name', `NAS Drive - ${profile.displayName || profile.loginId || '개인'}`
  ], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    const output = String(result.stderr || result.stdout || result.status);
    log('[provider register failed]', output);
    // An existing Windows sync-root registration may reject an in-place policy
    // update while Explorer still owns the namespace. The namespace remains valid;
    // keep the provider connected and refresh the shell metadata instead.
    if (!/0x8007018B/i.test(output)) return false;
  }
  sleepMs(700);
  setPersonalDriveHomePin(root.localPath, true);
  await ensurePersonalDriveProvider(profile, root);
  return true;
}

function personalDriveDesktopIniPath(rootPath) {
  return path.join(path.resolve(rootPath), 'desktop.ini');
}

function isPersonalDriveShellMetadata(root, targetPath) {
  if (root?.kind !== 'personal-drive' || !root.localPath || !targetPath) return false;
  const normalized = path.resolve(targetPath).toLowerCase();
  return normalized === personalDriveDesktopIniPath(root.localPath).toLowerCase()
    || normalized === path.join(path.resolve(root.localPath), PERSONAL_DRIVE_WEB_SHORTCUT_NAME).toLowerCase()
    || normalized === path.join(path.resolve(root.localPath), LEGACY_PERSONAL_DRIVE_WEB_SHORTCUT_NAME).toLowerCase();
}

function isPersonalDriveShellMetadataRelPath(root, relativePath) {
  if (root?.kind !== 'personal-drive') return false;
  const normalized = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  return normalized === 'desktop.ini'
    || normalized === PERSONAL_DRIVE_WEB_SHORTCUT_NAME.toLowerCase()
    || normalized === LEGACY_PERSONAL_DRIVE_WEB_SHORTCUT_NAME.toLowerCase();
}

function explorerStatusLabel(state) {
  return ({
    'up-to-date': '온라인 · NAS와 동기화됨',
    connecting: '계정 연결 중',
    syncing: '온라인 · 파일 동기화 중',
    offline: '오프라인 · NAS 또는 연결 경로 확인 필요',
    paused: '온라인 · 동기화 일시 중지',
    'needs-relink': '오프라인 · 계정 다시 연결 필요',
    updating: 'NAS Drive 업데이트 중',
    error: '오류 · NAS Drive 확인 필요'
  }[state] || 'NAS Drive 상태 확인 필요');
}

function setPersonalDriveFolderIcon(rootPath, enabled, state = 'up-to-date', message = '') {
  if (!rootPath) return false;
  const desktopIni = personalDriveDesktopIniPath(rootPath);
  try {
    if (enabled) {
      if (!fs.existsSync(INSTALLED_ICON)) return false;
      const statusIcon = path.join(path.dirname(INSTALLED_ICON), `nas-drive-status-${state}.ico`);
      const iconPath = fs.existsSync(statusIcon) ? statusIcon : INSTALLED_ICON;
      const statusText = explorerStatusLabel(state);
      const detail = String(message || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 180);
      const infoTip = detail && !statusText.includes(detail) ? `${statusText} · ${detail}` : statusText;
      const content = [
        PERSONAL_DRIVE_DESKTOP_INI_MARKER,
        '[.ShellClassInfo]',
        `IconResource=${iconPath},0`,
        'ConfirmFileOp=0',
        `InfoTip=${infoTip}`,
        '',
        '[ViewState]',
        'Mode=',
        'Vid=',
        'FolderType=StorageProviderGeneric',
        ''
      ].join('\r\n');
      if (fs.existsSync(desktopIni)) {
        const existing = fs.readFileSync(desktopIni, 'utf16le').replace(/^\uFEFF/, '');
        if (!existing.includes(PERSONAL_DRIVE_DESKTOP_INI_MARKER)) return false;
        if (existing === content) return false;
        spawnSync('attrib.exe', ['-h', '-s', desktopIni], { windowsHide: true, stdio: 'ignore' });
      }
      fs.writeFileSync(desktopIni, Buffer.from(`\uFEFF${content}`, 'utf16le'));
      spawnSync('attrib.exe', ['+h', '+s', desktopIni], { windowsHide: true, stdio: 'ignore' });
      spawnSync('attrib.exe', ['+r', rootPath], { windowsHide: true, stdio: 'ignore' });
      return true;
    }
    if (!fs.existsSync(desktopIni)) return false;
    const content = fs.readFileSync(desktopIni, 'utf16le').replace(/^\uFEFF/, '');
    if (!content.includes(PERSONAL_DRIVE_DESKTOP_INI_MARKER)) return false;
    spawnSync('attrib.exe', ['-h', '-s', desktopIni], { windowsHide: true, stdio: 'ignore' });
    fs.unlinkSync(desktopIni);
    spawnSync('attrib.exe', ['-r', rootPath], { windowsHide: true, stdio: 'ignore' });
    return true;
  } catch (err) {
    log('[personal drive icon failed]', err.message);
    return false;
  }
}

function refreshPersonalDriveShell(rootPath) {
  if (process.platform !== 'win32' || !rootPath) return;
  const script = `
$root = [Environment]::GetEnvironmentVariable('NAS_DRIVE_REFRESH_ROOT')
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NasDriveShellRefresh {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern void SHChangeNotify(uint eventId, uint flags, string item1, string item2);
}
'@
[NasDriveShellRefresh]::SHChangeNotify(0x00002000, 0x0005, $root, $null)
[NasDriveShellRefresh]::SHChangeNotify(0x00002000, 0x0005, (Join-Path $root 'desktop.ini'), $null)
[NasDriveShellRefresh]::SHChangeNotify(0x08000000, 0x0000, $null, $null)
$iconRefresh = Join-Path $env:WINDIR 'System32\\ie4uinit.exe'
if (Test-Path -LiteralPath $iconRefresh) {
  Start-Process -FilePath $iconRefresh -ArgumentList '-show' -WindowStyle Hidden -Wait
}
# Explorer updates its namespace-icon cache asynchronously. Refreshing the
# open window immediately can therefore display the previous state for one
# whole transition. Give the cache a short settling period, then notify again.
Start-Sleep -Milliseconds 1400
[NasDriveShellRefresh]::SHChangeNotify(0x00002000, 0x0005, $root, $null)
[NasDriveShellRefresh]::SHChangeNotify(0x00002000, 0x0005, (Join-Path $root 'desktop.ini'), $null)
[NasDriveShellRefresh]::SHChangeNotify(0x08000000, 0x0000, $null, $null)
$shell = New-Object -ComObject Shell.Application
foreach ($window in @($shell.Windows())) {
  try {
    if ([IO.Path]::GetFullPath($window.Document.Folder.Self.Path) -eq [IO.Path]::GetFullPath($root)) {
      $window.Refresh()
    }
  } catch {}
}
`;
  const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NAS_DRIVE_REFRESH_ROOT: rootPath }
  });
  child.on('error', err => log('[personal drive shell refresh failed]', err.message));
  child.unref();
}

function setPersonalDriveWebShortcut(rootPath, profile, enabled) {
  if (!rootPath) return;
  const shortcutPath = path.join(path.resolve(rootPath), PERSONAL_DRIVE_WEB_SHORTCUT_NAME);
  const legacyShortcutPath = path.join(path.resolve(rootPath), LEGACY_PERSONAL_DRIVE_WEB_SHORTCUT_NAME);
  try {
    if (fs.existsSync(legacyShortcutPath)) {
      const legacy = fs.readFileSync(legacyShortcutPath, 'utf8');
      if (legacy.includes(PERSONAL_DRIVE_WEB_SHORTCUT_MARKER)) fs.unlinkSync(legacyShortcutPath);
    }
    if (!enabled) {
      if (fs.existsSync(shortcutPath)) fs.unlinkSync(shortcutPath);
      return;
    }
    const launcher = path.join(path.dirname(INSTALLED_EXE), 'NAS-Drive.exe');
    const target = isNativeLauncherAvailable(INSTALLED_EXE) ? launcher : INSTALLED_EXE;
    const args = target === launcher ? '--open-web' : '--open-web --hidden-bootstrap';
    const script = [
      "$shortcutPath = [Environment]::GetEnvironmentVariable('NAS_DRIVE_WEB_SHORTCUT')",
      "$target = [Environment]::GetEnvironmentVariable('NAS_DRIVE_WEB_TARGET')",
      "$arguments = [Environment]::GetEnvironmentVariable('NAS_DRIVE_WEB_ARGUMENTS')",
      "$icon = [Environment]::GetEnvironmentVariable('NAS_DRIVE_WEB_ICON')",
      '$shell = New-Object -ComObject WScript.Shell',
      '$shortcut = $shell.CreateShortcut($shortcutPath)',
      '$shortcut.TargetPath = $target',
      '$shortcut.Arguments = $arguments',
      '$shortcut.WorkingDirectory = Split-Path -Parent $target',
      '$shortcut.IconLocation = $icon + ",0"',
      '$shortcut.Description = "NAS Drive 웹에서 관리"',
      '$shortcut.WindowStyle = 1',
      '$shortcut.Save()'
    ].join('; ');
    const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      encoding: 'utf8',
      env: {
        ...process.env,
        NAS_DRIVE_WEB_SHORTCUT: shortcutPath,
        NAS_DRIVE_WEB_TARGET: target,
        NAS_DRIVE_WEB_ARGUMENTS: args,
        NAS_DRIVE_WEB_ICON: INSTALLED_ICON
      }
    });
    if (result.status !== 0 || !fs.existsSync(shortcutPath)) {
      throw new Error(String(result.stderr || result.stdout || `shortcut exit ${result.status}`));
    }
  } catch (err) {
    log('[personal drive web shortcut failed]', err.message);
  }
}

function ensurePersonalDriveWebShortcut(rootPath, profile) {
  if (!rootPath) return;
  const shortcutPath = path.join(path.resolve(rootPath), PERSONAL_DRIVE_WEB_SHORTCUT_NAME);
  if (!fs.existsSync(shortcutPath)) setPersonalDriveWebShortcut(rootPath, profile, true);
}

function setPersonalDriveHomePin(rootPath, pinned) {
  if (!rootPath) return;
  const script = `
$root = [Environment]::GetEnvironmentVariable('NAS_DRIVE_HOME_ROOT')
$parent = Split-Path -Parent $root
$name = Split-Path -Leaf $root
$shell = New-Object -ComObject Shell.Application
$item = $shell.Namespace($parent).ParseName($name)
$quickAccessFolder = $shell.Namespace('shell:::{679F85CB-0220-4080-B29B-5540CC05AAB6}')
$isPinned = $false
if ($null -ne $quickAccessFolder) {
  foreach ($entry in $quickAccessFolder.Items()) {
    if ($entry.Path -and [String]::Equals($entry.Path, $root, [System.StringComparison]::OrdinalIgnoreCase)) {
      $isPinned = $true
      break
    }
  }
}
if ($null -ne $item -and ${pinned ? '$true' : '$false'} -and -not $isPinned) { $item.InvokeVerb('pintohome') }
if ($null -ne $item -and -not ${pinned ? '$true' : '$false'} -and $isPinned) { $item.InvokeVerb('unpinfromhome') }
`;
  spawnSync('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, NAS_DRIVE_HOME_ROOT: rootPath }
  });
}

function providerPidFile(profile, root) {
  return path.join(STATE_DIR, `provider-${safeAccountKey(profile.accountKey)}-${safeAccountKey(root.syncRootId)}.pid`);
}

function providerManifestFile(profile, root) {
  return path.join(STATE_DIR, `manifest-${safeAccountKey(profile.accountKey)}-${safeAccountKey(root.syncRootId)}.json`);
}

function stopPersonalDriveProvider(profile, root) {
  const pidFile = providerPidFile(profile, root);
  const pid = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : 0);
  if (isExpectedProcessAlive(pid, INSTALLED_PROVIDER_EXE)) {
    try { process.kill(pid); } catch {}
  }
  try { fs.unlinkSync(pidFile); } catch {}
}

function isPersonalDriveProviderAlive(profile, root) {
  const pidFile = providerPidFile(profile, root);
  const pid = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : 0);
  return isExpectedProcessAlive(pid, INSTALLED_PROVIDER_EXE);
}

function discoverPersonalDriveProviderPid(root) {
  if (process.platform !== 'win32' || !root?.syncRootId) return 0;
  const script = [
    "$expected = [IO.Path]::GetFullPath($env:NAS_DRIVE_PROVIDER_PATH)",
    "$rootId = $env:NAS_DRIVE_SYNC_ROOT_ID",
    "$match = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'NAS-Drive-Provider.exe' -and $_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath) -ieq $expected -and $_.CommandLine -and $_.CommandLine.Contains($rootId) } | Select-Object -First 1 -ExpandProperty ProcessId",
    "if ($match) { [Console]::Write($match) }"
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    env: { ...process.env, NAS_DRIVE_PROVIDER_PATH: INSTALLED_PROVIDER_EXE, NAS_DRIVE_SYNC_ROOT_ID: String(root.syncRootId) }
  });
  const pid = Number(String(result.stdout || '').trim());
  return isExpectedProcessAlive(pid, INSTALLED_PROVIDER_EXE) ? pid : 0;
}

async function ensurePersonalDriveProvider(profile, root) {
  const provider = await ensureProviderInstalled(profile);
  if (!provider || !root?.localPath) return false;
  const pidFile = providerPidFile(profile, root);
  const existingPid = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : 0);
  if (isExpectedProcessAlive(existingPid, provider)) return true;
  const discoveredPid = discoverPersonalDriveProviderPid(root);
  if (discoveredPid) {
    fs.writeFileSync(pidFile, String(discoveredPid), 'utf8');
    return true;
  }
  try { fs.unlinkSync(pidFile); } catch {}
  const displayName = String(profile.displayName || profile.loginId || '개인').startsWith('NAS Drive')
    ? String(profile.displayName || profile.loginId || '개인')
    : `NAS Drive - ${profile.displayName || profile.loginId || '개인'}`;
  const registration = spawnSync(provider, [
    'register',
    '--root', root.localPath,
    '--account', profile.accountKey,
    '--display-name', displayName
  ], { encoding: 'utf8', windowsHide: true });
  if (registration.status !== 0 && !/0x8007018B/i.test(String(registration.stderr || registration.stdout || ''))) {
    throw new Error(`NAS Drive 파일 탐색기 연결 등록을 복구하지 못했습니다: ${String(registration.stderr || registration.stdout || registration.status).trim()}`);
  }
  const child = spawn(provider, [
    'serve',
    '--root', root.localPath,
    '--server-base', SERVER_BASE,
    '--device-id', profile.deviceId,
    '--sync-root-id', root.syncRootId,
    '--token-file', tokenFileFor(profile.accountKey)
  ], { windowsHide: true, detached: true, stdio: 'ignore' });
  child.unref();
  fs.writeFileSync(pidFile, String(child.pid), 'utf8');
  await new Promise(resolve => setTimeout(resolve, 650));
  if (child.exitCode !== null || child.killed) {
    try { fs.unlinkSync(pidFile); } catch {}
    throw new Error('NAS Drive 파일 탐색기 연결 프로세스를 시작하지 못했습니다. 자동으로 다시 시도합니다.');
  }
  return true;
}

function providerCommandPipe(root) {
  const digest = crypto.createHash('sha256').update(String(root.syncRootId || ''), 'utf8').digest('hex').slice(0, 24).toUpperCase();
  return `\\\\.\\pipe\\NASDrive_${digest}`;
}

function sendPersonalDriveProviderCommand(root, operation, relativePath = '', identity = relativePath, extra = {}) {
  if (root?.kind !== 'personal-drive') return Promise.resolve(false);
  if (!['sync-manifest', 'configure-view'].includes(operation) && !relativePath) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const client = net.createConnection(providerCommandPipe(root));
    let response = '';
    const timer = setTimeout(() => {
      client.destroy();
      reject(new Error('NAS Drive Provider 상태 갱신 시간이 초과되었습니다.'));
    }, operation === 'sync-manifest' ? 60000 : 5000);
    client.setEncoding('utf8');
    client.on('connect', () => client.write(`${JSON.stringify({ operation, relPath: relativePath, identity, ...extra })}\n`));
    client.on('data', chunk => {
      response += chunk;
      if (!response.includes('\n')) return;
      clearTimeout(timer);
      client.end();
      try {
        const result = JSON.parse(response.trim());
        if (!result.success) throw new Error(result.error || 'NAS Drive Provider 상태 갱신에 실패했습니다.');
        resolve(true);
      } catch (err) {
        reject(err);
      }
    });
    client.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function updatePersonalDriveEntryState(root, profile, target, operation) {
  if (root?.kind !== 'personal-drive' || !target || !fs.existsSync(target)) return false;
  const relativePath = relPath(root.localPath, target);
  if (!relativePath || isPersonalDriveShellMetadataRelPath(root, relativePath)) return false;
  await ensurePersonalDriveProvider(profile, root);
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      return await sendPersonalDriveProviderCommand(root, operation, relativePath, relativePath);
    } catch (err) {
      lastError = err;
      if (attempt < 11) await new Promise(resolve => setTimeout(resolve, 125));
    }
  }
  log('[provider entry state failed]', operation, relativePath, lastError?.message || 'unknown error');
  throw lastError;
}

function suppressRemotePath(fullPath, durationMs = 6000) {
  suppressedRemotePaths.set(path.resolve(fullPath).toLowerCase(), Date.now() + durationMs);
}

function isRemotePathSuppressed(fullPath) {
  const key = path.resolve(fullPath).toLowerCase();
  const expiresAt = suppressedRemotePaths.get(key) || 0;
  if (expiresAt <= Date.now()) {
    suppressedRemotePaths.delete(key);
    return false;
  }
  return true;
}

async function syncPersonalDrivePlaceholders(root, profile, manifest, previous) {
  const provider = await ensureProviderInstalled(profile);
  if (!provider) throw new Error('Windows Cloud Files provider is unavailable.');
  // Reconciliation runs inside the connected Provider. This keeps placeholder
  // creation, conversion and updates on the process that owns the sync root and
  // avoids widening CFAPI helper permissions.
  await ensurePersonalDriveProvider(profile, root);
  const manifestFile = providerManifestFile(profile, root);
  const visibleManifest = {
    ...manifest,
    entries: (manifest.entries || []).filter(entry => !isPersonalDriveShellMetadataRelPath(root, entry.relPath))
  };
  for (const entry of visibleManifest.entries) {
    suppressRemotePath(path.join(root.localPath, entry.relPath.split('/').join(path.sep)));
  }
  writeJson(manifestFile, visibleManifest);
  let manifestSyncError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await sendPersonalDriveProviderCommand(root, 'sync-manifest', '', '', { manifestPath: manifestFile });
      manifestSyncError = null;
      break;
    } catch (err) {
      manifestSyncError = err;
      if (attempt < 19) await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  if (manifestSyncError) throw manifestSyncError;
  const remotePaths = new Set(visibleManifest.entries.map(entry => entry.relPath));
  for (const rel of previous.remotePaths || []) {
    if (!remotePaths.has(rel)) {
      const target = path.join(root.localPath, rel.split('/').join(path.sep));
      suppressRemotePath(target);
      moveToTrash(root, target, { allowOnlineOnlyPlaceholderDelete: true });
    }
  }
}

async function openPersonalDrive(profile) {
  const root = getRoots(profile).find(item => item.kind === 'personal-drive');
  if (!root?.localPath) return false;
  await registerPersonalDrive(profile);
  spawn('explorer.exe', [root.localPath], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  await new Promise(resolve => setTimeout(resolve, 700));
  const viewResult = spawnSync(INSTALLED_PROVIDER_EXE, [
    'configure-view', '--root', root.localPath
  ], { encoding: 'utf8', windowsHide: true });
  if (viewResult.status !== 0) {
    log('[explorer cloud status column failed]', viewResult.stderr || viewResult.stdout || viewResult.status);
  }
  return true;
}

function launchTrustedWebUrl(urlText, browser = { id: 'system' }) {
  const target = new URL(String(urlText || ''));
  const expected = new URL(SERVER_BASE);
  if (target.protocol !== 'https:' || target.origin !== expected.origin) {
    throw new Error('NAS Drive가 신뢰하지 않는 웹 주소를 차단했습니다.');
  }
  launchSelectedBrowser(browser, target.toString());
}

function friendlyOpenWebError(error) {
  const state = classifyAgentError(error);
  if (error?.code === 'WEB_PROFILE_TOKEN_UNAVAILABLE') {
    return {
      state: 'error',
      title: 'NAS Drive 계정 확인 지연',
      message: 'Windows에 보관된 NAS Drive 계정 정보를 잠시 읽지 못했습니다. NAS Drive는 로그인 정보를 지우지 않았습니다. 잠시 후 다시 눌러 주세요.\n\n오류 코드: WEB_PROFILE_TOKEN_UNAVAILABLE'
    };
  }
  if (state === 'offline') {
    return {
      state,
      title: 'NAS 서버 오프라인',
      message: 'NAS 서버가 꺼져 있거나 인터넷에 연결할 수 없습니다. 서버 전원과 Cloudflare 연결을 확인한 뒤 다시 눌러 주세요.'
    };
  }
  if (state === 'needs-relink') {
    return {
      state,
      title: 'NAS Drive 로그인 필요',
      message: '이 PC의 NAS 계정 연결이 만료되었습니다. NAS Drive 상태 및 설정에서 다시 로그인해 주세요.'
    };
  }
  return {
    state,
    title: 'NAS 웹을 열 수 없음',
    message: `NAS 웹 파일관리 화면을 열지 못했습니다. 잠시 후 다시 시도해 주세요.\n\n오류 코드: ${safeOpenWebError(error).code}`
  };
}

async function openWebForProfile(profile) {
  if (!profile?.deviceId) {
    const error = Object.assign(new Error('웹으로 열 NAS 계정 연결이 없습니다.'), { code: 'WEB_PROFILE_MISSING' });
    writeOpenWebDiagnostic({ state: 'error', stage: 'profile', attempt: 0, error: safeOpenWebError(error) });
    throw error;
  }
  if (!profile.agentToken) {
    const error = Object.assign(new Error('Windows DPAPI에서 NAS Drive 장치 인증 정보를 읽지 못했습니다.'), { code: 'WEB_PROFILE_TOKEN_UNAVAILABLE' });
    writeOpenWebDiagnostic({
      state: 'error',
      stage: 'profile-token',
      attempt: 0,
      tokenFileExists: fs.existsSync(tokenFileFor(profile.accountKey)),
      error: safeOpenWebError(error)
    });
    throw error;
  }
  const requestedBrowser = getCommandArgument('--web-browser');
  const requestedBrowserProfile = getCommandArgument('--web-browser-profile');
  const selectedBrowser = requestedBrowser
    ? resolveDirectSelection(requestedBrowser, requestedBrowserProfile)
    : chooseWebBrowser();
  const retryDelays = [0, 800, 2_000, 4_000];
  let lastError = null;
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt]) await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
    try {
      const result = await requestJson('POST', '/api/devices/agent/web-session', {
        deviceId: profile.deviceId,
        next: '/nas'
      }, profile.agentToken, 15_000);
      if (!result?.openUrl) {
        throw Object.assign(new Error('NAS 웹 로그인 주소를 만들지 못했습니다.'), { code: 'WEB_SESSION_URL_MISSING' });
      }
      try {
        launchTrustedWebUrl(result.openUrl, selectedBrowser);
      } catch (error) {
        error.code = error.code || 'WEB_URL_BLOCKED';
        writeOpenWebDiagnostic({ state: 'error', stage: 'launch', attempt: attempt + 1, error: safeOpenWebError(error) });
        throw error;
      }
      writeOpenWebDiagnostic({ state: 'opened', stage: 'launch', attempt: attempt + 1, deviceId: String(profile.deviceId), browser: selectedBrowser.id });
      return true;
    } catch (error) {
      lastError = error;
      const state = classifyAgentError(error);
      const safe = safeOpenWebError(error);
      log(`[open web attempt ${attempt + 1}/${retryDelays.length}]`, state, safe.code, safe.message);
      writeOpenWebDiagnostic({ state, stage: 'web-session', attempt: attempt + 1, error: safe });
      if (state === 'needs-relink' || error?.code === 'WEB_URL_BLOCKED') break;
    }
  }
  if (lastError && !lastError.code) lastError.code = 'WEB_SESSION_RETRY_EXHAUSTED';
  throw lastError || Object.assign(new Error('NAS 웹 연결을 시작하지 못했습니다.'), { code: 'WEB_SESSION_RETRY_EXHAUSTED' });
}

function isDownloadedInstaller() {
  const current = path.resolve(process.execPath).toLowerCase();
  const target = path.resolve(INSTALLED_EXE).toLowerCase();
  return current !== target;
}

function relaunchForegroundHiddenIfNeeded() {
  if (process.platform !== 'win32' || !process.pkg) return false;
  if (process.argv.includes('--background') || process.argv.includes('--hidden-bootstrap') || process.argv.includes('--self-test')) return false;
  const args = [...process.argv.slice(2), '--hidden-bootstrap'];
  spawn(process.execPath, args, { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  return true;
}

function isProcessAlive(pid) {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isExpectedProcessAlive(pid, expectedExe) {
  if (!isProcessAlive(pid)) return false;
  if (process.platform !== 'win32' || !expectedExe) return true;
  const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}" -ErrorAction SilentlyContinue; if ($p -and $p.ExecutablePath) { [Console]::Out.Write($p.ExecutablePath) }`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 5000
  });
  if (result.status !== 0) return false;
  return path.resolve(String(result.stdout || '').trim()).toLowerCase() === path.resolve(expectedExe).toLowerCase();
}

function acquireForegroundLock({ supersedeExisting = false } = {}) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existingPid = Number(fs.existsSync(FOREGROUND_LOCK_FILE) ? fs.readFileSync(FOREGROUND_LOCK_FILE, 'utf8') : 0);
    // A PID can be reused by an unrelated Windows process after an interrupted
    // foreground flow. Only a live copy of this exact Agent executable owns the
    // lock. A newer explicit command may replace that older foreground flow.
    if (isExpectedProcessAlive(existingPid, process.execPath)) {
      if (!supersedeExisting) return false;
      try { process.kill(existingPid); } catch {}
      // The executable path was verified before termination. Avoid spawning a
      // WMI/PowerShell probe every 50 ms while waiting for that PID to exit.
      for (let wait = 0; wait < 20 && isProcessAlive(existingPid); wait += 1) sleepMs(50);
      if (isProcessAlive(existingPid)) return false;
    }
    try {
      if (fs.existsSync(FOREGROUND_LOCK_FILE)) {
        const owner = Number(fs.readFileSync(FOREGROUND_LOCK_FILE, 'utf8'));
        if (!owner || owner === existingPid || !isExpectedProcessAlive(owner, process.execPath)) fs.unlinkSync(FOREGROUND_LOCK_FILE);
      }
    } catch {}
    try {
      fs.writeFileSync(FOREGROUND_LOCK_FILE, String(process.pid), { encoding: 'utf8', flag: 'wx' });
      return true;
    } catch {
      sleepMs(80 + (attempt * 80));
    }
  }
  return false;
}

function releaseForegroundLock() {
  try {
    const owner = Number(fs.readFileSync(FOREGROUND_LOCK_FILE, 'utf8'));
    if (owner === process.pid) fs.unlinkSync(FOREGROUND_LOCK_FILE);
  } catch {}
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.map(value => value instanceof Error ? (value.stack || value.message) : String(value)).join(' ')}\n`;
  try {
    ensureStateDir();
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {}
  if (!process.pkg) {
    try { console.log(...args); } catch {}
  }
}

function isAgentAuthError(error) {
  return /HTTP\s+403|Agent 인증 실패|WEB_PAIRING_REQUIRED/i.test(String(error?.message || error || ''));
}

function classifyAgentError(error) {
  if (isAgentAuthError(error)) return 'needs-relink';
  const value = `${String(error?.code || '')} ${String(error?.message || error || '')}`;
  if (/ECONNREFUSED|ECONNRESET|ECONNABORTED|EHOSTUNREACH|ENETUNREACH|ENETDOWN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EPROTO|ERR_TLS|CERT_|socket hang up|HTTP\s+(408|425|429|5\d\d)/i.test(value)) return 'offline';
  return 'error';
}

function safeOpenWebError(error) {
  const rawCode = String(error?.code || '').replace(/[^A-Z0-9_-]/gi, '').slice(0, 48);
  const rawMessage = String(error?.message || error || '알 수 없는 오류')
    .replace(/desktop_[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/([?&]token=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/x-agent-token[^\r\n]*/gi, 'x-agent-token=[REDACTED]')
    .replace(/https?:\/\/[^\s]+/gi, '[URL]')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 240);
  return { code: rawCode || 'OPEN_WEB_FAILED', message: rawMessage || '알 수 없는 오류' };
}

function writeOpenWebDiagnostic(value) {
  try {
    writeJson(OPEN_WEB_DIAGNOSTIC_FILE, {
      version: AGENT_VERSION,
      updatedAt: new Date().toISOString(),
      ...value
    });
  } catch {}
}

function isLogoutAlreadyRevokedError(error) {
  return /^HTTP (401|403):/.test(String(error?.message || ''));
}

function setAgentHealth(state, message = '', extra = {}) {
  writeJson(HEALTH_FILE, {
    state,
    message: String(message || '').slice(0, 500),
    needsRelink: state === 'needs-relink',
    updatedAt: new Date().toISOString(),
    ...extra
  });
}

function setExplorerStatus(profile, state, message = '') {
  if (process.platform !== 'win32' || !profile?.accountKey || !fs.existsSync(INSTALLED_PROVIDER_EXE)) return;
  const displayName = String(profile.displayName || profile.loginId || '개인').startsWith('NAS Drive')
    ? String(profile.displayName || profile.loginId || '개인')
    : `NAS Drive - ${profile.displayName || profile.loginId || '개인'}`;
  for (const root of getRoots(profile).filter(item => item.kind === 'personal-drive' && item.localPath)) {
    const cacheKey = `${profile.accountKey}:${root.syncRootId}`;
    const now = Date.now();
    const shouldRefreshView = now - Number(explorerViewRefreshAt.get(cacheKey) || 0) >= 15_000;
    const stateChanged = explorerStatusCache.get(cacheKey) !== state;
    // Write desktop.ini before the provider emits the Shell refresh. Otherwise
    // an already-open Explorer window can refresh the registry icon first and
    // keep the previous folder icon cached until the window is reopened.
    const iconChanged = setPersonalDriveFolderIcon(root.localPath, true, state, message);
    if (stateChanged) {
      const result = spawnSync(INSTALLED_PROVIDER_EXE, [
        'set-status',
        '--root', root.localPath,
        '--account', profile.accountKey,
        '--display-name', displayName,
        '--state', state,
        '--message', String(message || '').replace(/[\r\n]+/g, ' ').slice(0, 180)
      ], { encoding: 'utf8', windowsHide: true });
      if (result.status === 0) explorerStatusCache.set(cacheKey, state);
      else log('[explorer status failed]', state, result.stderr || result.stdout || result.status);
    }
    if (stateChanged || iconChanged) refreshPersonalDriveShell(root.localPath);
    if (shouldRefreshView) {
      explorerViewRefreshAt.set(cacheKey, now);
      ensurePersonalDriveProvider(profile, root)
        .then(() => sendPersonalDriveProviderCommand(root, 'configure-view'))
        .catch(err => log('[explorer view refresh failed]', err.message));
    }
  }
}

function setProfileHealth(profile, state, message = '') {
  if (profile) profile._runtimeState = state;
  const friendlyMessage = state === 'needs-relink'
    ? '이 계정 연결이 더 이상 유효하지 않습니다. 로그아웃하거나 다시 연결하세요.'
    : (state === 'offline' && !message
      ? 'NAS 서버가 꺼져 있거나 인터넷에 연결할 수 없습니다.'
      : message);
  if (!profile || profile._isActive !== false) {
    setAgentHealth(state, friendlyMessage, { accountKey: profile?.accountKey || '' });
  }
  setExplorerStatus(profile, state, friendlyMessage);
}

function agentStageError(error, stage) {
  const value = error instanceof Error ? error : new Error(String(error || 'unknown error'));
  if (!value.agentStage) value.agentStage = stage;
  return value;
}

function showMessage(title, message) {
  const launcher = path.join(path.dirname(INSTALLED_EXE), 'NAS-Drive.exe');
  if (isNativeLauncherAvailable(INSTALLED_EXE)) {
    const payload = Buffer.from(JSON.stringify({
      title: String(title || 'NAS Drive').slice(0, 100),
      message: String(message || '').slice(0, 1000)
    }), 'utf8').toString('base64');
    spawn(launcher, ['--notify-base64', payload], {
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    }).unref();
    return;
  }
  const safeTitle = String(title || 'NAS Drive').replace(/'/g, "''");
  const safeMessage = String(message || '').replace(/'/g, "''");
  spawn('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-Command',
    `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${safeMessage}', '${safeTitle}') | Out-Null`
  ], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
}

function webSetupUrl(page = 'login') {
  const safePage = page === 'signup' ? 'signup' : 'login';
  return `${SERVER_BASE}/${safePage}?next=${encodeURIComponent(PC_CONNECT_NEXT_PATH)}`;
}

function openWebPage(url) {
  spawn('explorer.exe', [String(url || SERVER_BASE)], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  }).unref();
}

function showFirstRunWelcome(clientDeviceKey) {
  ensureStateDir();
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$form = New-Object System.Windows.Forms.Form
$form.Text = "NAS Drive 로그인"
try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon(${JSON.stringify(INSTALLED_EXE)}) } catch {}
$form.ClientSize = New-Object System.Drawing.Size(620, 610)
$form.StartPosition = "CenterScreen"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.BackColor = [System.Drawing.Color]::White

$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(0, 0)
$header.Size = New-Object System.Drawing.Size(620, 126)
$header.BackColor = [System.Drawing.Color]::FromArgb(26, 86, 219)

$brand = New-Object System.Windows.Forms.Label
$brand.Text = "NAS DRIVE"
$brand.Location = New-Object System.Drawing.Point(30, 18)
$brand.Size = New-Object System.Drawing.Size(560, 25)
$brand.ForeColor = [System.Drawing.Color]::White
$brand.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 11)

$title = New-Object System.Windows.Forms.Label
$title.Text = "NAS Drive에 로그인"
$title.Location = New-Object System.Drawing.Point(28, 50)
$title.Size = New-Object System.Drawing.Size(560, 38)
$title.ForeColor = [System.Drawing.Color]::White
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 20)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = "로그인하면 파일 탐색기에서 개인 NAS Drive를 바로 사용할 수 있습니다."
$subtitle.Location = New-Object System.Drawing.Point(30, 91)
$subtitle.Size = New-Object System.Drawing.Size(555, 24)
$subtitle.ForeColor = [System.Drawing.Color]::FromArgb(224, 235, 255)
$subtitle.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$header.Controls.AddRange(@($brand, $title, $subtitle))

$step = New-Object System.Windows.Forms.Label
$step.Text = "설치 완료  ·  계정 연결"
$step.Location = New-Object System.Drawing.Point(32, 150)
$step.Size = New-Object System.Drawing.Size(550, 25)
$step.ForeColor = [System.Drawing.Color]::FromArgb(26, 86, 219)
$step.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10)

$statusPanel = New-Object System.Windows.Forms.Panel
$statusPanel.Location = New-Object System.Drawing.Point(30, 188)
$statusPanel.Size = New-Object System.Drawing.Size(560, 72)
$statusPanel.BackColor = [System.Drawing.Color]::FromArgb(246, 248, 252)
$statusPanel.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle

$installed = New-Object System.Windows.Forms.Label
$installed.Text = "●  프로그램 설치됨"
$installed.Location = New-Object System.Drawing.Point(18, 16)
$installed.Size = New-Object System.Drawing.Size(510, 25)
$installed.ForeColor = [System.Drawing.Color]::FromArgb(21, 128, 61)
$installed.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10)

$account = New-Object System.Windows.Forms.Label
$account.Text = "●  NAS 계정 연결 필요"
$account.Location = New-Object System.Drawing.Point(280, 16)
$account.Size = New-Object System.Drawing.Size(510, 25)
$account.ForeColor = [System.Drawing.Color]::FromArgb(217, 119, 6)
$account.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10)
$statusPanel.Controls.AddRange(@($installed, $account))

$idLabel = New-Object System.Windows.Forms.Label
$idLabel.Text = "아이디"
$idLabel.Location = New-Object System.Drawing.Point(32, 282)
$idLabel.Size = New-Object System.Drawing.Size(555, 22)
$idLabel.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 9.5)

$id = New-Object System.Windows.Forms.TextBox
$id.Location = New-Object System.Drawing.Point(32, 307)
$id.Size = New-Object System.Drawing.Size(555, 31)
$id.Font = New-Object System.Drawing.Font("Segoe UI", 11)

$passwordLabel = New-Object System.Windows.Forms.Label
$passwordLabel.Text = "비밀번호"
$passwordLabel.Location = New-Object System.Drawing.Point(32, 354)
$passwordLabel.Size = New-Object System.Drawing.Size(555, 22)
$passwordLabel.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 9.5)

$password = New-Object System.Windows.Forms.TextBox
$password.Location = New-Object System.Drawing.Point(32, 379)
$password.Size = New-Object System.Drawing.Size(455, 31)
$password.Font = New-Object System.Drawing.Font("Segoe UI", 11)
$password.UseSystemPasswordChar = $true

$showPassword = New-Object System.Windows.Forms.CheckBox
$showPassword.Text = "표시"
$showPassword.Location = New-Object System.Drawing.Point(500, 382)
$showPassword.Size = New-Object System.Drawing.Size(88, 26)
$showPassword.Add_CheckedChanged({ $password.UseSystemPasswordChar = -not $showPassword.Checked })

$persistence = New-Object System.Windows.Forms.Label
$persistence.Text = "✓ Windows를 다시 시작해도 이 PC에서 자동으로 연결됩니다."
$persistence.Location = New-Object System.Drawing.Point(32, 421)
$persistence.Size = New-Object System.Drawing.Size(555, 24)
$persistence.ForeColor = [System.Drawing.Color]::FromArgb(21, 128, 61)
$persistence.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$errorLabel = New-Object System.Windows.Forms.Label
$errorLabel.Text = ""
$errorLabel.Location = New-Object System.Drawing.Point(32, 449)
$errorLabel.Size = New-Object System.Drawing.Size(555, 32)
$errorLabel.ForeColor = [System.Drawing.Color]::FromArgb(190, 35, 45)
$errorLabel.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$login = New-Object System.Windows.Forms.Button
$login.Text = "로그인"
$login.Location = New-Object System.Drawing.Point(30, 486)
$login.Size = New-Object System.Drawing.Size(560, 44)
$login.BackColor = [System.Drawing.Color]::FromArgb(26, 86, 219)
$login.ForeColor = [System.Drawing.Color]::White
$login.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$login.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10.5)
$login.Add_Click({
  $loginId = $id.Text.Trim()
  if ([String]::IsNullOrWhiteSpace($loginId) -or [String]::IsNullOrWhiteSpace($password.Text)) {
    $errorLabel.Text = "아이디와 비밀번호를 입력해 주세요."
    return
  }
  $login.Enabled = $false
  $login.Text = "안전하게 연결하는 중..."
  $errorLabel.Text = ""
  try {
    $body = @{
      id = $loginId
      password = $password.Text
      clientDeviceKey = ${JSON.stringify(clientDeviceKey || '')}
      deviceName = ${JSON.stringify(os.hostname() || 'Windows-PC')}
    } | ConvertTo-Json -Compress
    $response = Invoke-RestMethod -Uri ${JSON.stringify(`${SERVER_BASE}/api/devices/agent/login-register`)} -Method Post -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 15
    if (-not [String]::IsNullOrWhiteSpace([string]$response.pairingToken)) {
      $form.Tag = "pair:" + [string]$response.pairingToken
      $password.Clear()
      $form.Close()
      return
    }
    $errorLabel.Text = "계정 연결 응답을 확인할 수 없습니다."
  } catch {
    $message = "로그인하지 못했습니다. 계정 정보와 NAS 연결을 확인해 주세요."
    try {
      if ($_.ErrorDetails.Message) {
        $details = $_.ErrorDetails.Message | ConvertFrom-Json
        if ($details.error) { $message = [string]$details.error }
      }
    } catch {}
    $errorLabel.Text = $message
    $password.SelectAll()
    $password.Focus()
  } finally {
    $login.Enabled = $true
    $login.Text = "로그인"
  }
})

$signup = New-Object System.Windows.Forms.Button
$signup.Text = "계정이 없나요? 회원가입"
$signup.Location = New-Object System.Drawing.Point(30, 541)
$signup.Size = New-Object System.Drawing.Size(365, 38)
$signup.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$signup.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 9.5)
$signup.Add_Click({ Start-Process ${JSON.stringify(webSetupUrl('signup'))} })

$later = New-Object System.Windows.Forms.Button
$later.Text = "나중에 설정"
$later.Location = New-Object System.Drawing.Point(407, 541)
$later.Size = New-Object System.Drawing.Size(183, 38)
$later.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$later.Add_Click({ $form.Tag = "later"; $form.Close() })

$note = New-Object System.Windows.Forms.Label
$note.Text = "비밀번호는 HTTPS 로그인 요청에만 사용되며 PC에 저장되지 않습니다."
$note.Location = New-Object System.Drawing.Point(32, 585)
$note.Size = New-Object System.Drawing.Size(555, 20)
$note.ForeColor = [System.Drawing.Color]::Gray
$note.Font = New-Object System.Drawing.Font("Segoe UI", 8.5)

$form.Controls.AddRange(@($header, $step, $statusPanel, $idLabel, $id, $passwordLabel, $password, $showPassword, $persistence, $errorLabel, $login, $signup, $later, $note))
$form.AcceptButton = $login
$form.CancelButton = $later
$form.ShowDialog() | Out-Null
if ([String]::IsNullOrWhiteSpace([string]$form.Tag)) { $form.Tag = "later" }
$password.Clear()
Write-Output ([string]$form.Tag)
`;
  writePowerShellScript(SETUP_SCRIPT_FILE, script);
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    SETUP_SCRIPT_FILE
  ], { encoding: 'utf8', windowsHide: true });
  const action = String(result.stdout || '').trim() || 'later';
  return action.startsWith('pair:') ? action.slice(5) : '';
}

function detectCloudApps() {
  const candidates = [
    ['OneDrive', 'Microsoft OneDrive'],
    ['Dropbox', 'Dropbox'],
    ['GoogleDriveFS', 'Google Drive'],
    ['iCloudDrive', 'iCloud Drive'],
    ['Box', 'Box Drive'],
    ['MEGAsync', 'MEGA'],
    ['SynologyDrive', 'Synology Drive'],
    ['Nextcloud', 'Nextcloud']
  ];
  const running = new Set();
  try {
    const result = spawnSync('tasklist.exe', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    for (const line of String(result.stdout || '').split(/\r?\n/)) {
      const match = line.match(/^"([^"]+)"/);
      if (match) running.add(path.basename(match[1], '.exe').toLowerCase());
    }
  } catch {}
  return candidates
    .filter(([processName]) => running.has(processName.toLowerCase()))
    .map(([processName, displayName]) => ({ processName, displayName }));
}

function showSetupWizard({ account, defaultDrivePath, detectedCloudApps }) {
  ensureStateDir();
  const detectedText = detectedCloudApps.length
    ? detectedCloudApps.map(item => item.displayName).join(', ')
    : '실행 중인 다른 클라우드 앱 없음';
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8

$form = New-Object System.Windows.Forms.Form
$form.Text = "NAS Drive 설치"
try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon(${JSON.stringify(process.execPath)}) } catch {}
$form.ClientSize = New-Object System.Drawing.Size(720, 610)
$form.StartPosition = "CenterScreen"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.BackColor = [System.Drawing.Color]::White

$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(0, 0)
$header.Size = New-Object System.Drawing.Size(720, 112)
$header.BackColor = [System.Drawing.Color]::FromArgb(26, 86, 219)

$brand = New-Object System.Windows.Forms.Label
$brand.Text = "NAS DRIVE"
$brand.Location = New-Object System.Drawing.Point(30, 18)
$brand.Size = New-Object System.Drawing.Size(640, 28)
$brand.ForeColor = [System.Drawing.Color]::White
$brand.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 12)

$title = New-Object System.Windows.Forms.Label
$title.Text = "내 NAS를 Windows 파일 탐색기에 연결"
$title.Location = New-Object System.Drawing.Point(28, 48)
$title.Size = New-Object System.Drawing.Size(650, 42)
$title.ForeColor = [System.Drawing.Color]::White
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 20)
$header.Controls.AddRange(@($brand, $title))

$accountLabel = New-Object System.Windows.Forms.Label
$accountLabel.Text = "연결 계정  ${String(account.displayName || account.loginId || '개인').replace(/`/g, '``').replace(/\$/g, '`$')}"
$accountLabel.Location = New-Object System.Drawing.Point(30, 132)
$accountLabel.Size = New-Object System.Drawing.Size(650, 26)
$accountLabel.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10)

$driveLabel = New-Object System.Windows.Forms.Label
$driveLabel.Text = "NAS Drive 위치"
$driveLabel.Location = New-Object System.Drawing.Point(30, 174)
$driveLabel.Size = New-Object System.Drawing.Size(300, 24)
$driveLabel.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10)

$drivePath = New-Object System.Windows.Forms.TextBox
$drivePath.Text = ${JSON.stringify(defaultDrivePath)}
$drivePath.Location = New-Object System.Drawing.Point(30, 202)
$drivePath.Size = New-Object System.Drawing.Size(555, 29)
$drivePath.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$driveBrowse = New-Object System.Windows.Forms.Button
$driveBrowse.Text = "변경"
$driveBrowse.Location = New-Object System.Drawing.Point(595, 199)
$driveBrowse.Size = New-Object System.Drawing.Size(90, 34)
$driveBrowse.Add_Click({
  $d = New-Object System.Windows.Forms.FolderBrowserDialog
  $d.Description = "NAS Drive로 사용할 폴더를 선택하세요."
  $d.SelectedPath = $drivePath.Text
  $d.ShowNewFolderButton = $true
  if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $drivePath.Text = $d.SelectedPath }
})

$driveHelp = New-Object System.Windows.Forms.Label
$driveHelp.Text = "OneDrive와 같은 사용자 폴더 위치를 기본값으로 사용합니다. 필요하면 변경할 수 있습니다."
$driveHelp.Location = New-Object System.Drawing.Point(30, 236)
$driveHelp.Size = New-Object System.Drawing.Size(655, 24)
$driveHelp.ForeColor = [System.Drawing.Color]::DimGray

$startup = New-Object System.Windows.Forms.CheckBox
$startup.Text = "Windows 로그인 시 NAS Drive 자동 시작 (권장)"
$startup.Checked = $true
$startup.Location = New-Object System.Drawing.Point(30, 278)
$startup.Size = New-Object System.Drawing.Size(600, 28)
$startup.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 10)

$cloudGroup = New-Object System.Windows.Forms.GroupBox
$cloudGroup.Text = "다른 클라우드 드라이브"
$cloudGroup.Location = New-Object System.Drawing.Point(30, 322)
$cloudGroup.Size = New-Object System.Drawing.Size(655, 150)
$cloudGroup.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 9.5)

$cloudStatus = New-Object System.Windows.Forms.Label
$cloudStatus.Text = "감지: ${detectedText.replace(/`/g, '``').replace(/\$/g, '`$')}"
$cloudStatus.Location = New-Object System.Drawing.Point(16, 25)
$cloudStatus.Size = New-Object System.Drawing.Size(610, 22)

$coexist = New-Object System.Windows.Forms.RadioButton
$coexist.Text = "계속 함께 사용 (권장)"
$coexist.Checked = $true
$coexist.Location = New-Object System.Drawing.Point(18, 52)
$coexist.Size = New-Object System.Drawing.Size(260, 24)

$closeCloud = New-Object System.Windows.Forms.RadioButton
$closeCloud.Text = "현재 실행 중인 앱만 종료"
$closeCloud.Location = New-Object System.Drawing.Point(18, 80)
$closeCloud.Size = New-Object System.Drawing.Size(280, 24)
$closeCloud.Enabled = ${detectedCloudApps.length > 0 ? '$true' : '$false'}

$startupSettings = New-Object System.Windows.Forms.RadioButton
$startupSettings.Text = "설치 후 Windows 시작 앱 설정 열기"
$startupSettings.Location = New-Object System.Drawing.Point(315, 52)
$startupSettings.Size = New-Object System.Drawing.Size(310, 24)

$cloudNote = New-Object System.Windows.Forms.Label
$cloudNote.Text = "계정 연결 해제나 삭제는 온라인 전용 파일 손실 위험 때문에 자동으로 수행하지 않습니다."
$cloudNote.Location = New-Object System.Drawing.Point(18, 110)
$cloudNote.Size = New-Object System.Drawing.Size(610, 24)
$cloudNote.ForeColor = [System.Drawing.Color]::DimGray
$cloudGroup.Controls.AddRange(@($cloudStatus, $coexist, $closeCloud, $startupSettings, $cloudNote))

$advanced = New-Object System.Windows.Forms.Label
$advanced.Text = "프로그램 설치 위치: ${String(getSavedInstallDir()).replace(/`/g, '``').replace(/\$/g, '`$')}"
$advanced.Location = New-Object System.Drawing.Point(30, 488)
$advanced.Size = New-Object System.Drawing.Size(655, 24)
$advanced.ForeColor = [System.Drawing.Color]::DimGray

$install = New-Object System.Windows.Forms.Button
$install.Text = "설치"
$install.Location = New-Object System.Drawing.Point(490, 540)
$install.Size = New-Object System.Drawing.Size(95, 38)
$install.BackColor = [System.Drawing.Color]::FromArgb(26, 86, 219)
$install.ForeColor = [System.Drawing.Color]::White
$install.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$install.Add_Click({
  if ([String]::IsNullOrWhiteSpace($drivePath.Text)) {
    [System.Windows.Forms.MessageBox]::Show("NAS Drive 위치를 선택해 주세요.", "NAS Drive") | Out-Null
    return
  }
  $cloudAction = if ($closeCloud.Checked) { "close" } elseif ($startupSettings.Checked) { "startup-settings" } else { "coexist" }
  $form.Tag = [PSCustomObject]@{
    accepted = $true
    drivePath = $drivePath.Text
    installDir = ${JSON.stringify(getSavedInstallDir())}
    startWithWindows = [bool]$startup.Checked
    cloudAction = $cloudAction
  }
  $form.Close()
})

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "취소"
$cancel.Location = New-Object System.Drawing.Point(590, 540)
$cancel.Size = New-Object System.Drawing.Size(95, 38)
$cancel.Add_Click({ $form.Tag = [PSCustomObject]@{ accepted = $false }; $form.Close() })

$form.Controls.AddRange(@($header, $accountLabel, $driveLabel, $drivePath, $driveBrowse, $driveHelp, $startup, $cloudGroup, $advanced, $install, $cancel))
$form.AcceptButton = $install
$form.CancelButton = $cancel
$form.ShowDialog() | Out-Null
if ($null -eq $form.Tag) { $form.Tag = [PSCustomObject]@{ accepted = $false } }
$form.Tag | ConvertTo-Json -Compress
`;
  writePowerShellScript(SETUP_SCRIPT_FILE, script);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SETUP_SCRIPT_FILE], {
    encoding: 'utf8', windowsHide: true
  });
  try { return JSON.parse((result.stdout || '').trim()); } catch { return { accepted: false }; }
}

function showRecommendedSetupWizard({ account, defaultDrivePath, detectedCloudApps }) {
  ensureStateDir();
  const accountName = String(account.displayName || account.loginId || '개인');
  const otherCloudText = detectedCloudApps.length
    ? `${detectedCloudApps.map(item => item.displayName).join(', ')}와 함께 사용`
    : '다른 클라우드 앱과 충돌 없음';
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8

$form = New-Object System.Windows.Forms.Form
$form.Text = "NAS Drive 설치"
$form.ClientSize = New-Object System.Drawing.Size(640, 430)
$form.StartPosition = "CenterScreen"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.BackColor = [System.Drawing.Color]::White

$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(0, 0)
$header.Size = New-Object System.Drawing.Size(640, 105)
$header.BackColor = [System.Drawing.Color]::FromArgb(26, 86, 219)
$brand = New-Object System.Windows.Forms.Label
$brand.Text = "NAS DRIVE"
$brand.Location = New-Object System.Drawing.Point(28, 18)
$brand.Size = New-Object System.Drawing.Size(580, 24)
$brand.ForeColor = [System.Drawing.Color]::White
$brand.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 11)
$title = New-Object System.Windows.Forms.Label
$title.Text = "설치하면 바로 사용할 수 있습니다"
$title.Location = New-Object System.Drawing.Point(26, 48)
$title.Size = New-Object System.Drawing.Size(585, 38)
$title.ForeColor = [System.Drawing.Color]::White
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 19)
$header.Controls.AddRange(@($brand, $title))

$intro = New-Object System.Windows.Forms.Label
$intro.Text = "${accountName.replace(/`/g, '``').replace(/\$/g, '`$')} 계정에 안전한 권장 설정을 적용합니다. 나중에 트레이에서 변경할 수 있습니다."
$intro.Location = New-Object System.Drawing.Point(30, 126)
$intro.Size = New-Object System.Drawing.Size(575, 42)
$intro.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$summary = New-Object System.Windows.Forms.Label
$summary.Text = "✓ 파일 탐색기 위치    ${String(defaultDrivePath).replace(/`/g, '``').replace(/\$/g, '`$')}\r\n✓ Windows 시작 시 자동 실행\r\n✓ 파일은 온라인 전용으로 시작해 디스크 공간 절약\r\n✓ ${otherCloudText.replace(/`/g, '``').replace(/\$/g, '`$')}"
$summary.Location = New-Object System.Drawing.Point(34, 180)
$summary.Size = New-Object System.Drawing.Size(570, 112)
$summary.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$summary.ForeColor = [System.Drawing.Color]::FromArgb(45, 55, 72)

$privacy = New-Object System.Windows.Forms.Label
$privacy.Text = "바탕화면·문서·사진 폴더를 몰래 이동하지 않으며 다른 클라우드 계정도 변경하지 않습니다."
$privacy.Location = New-Object System.Drawing.Point(32, 300)
$privacy.Size = New-Object System.Drawing.Size(575, 38)
$privacy.ForeColor = [System.Drawing.Color]::DimGray

$advanced = New-Object System.Windows.Forms.Button
$advanced.Text = "설정 변경"
$advanced.Location = New-Object System.Drawing.Point(30, 365)
$advanced.Size = New-Object System.Drawing.Size(105, 38)
$advanced.Add_Click({ $form.Tag = [PSCustomObject]@{ advanced = $true }; $form.Close() })

$install = New-Object System.Windows.Forms.Button
$install.Text = "권장 설정으로 설치"
$install.Location = New-Object System.Drawing.Point(420, 365)
$install.Size = New-Object System.Drawing.Size(185, 38)
$install.BackColor = [System.Drawing.Color]::FromArgb(26, 86, 219)
$install.ForeColor = [System.Drawing.Color]::White
$install.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
$install.Add_Click({
  $form.Tag = [PSCustomObject]@{
    accepted = $true
    drivePath = ${JSON.stringify(defaultDrivePath)}
    installDir = ${JSON.stringify(getSavedInstallDir())}
    startWithWindows = $true
    cloudAction = "coexist"
  }
  $form.Close()
})

$form.Controls.AddRange(@($header, $intro, $summary, $privacy, $advanced, $install))
$form.AcceptButton = $install
$form.ShowDialog() | Out-Null
if ($null -eq $form.Tag) { $form.Tag = [PSCustomObject]@{ accepted = $false } }
$form.Tag | ConvertTo-Json -Compress
`;
  writePowerShellScript(SETUP_SCRIPT_FILE, script);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SETUP_SCRIPT_FILE], {
    encoding: 'utf8', windowsHide: true
  });
  let choice = { accepted: false };
  try { choice = JSON.parse((result.stdout || '').trim()); } catch {}
  if (choice.advanced) return showSetupWizard({ account, defaultDrivePath, detectedCloudApps });
  return choice;
}

function writeInstallProgress(percent, title, detail, state = 'working') {
  writeJson(SETUP_PROGRESS_FILE, { percent, title, detail, state, updatedAt: new Date().toISOString() });
}

function startInstallProgressWindow() {
  const progressPath = SETUP_PROGRESS_FILE.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$progressPath = '${progressPath}'
$form = New-Object System.Windows.Forms.Form
$form.Text = "NAS Drive 설치"
try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon(${JSON.stringify(process.execPath)}) } catch {}
$form.ClientSize = New-Object System.Drawing.Size(560, 255)
$form.StartPosition = "CenterScreen"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.BackColor = [System.Drawing.Color]::White
$brand = New-Object System.Windows.Forms.Label
$brand.Text = "NAS DRIVE"
$brand.Location = New-Object System.Drawing.Point(28, 22)
$brand.Size = New-Object System.Drawing.Size(500, 26)
$brand.ForeColor = [System.Drawing.Color]::FromArgb(26, 86, 219)
$brand.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 11)
$title = New-Object System.Windows.Forms.Label
$title.Text = "설치를 준비하는 중입니다"
$title.Location = New-Object System.Drawing.Point(28, 60)
$title.Size = New-Object System.Drawing.Size(500, 32)
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 15)
$detail = New-Object System.Windows.Forms.Label
$detail.Text = "잠시만 기다려 주세요."
$detail.Location = New-Object System.Drawing.Point(30, 98)
$detail.Size = New-Object System.Drawing.Size(495, 38)
$detail.ForeColor = [System.Drawing.Color]::DimGray
$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(30, 148)
$bar.Size = New-Object System.Drawing.Size(495, 18)
$bar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
$close = New-Object System.Windows.Forms.Button
$close.Text = "완료"
$close.Location = New-Object System.Drawing.Point(430, 190)
$close.Size = New-Object System.Drawing.Size(95, 34)
$close.Enabled = $false
$close.Add_Click({ $form.Close() })
$form.Controls.AddRange(@($brand, $title, $detail, $bar, $close))
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 250
$timer.Add_Tick({
  try {
    if (Test-Path $progressPath) {
      $status = Get-Content $progressPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $bar.Value = [Math]::Max(0, [Math]::Min(100, [int]$status.percent))
      $title.Text = [string]$status.title
      $detail.Text = [string]$status.detail
      if ($status.state -eq "done" -or $status.state -eq "error") {
        $close.Enabled = $true
        if ($status.state -eq "error") { $brand.ForeColor = [System.Drawing.Color]::FromArgb(190, 35, 45) }
      }
    }
  } catch {}
})
$timer.Start()
$form.ShowDialog() | Out-Null
$timer.Stop()
`;
  writePowerShellScript(SETUP_PROGRESS_SCRIPT_FILE, script);
  spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', SETUP_PROGRESS_SCRIPT_FILE], {
    detached: true, windowsHide: true, stdio: 'ignore'
  }).unref();
}

function applyCloudAppChoice(choice, detectedCloudApps) {
  if (choice === 'close') {
    for (const app of detectedCloudApps) {
      spawnSync('taskkill.exe', ['/IM', `${app.processName}.exe`], { windowsHide: true, stdio: 'ignore' });
    }
  }
  if (choice === 'startup-settings') {
    spawn('explorer.exe', ['ms-settings:startupapps'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  }
}

function showInstalledDashboard(config) {
  const profiles = getProfiles(config);
  const roots = profiles.flatMap(profile => getRoots(profile).map(root => ({ profile, root })));
  const firstRoot = roots[0]?.root?.localPath || '';
  const accountText = profiles.map(profile => profile.displayName || profile.loginId || '개인').join(', ') || '연결 대기 중';
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.Text = "NAS Drive"
try { $form.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon(${JSON.stringify(INSTALLED_EXE)}) } catch {}
$form.ClientSize = New-Object System.Drawing.Size(540, 340)
$form.StartPosition = "CenterScreen"
$form.MaximizeBox = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
$form.BackColor = [System.Drawing.Color]::White
$brand = New-Object System.Windows.Forms.Label
$brand.Text = "NAS DRIVE"
$brand.Location = New-Object System.Drawing.Point(28, 24)
$brand.Size = New-Object System.Drawing.Size(480, 26)
$brand.ForeColor = [System.Drawing.Color]::FromArgb(26, 86, 219)
$brand.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 11)
$title = New-Object System.Windows.Forms.Label
$title.Text = "정상 실행 중"
$title.Location = New-Object System.Drawing.Point(28, 62)
$title.Size = New-Object System.Drawing.Size(480, 34)
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 18)
$account = New-Object System.Windows.Forms.Label
$account.Text = "연결 계정: ${accountText.replace(/`/g, '``').replace(/\$/g, '`$')}"
$account.Location = New-Object System.Drawing.Point(30, 108)
$account.Size = New-Object System.Drawing.Size(475, 28)
$account.ForeColor = [System.Drawing.Color]::DimGray
$open = New-Object System.Windows.Forms.Button
$open.Text = "NAS Drive 열기"
$open.Location = New-Object System.Drawing.Point(30, 184)
$open.Size = New-Object System.Drawing.Size(145, 38)
$open.Enabled = ${firstRoot ? '$true' : '$false'}
$open.Add_Click({ if (${JSON.stringify(firstRoot)}) { Start-Process explorer.exe -ArgumentList ${JSON.stringify(firstRoot)} } })
$web = New-Object System.Windows.Forms.Button
$web.Text = "NAS 웹 열기"
$web.Location = New-Object System.Drawing.Point(185, 184)
$web.Size = New-Object System.Drawing.Size(130, 38)
$web.Add_Click({ Start-Process 'nas-sync://open-web' })
$logout = New-Object System.Windows.Forms.Button
$logout.Text = "로그아웃"
$logout.Location = New-Object System.Drawing.Point(325, 184)
$logout.Size = New-Object System.Drawing.Size(90, 38)
$logout.ForeColor = [System.Drawing.Color]::FromArgb(190, 35, 45)
$logout.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show("이 PC의 NAS Drive 연결을 해제할까요? 로컬 파일은 삭제하지 않습니다.", "NAS Drive 로그아웃", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
  if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { $form.Tag = "logout"; $form.Close() }
})
$close = New-Object System.Windows.Forms.Button
$close.Text = "닫기"
$close.Location = New-Object System.Drawing.Point(425, 184)
$close.Size = New-Object System.Drawing.Size(80, 38)
$close.Add_Click({ $form.Close() })
$note = New-Object System.Windows.Forms.Label
$note.Text = "Windows를 다시 시작해도 자동 연결됩니다. 로그아웃해도 이 PC의 로컬 파일은 지우지 않습니다."
$note.Location = New-Object System.Drawing.Point(30, 242)
$note.Size = New-Object System.Drawing.Size(475, 54)
$note.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.AddRange(@($brand, $title, $account, $open, $web, $logout, $close, $note))
$form.ShowDialog() | Out-Null
if ($form.Tag) { Write-Output ([string]$form.Tag) }
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8', windowsHide: true
  });
  return String(result.stdout || '').trim();
}

function selectInstallDir() {
  const currentDir = getSavedInstallDir();
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.Application]::EnableVisualStyles()',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = "Choose where to install NAS Sync Agent."',
    `$d.SelectedPath = ${JSON.stringify(currentDir)}`,
    '$d.ShowNewFolderButton = $true',
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; Write-Output $d.SelectedPath }'
  ].join('; ');
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: true });
  const selected = (ps.stdout || '').trim();
  return selected || currentDir;
}

function createDesktopShortcut(exePath) {
  const safeExe = path.resolve(exePath || INSTALLED_EXE);
  const psScript = `
$exe = ${JSON.stringify(safeExe)}
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "NAS Drive.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$launcher = Join-Path (Split-Path $exe) "NAS-Drive.exe"
$target = $(if (Test-Path $launcher) { $launcher } else { $exe })
$shortcut.TargetPath = $target
$shortcut.Arguments = $(if ($target -eq $launcher) { "--open" } else { "--hidden-bootstrap" })
$shortcut.WorkingDirectory = Split-Path $exe
$icon = ${JSON.stringify(INSTALLED_ICON)}
$shortcut.IconLocation = $(if (Test-Path $icon) { $icon } else { $exe })
$shortcut.Description = "NAS Drive for Windows"
$shortcut.Save()
`;
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
    windowsHide: true,
    stdio: 'ignore'
  });
}

function removeDesktopShortcut() {
  const psScript = `
$desktop = [Environment]::GetFolderPath("Desktop")
foreach ($name in @("NAS Drive.lnk", "NAS Sync Agent.lnk")) {
  $shortcutPath = Join-Path $desktop $name
  try { if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force } } catch {}
}
`;
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
    windowsHide: true,
    stdio: 'ignore'
  });
}

function promptInstalledAction() {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "NAS Sync Agent"
$form.Size = New-Object System.Drawing.Size(430, 210)
$form.StartPosition = "CenterScreen"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog

$label = New-Object System.Windows.Forms.Label
$label.Text = "NAS Sync Agent is already installed. What would you like to do?"
$label.AutoSize = $false
$label.Location = New-Object System.Drawing.Point(18, 18)
$label.Size = New-Object System.Drawing.Size(380, 54)
$label.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$open = New-Object System.Windows.Forms.Button
$open.Text = "Run"
$open.Location = New-Object System.Drawing.Point(18, 95)
$open.Size = New-Object System.Drawing.Size(86, 34)
$open.Add_Click({ $form.Tag = "open"; $form.Close() })

$repair = New-Object System.Windows.Forms.Button
$repair.Text = "Repair"
$repair.Location = New-Object System.Drawing.Point(114, 95)
$repair.Size = New-Object System.Drawing.Size(86, 34)
$repair.Add_Click({ $form.Tag = "repair"; $form.Close() })

$uninstall = New-Object System.Windows.Forms.Button
$uninstall.Text = "Uninstall"
$uninstall.Location = New-Object System.Drawing.Point(210, 95)
$uninstall.Size = New-Object System.Drawing.Size(86, 34)
$uninstall.Add_Click({ $form.Tag = "uninstall"; $form.Close() })

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancel"
$cancel.Location = New-Object System.Drawing.Point(306, 95)
$cancel.Size = New-Object System.Drawing.Size(86, 34)
$cancel.Add_Click({ $form.Tag = "cancel"; $form.Close() })

$form.Controls.Add($label)
$form.Controls.Add($open)
$form.Controls.Add($repair)
$form.Controls.Add($uninstall)
$form.Controls.Add($cancel)
$form.ShowDialog() | Out-Null
if ($form.Tag) { Write-Output $form.Tag } else { Write-Output "cancel" }
`;
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return (ps.stdout || '').trim() || 'cancel';
}

function signalExitAndWait() {
  requestInstalledAgentStop({ force: true });
  for (let i = 0; i < 6; i += 1) sleepMs(500);
}

function unregisterProtocol() {
  spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Classes\\nas-sync', '/f'], { windowsHide: true });
}

function unregisterStartup() {
  for (const name of ['NAS Drive', 'NAS Sync Agent']) {
    spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', name, '/f'], { windowsHide: true });
  }
}

function uninstallAgent() {
  signalExitAndWait();
  const state = loadConfig();
  for (const profile of getProfiles(state)) {
    const root = getRoots(profile).find(item => item.kind === 'personal-drive');
    if (root?.localPath && fs.existsSync(INSTALLED_PROVIDER_EXE)) {
      stopPersonalDriveProvider(profile, root);
      sleepMs(250);
      spawnSync(INSTALLED_PROVIDER_EXE, ['unregister', '--root', root.localPath, '--account', profile.accountKey], { windowsHide: true, stdio: 'ignore' });
      setPersonalDriveFolderIcon(root.localPath, false);
      setPersonalDriveWebShortcut(root.localPath, profile, false);
    }
  }
  unregisterStartup();
  unregisterProtocol();
  removeDesktopShortcut();
  for (const file of [PID_FILE, FOREGROUND_LOCK_FILE, EXIT_FILE, TRAY_SCRIPT_FILE, TRAY_PID_FILE, SETUP_SCRIPT_FILE, SETUP_PROGRESS_SCRIPT_FILE, SETUP_PROGRESS_FILE, UPDATE_CHECK_FILE, UPDATE_SCRIPT_FILE, LOG_FILE, HEALTH_FILE, CONFIG_FILE, LEGACY_TOKEN_FILE, INSTALLED_PROVIDER_VERSION, INSTALLED_PROVIDER_EXE, INSTALLED_ICON, INSTALLED_EXE, `${INSTALLED_EXE}.update`]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
  try {
    for (const name of fs.readdirSync(STATE_DIR)) {
      if (/^agent-token-.+\.dpapi$/i.test(name)) fs.unlinkSync(path.join(STATE_DIR, name));
    }
  } catch {}
}

function waitIfConsole() {
  if (process.argv.includes('--no-pause') || process.argv.includes('--background') || process.argv.includes('--hidden-bootstrap')) return;
  try {
    fs.writeSync(1, '\nPress Enter to close.\n');
    fs.readSync(0, Buffer.alloc(1), 0, 1);
  } catch {}
}

function request(method, urlPath, { headers = {}, body = null, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, SERVER_BASE);
    const req = https.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const text = raw.toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode}: ${text}`);
          err.statusCode = res.statusCode;
          err.body = text;
          reject(err);
          return;
        }
        try {
          resolve(text ? JSON.parse(text) : {});
        } catch {
          resolve(text);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('NAS 연결 시간이 초과되었습니다.')));
    if (body) req.write(body);
    req.end();
  });
}

function requestJson(method, urlPath, payload, agentToken, timeoutMs = REQUEST_TIMEOUT_MS) {
  const body = JSON.stringify(payload || {});
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  };
  if (agentToken) headers['x-agent-token'] = agentToken;
  return request(method, urlPath, { headers, body, timeoutMs });
}

function sendHeartbeat(profile, syncState = 'idle', lastError = '') {
  return requestJson('POST', '/api/devices/agent/heartbeat', {
    deviceId: profile.deviceId,
    syncState,
    lastError,
    clientStateRevision: Number(profile._serverStateRevision || 0)
  }, profile.agentToken).then((result) => {
    const revision = Number(result?.device?.stateRevision || 0);
    if (Number.isFinite(revision) && revision > 0) profile._serverStateRevision = revision;
    return result;
  });
}

function downloadFile(urlPath, outPath, agentToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, SERVER_BASE);
    const req = https.request(url, { headers: { 'x-agent-token': agentToken } }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString('utf8')}`)));
        return;
      }
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      const file = fs.createWriteStream(outPath);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

async function checkForAgentUpdate(profile, { force = false } = {}) {
  if (!process.pkg || !profile?.deviceId || !profile?.agentToken) return false;
  const previous = readJson(UPDATE_CHECK_FILE, {});
  const lastCheckedAt = Date.parse(previous.checkedAt || 0) || 0;
  if (!force && Date.now() - lastCheckedAt < 6 * 60 * 60 * 1000) return false;

  const metadata = await request('GET', `/api/devices/agent/update/windows?deviceId=${encodeURIComponent(profile.deviceId)}`, {
    headers: { 'x-agent-token': profile.agentToken }
  });
  writeJson(UPDATE_CHECK_FILE, { checkedAt: new Date().toISOString(), currentVersion: AGENT_VERSION, latestVersion: metadata.version || '' });
  if (!metadata?.version || !isNewerVersion(metadata.version, AGENT_VERSION) || !metadata.downloadUrl || !metadata.sha256) return false;

  const tempExe = `${INSTALLED_EXE}.update`;
  await downloadFile(metadata.downloadUrl, tempExe, profile.agentToken);
  const actualHash = crypto.createHash('sha256').update(fs.readFileSync(tempExe)).digest('hex');
  const expectedHash = String(metadata.sha256 || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || !crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'))) {
    try { fs.unlinkSync(tempExe); } catch {}
    throw new Error('자동 업데이트 파일 무결성 검증에 실패했습니다.');
  }

  const updateScript = `
$processId = ${process.pid}
$source = ${JSON.stringify(tempExe)}
$target = ${JSON.stringify(INSTALLED_EXE)}
$versionFile = Join-Path (Split-Path -Parent $target) 'agent-version.txt'
$nextVersion = ${JSON.stringify(String(metadata.version || ''))}
$launcher = Join-Path (Split-Path -Parent $target) 'NAS-Drive.exe'
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Process -Id $processId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 300 }
if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
Copy-Item -LiteralPath $source -Destination $target -Force
[System.IO.File]::WriteAllText($versionFile, $nextVersion, [System.Text.UTF8Encoding]::new($false))
Remove-Item -LiteralPath $source -Force -ErrorAction SilentlyContinue
if (Test-Path -LiteralPath $launcher) { Start-Process -FilePath $launcher -ArgumentList @('--background') -WindowStyle Hidden }
else { Start-Process -FilePath $target -ArgumentList @('--background') -WindowStyle Hidden }
Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
`;
  writePowerShellScript(UPDATE_SCRIPT_FILE, updateScript);
  const launcher = `
$scriptPath = ${JSON.stringify(UPDATE_SCRIPT_FILE)}
$quotedPath = '"' + $scriptPath + '"'
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $quotedPath) -WindowStyle Hidden
`;
  spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', launcher], { windowsHide: true, stdio: 'ignore' });
  await sendHeartbeat(profile, 'updating').catch(error => log('[pre-update heartbeat deferred]', error.message));
  setAgentHealth('updating', `${AGENT_VERSION} → ${metadata.version}`);
  return true;
}

function multipartUpload(urlPath, fields, filePath, agentToken) {
  return new Promise((resolve, reject) => {
    const boundary = '----NasSyncAgent' + crypto.randomBytes(12).toString('hex');
    const chunks = [];
    for (const [key, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    }
    const filename = path.basename(filePath).replace(/"/g, '');
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const stat = fs.statSync(filePath);
    const contentLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0) + stat.size + footer.length;
    const url = new URL(urlPath, SERVER_BASE);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': contentLength,
        'x-agent-token': agentToken
      }
    }, (res) => {
      const resp = [];
      res.on('data', chunk => resp.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(resp).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) reject(new Error(`HTTP ${res.statusCode}: ${text}`));
        else {
          try { resolve(JSON.parse(text)); } catch { resolve({ success: true, raw: text }); }
        }
      });
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('end', () => {
        req.write(footer);
        req.end();
      })
      .pipe(req, { end: false });
  });
}

function hashFileSlice(filePath, start, length) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { start, end: start + length - 1 });
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function multipartUploadSlice(urlPath, fields, filePath, start, length, agentToken) {
  return new Promise((resolve, reject) => {
    const boundary = '----NasSyncAgentChunk' + crypto.randomBytes(12).toString('hex');
    const headers = [];
    for (const [key, value] of Object.entries(fields)) {
      headers.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    }
    const filename = `${path.basename(filePath).replace(/"/g, '')}.part`;
    headers.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const contentLength = headers.reduce((sum, chunk) => sum + chunk.length, 0) + length + footer.length;
    const url = new URL(urlPath, SERVER_BASE);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': contentLength,
        'x-agent-token': agentToken
      }
    }, (res) => {
      const response = [];
      res.on('data', chunk => response.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(response).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const err = new Error(`HTTP ${res.statusCode}: ${text}`);
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }
        try { resolve(JSON.parse(text)); } catch { resolve({ success: true, raw: text }); }
      });
    });
    req.setTimeout(120_000, () => req.destroy(new Error('파일 조각 업로드 시간이 초과되었습니다.')));
    req.on('error', reject);
    for (const header of headers) req.write(header);
    fs.createReadStream(filePath, { start, end: start + length - 1 })
      .on('error', reject)
      .on('end', () => {
        req.write(footer);
        req.end();
      })
      .pipe(req, { end: false });
  });
}

async function resumableAgentUpload(root, file, config, stat, relativePath, knownRemote) {
  const common = {
    deviceId: config.deviceId,
    syncRootId: root.syncRootId,
    relPath: relativePath,
    fileSize: stat.size,
    chunkSize: AGENT_CHUNK_SIZE,
    baseMtimeMs: Number(knownRemote?.mtimeMs || 0),
    clientMtimeMs: Math.round(stat.mtimeMs),
    deviceName: config.deviceName || os.hostname() || 'Windows-PC'
  };
  const initialized = await requestJson('POST', '/api/devices/agent/chunk/init', common, config.agentToken, 30_000);
  const uploadId = initialized.uploadId;
  const totalChunks = Number(initialized.totalChunks || Math.ceil(stat.size / AGENT_CHUNK_SIZE));
  const received = new Set((initialized.receivedChunks || []).map(Number));
  for (let index = 0; index < totalChunks; index += 1) {
    if (received.has(index)) continue;
    const start = index * AGENT_CHUNK_SIZE;
    const length = Math.min(AGENT_CHUNK_SIZE, stat.size - start);
    const chunkSha256 = await hashFileSlice(file, start, length);
    setProfileHealth(config, 'syncing', `${path.basename(file)} 업로드 ${Math.floor((index * 100) / totalChunks)}%`);
    await multipartUploadSlice('/api/devices/agent/chunk', {
      deviceId: config.deviceId,
      uploadId,
      chunkIndex: index,
      chunkSha256
    }, file, start, length, config.agentToken);
  }
  return requestJson('POST', '/api/devices/agent/chunk/complete', {
    deviceId: config.deviceId,
    uploadId
  }, config.agentToken, 120_000);
}

function getPairingToken() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--pairing-token' && args[i + 1]) return args[i + 1];
    if (arg === '--pairing-url' && args[i + 1]) return tokenFromUrl(args[i + 1]);
    if (arg.startsWith('nas-sync://')) return tokenFromUrl(arg);
  }
  const exeName = path.basename(process.execPath);
  const match = exeName.match(/pair_[a-zA-Z0-9_-]+/);
  return match ? match[0] : '';
}

function getCommandArgument(name) {
  const args = process.argv.slice(2);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? String(args[index + 1]) : '';
}

function parseVersionParts(value) {
  const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
  return match ? match.slice(1).map(part => Number(part || 0)) : null;
}

function isNewerVersion(candidate, current) {
  const next = parseVersionParts(candidate);
  const installed = parseVersionParts(current);
  if (!next || !installed) return false;
  const length = Math.max(next.length, installed.length);
  for (let index = 0; index < length; index += 1) {
    const difference = Number(next[index] || 0) - Number(installed[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function tokenFromUrl(urlText) {
  try {
    const url = new URL(urlText);
    return url.searchParams.get('token') || '';
  } catch {
    const match = String(urlText).match(/[?&]token=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
}

function getProtocolAction() {
  const protocolArg = process.argv.slice(2).find(arg => String(arg || '').startsWith('nas-sync://'));
  if (!protocolArg) return '';
  try {
    const url = new URL(protocolArg);
    return String(url.hostname || '').toLowerCase();
  } catch {
    const match = String(protocolArg).match(/^nas-sync:\/\/([^?]+)/i);
    return match ? match[1].toLowerCase() : '';
  }
}

function getProtocolParam(name) {
  const protocolArg = process.argv.slice(2).find(arg => String(arg || '').startsWith('nas-sync://'));
  if (!protocolArg) return '';
  try {
    return new URL(protocolArg).searchParams.get(name) || '';
  } catch {
    const match = String(protocolArg).match(new RegExp(`[?&]${name}=([^&]+)`, 'i'));
    return match ? decodeURIComponent(match[1]) : '';
  }
}

function getDeviceKey() {
  ensureStateDir();
  const reg = spawnSync('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
  const match = `${reg.stdout || ''}\n${reg.stderr || ''}`.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
  if (match) return `win-machine-${match[1].trim()}`;
  if (fs.existsSync(DEVICE_KEY_FILE)) return fs.readFileSync(DEVICE_KEY_FILE, 'utf8').trim();
  const next = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(DEVICE_KEY_FILE, next, 'utf8');
  return next;
}

async function runLoginFromStdin() {
  ensureStateDir();
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    throw new Error('로그인 요청 형식이 올바르지 않습니다.');
  }
  const id = String(payload?.id || '').trim();
  const password = String(payload?.password || '');
  if (!id || !password) throw new Error('아이디와 비밀번호를 입력해 주세요.');
  const result = await requestJson('POST', '/api/devices/agent/login-register', {
    id,
    password,
    clientDeviceKey: getDeviceKey(),
    deviceName: os.hostname() || 'Windows-PC'
  }, '', 15_000);
  if (!result?.pairingToken) throw new Error('계정 연결 응답을 확인할 수 없습니다.');
  process.stdout.write(String(result.pairingToken));
}

function selectFolder() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = "Select a folder to sync with NAS."',
    '$d.ShowNewFolderButton = $false',
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; Write-Output $d.SelectedPath }'
  ].join('; ');
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return (ps.stdout || '').trim();
}

function promptText(title, message, defaultValue) {
  const script = [
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8',
    `$value = [Microsoft.VisualBasic.Interaction]::InputBox(${JSON.stringify(message)}, ${JSON.stringify(title)}, ${JSON.stringify(defaultValue || '')})`,
    'Write-Output $value'
  ].join('; ');
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return (ps.stdout || '').trim();
}

function promptPassword(title, message) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = ${JSON.stringify(title)}
$form.Size = New-Object System.Drawing.Size(420, 170)
$form.StartPosition = "CenterScreen"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog

$label = New-Object System.Windows.Forms.Label
$label.Text = ${JSON.stringify(message)}
$label.Location = New-Object System.Drawing.Point(16, 18)
$label.Size = New-Object System.Drawing.Size(370, 24)

$textBox = New-Object System.Windows.Forms.TextBox
$textBox.Location = New-Object System.Drawing.Point(18, 50)
$textBox.Size = New-Object System.Drawing.Size(365, 24)
$textBox.UseSystemPasswordChar = $true

$ok = New-Object System.Windows.Forms.Button
$ok.Text = "OK"
$ok.Location = New-Object System.Drawing.Point(216, 92)
$ok.Size = New-Object System.Drawing.Size(80, 30)
$ok.Add_Click({ $form.Tag = $textBox.Text; $form.Close() })

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancel"
$cancel.Location = New-Object System.Drawing.Point(304, 92)
$cancel.Size = New-Object System.Drawing.Size(80, 30)
$cancel.Add_Click({ $form.Tag = ""; $form.Close() })

$form.Controls.Add($label)
$form.Controls.Add($textBox)
$form.Controls.Add($ok)
$form.Controls.Add($cancel)
$form.AcceptButton = $ok
$form.CancelButton = $cancel
$form.ShowDialog() | Out-Null
[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8
Write-Output $form.Tag
`;
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: true });
  return (ps.stdout || '').trim();
}

function getFolderSummary(root) {
  let totalBytes = 0;
  let fileCount = 0;
  let folderCount = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          folderCount += 1;
          walk(full);
        } else if (entry.isFile()) {
          const stat = fs.statSync(full);
          totalBytes += stat.size;
          fileCount += 1;
        }
      } catch {}
    }
  };
  walk(root);
  return { totalBytes, fileCount, folderCount };
}

function relPath(root, fullPath) {
  return path.relative(root, fullPath).replace(/\\/g, '/');
}

function loadConfig() {
  const raw = readJson(CONFIG_FILE, null);
  if (!raw) return null;
  if (Array.isArray(raw.profiles)) {
    return {
      ...raw,
      schemaVersion: 2,
      profiles: raw.profiles.map(profile => ({
        ...profile,
        agentToken: unprotectAgentToken(profile.accountKey)
      }))
    };
  }
  const legacyKey = safeAccountKey(raw.accountKey || raw.loginId || raw.deviceId || 'legacy');
  const legacyToken = raw.agentToken || unprotectAgentToken(legacyKey, true);
  const migrated = {
    schemaVersion: 2,
    profiles: [{ ...raw, accountKey: legacyKey, agentToken: legacyToken }],
    activeAccountKey: legacyKey,
    savedAt: new Date().toISOString()
  };
  saveConfig(migrated);
  return migrated;
}

function saveConfig(config) {
  const next = { ...(config || {}), schemaVersion: 2 };
  next.profiles = getProfiles(next).map(profile => {
    const saved = { ...profile, accountKey: safeAccountKey(profile.accountKey) };
    if (saved.agentToken) protectAgentToken(saved.agentToken, saved.accountKey);
    delete saved.agentToken;
    return saved;
  });
  writeJson(CONFIG_FILE, next);
  for (const profile of getProfiles(config).filter(item => item?.agentToken)) {
    if (unprotectAgentToken(profile.accountKey) !== profile.agentToken) {
      throw new Error('저장한 장치 인증 정보를 다시 확인하지 못했습니다. 로컬 연결을 만들지 않았습니다.');
    }
  }
  try { if (fs.existsSync(LEGACY_TOKEN_FILE)) fs.unlinkSync(LEGACY_TOKEN_FILE); } catch {}
}

function tokenFileFor(accountKey) {
  return path.join(STATE_DIR, `agent-token-${safeAccountKey(accountKey)}.dpapi`);
}

function protectAgentToken(token, accountKey) {
  ensureStateDir();
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$plain = [Console]::In.ReadToEnd()',
    '$bytes = [Text.Encoding]::UTF8.GetBytes($plain)',
    '$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Convert]::ToBase64String($protected))'
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: String(token || ''),
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0 || !(result.stdout || '').trim()) {
    throw new Error('Windows DPAPI로 장치 토큰을 보호하지 못했습니다.');
  }
  const tokenFile = tokenFileFor(accountKey);
  const tempFile = `${tokenFile}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, result.stdout.trim(), { encoding: 'utf8', mode: 0o600 });
  try {
    fs.renameSync(tempFile, tokenFile);
  } catch (error) {
    try { fs.unlinkSync(tokenFile); } catch {}
    fs.renameSync(tempFile, tokenFile);
  }
}

function unprotectAgentToken(accountKey, allowLegacy = false) {
  const tokenFile = fs.existsSync(tokenFileFor(accountKey))
    ? tokenFileFor(accountKey)
    : (allowLegacy && fs.existsSync(LEGACY_TOKEN_FILE) ? LEGACY_TOKEN_FILE : '');
  if (!tokenFile) return '';
  const script = [
    'Add-Type -AssemblyName System.Security',
    '$encoded = [Console]::In.ReadToEnd().Trim()',
    '$protected = [Convert]::FromBase64String($encoded)',
    '$bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
    '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))'
  ].join('; ');
  const encoded = fs.readFileSync(tokenFile, 'utf8');
  const retryDelays = [0, 150, 450, 900];
  let lastStatus = null;
  let lastErrorCode = '';
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt]) sleepMs(retryDelays[attempt]);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: encoded,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 8_000
    });
    const token = result.status === 0 ? (result.stdout || '').trim() : '';
    if (token) {
      if (attempt > 0) log('[dpapi token recovered]', safeAccountKey(accountKey), `attempt=${attempt + 1}`);
      return token;
    }
    lastStatus = result.status;
    lastErrorCode = String(result.error?.code || '').replace(/[^A-Z0-9_-]/gi, '').slice(0, 48);
  }
  log('[dpapi token unavailable]', safeAccountKey(accountKey), `attempts=${retryDelays.length}`, `status=${lastStatus}`, `code=${lastErrorCode || 'NONE'}`);
  return '';
}

function getProfiles(config) {
  if (!config) return [];
  if (Array.isArray(config.profiles)) return config.profiles.filter(Boolean);
  return config.deviceId ? [config] : [];
}

function upsertProfile(config, profile) {
  const accountKey = safeAccountKey(profile.accountKey);
  const profiles = getProfiles(config).filter(item => safeAccountKey(item.accountKey) !== accountKey);
  profiles.push({ ...profile, accountKey });
  return {
    schemaVersion: 2,
    profiles,
    activeAccountKey: accountKey,
    settings: config?.settings || {},
    savedAt: new Date().toISOString()
  };
}

function getActiveProfile(config) {
  const profiles = getProfiles(config);
  return profiles.find(profile => safeAccountKey(profile.accountKey) === safeAccountKey(config?.activeAccountKey)) || profiles[0] || null;
}

function confirmProfileLogout(profile) {
  const accountName = String(profile?.displayName || profile?.loginId || '현재 계정');
  const confirmationText = `${accountName} 계정에서 로그아웃할까요? 로컬 파일은 삭제하지 않습니다.`.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$answer = [System.Windows.Forms.MessageBox]::Show('${confirmationText}', "NAS Drive 로그아웃", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) { Write-Output "yes" }
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8', windowsHide: true
  });
  return String(result.stdout || '').trim() === 'yes';
}

function clearLocalProfileResources(profile) {
  if (!profile) return;
  for (const root of getRoots(profile).filter(item => item.kind === 'personal-drive')) {
    try { stopPersonalDriveProvider(profile, root); } catch (error) { log('[logout provider stop deferred]', error.message); }
    try { setPersonalDriveHomePin(root.localPath, false); } catch (error) { log('[logout home unpin deferred]', error.message); }
    try {
      if (root.localPath && fs.existsSync(INSTALLED_PROVIDER_EXE)) {
        spawnSync(INSTALLED_PROVIDER_EXE, ['unregister', '--root', root.localPath, '--account', profile.accountKey], {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 5_000
        });
      }
    } catch (error) { log('[logout provider unregister deferred]', error.message); }
    try { setPersonalDriveFolderIcon(root.localPath, false); } catch (error) { log('[logout icon cleanup deferred]', error.message); }
    try { setPersonalDriveWebShortcut(root.localPath, profile, false); } catch (error) { log('[logout shortcut cleanup deferred]', error.message); }
  }
  try { fs.unlinkSync(tokenFileFor(profile.accountKey)); } catch {}
}

async function logoutActiveProfile(config, { confirmed = false, reopenLogin = true } = {}) {
  const profile = getActiveProfile(config);
  if (!profile?.deviceId) {
    // Logout is intentionally idempotent. It is also the recovery command for
    // a connection attempt that failed before a complete profile was saved.
    const incompleteProfiles = getProfiles(config);
    for (const item of incompleteProfiles) clearLocalProfileResources(item);
    if (incompleteProfiles.length === 0) {
      try {
        for (const file of fs.readdirSync(STATE_DIR)) {
          if (/^agent-token-[a-zA-Z0-9_.-]+\.dpapi$/.test(file)) fs.unlinkSync(path.join(STATE_DIR, file));
        }
      } catch {}
    }
    saveConfig({ ...(config || {}), schemaVersion: 2, profiles: [], activeAccountKey: '', savedAt: new Date().toISOString() });
    setAgentHealth('needs-relink', '이 PC의 NAS Drive 연결을 해제했습니다. 언제든 다시 로그인할 수 있습니다.');
    restartBackground();
    if (reopenLogin) {
      const launcher = path.join(path.dirname(INSTALLED_EXE), 'NAS-Drive.exe');
      const target = fs.existsSync(launcher) ? launcher : INSTALLED_EXE;
      const args = fs.existsSync(launcher) ? ['--login'] : ['--login-after-delay', '--hidden-bootstrap'];
      spawn(target, args, { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    }
    return true;
  }
  if (!confirmed && !confirmProfileLogout(profile)) return false;

  const remainingProfiles = getProfiles(config).filter(item => safeAccountKey(item.accountKey) !== safeAccountKey(profile.accountKey));
  const nextConfig = {
    ...(config || {}),
    schemaVersion: 2,
    profiles: remainingProfiles,
    activeAccountKey: remainingProfiles[0]?.accountKey || '',
    savedAt: new Date().toISOString()
  };
  // The newest explicit logout request wins immediately. Persist the local
  // disconnect before any network call or provider cleanup that can time out.
  saveConfig(nextConfig);
  try { fs.unlinkSync(tokenFileFor(profile.accountKey)); } catch {}
  setAgentHealth('needs-relink', '이 PC의 NAS Drive 연결을 해제했습니다. 언제든 다시 로그인할 수 있습니다.');

  if (profile.agentToken) {
    try {
      await requestJson('POST', '/api/devices/agent/logout', {
        deviceId: profile.deviceId
      }, profile.agentToken, 15_000);
    } catch (error) {
      // Local sign-out must never be held hostage by a revoked token, an
      // unreachable server, or a connection that is still being established.
      // The web device manager can remove an offline server record later.
      log(isLogoutAlreadyRevokedError(error) ? '[logout already revoked]' : '[logout remote revoke deferred]', profile.deviceId, error.message);
    }
  } else {
    log('[logout local only: token unavailable]', profile.deviceId);
  }

  clearLocalProfileResources(profile);
  restartBackground();
  if (reopenLogin) {
    const launcher = path.join(path.dirname(INSTALLED_EXE), 'NAS-Drive.exe');
    const target = fs.existsSync(launcher) ? launcher : INSTALLED_EXE;
    const args = fs.existsSync(launcher) ? ['--login'] : ['--login-after-delay', '--hidden-bootstrap'];
    spawn(target, args, { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  }
  return true;
}

function getRoots(config) {
  if (!config) return [];
  if (Array.isArray(config.syncRoots)) return config.syncRoots;
  if (config.syncFolder) {
    return [{
      syncRootId: config.syncRootId || 'root_default',
      name: config.syncRootName || config.deviceName || 'Synced Folder',
      localPath: config.syncFolder,
      linkedNasPath: config.linkedNasPath || ''
    }];
  }
  return [];
}

function registerProtocol() {
  const exe = installSelf();
  const launcher = path.join(path.dirname(exe), 'NAS-Drive.exe');
  const handler = isNativeLauncherAvailable(exe) ? launcher : exe;
  const command = `"${handler}" "%1"`;
  spawnSync('reg.exe', ['add', 'HKCU\\Software\\Classes\\nas-sync', '/ve', '/d', 'URL:NAS Drive', '/f'], { windowsHide: true });
  spawnSync('reg.exe', ['add', 'HKCU\\Software\\Classes\\nas-sync', '/v', 'URL Protocol', '/d', '', '/f'], { windowsHide: true });
  spawnSync('reg.exe', ['add', 'HKCU\\Software\\Classes\\nas-sync\\shell\\open\\command', '/ve', '/d', command, '/f'], { windowsHide: true });
}

function registerStartup() {
  const exe = installSelf();
  const launcher = path.join(path.dirname(exe), 'NAS-Drive.exe');
  const handler = isNativeLauncherAvailable(exe) ? launcher : exe;
  const command = `"${handler}" --background`;
  spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'NAS Sync Agent', '/f'], { windowsHide: true });
  spawnSync('reg.exe', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'NAS Drive', '/d', command, '/f'], { windowsHide: true });
}

function applyStartupPreference(enabled) {
  if (enabled !== false) registerStartup();
  else unregisterStartup();
}

function startBackground() {
  const exe = installSelf();
  const previousPid = Number(fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf8') : 0);
  if (isExpectedProcessAlive(previousPid, exe)) return;
  const launcher = path.join(path.dirname(exe), 'NAS-Drive.exe');
  if (isNativeLauncherAvailable(exe)) {
    // Keep the native tray alive, but do not rely on an already-running tray
    // instance to notice that the first account was just connected.
    spawn(launcher, ['--background'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
  }
  spawn(exe, ['--background'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
}

function restartBackground() {
  requestInstalledAgentStop({ force: true });
  try { fs.unlinkSync(PID_FILE); } catch {}
  try { fs.unlinkSync(EXIT_FILE); } catch {}
  startBackground();
}

function writeTrayScript(config) {
  const configPath = CONFIG_FILE.replace(/'/g, "''");
  const healthPath = HEALTH_FILE.replace(/'/g, "''");
  const exitPath = EXIT_FILE.replace(/'/g, "''");
  const trayPidPath = TRAY_PID_FILE.replace(/'/g, "''");
  const serverBase = SERVER_BASE.replace(/'/g, "''");
  const exePath = INSTALLED_EXE.replace(/'/g, "''");
  const launcherPath = path.join(path.dirname(INSTALLED_EXE), 'NAS-Drive.exe').replace(/'/g, "''");
  const iconPath = INSTALLED_ICON.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$configPath = '${configPath}'
$healthPath = '${healthPath}'
$exitPath = '${exitPath}'
$trayPidPath = '${trayPidPath}'
$serverBase = '${serverBase}'
$exePath = '${exePath}'
$launcherPath = '${launcherPath}'
$iconPath = '${iconPath}'
try { Set-Content -LiteralPath $trayPidPath -Value $PID -Encoding ASCII -Force } catch {}

function Read-AgentConfig {
  try {
    if (Test-Path $configPath) {
      return Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
  } catch {}
  return $null
}

function Read-AgentHealth {
  try {
    if (Test-Path $healthPath) { return Get-Content $healthPath -Raw -Encoding UTF8 | ConvertFrom-Json }
  } catch {}
  return $null
}

function Get-StatusText {
  $config = Read-AgentConfig
  if ($null -eq $config) { return "아직 NAS 계정과 연결되지 않았습니다." }
  $health = Read-AgentHealth
  $profiles = @($config.profiles)
  $lines = New-Object System.Collections.Generic.List[string]
  if ($null -ne $health -and $health.needsRelink) {
    $lines.Add("상태: 계정 다시 연결 필요")
    $lines.Add("상태 및 설정을 열어 NAS 계정으로 로그인해 주세요.")
  } elseif ($null -ne $health -and $health.state -eq "offline") {
    $lines.Add("상태: NAS 서버에 연결할 수 없음")
    $lines.Add("NAS 전원과 인터넷 연결을 확인합니다. 서버가 켜지면 자동으로 다시 연결됩니다.")
  } elseif ($null -ne $health -and $health.state -eq "syncing") {
    $lines.Add("상태: 동기화 중")
    if ($health.message) { $lines.Add($health.message) }
  } elseif ($null -ne $health -and $health.state -eq "connecting") {
    $lines.Add("상태: NAS 서버 연결 중")
  } elseif ($null -ne $health -and $health.state -eq "paused") {
    $lines.Add("상태: 동기화 일시 중지")
  } elseif ($null -ne $health -and $health.state -eq "updating") {
    $lines.Add("상태: NAS Drive 업데이트 중")
  } elseif ($null -ne $health -and $health.state -eq "error") {
    $lines.Add("상태: 동기화 오류")
    if ($health.message) { $lines.Add("최근 오류: " + $health.message) }
  } else {
    $lines.Add("상태: NAS와 동기화됨")
    $lines.Add("구름=온라인 전용 · 초록 체크=이 PC에서 사용 가능 · 진한 초록 체크=항상 유지")
  }
  $lines.Add("연결된 계정: " + $profiles.Count)
  $lines.Add("")
  foreach ($profile in $profiles) {
    $lines.Add("계정: " + $profile.displayName)
    foreach ($root in @($profile.syncRoots)) { $lines.Add(" · " + $root.name + "  " + $root.localPath) }
  }
  return ($lines -join [Environment]::NewLine)
}

function Get-FirstDrivePath {
  $config = Read-AgentConfig
  foreach ($profile in @($config.profiles)) {
    foreach ($root in @($profile.syncRoots)) {
      if ($root.localPath) { return [string]$root.localPath }
    }
  }
  return ""
}

function Show-AgentWindow {
  if (Test-Path $launcherPath) {
    Start-Process -FilePath $launcherPath -ArgumentList @('--open')
    return
  }
  $form = New-Object System.Windows.Forms.Form
  $form.Text = "NAS Drive"
  $form.Size = New-Object System.Drawing.Size(520, 360)
  $form.StartPosition = "CenterScreen"
  $form.MaximizeBox = $false
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog

  $label = New-Object System.Windows.Forms.Label
  $label.Text = Get-StatusText
  $label.AutoSize = $false
  $label.Location = New-Object System.Drawing.Point(18, 18)
  $label.Size = New-Object System.Drawing.Size(470, 230)
  $label.Font = New-Object System.Drawing.Font("Segoe UI", 10)

  $openButton = New-Object System.Windows.Forms.Button
  $openButton.Text = "NAS Drive 열기"
  $openButton.Location = New-Object System.Drawing.Point(18, 270)
  $openButton.Size = New-Object System.Drawing.Size(130, 34)
  $openButton.Add_Click({ $drivePath = Get-FirstDrivePath; if ($drivePath) { Start-Process explorer.exe -ArgumentList $drivePath } })

  $webButton = New-Object System.Windows.Forms.Button
  $webButton.Text = "NAS 웹 열기"
  $webButton.Location = New-Object System.Drawing.Point(158, 270)
  $webButton.Size = New-Object System.Drawing.Size(130, 34)
  $webButton.Add_Click({ Start-Process 'nas-sync://open-web' })

  $closeButton = New-Object System.Windows.Forms.Button
  $closeButton.Text = "닫기"
  $closeButton.Location = New-Object System.Drawing.Point(362, 270)
  $closeButton.Size = New-Object System.Drawing.Size(126, 34)
  $closeButton.Add_Click({ $form.Close() })

  $form.Controls.Add($label)
  $form.Controls.Add($openButton)
  $form.Controls.Add($webButton)
  $form.Controls.Add($closeButton)
  $form.ShowDialog() | Out-Null
}

$notify = New-Object System.Windows.Forms.NotifyIcon
try {
  if (Test-Path $iconPath) { $notify.Icon = [System.Drawing.Icon]::new($iconPath) }
  else { $notify.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath) }
} catch { $notify.Icon = [System.Drawing.SystemIcons]::Application }
$notify.Text = "NAS Drive"
$notify.Visible = $true
$brandIcon = $notify.Icon

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add("상태 확인 중")
$statusItem.Enabled = $false
$menu.Items.Add("-") | Out-Null
$openItem = $menu.Items.Add("상태 및 설정")
$driveItem = $menu.Items.Add("NAS Drive 열기")
$webItem = $menu.Items.Add("NAS 웹 열기")
$logoutItem = $menu.Items.Add("로그아웃")
$menu.Items.Add("-") | Out-Null
$exitItem = $menu.Items.Add("종료")

$openItem.Add_Click({ Show-AgentWindow })
$driveItem.Add_Click({ $drivePath = Get-FirstDrivePath; if ($drivePath) { Start-Process explorer.exe -ArgumentList $drivePath } })
$webItem.Add_Click({ Start-Process 'nas-sync://open-web' })
$logoutItem.Add_Click({ if (Test-Path $launcherPath) { Start-Process -FilePath $launcherPath -ArgumentList @('--open') } else { Start-Process -FilePath $exePath -ArgumentList @('nas-sync://logout','--hidden-bootstrap') -WindowStyle Hidden } })
$exitItem.Add_Click({
  try { New-Item -Path $exitPath -ItemType File -Force | Out-Null } catch {}
  $notify.Visible = $false
  $notify.Dispose()
  [System.Windows.Forms.Application]::Exit()
})
$notify.Add_DoubleClick({ Show-AgentWindow })
$notify.Add_BalloonTipClicked({ Start-Process $serverBase })
$notify.ContextMenuStrip = $menu

$lastHealthState = ""
$healthWatch = New-Object System.Windows.Forms.Timer
$healthWatch.Interval = 1000
$healthWatch.Add_Tick({
  $health = Read-AgentHealth
  $nextState = if ($null -ne $health) { [string]$health.state } else { "unknown" }
  if ($nextState -ne $lastHealthState) {
    $previousState = $lastHealthState
    $lastHealthState = $nextState
    if ($nextState -eq "needs-relink") {
      $notify.Text = "NAS Drive - 계정 연결 필요"
      $notify.Icon = [System.Drawing.SystemIcons]::Error
      $statusItem.Text = "● 계정 다시 연결 필요"
      $notify.BalloonTipTitle = "NAS Drive 계정 연결 필요"
      $notify.BalloonTipText = "NAS Drive 설정을 열어 계정으로 로그인해 주세요."
      $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
      $notify.ShowBalloonTip(7000)
    } elseif ($nextState -eq "offline") {
      $notify.Text = "NAS Drive - NAS 오프라인"
      $notify.Icon = [System.Drawing.SystemIcons]::Warning
      $statusItem.Text = "● NAS 서버에 연결할 수 없음"
      $notify.BalloonTipTitle = "NAS Drive 연결 끊김"
      $notify.BalloonTipText = "NAS가 꺼져 있거나 인터넷에 연결할 수 없습니다. 서버가 켜지면 자동으로 복구됩니다."
      $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
      $notify.ShowBalloonTip(5000)
    } elseif ($nextState -eq "connecting") {
      $notify.Text = "NAS Drive - 연결 중"
      $notify.Icon = [System.Drawing.SystemIcons]::Information
      $statusItem.Text = "● NAS 서버 연결 중"
    } elseif ($nextState -eq "syncing") {
      $notify.Text = "NAS Drive - 동기화 중"
      $notify.Icon = [System.Drawing.SystemIcons]::Information
      $statusItem.Text = "● 변경 사항 동기화 중"
    } elseif ($nextState -eq "paused") {
      $notify.Text = "NAS Drive - 일시 중지"
      $notify.Icon = [System.Drawing.SystemIcons]::Warning
      $statusItem.Text = "● 동기화 일시 중지"
    } elseif ($nextState -eq "updating") {
      $notify.Text = "NAS Drive - 업데이트 중"
      $notify.Icon = [System.Drawing.SystemIcons]::Information
      $statusItem.Text = "● NAS Drive 업데이트 중"
    } elseif ($nextState -eq "error") {
      $notify.Text = "NAS Drive - 동기화 오류"
      $notify.Icon = [System.Drawing.SystemIcons]::Error
      $statusItem.Text = "● 동기화 오류"
    } else {
      $notify.Text = "NAS Drive - NAS와 동기화됨"
      $notify.Icon = $brandIcon
      $statusItem.Text = "● NAS와 동기화됨 (파일별 저장 상태는 탐색기 확인)"
      if ($previousState -eq "offline" -or $previousState -eq "error") {
        $notify.BalloonTipTitle = "NAS Drive 연결 복구"
        $notify.BalloonTipText = "NAS 서버와 다시 연결되어 동기화가 정상화되었습니다."
        $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
        $notify.ShowBalloonTip(4000)
      }
    }
  }
})
$healthWatch.Start()

$exitWatch = New-Object System.Windows.Forms.Timer
$exitWatch.Interval = 500
$exitWatch.Add_Tick({
  if (Test-Path $exitPath) {
    $exitWatch.Stop()
    $healthWatch.Stop()
    $notify.Visible = $false
    $notify.Dispose()
    [System.Windows.Forms.Application]::Exit()
  }
})
$exitWatch.Start()

[System.Windows.Forms.Application]::Run()
`;
  writePowerShellScript(TRAY_SCRIPT_FILE, script);
  return TRAY_SCRIPT_FILE;
}

function startTray(config) {
  if (isNativeLauncherAvailable(INSTALLED_EXE)) return;
  const previousPid = Number(fs.existsSync(TRAY_PID_FILE) ? fs.readFileSync(TRAY_PID_FILE, 'utf8') : 0);
  if (isProcessAlive(previousPid)) return;
  const script = writeTrayScript(config);
  const launcher = `
$scriptPath = ${JSON.stringify(script)}
$quotedPath = '"' + $scriptPath.Replace('"', '\\"') + '"'
$child = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', $quotedPath) -PassThru
[Console]::Out.Write($child.Id)
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', launcher], {
    encoding: 'utf8', windowsHide: true
  });
  const childPid = Number(String(result.stdout || '').trim());
  if (childPid > 0) fs.writeFileSync(TRAY_PID_FILE, String(childPid), 'utf8');
}

async function lookup(pairingToken, clientDeviceKey) {
  return requestJson('POST', '/api/devices/agent/lookup', { pairingToken, clientDeviceKey });
}

async function register(pairingToken, clientDeviceKey, deviceName, selectedFolder, summary) {
  return requestJson('POST', '/api/devices/agent/register', {
    pairingToken,
    clientDeviceKey,
    deviceName,
    osType: 'windows',
    desktopPath: selectedFolder,
    syncRootPath: selectedFolder,
    syncRootSizeBytes: summary.totalBytes,
    syncRootFileCount: summary.fileCount,
    syncRootFolderCount: summary.folderCount
  });
}

function mergeRoot(config, root) {
  const roots = getRoots(config).filter(existing => existing.syncRootId !== root.syncRootId && existing.localPath !== root.localPath);
  roots.push(root);
  return roots;
}

function buildRegisteredProfile(currentConfig, reg, lookupResult, deviceName, root) {
  const account = reg.account || lookupResult.account || {};
  const accountKey = account.ownerKey || account.userUid || account.loginId || reg.device.deviceId;
  const existingProfile = getProfiles(currentConfig)
    .find(item => safeAccountKey(item.accountKey) === safeAccountKey(accountKey)) || null;
  return {
    serverBase: SERVER_BASE,
    accountKey,
    userUid: account.userUid || '',
    loginId: account.loginId || '',
    displayName: account.displayName || account.loginId || '개인',
    deviceId: reg.device.deviceId,
    agentToken: reg.agentToken,
    deviceName,
    syncRoots: mergeRoot(existingProfile, root),
    savedAt: new Date().toISOString()
  };
}

async function syncFolder(root, dir, config) {
  if (isPersonalDriveShellMetadata(root, dir)) return;
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  const rel = relPath(root.localPath, dir);
  if (!rel) return;
  if (root.kind === 'personal-drive') await updatePersonalDriveEntryState(root, config, dir, 'dirty');
  await requestJson('POST', '/api/devices/agent/sync-folder', { deviceId: config.deviceId, syncRootId: root.syncRootId, relPath: rel }, config.agentToken);
  if (root.kind === 'personal-drive') await updatePersonalDriveEntryState(root, config, dir, 'commit');
}

async function syncDelete(root, target, config) {
  if (isPersonalDriveShellMetadata(root, target)) return;
  const rel = relPath(root.localPath, target);
  if (!rel) return;
  await requestJson('POST', '/api/devices/agent/sync-delete', { deviceId: config.deviceId, syncRootId: root.syncRootId, relPath: rel }, config.agentToken);
}

async function syncFile(root, file, config) {
  if (isPersonalDriveShellMetadata(root, file)) return;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`파일이 NAS Drive 최대 파일 크기(250GB)를 초과했습니다: ${path.basename(file)}`);
  }
  const relativePath = relPath(root.localPath, file);
  if (root.kind === 'personal-drive') await updatePersonalDriveEntryState(root, config, file, 'dirty');
  const knownRemote = getKnownRemoteEntry(root, relativePath);
  const result = stat.size > DIRECT_UPLOAD_MAX_BYTES
    ? await resumableAgentUpload(root, file, config, stat, relativePath, knownRemote)
    : await multipartUpload('/api/devices/agent/sync-file', {
      deviceId: config.deviceId,
      syncRootId: root.syncRootId,
      relPath: relativePath,
      baseMtimeMs: Number(knownRemote?.mtimeMs || 0),
      clientMtimeMs: Math.round(stat.mtimeMs),
      deviceName: config.deviceName || os.hostname() || 'Windows-PC'
    }, file, config.agentToken);
  if (result?.conflict && result.conflictRelPath) {
    const conflictLocal = path.join(root.localPath, String(result.conflictRelPath).split('/').join(path.sep));
    suppressRemotePath(file, 12_000);
    suppressRemotePath(conflictLocal, 12_000);
    fs.mkdirSync(path.dirname(conflictLocal), { recursive: true });
    if (!fs.existsSync(conflictLocal)) fs.renameSync(file, conflictLocal);
    if (root.kind === 'personal-drive' && fs.existsSync(conflictLocal)) {
      await updatePersonalDriveEntryState(root, config, conflictLocal, 'commit');
    }
    log('[conflict preserved]', relativePath, '=>', result.conflictRelPath);
    return;
  }
  if (root.kind === 'personal-drive' && fs.existsSync(file)) {
    await updatePersonalDriveEntryState(root, config, file, 'commit');
  }
}

function scanLocalEntries(root) {
  const entries = {};
  const unreadablePrefixes = new Set();
  const walk = (dir) => {
    let directoryEntries;
    try {
      directoryEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      const prefix = relPath(root.localPath, dir);
      unreadablePrefixes.add(prefix);
      log('[local scan deferred]', prefix || '.', err.code || err.message);
      return;
    }
    for (const entry of directoryEntries) {
      const full = path.join(dir, entry.name);
      const relativePath = relPath(root.localPath, full);
      if (!relativePath || relativePath.endsWith('.nasdownload') || isPersonalDriveShellMetadata(root, full)) continue;
      let stat;
      try {
        // lstat reads placeholder metadata without requesting an online-only
        // file body from CFAPI. A transient unreadable placeholder must never
        // abort the Agent or be interpreted as a remote deletion.
        stat = fs.lstatSync(full);
      } catch (err) {
        unreadablePrefixes.add(relativePath);
        entries[relativePath] = {
          type: entry.isDirectory() ? 'folder' : 'file',
          unreadable: true,
          fullPath: full
        };
        log('[local entry scan deferred]', relativePath, err.code || err.message);
        continue;
      }
      entries[relativePath] = {
        type: entry.isDirectory() ? 'folder' : 'file',
        size: entry.isFile() ? stat.size : undefined,
        mtimeMs: Math.round(stat.mtimeMs),
        fullPath: full
      };
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root.localPath);
  return { entries, unreadablePrefixes };
}

function entriesMatch(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'folder') return true;
  return Number(a.size) === Number(b.size) && Math.abs(Number(a.mtimeMs) - Number(b.mtimeMs)) <= 2000;
}

function localEntryNeedsUpload(local, previousRemote, currentRemote, wasPreviouslyRemote = false) {
  if (!local) return false;
  if (previousRemote) return !entriesMatch(local, previousRemote);
  // State files written by older Agents only contain remotePaths. If such a
  // path disappeared from the current NAS manifest, the remaining CFAPI
  // placeholder is a pending remote deletion, not a brand-new local file.
  // Trying to upload it hydrates a source that no longer exists and loops on a
  // Windows read error before the normal pull/trash path can preserve it.
  if (wasPreviouslyRemote && !currentRemote) return false;
  return !currentRemote || !entriesMatch(local, currentRemote);
}

function enqueueRootSync(root, task) {
  const key = String(root?.syncRootId || root?.localPath || 'root');
  const previous = rootSyncQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  rootSyncQueues.set(key, next);
  return next.finally(() => {
    if (rootSyncQueues.get(key) === next) rootSyncQueues.delete(key);
  });
}

async function reconcileOfflineLocalChanges(root, config) {
  const previous = readJson(stateFile(root), { remoteEntries: {} });
  const previousEntries = previous.remoteEntries || {};
  const previousRemotePaths = new Set(previous.remotePaths || Object.keys(previousEntries));
  const currentManifest = await request('GET', `/api/devices/agent/manifest?deviceId=${encodeURIComponent(config.deviceId)}&syncRootId=${encodeURIComponent(root.syncRootId)}`, {
    headers: { 'x-agent-token': config.agentToken }
  }).catch(error => { throw agentStageError(error, 'local-audit-manifest'); });
  const currentRemote = Object.fromEntries((currentManifest.entries || []).map(entry => [entry.relPath, entry]));
  const localScan = scanLocalEntries(root);
  const localEntries = localScan.entries;

  for (const [relativePath, local] of Object.entries(localEntries)) {
    const before = previousEntries[relativePath];
    const remote = currentRemote[relativePath];
    if (!local.unreadable && localEntryNeedsUpload(local, before, remote, previousRemotePaths.has(relativePath))) {
      if (local.type === 'folder') await syncFolder(root, local.fullPath, config).catch(error => { throw agentStageError(error, 'local-folder-upload'); });
      else await syncFile(root, local.fullPath, config).catch(error => {
        const staged = agentStageError(error, 'local-file-upload');
        staged.agentRelPath = relativePath;
        throw staged;
      });
    }
  }

  const isUnreadable = relativePath => Array.from(localScan.unreadablePrefixes).some(prefix => !prefix || relativePath === prefix || relativePath.startsWith(prefix + '/'));
  const missing = Object.keys(previousEntries)
    .filter(relativePath => !localEntries[relativePath] && !isUnreadable(relativePath) && currentRemote[relativePath] && entriesMatch(currentRemote[relativePath], previousEntries[relativePath]))
    .sort((a, b) => a.split('/').length - b.split('/').length);
  const topLevelMissing = [];
  for (const relativePath of missing) {
    if (topLevelMissing.some(parent => relativePath.startsWith(parent + '/'))) continue;
    topLevelMissing.push(relativePath);
  }
  for (const relativePath of topLevelMissing) {
    await requestJson('POST', '/api/devices/agent/sync-delete', {
      deviceId: config.deviceId,
      syncRootId: root.syncRootId,
      relPath: relativePath
    }, config.agentToken).catch(error => { throw agentStageError(error, 'local-delete-upload'); });
  }
}

async function initialSync(root, config) {
  const walk = async (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      try {
        if (isPersonalDriveShellMetadata(root, full)) continue;
        if (entry.isDirectory()) {
          await syncFolder(root, full, config);
          await walk(full);
        } else if (entry.isFile()) {
          await syncFile(root, full, config);
        }
      } catch (err) {
        log('[sync failed]', full, err.message);
      }
    }
  };
  await walk(root.localPath);
}

function stateFile(root) {
  return path.join(STATE_DIR, `${STATE_PREFIX}${String(root.syncRootId).replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
}

function getKnownRemoteEntry(root, relativePath) {
  const state = readJson(stateFile(root), {});
  return state.remoteEntries?.[relativePath] || null;
}

function moveToTrash(root, target, { allowOnlineOnlyPlaceholderDelete = false } = {}) {
  if (!fs.existsSync(target)) return;
  const rel = relPath(root.localPath, target);
  if (!rel) return;
  const trash = path.join(STATE_DIR, 'trash', String(root.syncRootId), new Date().toISOString().replace(/[:.]/g, '-'), rel);
  fs.mkdirSync(path.dirname(trash), { recursive: true });
  try {
    fs.renameSync(target, trash);
  } catch (error) {
    const isUnreadablePlaceholder = allowOnlineOnlyPlaceholderDelete
      && fs.lstatSync(target).isFile()
      && /UNKNOWN|read/i.test(`${error?.code || ''} ${error?.message || ''}`);
    if (!isUnreadablePlaceholder) throw error;
    // The NAS manifest authoritatively removed this path and Windows confirms
    // that the remaining online-only placeholder cannot be read/moved. It has
    // no hydrated local body to preserve, so remove only that placeholder and
    // let a future manifest recreate it if the server path returns.
    fs.unlinkSync(target);
    log('[stale online-only placeholder removed]', rel);
  }
}

async function pullNasChanges(root, config, onDetectedChange = null) {
  const previous = readJson(stateFile(root), { remotePaths: [] });
  if (previous.remoteRevision) {
    const change = await request('GET', `/api/devices/agent/changes?deviceId=${encodeURIComponent(config.deviceId)}&syncRootId=${encodeURIComponent(root.syncRootId)}&revision=${encodeURIComponent(previous.remoteRevision)}`, {
      headers: { 'x-agent-token': config.agentToken }
    }).catch(error => { throw agentStageError(error, 'remote-change-check'); });
    if (!change.changed) return false;
  }
  const manifest = await request('GET', `/api/devices/agent/manifest?deviceId=${encodeURIComponent(config.deviceId)}&syncRootId=${encodeURIComponent(root.syncRootId)}`, {
    headers: { 'x-agent-token': config.agentToken }
  }).catch(error => { throw agentStageError(error, 'remote-manifest'); });
  const remotePaths = new Map();
  for (const entry of manifest.entries || []) {
    if (isPersonalDriveShellMetadataRelPath(root, entry.relPath)) continue;
    remotePaths.set(entry.relPath, entry);
  }
  const remoteEntries = Object.fromEntries(Array.from(remotePaths.entries()));
  const previousEntries = previous.remoteEntries || {};
  const remoteChanged = JSON.stringify(previousEntries) !== JSON.stringify(remoteEntries);
  if (remoteChanged && onDetectedChange) await onDetectedChange();
  applyingRemoteChange = true;
  try {
    if (root.kind === 'personal-drive') {
      await syncPersonalDrivePlaceholders(root, config, manifest, previous)
        .catch(error => { throw agentStageError(error, 'provider-manifest-apply'); });
      writeJson(stateFile(root), { remotePaths: Array.from(remotePaths.keys()), remoteEntries, remoteRevision: manifest.revision || '', savedAt: new Date().toISOString(), filesOnDemand: true });
      return remoteChanged;
    }
    for (const entry of manifest.entries || []) {
      const local = path.join(root.localPath, entry.relPath.split('/').join(path.sep));
      if (entry.type === 'folder') {
        fs.mkdirSync(local, { recursive: true });
      } else if (entry.type === 'file') {
        let needsDownload = true;
        if (fs.existsSync(local)) {
          const stat = fs.statSync(local);
          needsDownload = stat.size !== entry.size || Math.abs(stat.mtimeMs - entry.mtimeMs) > 2000;
        }
        if (needsDownload) {
          const tmp = `${local}.nasdownload`;
          await downloadFile(`/api/devices/agent/file?deviceId=${encodeURIComponent(config.deviceId)}&syncRootId=${encodeURIComponent(root.syncRootId)}&relPath=${encodeURIComponent(entry.relPath)}`, tmp, config.agentToken);
          fs.renameSync(tmp, local);
          try { fs.utimesSync(local, new Date(), new Date(entry.mtimeMs)); } catch {}
        }
      }
    }
    for (const rel of previous.remotePaths || []) {
      if (!remotePaths.has(rel)) moveToTrash(root, path.join(root.localPath, rel.split('/').join(path.sep)));
    }
    writeJson(stateFile(root), { remotePaths: Array.from(remotePaths.keys()), remoteEntries, remoteRevision: manifest.revision || '', savedAt: new Date().toISOString() });
  } finally {
    applyingRemoteChange = false;
  }
  return remoteChanged;
}

function debounce(fn, delay = 700) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args).catch(err => {
      log('[event failed]', err.message);
    }), delay);
  };
}

function watchRoot(root, config) {
  const changedPaths = new Set();
  let flushTimer = null;
  const scheduleFlush = () => {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      if (config._paused || changedPaths.size === 0) return;
      const batch = Array.from(changedPaths);
      changedPaths.clear();
      try {
        await enqueueRootSync(root, async () => {
          setProfileHealth(config, 'syncing', `변경 사항 ${batch.length}개를 확인하는 중입니다.`);
          await reconcileOfflineLocalChanges(root, config);
          await pullNasChanges(root, config);
          rootLocalAuditAt.set(String(root.syncRootId), Date.now());
          setProfileHealth(config, 'up-to-date');
          await sendHeartbeat(config, 'up-to-date').catch(() => {});
        });
      } catch (err) {
        const state = classifyAgentError(err);
        setProfileHealth(config, state, state === 'offline' ? 'NAS 서버가 꺼져 있거나 인터넷에 연결할 수 없습니다.' : err.message);
        log('[event batch failed]', root.syncRootId, err.message);
      }
      if (changedPaths.size > 0) scheduleFlush();
    }, 900);
  };
  return fs.watch(root.localPath, { recursive: true }, (_event, fileName) => {
    if (applyingRemoteChange || config._paused || !fileName) return;
    const full = path.join(root.localPath, fileName.toString());
    if (isRemotePathSuppressed(full) || isPersonalDriveShellMetadata(root, full)) return;
    changedPaths.add(fileName.toString());
    scheduleFlush();
  });
}

async function runBackground() {
  ensureStateDir();
  const config = loadConfig();
  if (migrateUnsafeInstallDir(config) && path.resolve(process.execPath).toLowerCase() !== path.resolve(INSTALLED_EXE).toLowerCase()) {
    const installed = installSelf();
    registerStartup(installed);
    registerProtocol(installed);
    spawn(installed, ['--background'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
    return;
  }
  const previousPid = Number(fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf8') : 0);
  if (isExpectedProcessAlive(previousPid, INSTALLED_EXE)) return;
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  try { fs.unlinkSync(EXIT_FILE); } catch {}
  const profiles = getProfiles(config).filter(profile => profile.deviceId && profile.agentToken);
  for (const profile of profiles) {
    profile._isActive = safeAccountKey(profile.accountKey) === safeAccountKey(config?.activeAccountKey);
  }
  const trayConfig = config ? { ...config, serverBase: SERVER_BASE } : {
    serverBase: SERVER_BASE,
    profiles: []
  };
  startTray(trayConfig);

  if (profiles.length === 0) {
    setAgentHealth('needs-relink', '연결된 NAS 계정이 없습니다.');
    setInterval(() => {
      if (fs.existsSync(EXIT_FILE)) {
        try { fs.unlinkSync(PID_FILE); } catch {}
        process.exit(0);
      }
      startTray(trayConfig);
    }, PULL_INTERVAL_MS);
    return;
  }

  let startupHeartbeatBusy = false;
  const startupHeartbeatTimer = setInterval(async () => {
    if (startupHeartbeatBusy) return;
    startupHeartbeatBusy = true;
    try {
      await Promise.all(profiles.map(async profile => {
        try {
          const state = profile._runtimeState || 'connecting';
          await sendHeartbeat(profile, state);
          setProfileHealth(profile, state);
        } catch {}
      }));
    } finally {
      startupHeartbeatBusy = false;
    }
  }, 3000);

  const profileJobs = [];
  for (const profile of profiles) {
    const roots = getRoots(profile).filter(root => root.localPath && fs.existsSync(root.localPath));
    let heartbeat = { commands: { paused: false } };
    let authenticated = true;
    try {
      setProfileHealth(profile, 'connecting');
      heartbeat = await sendHeartbeat(profile, 'connecting');
      if (await checkForAgentUpdate(profile)) {
        try { fs.unlinkSync(PID_FILE); } catch {}
        process.exit(0);
      }
    } catch (err) {
      authenticated = false;
      log('[heartbeat failed]', profile.accountKey, err.message);
      const state = classifyAgentError(err);
      setProfileHealth(profile, state, state === 'offline' ? 'NAS 서버가 꺼져 있거나 인터넷에 연결할 수 없습니다.' : err.message);
    }
    profile._paused = !!heartbeat.commands?.paused;
    let watchersStarted = authenticated;
    if (authenticated) {
      for (const root of roots) {
        try {
          if (root.kind === 'personal-drive') await registerPersonalDrive(profile);
          if (!profile._paused) await enqueueRootSync(root, async () => {
            await reconcileOfflineLocalChanges(root, profile);
            await pullNasChanges(root, profile, async () => {
              setProfileHealth(profile, 'syncing', 'NAS의 변경 사항을 반영하는 중입니다.');
              await sendHeartbeat(profile, 'syncing').catch(() => {});
            });
            rootLocalAuditAt.set(String(root.syncRootId), Date.now());
          });
          watchRoot(root, profile);
        } catch (err) {
          watchersStarted = false;
          log('[initial root setup failed]', profile.accountKey, root.syncRootId, err.agentStage || 'unknown-stage', err.agentRelPath || '', err.code || '', err.message);
          const state = classifyAgentError(err);
          setProfileHealth(profile, state, state === 'offline' ? 'NAS 서버가 꺼져 있거나 인터넷에 연결할 수 없습니다.' : err.message);
        }
      }
      if (profile._paused) {
        setProfileHealth(profile, 'paused');
      } else if (watchersStarted) {
        await sendHeartbeat(profile, 'up-to-date').catch(() => {});
        setProfileHealth(profile, 'up-to-date');
      }
    }
    profileJobs.push({
      profile,
      roots,
      authenticated,
      watchersStarted,
      nextAuthRetryAt: authenticated ? 0 : Date.now() + 5 * 60 * 1000
    });
  }
  clearInterval(startupHeartbeatTimer);
  let backgroundTickRunning = false;
  setInterval(async () => {
    if (backgroundTickRunning) return;
    backgroundTickRunning = true;
    try {
    if (fs.existsSync(EXIT_FILE)) {
      try { fs.unlinkSync(PID_FILE); } catch {}
      process.exit(0);
    }
    startTray(trayConfig);
    for (const job of profileJobs) {
      if (!job.authenticated && Date.now() < Number(job.nextAuthRetryAt || 0)) continue;
      try {
        const heartbeat = await sendHeartbeat(job.profile, job.profile._runtimeState || 'connecting');
        job.authenticated = true;
        job.nextAuthRetryAt = 0;
        if (await checkForAgentUpdate(job.profile)) {
          try { fs.unlinkSync(PID_FILE); } catch {}
          process.exit(0);
        }
        job.profile._paused = !!heartbeat.commands?.paused;
        for (const root of job.roots.filter(item => item.kind === 'personal-drive')) {
          ensurePersonalDriveWebShortcut(root.localPath, job.profile);
          if (!isPersonalDriveProviderAlive(job.profile, root)) {
            setProfileHealth(job.profile, 'connecting', '파일 탐색기 연결을 복구하는 중입니다.');
            await ensurePersonalDriveProvider(job.profile, root);
          }
        }
        if (!job.watchersStarted) {
          for (const root of job.roots) {
            if (root.kind === 'personal-drive') await registerPersonalDrive(job.profile);
            if (!job.profile._paused) await reconcileOfflineLocalChanges(root, job.profile);
            watchRoot(root, job.profile);
          }
          job.watchersStarted = true;
        }
        if (job.profile._paused) {
          setProfileHealth(job.profile, 'paused');
          continue;
        }
        for (const root of job.roots) await enqueueRootSync(root, async () => {
          const auditKey = String(root.syncRootId);
          if (Date.now() - Number(rootLocalAuditAt.get(auditKey) || 0) >= 15_000) {
            await reconcileOfflineLocalChanges(root, job.profile);
            rootLocalAuditAt.set(auditKey, Date.now());
          }
          await pullNasChanges(root, job.profile, async () => {
            setProfileHealth(job.profile, 'syncing', 'NAS의 변경 사항을 반영하는 중입니다.');
            await sendHeartbeat(job.profile, 'syncing').catch(() => {});
          });
        });
        await sendHeartbeat(job.profile, 'up-to-date');
        setProfileHealth(job.profile, 'up-to-date');
      } catch (err) {
        log('[pull failed]', job.profile.accountKey, err.agentStage || 'unknown-stage', err.agentRelPath || '', err.code || '', err.message);
        if (isAgentAuthError(err)) {
          job.authenticated = false;
          job.nextAuthRetryAt = Date.now() + 5 * 60 * 1000;
        }
        const state = classifyAgentError(err);
        setProfileHealth(job.profile, state, state === 'offline' ? 'NAS 서버가 꺼져 있거나 인터넷에 연결할 수 없습니다.' : err.message);
        if (!isAgentAuthError(err)) await sendHeartbeat(job.profile, 'error', err.message).catch(() => {});
      }
    }
    } finally {
      backgroundTickRunning = false;
    }
  }, PULL_INTERVAL_MS);
}

async function runStandaloneLoginSetup() {
  installSelf();
  registerProtocol();
  applyStartupPreference(true);
  startBackground();
  setAgentHealth('needs-relink', '프로그램 설치가 완료되었습니다. NAS 계정을 연결해 주세요.');
  return showFirstRunWelcome(getDeviceKey());
}

function needsAccountConnection(config) {
  const profiles = getProfiles(config).filter(profile => profile.deviceId && profile.agentToken);
  if (profiles.length === 0) return true;
  const health = readJson(HEALTH_FILE, {});
  return health?.state === 'needs-relink' || health?.needsRelink === true;
}

function runSelfTest() {
  if (!fs.existsSync(ICON_ASSET)) throw new Error('NAS Drive icon asset is missing.');
  if (fileSha256(ICON_ASSET) !== BRAND_ICON_SHA256) throw new Error('NAS Drive icon asset hash mismatch.');
  const expectedPrefix = path.join(os.homedir(), 'NAS Drive - ');
  const defaultPath = personalDrivePath({ displayName: '테스트 계정' });
  if (!defaultPath.startsWith(expectedPrefix)) throw new Error('OneDrive-style default path test failed.');
  if (personalDrivePath({ displayName: 'a/b:c' }).includes('/b:')) throw new Error('Drive label sanitization test failed.');
  if (safeAccountKey('a/b') !== 'a_b') throw new Error('Account key sanitization test failed.');
  if (classifyAgentError(new Error('HTTP 503: tunnel unavailable')) !== 'offline') throw new Error('NAS offline classification test failed.');
  if (classifyAgentError(new Error('HTTP 403: Agent 인증 실패')) !== 'needs-relink') throw new Error('Agent relink classification test failed.');
  const iconProbe = createStatusIconBuffer('offline', EXPLORER_STATUS_COLORS.offline);
  if (iconProbe.readUInt16LE(2) !== 1 || iconProbe.readUInt16LE(4) !== 1 || iconProbe.length < 1000) throw new Error('Explorer status icon generation test failed.');
  if (!explorerStatusLabel('needs-relink').includes('다시 연결')) throw new Error('Explorer relink status label test failed.');
  if (!isLogoutAlreadyRevokedError(new Error('HTTP 403: Agent 인증 실패'))) throw new Error('Already-revoked logout test failed.');
  if (isLogoutAlreadyRevokedError(new Error('HTTP 503: tunnel unavailable'))) throw new Error('Offline logout preservation test failed.');
  if (!isNewerVersion('1.9.0', '1.8.4') || isNewerVersion('1.7.0', '1.8.4') || isNewerVersion('1.8.4', '1.8.4')) {
    throw new Error('Agent semantic update ordering test failed.');
  }
  if (localEntryNeedsUpload({ type: 'file', size: 10, mtimeMs: 1000 }, null, null, true)) {
    throw new Error('Legacy remote placeholder migration test failed.');
  }
  const profileMergeTest = buildRegisteredProfile(
    { profiles: [{ accountKey: 'owner_test', syncRoots: [{ syncRootId: 'old', localPath: 'C:\\old' }] }] },
    { account: { ownerKey: 'owner_test', loginId: 'tester' }, device: { deviceId: 'device_test' }, agentToken: 'token_test' },
    { account: {} },
    'Windows-PC',
    { syncRootId: 'new', localPath: 'C:\\new' }
  );
  if (profileMergeTest.syncRoots.length !== 2 || profileMergeTest.deviceId !== 'device_test') {
    throw new Error('Registered profile merge regression test failed.');
  }
  if (tokenFromUrl('nas-sync://drive?token=pair_test') !== 'pair_test') throw new Error('Pairing URL test failed.');
  if (!webSetupUrl('login').includes('/login?next=%2Fplatform%3FpcConnect%3D1')) throw new Error('Login onboarding URL test failed.');
  if (!webSetupUrl('signup').includes('/signup?next=%2Fplatform%3FpcConnect%3D1')) throw new Error('Signup onboarding URL test failed.');
  if (friendlyOpenWebError(new Error('HTTP 530: error code: 1033')).state !== 'offline') throw new Error('Offline web shortcut classification test failed.');
  if (classifyAgentError(Object.assign(new Error('connect failed'), { code: 'EHOSTUNREACH' })) !== 'offline') throw new Error('Host-unreachable web shortcut classification test failed.');
  if (friendlyOpenWebError(new Error('HTTP 403: Agent 인증 실패')).state !== 'needs-relink') throw new Error('Relink web shortcut classification test failed.');
  if (!friendlyOpenWebError(Object.assign(new Error('DPAPI unavailable'), { code: 'WEB_PROFILE_TOKEN_UNAVAILABLE' })).message.includes('로그인 정보를 지우지 않았습니다')) throw new Error('DPAPI profile preservation message test failed.');
  const browserTokenSecret = crypto.randomBytes(32);
  const browserChoices = listPublicBrowserChoices({}, browserTokenSecret);
  if (!browserChoices.some(choice => choice.id === 'system')) throw new Error('System browser fallback test failed.');
  if (browserChoices.some(choice => choice.profiles.some(profile => !/^[A-Za-z0-9_-]{43}$/.test(profile.token)))) throw new Error('Browser profile tokenization test failed.');
  if (resolvePublicSelection({ browserId: 'system', profileToken: '' }, {}, browserTokenSecret).id !== 'system') throw new Error('System browser selection test failed.');
  if (resolveDirectSelection('system').id !== 'system') throw new Error('Direct system browser selection test failed.');
  const redactedOpenWebError = safeOpenWebError(Object.assign(new Error('GET https://filemanager-nas.com/api/auth/desktop-handoff?token=desktop_secret'), { code: 'EPROTO' }));
  if (redactedOpenWebError.message.includes('desktop_secret') || redactedOpenWebError.message.includes('filemanager-nas.com')) throw new Error('Open web diagnostic redaction test failed.');
  if (new URL(SERVER_BASE).protocol !== 'https:') throw new Error('Trusted web origin must use HTTPS.');
  const sampleFile = { type: 'file', size: 10, mtimeMs: 1000 };
  if (!localEntryNeedsUpload(sampleFile, null, null)) throw new Error('New local file reconciliation test failed.');
  if (localEntryNeedsUpload(sampleFile, null, { ...sampleFile })) throw new Error('Existing remote file reconciliation test failed.');
  if (!localEntryNeedsUpload({ ...sampleFile, size: 11 }, sampleFile, sampleFile)) throw new Error('Changed local file reconciliation test failed.');
  if (validatePersonalDrivePath(defaultPath) !== path.resolve(defaultPath)) throw new Error('Drive path validation test failed.');
  const overlapTestRoot = path.join(os.tmpdir(), 'nas-drive-overlap-test');
  if (!isSameOrChildLocalPath(overlapTestRoot, path.join(overlapTestRoot, 'Agent.exe'))) throw new Error('Install overlap detection test failed.');
  if (MAX_FILE_BYTES !== 250 * 1024 * 1024 * 1024) throw new Error('250GB file limit test failed.');
  if (!entriesMatch({ type: 'file', size: 10, mtimeMs: 1000 }, { type: 'file', size: 10, mtimeMs: 2500 })) throw new Error('Offline reconciliation tolerance test failed.');
  if (entriesMatch({ type: 'file', size: 10, mtimeMs: 1000 }, { type: 'file', size: 11, mtimeMs: 1000 })) throw new Error('Offline reconciliation change test failed.');
  if (!process.pkg) console.log('NAS Drive agent self-tests passed');
}

async function runForeground() {
  const protocolAction = getProtocolAction();
  const currentConfig = loadConfig();
  const autoSetup = process.argv.includes('--auto-setup');
  migrateUnsafeInstallDir(currentConfig);
  if (protocolAction === 'open-web' || process.argv.includes('--open-web')) {
    registerProtocol();
    applyStartupPreference(currentConfig?.settings?.startWithWindows !== false);
    const requestedDeviceId = getProtocolParam('deviceId') || getCommandArgument('--device-id');
    const profiles = getProfiles(currentConfig);
    const profile = profiles.find(item => item.deviceId === requestedDeviceId)
      || profiles.find(item => item.accountKey === currentConfig?.activeAccountKey)
      || profiles[0];
    try {
      await openWebForProfile(profile);
    } catch (err) {
      if (err?.code === 'WEB_BROWSER_SELECTION_CANCELLED') {
        writeOpenWebDiagnostic({ state: 'cancelled', stage: 'browser-selection', attempt: 0, error: safeOpenWebError(err) });
        startBackground();
        return;
      }
      const friendly = friendlyOpenWebError(err);
      log('[open web failed]', err.message || err);
      setProfileHealth(profile, friendly.state, friendly.message);
      showMessage(friendly.title, friendly.message);
      startBackground();
      return;
    }
    startBackground();
    return;
  }
  if (protocolAction === 'open-drive') {
    registerProtocol();
    applyStartupPreference(currentConfig?.settings?.startWithWindows !== false);
    const requestedDeviceId = getProtocolParam('deviceId');
    const profiles = getProfiles(currentConfig);
    const profile = profiles.find(item => item.deviceId === requestedDeviceId)
      || profiles.find(item => item.accountKey === currentConfig?.activeAccountKey)
      || profiles[0];
    if (!profile || !(await openPersonalDrive(profile))) {
      showMessage('NAS Drive', '이 Windows 계정에 연결된 NAS Drive가 없습니다. NAS 웹에서 PC 연동을 다시 시작하세요.');
      return;
    }
    startBackground();
    return;
  }
  if (protocolAction === 'open') {
    registerProtocol();
    applyStartupPreference(currentConfig?.settings?.startWithWindows !== false);
    if (!needsAccountConnection(currentConfig)) {
      startBackground();
      if (showInstalledDashboard(currentConfig) === 'logout') await logoutActiveProfile(currentConfig, { confirmed: true });
      return;
    }
  }
  if (protocolAction === 'logout') {
    const confirmed = getProtocolParam('confirmed') === '1';
    const native = getProtocolParam('native') === '1';
    await logoutActiveProfile(currentConfig, { confirmed, reopenLogin: !native });
    return;
  }

  let pairingToken = getPairingToken();
  if (!pairingToken) {
    if (!needsAccountConnection(currentConfig)) {
      registerProtocol();
      applyStartupPreference(currentConfig?.settings?.startWithWindows !== false);
      startBackground();
      if (showInstalledDashboard(currentConfig) === 'logout') await logoutActiveProfile(currentConfig, { confirmed: true });
      return;
    }
    pairingToken = await runStandaloneLoginSetup();
    if (!pairingToken) return;
  }
  const clientDeviceKey = getDeviceKey();
  const lookupResult = await lookup(pairingToken, clientDeviceKey).catch(() => null);
  if (!lookupResult) throw new Error('PC 연동 요청을 확인할 수 없습니다. NAS 웹에서 새 연동을 시작해 주세요.');
  if (lookupResult && lookupResult.exists && !lookupResult.canAddFolder && lookupResult.mode !== 'personal-drive') {
    startBackground();
    showMessage('NAS Drive', `이 PC는 이미 ${lookupResult.device.deviceName} 이름으로 연결되어 있습니다.`);
    return;
  }
  const isAddingFolder = !!(lookupResult && lookupResult.exists && lookupResult.canAddFolder);
  const isPersonalDrive = lookupResult?.mode === 'personal-drive';
  const accountForSetup = lookupResult.account || {};
  const detectedCloudApps = detectCloudApps();
  const needsSetupWizard = isDownloadedInstaller() || isPersonalDrive;
  const setupOptions = needsSetupWizard
    ? (autoSetup && isPersonalDrive ? {
        accepted: true,
        drivePath: validatePersonalDrivePath(getCommandArgument('--drive-path') || personalDrivePath(accountForSetup)),
        installDir: BRANDED_INSTALL_DIR,
        startWithWindows: true,
        cloudAction: 'coexist'
      } : showRecommendedSetupWizard({
        account: accountForSetup,
        defaultDrivePath: personalDrivePath(accountForSetup),
        detectedCloudApps
      }))
    : {
        accepted: true,
        installDir: getSavedInstallDir(),
        startWithWindows: currentConfig?.settings?.startWithWindows !== false,
        cloudAction: 'coexist'
      };
  if (!setupOptions?.accepted) return;

  if (isDownloadedInstaller()) {
    const requestedInstallDir = setupOptions.installDir || BRANDED_INSTALL_DIR;
    const requestedDrivePath = setupOptions.drivePath || '';
    const safeInstallDir = requestedDrivePath && (
      isSameOrChildLocalPath(requestedDrivePath, requestedInstallDir) ||
      isSameOrChildLocalPath(requestedInstallDir, requestedDrivePath)
    ) ? BRANDED_INSTALL_DIR : requestedInstallDir;
    setInstallDir(safeInstallDir);
    signalExitAndWait();
  }
  if (needsSetupWizard && !autoSetup) {
    writeInstallProgress(5, 'NAS Drive 설치를 시작합니다', '기존 실행 상태를 안전하게 정리했습니다.');
    startInstallProgressWindow();
    setupProgressActive = true;
  }
  writeInstallProgress(15, '프로그램 파일을 준비하는 중', 'Windows 사용자 영역에 NAS Drive를 설치합니다.');
  registerProtocol();
  applyStartupPreference(setupOptions.startWithWindows !== false);
  applyCloudAppChoice(setupOptions.cloudAction, detectedCloudApps);
  writeInstallProgress(32, '계정을 안전하게 연결하는 중', '일회용 연동 정보를 확인하고 있습니다.');

  let deviceName = lookupResult && lookupResult.device && lookupResult.device.deviceName;
  if (isPersonalDrive) deviceName = os.hostname() || 'Windows-PC';
  if (!deviceName) {
    deviceName = promptText(
      'NAS Drive',
      '이 PC에서 표시할 NAS Drive 이름을 입력해 주세요.',
      os.hostname() || 'Windows-PC'
    );
    if (!deviceName) throw new Error('NAS Drive 이름 입력이 취소되었습니다.');
  }

  const selectedFolder = isPersonalDrive ? validatePersonalDrivePath(setupOptions.drivePath || personalDrivePath(accountForSetup)) : selectFolder();
  if (!selectedFolder) return;
  fs.mkdirSync(selectedFolder, { recursive: true });
  const summary = getFolderSummary(selectedFolder);
  if (summary.totalBytes > MAX_TOTAL_BYTES) {
    throw new Error('선택한 폴더가 동기화 가능한 최대 크기(50GB)를 초과했습니다.');
  }
  writeInstallProgress(48, 'NAS Drive 위치를 설정하는 중', selectedFolder);
  const reg = await register(pairingToken, clientDeviceKey, deviceName, selectedFolder, summary);
  const root = {
    syncRootId: reg.syncRoot.syncRootId,
    name: reg.syncRoot.name,
    localPath: selectedFolder,
    linkedNasPath: reg.syncRoot.linkedNasPath,
    kind: reg.syncRoot.kind || (isPersonalDrive ? 'personal-drive' : 'folder-sync')
  };
  const profile = buildRegisteredProfile(currentConfig, reg, lookupResult, deviceName, root);
  const nextConfig = upsertProfile(currentConfig, profile);
  nextConfig.settings = {
    ...(currentConfig?.settings || {}),
    startWithWindows: setupOptions.startWithWindows !== false,
    cloudAppChoice: setupOptions.cloudAction || 'coexist'
  };
  try {
    saveConfig(nextConfig);
  } catch (error) {
    // Registration has already issued a server token. If durable local storage
    // fails, revoke that half-created relationship instead of leaving a device
    // that can only transition from connecting to disconnected.
    await requestJson('POST', '/api/devices/agent/logout', { deviceId: profile.deviceId }, profile.agentToken, 5_000).catch(() => {});
    try { fs.unlinkSync(tokenFileFor(profile.accountKey)); } catch {}
    const rollbackProfiles = getProfiles(currentConfig).filter(item => safeAccountKey(item.accountKey) !== safeAccountKey(profile.accountKey));
    const rollbackConfig = {
      ...(currentConfig || {}),
      schemaVersion: 2,
      profiles: rollbackProfiles,
      activeAccountKey: rollbackProfiles[0]?.accountKey || '',
      savedAt: new Date().toISOString()
    };
    try {
      saveConfig(rollbackConfig);
    } catch {
      writeJson(CONFIG_FILE, {
        ...rollbackConfig,
        profiles: rollbackProfiles.map(item => {
          const saved = { ...item };
          delete saved.agentToken;
          return saved;
        })
      });
    }
    setAgentHealth('needs-relink', '장치 인증 정보를 안전하게 저장하지 못해 연결 생성을 취소했습니다. 다시 로그인해 주세요.');
    throw error;
  }
  setProfileHealth(profile, 'connecting', 'NAS Drive 연결을 마무리하는 중입니다.');
  await sendHeartbeat(profile, 'connecting');
  // Provider/Explorer initialization is recoverable background work. Start the
  // authenticated Agent before it so a provider failure cannot strand pairing.
  restartBackground();
  writeInstallProgress(68, '파일 탐색기에 연결하는 중', '계정별 NAS Drive와 보안 토큰을 등록합니다.');
  if (!isPersonalDrive) await initialSync(root, profile);
  if (isPersonalDrive) {
    try {
      await registerPersonalDrive(profile);
    } catch (error) {
      log('[post-registration provider setup deferred]', profile.accountKey, error.message);
      setProfileHealth(profile, 'connecting', '계정 연결은 완료되었습니다. 파일 탐색기 연결을 백그라운드에서 복구하는 중입니다.');
    }
  }
  writeInstallProgress(88, '백그라운드 동기화를 시작하는 중', '한 번만 실행되는 동기화 프로세스를 준비합니다.');
  if (isPersonalDrive) await openPersonalDrive(profile);
  if (setupProgressActive) {
    writeInstallProgress(100, 'NAS Drive 설치 완료', `${root.name} 드라이브를 파일 탐색기에서 사용할 수 있습니다.`, 'done');
    setupProgressActive = false;
  } else if (!autoSetup) {
    showMessage('NAS Drive', `${isPersonalDrive ? 'NAS Drive 연결 완료' : (isAddingFolder ? '동기화 폴더 추가 완료' : 'PC 연결 완료')}:\n${root.name}`);
  }
}

(async () => {
  try {
    if (process.argv.includes('--login-stdin')) {
      await runLoginFromStdin();
      return;
    }
    if (process.argv.includes('--self-test')) {
      runSelfTest();
      return;
    }
    if (relaunchForegroundHiddenIfNeeded()) return;
    ensureStateDir();
    refreshInstalledBrandAssets();
    if (process.argv.includes('--background')) {
      await runBackground();
      return;
    }
    if (!acquireForegroundLock({ supersedeExisting: true })) {
      showMessage('NAS Drive', '이전 NAS Drive 요청을 정리하는 중입니다. 잠시 후 다시 실행해 주세요.');
      return;
    }
    try {
      if (process.argv.includes('--login-after-delay')) await sleepMs(900);
      await runForeground();
    } finally {
      releaseForegroundLock();
    }
  } catch (err) {
    if (process.argv.includes('--login-stdin')) {
      process.stderr.write(String(err?.message || '로그인하지 못했습니다.'));
      process.exitCode = 1;
      return;
    }
    log(err.stack || err.message);
    if (setupProgressActive) {
      writeInstallProgress(100, '설치를 완료하지 못했습니다', err.message, 'error');
      setupProgressActive = false;
    }
    showMessage('NAS Drive 오류', err.message);
    waitIfConsole();
    process.exitCode = 1;
  }
})();
