#!/usr/bin/env node
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const SERVER_BASE = 'https://filemanager-nas.com';
const MAX_FILE_BYTES = 90 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024 * 1024;
const PULL_INTERVAL_MS = 10_000;
const STATE_DIR = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'NAS-Sync-Agent');
const CONFIG_FILE = path.join(STATE_DIR, 'agent-config.json');
const DEVICE_KEY_FILE = path.join(STATE_DIR, 'device-key.txt');
const INSTALLED_EXE = path.join(STATE_DIR, 'NAS-Sync-Agent.exe');
const STATE_PREFIX = 'state_';

let applyingRemoteChange = false;

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
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

function installSelf() {
  ensureStateDir();
  const current = path.resolve(process.execPath);
  const target = path.resolve(INSTALLED_EXE);
  try {
    if (current.toLowerCase() !== target.toLowerCase()) {
      fs.copyFileSync(current, target);
    }
  } catch (err) {
    log('[install self failed]', err.message);
    return current;
  }
  return fs.existsSync(target) ? target : current;
}

function log(...args) {
  console.log(...args);
}

function showMessage(title, message) {
  const safeTitle = String(title || 'NAS Sync Agent').replace(/'/g, "''");
  const safeMessage = String(message || '').replace(/'/g, "''");
  spawn('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-Command',
    `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${safeMessage}', '${safeTitle}') | Out-Null`
  ], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
}

function waitIfConsole() {
  if (process.argv.includes('--no-pause') || process.argv.includes('--background')) return;
  try {
    fs.writeSync(1, '\nPress Enter to close.\n');
    fs.readSync(0, Buffer.alloc(1), 0, 1);
  } catch {}
}

function request(method, urlPath, { headers = {}, body = null } = {}) {
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
    if (body) req.write(body);
    req.end();
  });
}

function requestJson(method, urlPath, payload, agentToken) {
  const body = JSON.stringify(payload || {});
  const headers = {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  };
  if (agentToken) headers['x-agent-token'] = agentToken;
  return request(method, urlPath, { headers, body });
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
        else resolve(text);
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

function tokenFromUrl(urlText) {
  try {
    const url = new URL(urlText);
    return url.searchParams.get('token') || '';
  } catch {
    const match = String(urlText).match(/[?&]token=([^&]+)/);
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

function selectFolder() {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$d.Description = "Select a folder to sync with NAS."',
    '$d.ShowNewFolderButton = $false',
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8; Write-Output $d.SelectedPath }'
  ].join('; ');
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: false });
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
  return readJson(CONFIG_FILE, null);
}

function saveConfig(config) {
  writeJson(CONFIG_FILE, config);
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
  const psExe = exe.replace(/'/g, "''");
  const command = `powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '${psExe}' -ArgumentList @('%1') -WindowStyle Hidden"`;
  spawnSync('reg.exe', ['add', 'HKCU\\Software\\Classes\\nas-sync', '/ve', '/d', 'URL:NAS Sync Agent', '/f'], { windowsHide: true });
  spawnSync('reg.exe', ['add', 'HKCU\\Software\\Classes\\nas-sync', '/v', 'URL Protocol', '/d', '', '/f'], { windowsHide: true });
  spawnSync('reg.exe', ['add', 'HKCU\\Software\\Classes\\nas-sync\\shell\\open\\command', '/ve', '/d', command, '/f'], { windowsHide: true });
}

function registerStartup() {
  const exe = installSelf();
  const psExe = exe.replace(/'/g, "''");
  const command = `powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '${psExe}' -ArgumentList '--background' -WindowStyle Hidden"`;
  spawnSync('reg.exe', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'NAS Sync Agent', '/d', command, '/f'], { windowsHide: true });
}

function startBackground() {
  const exe = installSelf();
  spawn(exe, ['--background'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
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

async function syncFolder(root, dir, config) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  const rel = relPath(root.localPath, dir);
  if (!rel) return;
  await requestJson('POST', '/api/devices/agent/sync-folder', { deviceId: config.deviceId, syncRootId: root.syncRootId, relPath: rel }, config.agentToken);
}

async function syncDelete(root, target, config) {
  const rel = relPath(root.localPath, target);
  if (!rel) return;
  await requestJson('POST', '/api/devices/agent/sync-delete', { deviceId: config.deviceId, syncRootId: root.syncRootId, relPath: rel }, config.agentToken);
}

async function syncFile(root, file, config) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE_BYTES) return;
  await multipartUpload('/api/devices/agent/sync-file', {
    deviceId: config.deviceId,
    syncRootId: root.syncRootId,
    relPath: relPath(root.localPath, file)
  }, file, config.agentToken);
}

async function initialSync(root, config) {
  const walk = async (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      try {
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

function moveToTrash(root, target) {
  if (!fs.existsSync(target)) return;
  const rel = relPath(root.localPath, target);
  if (!rel) return;
  const trash = path.join(STATE_DIR, 'trash', String(root.syncRootId), new Date().toISOString().replace(/[:.]/g, '-'), rel);
  fs.mkdirSync(path.dirname(trash), { recursive: true });
  fs.renameSync(target, trash);
}

async function pullNasChanges(root, config) {
  const manifest = await request('GET', `/api/devices/agent/manifest?deviceId=${encodeURIComponent(config.deviceId)}&syncRootId=${encodeURIComponent(root.syncRootId)}`, {
    headers: { 'x-agent-token': config.agentToken }
  });
  const previous = readJson(stateFile(root), { remotePaths: [] });
  const remotePaths = new Map();
  for (const entry of manifest.entries || []) {
    remotePaths.set(entry.relPath, entry);
  }
  applyingRemoteChange = true;
  try {
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
    writeJson(stateFile(root), { remotePaths: Array.from(remotePaths.keys()), savedAt: new Date().toISOString() });
  } finally {
    applyingRemoteChange = false;
  }
}

function debounce(fn, delay = 700) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args).catch(err => log('[event failed]', err.message)), delay);
  };
}

function watchRoot(root, config) {
  const handle = debounce(async (_event, fileName) => {
    if (applyingRemoteChange || !fileName) return;
    const full = path.join(root.localPath, fileName.toString());
    if (fs.existsSync(full)) {
      const stat = fs.statSync(full);
      if (stat.isDirectory()) await syncFolder(root, full, config);
      else if (stat.isFile()) await syncFile(root, full, config);
    } else {
      await syncDelete(root, full, config);
    }
  });
  return fs.watch(root.localPath, { recursive: true }, handle);
}

async function runBackground() {
  const config = loadConfig();
  if (!config || !config.deviceId || !config.agentToken) return;
  const roots = getRoots(config).filter(root => root.localPath && fs.existsSync(root.localPath));
  for (const root of roots) {
    await pullNasChanges(root, config).catch(err => log('[pull failed]', err.message));
    watchRoot(root, config);
  }
  setInterval(() => {
    for (const root of roots) pullNasChanges(root, config).catch(err => log('[pull failed]', err.message));
  }, PULL_INTERVAL_MS);
}

async function runForeground() {
  registerProtocol();
  registerStartup();
  const pairingToken = getPairingToken();
  if (!pairingToken) {
    showMessage('NAS Sync Agent', 'Pairing token was not found.');
    return;
  }
  const config = loadConfig();
  const clientDeviceKey = getDeviceKey();
  const lookupResult = await lookup(pairingToken, clientDeviceKey).catch(() => null);
  if (lookupResult && lookupResult.exists && !lookupResult.canAddFolder) {
    startBackground();
    showMessage('NAS Sync Agent', `This PC is already linked as ${lookupResult.device.deviceName}.\nOpen the linked PC folder in NAS to add another sync folder.`);
    return;
  }
  const selectedFolder = selectFolder();
  if (!selectedFolder) return;
  const summary = getFolderSummary(selectedFolder);
  if (summary.totalBytes > MAX_TOTAL_BYTES) {
    showMessage('NAS Sync Agent', 'The selected folder exceeds the 50GB sync limit.');
    return;
  }
  const deviceName = (lookupResult && lookupResult.device && lookupResult.device.deviceName) || os.hostname() || 'Windows-PC';
  const reg = await register(pairingToken, clientDeviceKey, deviceName, selectedFolder, summary);
  const root = {
    syncRootId: reg.syncRoot.syncRootId,
    name: reg.syncRoot.name,
    localPath: selectedFolder,
    linkedNasPath: reg.syncRoot.linkedNasPath
  };
  const nextConfig = {
    serverBase: SERVER_BASE,
    deviceId: reg.device.deviceId,
    agentToken: reg.agentToken,
    deviceName,
    syncRoots: mergeRoot(config, root),
    savedAt: new Date().toISOString()
  };
  saveConfig(nextConfig);
  await initialSync(root, nextConfig);
  startBackground();
  showMessage('NAS Sync Agent', `Sync folder connected:\n${root.linkedNasPath}`);
}

(async () => {
  try {
    ensureStateDir();
    if (process.argv.includes('--background')) {
      await runBackground();
      return;
    }
    await runForeground();
  } catch (err) {
    log(err.stack || err.message);
    showMessage('NAS Sync Agent Error', err.message);
    waitIfConsole();
    process.exitCode = 1;
  }
})();
