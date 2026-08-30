'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const MAX_LOCAL_STATE_BYTES = 8 * 1024 * 1024;
const BROWSER_LABELS = Object.freeze({ chrome: 'Google Chrome', edge: 'Microsoft Edge', system: 'Windows 기본 브라우저' });

function codedError(message, code, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function normalizedStandardRoot(value, kind) {
  const root = path.win32.normalize(String(value || '').trim()).replace(/[\\/]+$/, '');
  if (/^[A-Za-z]:\\Program Files$/i.test(root) && kind === 'program-files') return root;
  if (/^[A-Za-z]:\\Program Files \(x86\)$/i.test(root) && kind === 'program-files-x86') return root;
  if (/^[A-Za-z]:\\Users\\[^\\/:*?"<>|]+\\AppData\\Local$/i.test(root) && kind === 'local-app-data') return root;
  return '';
}

function standardBrowserCandidates(environment = process.env) {
  const programFiles = normalizedStandardRoot(environment.ProgramFiles, 'program-files');
  const programFilesX86 = normalizedStandardRoot(environment['ProgramFiles(x86)'], 'program-files-x86');
  const localAppData = normalizedStandardRoot(environment.LOCALAPPDATA, 'local-app-data');
  const join = (root, ...parts) => root ? path.win32.join(root, ...parts) : '';
  return {
    chrome: [
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ].filter(Boolean),
    edge: [
      join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
    ].filter(Boolean)
  };
}

function standardUserDataRoots(environment = process.env) {
  const localAppData = normalizedStandardRoot(environment.LOCALAPPDATA, 'local-app-data');
  const join = (root, ...parts) => root ? path.win32.join(root, ...parts) : '';
  return {
    chrome: join(localAppData, 'Google', 'Chrome', 'User Data'),
    edge: join(localAppData, 'Microsoft', 'Edge', 'User Data')
  };
}

function canonicalWindowsPath(value) {
  return path.win32.normalize(String(value || '')).replace(/[\\/]+$/, '').toLowerCase();
}

function resolveCandidate(candidate, fileSystem = fs) {
  try {
    if (!fileSystem.statSync(candidate).isFile()) return '';
    const realpath = typeof fileSystem.realpathSync.native === 'function'
      ? fileSystem.realpathSync.native(candidate)
      : fileSystem.realpathSync(candidate);
    if (canonicalWindowsPath(realpath) !== canonicalWindowsPath(candidate)) return '';
    return path.win32.normalize(realpath);
  } catch (_) {
    return '';
  }
}

function resolveBrowser(browserId, { environment = process.env, fileSystem = fs } = {}) {
  const id = String(browserId || '').toLowerCase();
  if (id === 'system') return { id, label: BROWSER_LABELS.system };
  if (!['chrome', 'edge'].includes(id)) throw codedError('선택한 브라우저는 사용할 수 없습니다.', 'WEB_BROWSER_NOT_ALLOWED');
  for (const candidate of standardBrowserCandidates(environment)[id]) {
    const executablePath = resolveCandidate(candidate, fileSystem);
    if (executablePath) return { id, label: BROWSER_LABELS[id], executablePath };
  }
  throw codedError(`${BROWSER_LABELS[id]}이 설치되어 있지 않거나 실행할 수 없습니다.`, 'WEB_BROWSER_UNAVAILABLE');
}

function normalizeProfileDirectory(value) {
  const profileId = String(value || '').trim();
  if (!/^(?:Default|Profile [1-9][0-9]{0,5})$/.test(profileId)) {
    throw codedError('선택한 브라우저 사용자는 사용할 수 없습니다.', 'WEB_BROWSER_PROFILE_NOT_ALLOWED');
  }
  return profileId;
}

function publicProfileText(value, maxLength) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function readBoundedJson(filePath, fileSystem = fs) {
  try {
    const stats = fileSystem.statSync(filePath);
    if (!stats.isFile() || stats.size > MAX_LOCAL_STATE_BYTES) return null;
    const raw = fileSystem.readFileSync(filePath, 'utf8');
    if (Buffer.byteLength(raw, 'utf8') > MAX_LOCAL_STATE_BYTES) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function existingProfileDirectory(userDataRoot, profileId, fileSystem = fs) {
  try {
    const directory = path.win32.join(userDataRoot, profileId);
    if (!fileSystem.statSync(directory).isDirectory()) return false;
    const realpath = typeof fileSystem.realpathSync.native === 'function'
      ? fileSystem.realpathSync.native.bind(fileSystem.realpathSync)
      : fileSystem.realpathSync.bind(fileSystem);
    const rootReal = path.win32.normalize(realpath(userDataRoot));
    const profileReal = path.win32.normalize(realpath(directory));
    const relative = path.win32.relative(rootReal, profileReal);
    return relative === profileId && !path.win32.isAbsolute(relative) && !relative.startsWith(`..${path.win32.sep}`);
  } catch (_) {
    return false;
  }
}

function listBrowserProfiles(browserId, options = {}) {
  const { environment = process.env, fileSystem = fs } = options;
  resolveBrowser(browserId, options);
  const userDataRoot = standardUserDataRoots(environment)[browserId];
  const localState = readBoundedJson(path.win32.join(userDataRoot, 'Local State'), fileSystem);
  const profileState = localState?.profile;
  const infoCache = profileState?.info_cache;
  if (!infoCache || typeof infoCache !== 'object' || Array.isArray(infoCache)) return [];
  let lastUsed = '';
  try { lastUsed = normalizeProfileDirectory(profileState.last_used); } catch (_) {}
  const ordered = [];
  const append = value => {
    try {
      const id = normalizeProfileDirectory(value);
      if (!ordered.includes(id)) ordered.push(id);
    } catch (_) {}
  };
  (Array.isArray(profileState.profiles_order) ? profileState.profiles_order : []).forEach(append);
  (Array.isArray(profileState.last_active_profiles) ? profileState.last_active_profiles : []).forEach(append);
  append(lastUsed);
  Object.keys(infoCache).forEach(append);
  return ordered.flatMap((id, index) => {
    const info = infoCache[id];
    if (!info || typeof info !== 'object' || info.is_omitted_from_profile_list === true) return [];
    if (!existingProfileDirectory(userDataRoot, id, fileSystem)) return [];
    return [{
      id,
      label: publicProfileText(info.name || info.shortcut_name || info.gaia_name, 80) || `${BROWSER_LABELS[browserId]} 사용자 ${index + 1}`,
      account: publicProfileText(info.user_name, 320),
      isLastUsed: id === lastUsed
    }];
  });
}

function profileToken(secret, browserId, profileDirectory) {
  const key = Buffer.isBuffer(secret) ? secret : Buffer.from(secret || '');
  if (key.length < 32) throw new TypeError('A 32-byte browser profile token secret is required.');
  return crypto.createHmac('sha256', key)
    .update(String(browserId || ''))
    .update('\0')
    .update(String(profileDirectory || ''))
    .digest('base64url');
}

function listPublicBrowserChoices(options = {}, secret = crypto.randomBytes(32)) {
  const choices = [];
  for (const browserId of ['chrome', 'edge']) {
    try {
      const browser = resolveBrowser(browserId, options);
      const profiles = listBrowserProfiles(browserId, options).map(profile => ({
        token: profileToken(secret, browserId, profile.id),
        label: profile.label,
        account: profile.account,
        isLastUsed: profile.isLastUsed
      }));
      choices.push({ id: browser.id, label: browser.label, profiles });
    } catch (error) {
      if (error.code !== 'WEB_BROWSER_UNAVAILABLE') throw error;
    }
  }
  choices.push({ id: 'system', label: BROWSER_LABELS.system, profiles: [] });
  return choices;
}

function resolvePublicSelection(selection, options, secret) {
  const browser = resolveBrowser(selection?.browserId, options);
  if (browser.id === 'system') {
    if (selection?.profileToken) throw codedError('기본 브라우저에는 사용자를 지정할 수 없습니다.', 'WEB_BROWSER_PROFILE_NOT_ALLOWED');
    return browser;
  }
  const token = String(selection?.profileToken || '');
  if (!token) return browser;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw codedError('선택한 브라우저 사용자는 사용할 수 없습니다.', 'WEB_BROWSER_PROFILE_NOT_ALLOWED');
  const profile = listBrowserProfiles(browser.id, options).find(candidate => {
    const expected = profileToken(secret, browser.id, candidate.id);
    return token.length === expected.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  });
  if (!profile) throw codedError('선택한 브라우저 사용자를 더 이상 찾을 수 없습니다.', 'WEB_BROWSER_PROFILE_UNAVAILABLE');
  return { ...browser, profileDirectory: profile.id };
}

function resolveDirectSelection(browserId, profileDirectory = '', options = {}) {
  const browser = resolveBrowser(browserId, options);
  if (browser.id === 'system') {
    if (profileDirectory) throw codedError('기본 브라우저에는 사용자를 지정할 수 없습니다.', 'WEB_BROWSER_PROFILE_NOT_ALLOWED');
    return browser;
  }
  if (!profileDirectory) return browser;
  const normalized = normalizeProfileDirectory(profileDirectory);
  const profile = listBrowserProfiles(browser.id, options).find(candidate => candidate.id === normalized);
  if (!profile) throw codedError('선택한 브라우저 사용자를 더 이상 찾을 수 없습니다.', 'WEB_BROWSER_PROFILE_UNAVAILABLE');
  return { ...browser, profileDirectory: profile.id };
}

const PICKER_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$raw = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:NAS_DRIVE_BROWSER_CHOICES))
$choices = @(ConvertFrom-Json $raw)
$form = New-Object System.Windows.Forms.Form
$form.Text = 'NAS 웹에서 열기'
$form.ClientSize = New-Object System.Drawing.Size(610, 430)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$title = New-Object System.Windows.Forms.Label
$title.Text = '웹 브라우저와 사용자를 선택하세요'
$title.Location = New-Object System.Drawing.Point(24, 22)
$title.Size = New-Object System.Drawing.Size(560, 34)
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 15)
$info = New-Object System.Windows.Forms.Label
$info.Text = '선택한 브라우저에서 현재 NAS Drive 계정으로 자동 로그인합니다.'
$info.Location = New-Object System.Drawing.Point(26, 62)
$info.Size = New-Object System.Drawing.Size(555, 24)
$info.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
$browserLabel = New-Object System.Windows.Forms.Label
$browserLabel.Text = '브라우저'
$browserLabel.Location = New-Object System.Drawing.Point(26, 102)
$browserLabel.Size = New-Object System.Drawing.Size(120, 22)
$browser = New-Object System.Windows.Forms.ComboBox
$browser.Location = New-Object System.Drawing.Point(26, 127)
$browser.Size = New-Object System.Drawing.Size(555, 30)
$browser.DropDownStyle = 'DropDownList'
foreach ($choice in $choices) { [void]$browser.Items.Add($choice.label) }
$profileLabel = New-Object System.Windows.Forms.Label
$profileLabel.Text = 'Chrome / Edge 사용자 프로필'
$profileLabel.Location = New-Object System.Drawing.Point(26, 174)
$profileLabel.Size = New-Object System.Drawing.Size(300, 22)
$profiles = New-Object System.Windows.Forms.ListBox
$profiles.Location = New-Object System.Drawing.Point(26, 199)
$profiles.Size = New-Object System.Drawing.Size(555, 132)
$profiles.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$hint = New-Object System.Windows.Forms.Label
$hint.Text = '표시된 이메일은 프로필의 대표 계정입니다. NAS 비밀번호나 Chrome 쿠키는 읽지 않습니다.'
$hint.Location = New-Object System.Drawing.Point(27, 338)
$hint.Size = New-Object System.Drawing.Size(555, 38)
$hint.ForeColor = [System.Drawing.Color]::DimGray
$open = New-Object System.Windows.Forms.Button
$open.Text = '선택한 브라우저로 열기'
$open.Location = New-Object System.Drawing.Point(378, 382)
$open.Size = New-Object System.Drawing.Size(203, 36)
$open.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 9.5)
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = '취소'
$cancel.Location = New-Object System.Drawing.Point(272, 382)
$cancel.Size = New-Object System.Drawing.Size(96, 36)
$refresh = {
  $profiles.Items.Clear()
  $choice = $choices[$browser.SelectedIndex]
  if ($choice.id -eq 'system') {
    [void]$profiles.Items.Add('Windows에서 설정된 기본 브라우저')
    $profiles.Enabled = $false
    $profiles.SelectedIndex = 0
    return
  }
  $profiles.Enabled = $true
  foreach ($profile in @($choice.profiles)) {
    $text = $profile.label
    if ($profile.account) { $text += '  ·  ' + $profile.account }
    if ($profile.isLastUsed) { $text += '  (최근 사용)' }
    [void]$profiles.Items.Add($text)
  }
  if ($profiles.Items.Count -eq 0) { [void]$profiles.Items.Add('브라우저 기본 사용자') }
  $recentIndex = 0
  for ($i = 0; $i -lt @($choice.profiles).Count; $i++) { if ($choice.profiles[$i].isLastUsed) { $recentIndex = $i; break } }
  $profiles.SelectedIndex = $recentIndex
}
$browser.Add_SelectedIndexChanged($refresh)
$open.Add_Click({
  $choice = $choices[$browser.SelectedIndex]
  $profileToken = ''
  if ($choice.id -ne 'system' -and @($choice.profiles).Count -gt 0 -and $profiles.SelectedIndex -ge 0) {
    $profileToken = $choice.profiles[$profiles.SelectedIndex].token
  }
  $form.Tag = $choice.id + '|' + $profileToken
  $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $form.Close()
})
$cancel.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::Cancel; $form.Close() })
$form.AcceptButton = $open
$form.CancelButton = $cancel
$form.Controls.AddRange(@($title, $info, $browserLabel, $browser, $profileLabel, $profiles, $hint, $open, $cancel))
$defaultIndex = 0
for ($i = 0; $i -lt $choices.Count; $i++) { if ($choices[$i].id -eq 'chrome') { $defaultIndex = $i; break } }
$browser.SelectedIndex = $defaultIndex
$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK -or -not $form.Tag) { exit 2 }
[Console]::Write([string]$form.Tag)
`;

function chooseWebBrowser(options = {}) {
  const secret = crypto.randomBytes(32);
  const choices = listPublicBrowserChoices(options, secret);
  const encoded = Buffer.from(JSON.stringify(choices), 'utf8').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-STA', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PICKER_SCRIPT], {
    windowsHide: true,
    encoding: 'utf8',
    env: { ...process.env, NAS_DRIVE_BROWSER_CHOICES: encoded }
  });
  if (result.status === 2) throw codedError('브라우저 선택이 취소되었습니다.', 'WEB_BROWSER_SELECTION_CANCELLED');
  if (result.status !== 0) throw codedError('브라우저 선택 창을 열지 못했습니다.', 'WEB_BROWSER_PICKER_FAILED');
  const [browserId, profileTokenValue = ''] = String(result.stdout || '').trim().split('|', 2);
  return resolvePublicSelection({ browserId, profileToken: profileTokenValue }, options, secret);
}

function launchSelectedBrowser(browser, url) {
  if (browser.id === 'system') {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const args = [];
  if (browser.profileDirectory) args.push(`--profile-directory=${browser.profileDirectory}`, '--ignore-profile-directory-if-not-exists');
  args.push(url);
  const child = spawn(browser.executablePath, args, { shell: false, windowsHide: true, detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

module.exports = {
  standardBrowserCandidates,
  standardUserDataRoots,
  resolveBrowser,
  normalizeProfileDirectory,
  listBrowserProfiles,
  profileToken,
  listPublicBrowserChoices,
  resolvePublicSelection,
  resolveDirectSelection,
  chooseWebBrowser,
  launchSelectedBrowser
};
