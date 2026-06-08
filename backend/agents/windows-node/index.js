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
const INSTALL_DIR_FILE = path.join(STATE_DIR, 'install-dir.txt');
const DEFAULT_INSTALL_DIR = STATE_DIR;
const PID_FILE = path.join(STATE_DIR, 'agent.pid');
const EXIT_FILE = path.join(STATE_DIR, 'agent.exit');
const TRAY_SCRIPT_FILE = path.join(STATE_DIR, 'tray.ps1');
const STATE_PREFIX = 'state_';

let applyingRemoteChange = false;
let INSTALLED_EXE = path.join(DEFAULT_INSTALL_DIR, 'NAS-Sync-Agent.exe');

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

function getSavedInstallDir() {
  try {
    const saved = fs.readFileSync(INSTALL_DIR_FILE, 'utf8').trim();
    if (saved) return saved;
  } catch {}
  return DEFAULT_INSTALL_DIR;
}

function setInstallDir(dir) {
  const nextDir = path.resolve(dir || DEFAULT_INSTALL_DIR);
  ensureStateDir();
  fs.writeFileSync(INSTALL_DIR_FILE, nextDir, 'utf8');
  INSTALLED_EXE = path.join(nextDir, 'NAS-Sync-Agent.exe');
  return nextDir;
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
  if (force) stopInstalledAgentProcesses();
}

function installSelf() {
  ensureStateDir();
  const current = path.resolve(process.execPath);
  const target = path.resolve(INSTALLED_EXE);
  if (current.toLowerCase() === target.toLowerCase()) return target;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(current, target);
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

function isDownloadedInstaller() {
  const current = path.resolve(process.execPath).toLowerCase();
  const target = path.resolve(INSTALLED_EXE).toLowerCase();
  return current !== target;
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
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: false });
  const selected = (ps.stdout || '').trim();
  return selected || currentDir;
}

function createDesktopShortcut(exePath) {
  const safeExe = path.resolve(exePath || INSTALLED_EXE);
  const psScript = `
$exe = ${JSON.stringify(safeExe)}
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "NAS Sync Agent.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = Split-Path $exe
$shortcut.IconLocation = $exe
$shortcut.Description = "NAS Sync Agent"
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
$shortcutPath = Join-Path $desktop "NAS Sync Agent.lnk"
try { if (Test-Path $shortcutPath) { Remove-Item $shortcutPath -Force } } catch {}
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
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { encoding: 'utf8', windowsHide: false });
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
  spawnSync('reg.exe', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'NAS Sync Agent', '/f'], { windowsHide: true });
}

function uninstallAgent() {
  signalExitAndWait();
  unregisterStartup();
  unregisterProtocol();
  removeDesktopShortcut();
  for (const file of [PID_FILE, EXIT_FILE, TRAY_SCRIPT_FILE, INSTALLED_EXE]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
  }
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

function promptText(title, message, defaultValue) {
  const script = [
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8',
    `$value = [Microsoft.VisualBasic.Interaction]::InputBox(${JSON.stringify(message)}, ${JSON.stringify(title)}, ${JSON.stringify(defaultValue || '')})`,
    'Write-Output $value'
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
  const previousPid = Number(fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf8') : 0);
  if (isProcessAlive(previousPid)) return;
  spawn(exe, ['--background'], { detached: true, windowsHide: true, stdio: 'ignore' }).unref();
}

function writeTrayScript(config) {
  const configPath = CONFIG_FILE.replace(/'/g, "''");
  const exitPath = EXIT_FILE.replace(/'/g, "''");
  const serverBase = SERVER_BASE.replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$configPath = '${configPath}'
$exitPath = '${exitPath}'
$serverBase = '${serverBase}'

function Read-AgentConfig {
  try {
    if (Test-Path $configPath) {
      return Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
  } catch {}
  return $null
}

function Get-StatusText {
  $config = Read-AgentConfig
  if ($null -eq $config) { return "NAS Sync Agent is not linked yet." }
  $roots = @($config.syncRoots)
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("Status: running")
  $lines.Add("PC folder: " + $config.deviceName)
  $lines.Add("Server: " + $config.serverBase)
  $lines.Add("")
  $lines.Add("Linked folders:")
  if ($roots.Count -eq 0) {
    $lines.Add("- none")
  } else {
    foreach ($root in $roots) {
      $lines.Add("- " + $root.name + "  ->  " + $root.localPath)
    }
  }
  return ($lines -join [Environment]::NewLine)
}

function Show-AgentWindow {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = "NAS Sync Agent"
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
  $openButton.Text = "Open NAS Web"
  $openButton.Location = New-Object System.Drawing.Point(18, 270)
  $openButton.Size = New-Object System.Drawing.Size(130, 34)
  $openButton.Add_Click({ Start-Process $serverBase })

  $closeButton = New-Object System.Windows.Forms.Button
  $closeButton.Text = "Hide"
  $closeButton.Location = New-Object System.Drawing.Point(362, 270)
  $closeButton.Size = New-Object System.Drawing.Size(126, 34)
  $closeButton.Add_Click({ $form.Close() })

  $form.Controls.Add($label)
  $form.Controls.Add($openButton)
  $form.Controls.Add($closeButton)
  $form.ShowDialog() | Out-Null
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Application
$notify.Text = "NAS Sync Agent"
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Open Agent Window")
$webItem = $menu.Items.Add("Open NAS Web")
$menu.Items.Add("-") | Out-Null
$exitItem = $menu.Items.Add("Exit")

$openItem.Add_Click({ Show-AgentWindow })
$webItem.Add_Click({ Start-Process $serverBase })
$exitItem.Add_Click({
  try { New-Item -Path $exitPath -ItemType File -Force | Out-Null } catch {}
  $notify.Visible = $false
  $notify.Dispose()
  [System.Windows.Forms.Application]::Exit()
})
$notify.Add_DoubleClick({ Show-AgentWindow })
$notify.ContextMenuStrip = $menu

[System.Windows.Forms.Application]::Run()
`;
  fs.writeFileSync(TRAY_SCRIPT_FILE, script.trimStart(), 'utf8');
  return TRAY_SCRIPT_FILE;
}

function startTray(config) {
  const script = writeTrayScript(config);
  spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore'
  }).unref();
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
  ensureStateDir();
  const previousPid = Number(fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf8') : 0);
  if (isProcessAlive(previousPid)) return;
  fs.writeFileSync(PID_FILE, String(process.pid), 'utf8');
  try { fs.unlinkSync(EXIT_FILE); } catch {}
  const config = loadConfig();
  const trayConfig = config || {
    serverBase: SERVER_BASE,
    deviceName: os.hostname() || 'This PC',
    syncRoots: []
  };
  startTray(trayConfig);

  if (!config || !config.deviceId || !config.agentToken) {
    setInterval(() => {
      if (fs.existsSync(EXIT_FILE)) {
        try { fs.unlinkSync(PID_FILE); } catch {}
        process.exit(0);
      }
    }, PULL_INTERVAL_MS);
    return;
  }

  const roots = getRoots(config).filter(root => root.localPath && fs.existsSync(root.localPath));
  for (const root of roots) {
    await pullNasChanges(root, config).catch(err => log('[pull failed]', err.message));
    watchRoot(root, config);
  }
  setInterval(() => {
    if (fs.existsSync(EXIT_FILE)) {
      try { fs.unlinkSync(PID_FILE); } catch {}
      process.exit(0);
    }
    for (const root of roots) pullNasChanges(root, config).catch(err => log('[pull failed]', err.message));
  }, PULL_INTERVAL_MS);
}

async function runForeground() {
  const protocolAction = getProtocolAction();
  if (protocolAction === 'open') {
    registerProtocol();
    registerStartup();
    startBackground();
    showMessage('NAS Sync Agent', 'NAS Sync Agent is running in the system tray.');
    return;
  }

  if (isDownloadedInstaller()) {
    const installDir = selectInstallDir();
    setInstallDir(installDir);
    signalExitAndWait();
    showMessage('NAS Sync Agent', `Installing NAS Sync Agent to:\n${installDir}\n\nAny old background agent will be replaced.`);
  }
  registerProtocol();
  registerStartup();
  const pairingToken = getPairingToken();
  if (!pairingToken) {
    startBackground();
    showMessage('NAS Sync Agent', 'NAS Sync Agent is running in the system tray.');
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
  const isAddingFolder = !!(lookupResult && lookupResult.exists && lookupResult.canAddFolder);
  let deviceName = lookupResult && lookupResult.device && lookupResult.device.deviceName;
  if (!deviceName) {
    deviceName = promptText(
      'NAS Sync Agent',
      'Enter the NAS root folder name for this PC.',
      os.hostname() || 'Windows-PC'
    );
    if (!deviceName) return;
  }

  const selectedFolder = selectFolder();
  if (!selectedFolder) return;
  const summary = getFolderSummary(selectedFolder);
  if (summary.totalBytes > MAX_TOTAL_BYTES) {
    showMessage('NAS Sync Agent', 'The selected folder exceeds the 50GB sync limit.');
    return;
  }
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
  showMessage('NAS Sync Agent', `${isAddingFolder ? 'Sync folder added' : 'PC linked'}:\n${root.linkedNasPath}`);
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
