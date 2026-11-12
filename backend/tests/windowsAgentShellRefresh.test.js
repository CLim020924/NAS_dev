'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const nodeSource = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows-node', 'index.js'), 'utf8');
const providerSource = fs.readFileSync(path.join(__dirname, '..', 'agents', 'windows-cfapi', 'Program.cs'), 'utf8');

const refreshStart = nodeSource.indexOf('function refreshPersonalDriveShell');
const refreshEnd = nodeSource.indexOf('function setPersonalDriveWebShortcut', refreshStart);
const refreshSource = nodeSource.slice(refreshStart, refreshEnd);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
assert.ok(!refreshSource.includes('0x08000000'), 'routine status refresh must not broadcast SHCNE_ASSOCCHANGED');
assert.ok(!refreshSource.includes('ie4uinit.exe'), 'routine status refresh must not flush the global icon cache');
assert.ok(!refreshSource.includes('Start-Sleep'), 'routine status refresh must not repeat after a delayed desktop repaint');

const setStatusStart = providerSource.indexOf('private static unsafe int SetStatus');
const setStatusEnd = providerSource.indexOf('private static string StatusIconPath', setStatusStart);
const setStatusSource = providerSource.slice(setStatusStart, setStatusEnd);
assert.ok(setStatusStart >= 0 && setStatusEnd > setStatusStart);
assert.ok(!setStatusSource.includes('ShcneAssocChanged'), 'provider status changes must target only the NAS Drive root');
assert.ok(setStatusSource.includes('ShcneUpdateDir'));

const configureStart = providerSource.indexOf('private static unsafe int ConfigureExplorerViewCore');
const configureEnd = providerSource.indexOf('private static void ReleaseComObject', configureStart);
const configureSource = providerSource.slice(configureStart, configureEnd);
assert.ok(configureStart >= 0 && configureEnd > configureStart);
assert.ok(!configureSource.includes('InvokeMember("Refresh"'), 'status-column maintenance must not force Explorer window refreshes');

assert.ok(nodeSource.includes("credentialProtocol: 'rotating-v1'"));
assert.ok(nodeSource.match(/devices\/agent\/register[\s\S]{0,500}credentialProtocol: 'rotating-v1'/));
assert.ok(nodeSource.includes('EXPLORER_VIEW_REFRESH_INTERVAL_MS = 60_000'));
assert.ok(nodeSource.includes('protectAgentToken(rotatedToken, profile.accountKey)'));
assert.ok(nodeSource.includes('agentHealthSignature === signature'));

console.log('windows agent shell refresh contract tests passed');
