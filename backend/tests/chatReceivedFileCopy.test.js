const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyReceivedBundleEntries } = require('../chatReceivedFileCopy');
const { isExpiredPendingBundle, cleanupExpiredPendingBundles, PENDING_TTL_MS } = require('../chatAttachmentStore');
const {
  cleanupExpiredReceivedFiles,
  cleanupExpiredSentAttachmentBundles,
  runMessageRetentionCleanup,
  MESSAGE_RETENTION_MS,
  RECEIVED_FILE_RETENTION_MS,
  ATTACHMENT_RETENTION_MS,
} = require('../chatRetentionEngine');

test('received files copy once and repeated save remains idempotent without quota charge', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-chat-copy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'bundle');
  const receivedDir = path.join(root, 'received');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'sample.txt'), 'test');
  let charged = 0;
  const options = { bundleDirs: [source], receivedDir, requestRoot: '/users/master/받은 파일', beforeCopy: () => { charged += 1; } };
  const first = copyReceivedBundleEntries(options);
  assert.equal(first.alreadySaved, false);
  assert.equal(first.savedEntries[0].relativePath, '/users/master/받은 파일/sample.txt');
  const again = copyReceivedBundleEntries({ ...options, existingEntries: first.savedEntries });
  assert.equal(again.alreadySaved, true);
  assert.equal(charged, 1);
  assert.deepEqual(fs.readdirSync(receivedDir), ['sample.txt']);
  fs.rmSync(source, { recursive: true });
  assert.equal(copyReceivedBundleEntries({ ...options, existingEntries: first.savedEntries }).alreadySaved, true);
});

test('quota rejection and missing source leave received folder unchanged', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-chat-reject-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'bundle');
  const receivedDir = path.join(root, 'received');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'sample.txt'), 'test');
  const options = { bundleDirs: [source], receivedDir, requestRoot: '/받은 파일' };
  assert.throws(() => copyReceivedBundleEntries({ ...options, beforeCopy: () => { throw new Error('QUOTA'); } }), /QUOTA/);
  assert.equal(fs.existsSync(receivedDir), false);
  assert.throws(() => copyReceivedBundleEntries({ ...options, bundleDirs: [source, path.join(root, 'missing')] }), /ATTACHMENT_SOURCE_MISSING/);
  assert.equal(fs.existsSync(receivedDir), false);
});

test('redownload replaces only missing entries and preserves remaining copies', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-chat-partial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'bundle');
  const receivedDir = path.join(root, 'received');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'a.txt'), 'a');
  fs.writeFileSync(path.join(source, 'b.txt'), 'b');
  const options = { bundleDirs: [source], receivedDir, requestRoot: '/받은 파일' };
  const first = copyReceivedBundleEntries(options);
  const preserved = first.savedEntries.find((entry) => entry.name === 'a.txt');
  fs.rmSync(path.join(receivedDir, 'b.txt'));
  let chargedSources = [];
  const second = copyReceivedBundleEntries({
    ...options,
    existingEntries: first.savedEntries,
    beforeCopy: (missing) => { chargedSources = missing.map((item) => item.name); },
  });
  assert.equal(second.alreadySaved, false);
  assert.deepEqual(chargedSources, ['b.txt']);
  assert.deepEqual(second.savedEntries.find((entry) => entry.name === 'a.txt'), preserved);
  assert.deepEqual(fs.readdirSync(receivedDir).sort(), ['a.txt', 'b.txt']);
});

test('two bundles with matching names retain both copies and nested folders', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-chat-collision-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const firstBundle = path.join(root, 'bundle1');
  const secondBundle = path.join(root, 'bundle2');
  const receivedDir = path.join(root, 'received');
  fs.mkdirSync(path.join(firstBundle, 'project'), { recursive: true });
  fs.mkdirSync(secondBundle);
  fs.writeFileSync(path.join(firstBundle, 'project', 'note.txt'), 'nested');
  fs.writeFileSync(path.join(firstBundle, 'same.txt'), 'first');
  fs.writeFileSync(path.join(secondBundle, 'same.txt'), 'second');
  const result = copyReceivedBundleEntries({ bundleDirs: [firstBundle, secondBundle], receivedDir, requestRoot: '/받은 파일' });
  assert.equal(result.savedEntries.length, 3);
  assert.equal(fs.readFileSync(path.join(receivedDir, 'project', 'note.txt'), 'utf8'), 'nested');
  assert.equal(fs.readFileSync(path.join(receivedDir, 'same.txt'), 'utf8'), 'first');
  assert.equal(fs.readFileSync(path.join(receivedDir, 'same (1).txt'), 'utf8'), 'second');
});

test('pending attachments expire at 24 hours but sent bundles do not', () => {
  const now = Date.parse('2026-09-20T00:00:00Z');
  const older = new Date(now - PENDING_TTL_MS).toISOString();
  const newer = new Date(now - PENDING_TTL_MS + 1000).toISOString();
  assert.equal(isExpiredPendingBundle({ status: 'pending', createdAt: older }, now), true);
  assert.equal(isExpiredPendingBundle({ status: 'canceled', createdAt: older }, now), true);
  assert.equal(isExpiredPendingBundle({ status: 'pending', createdAt: newer }, now), false);
  assert.equal(isExpiredPendingBundle({ status: 'sent', createdAt: older }, now), false);
});

test('scheduled pending cleanup removes only expired temporary bundles', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-chat-pending-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataFile = path.join(root, 'bundles.json');
  const tempRoot = path.join(root, 'chat_tmp');
  const now = Date.parse('2026-09-20T00:00:00Z');
  fs.mkdirSync(path.join(tempRoot, 'cab_old'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'cab_new'), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify([
    { bundleId: 'cab_old', status: 'pending', createdAt: new Date(now - PENDING_TTL_MS).toISOString() },
    { bundleId: 'cab_new', status: 'pending', createdAt: new Date(now - PENDING_TTL_MS + 1000).toISOString() },
  ]));
  const result = cleanupExpiredPendingBundles({ atMs: now, dataFile, tempRoot });
  assert.equal(result.removedCount, 1);
  assert.equal(fs.existsSync(path.join(tempRoot, 'cab_old')), false);
  assert.equal(fs.existsSync(path.join(tempRoot, 'cab_new')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8')).map((item) => item.bundleId), ['cab_new']);
});

test('received cleanup keeps files younger than 30 days and removes expired files', (t) => {
  const receivedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-chat-retention-'));
  t.after(() => fs.rmSync(receivedRoot, { recursive: true, force: true }));
  const oldFile = path.join(receivedRoot, 'old.txt');
  const freshFile = path.join(receivedRoot, 'fresh.txt');
  fs.writeFileSync(oldFile, 'old');
  fs.writeFileSync(freshFile, 'new');
  const now = Date.parse('2026-09-20T00:00:00Z');
  fs.utimesSync(oldFile, new Date(now - RECEIVED_FILE_RETENTION_MS - 1000), new Date(now - RECEIVED_FILE_RETENTION_MS - 1000));
  fs.utimesSync(freshFile, new Date(now - RECEIVED_FILE_RETENTION_MS + 1000), new Date(now - RECEIVED_FILE_RETENTION_MS + 1000));
  const result = cleanupExpiredReceivedFiles({ nowMs: now, receivedRoots: [receivedRoot] });
  assert.equal(result.removedCount, 1);
  assert.equal(fs.existsSync(oldFile), false);
  assert.equal(fs.existsSync(freshFile), true);
});

test('sent attachment cleanup waits 30 days and removes only its own bundle', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-chat-sent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataFile = path.join(root, 'bundles.json');
  const tempRoot = path.join(root, 'chat_tmp');
  const now = Date.parse('2026-09-20T00:00:00Z');
  fs.mkdirSync(path.join(tempRoot, 'cab_expired'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'cab_fresh'), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify([
    { bundleId: 'cab_expired', status: 'sent', sentAt: new Date(now - ATTACHMENT_RETENTION_MS).toISOString() },
    { bundleId: 'cab_fresh', status: 'sent', sentAt: new Date(now - ATTACHMENT_RETENTION_MS + 1000).toISOString() },
    { bundleId: '../outside', status: 'sent', sentAt: new Date(now - ATTACHMENT_RETENTION_MS).toISOString() },
  ]));
  const result = cleanupExpiredSentAttachmentBundles({ nowMs: now, dataFile, tempRoot });
  assert.equal(result.removedCount, 1);
  assert.equal(fs.existsSync(path.join(tempRoot, 'cab_expired')), false);
  assert.equal(fs.existsSync(path.join(tempRoot, 'cab_fresh')), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8')).map((item) => item.bundleId), ['cab_fresh', '../outside']);
});

test('message retention archives only expired messages and preserves the live conversation', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-chat-archive-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  const chatTempRoot = path.join(root, 'chat_tmp');
  const archiveRoot = path.join(root, 'chatdata');
  fs.mkdirSync(dataDir);
  const now = Date.parse('2026-09-20T00:00:00Z');
  const membersFile = path.join(dataDir, 'members.json');
  const conversationsFile = path.join(dataDir, 'conversations.json');
  const messagesFile = path.join(dataDir, 'messages.json');
  const chatAttachmentsFile = path.join(dataDir, 'chatAttachments.json');
  fs.writeFileSync(membersFile, JSON.stringify([
    { userUid: 'uid-a', loginId: 'sender' }, { userUid: 'uid-b', loginId: 'recipient' },
  ]));
  fs.writeFileSync(conversationsFile, JSON.stringify([{ conversationId: 'conv-1', type: 'direct', participantUids: ['uid-a', 'uid-b'] }]));
  fs.writeFileSync(messagesFile, JSON.stringify([
    { messageId: 'old', conversationId: 'conv-1', senderUid: 'uid-a', text: 'archive', createdAt: new Date(now - MESSAGE_RETENTION_MS).toISOString() },
    { messageId: 'new', conversationId: 'conv-1', senderUid: 'uid-b', text: 'keep', createdAt: new Date(now - MESSAGE_RETENTION_MS + 1000).toISOString() },
  ]));
  fs.writeFileSync(chatAttachmentsFile, '[]');
  const options = { nowMs: now, membersFile, conversationsFile, messagesFile, chatAttachmentsFile, chatTempRoot, archiveRoot, receivedRoots: [] };
  const first = runMessageRetentionCleanup(options);
  assert.equal(first.archivedCount, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(messagesFile, 'utf8')).map((item) => item.messageId), ['new']);
  const archiveFile = path.join(archiveRoot, 'sender', 'recipient', '2026-08.jsonl');
  const archived = fs.readFileSync(archiveFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(archived.map((item) => item.messageId), ['old']);
  const conversations = JSON.parse(fs.readFileSync(conversationsFile, 'utf8'));
  assert.equal(conversations[0].lastMessageId, 'new');
  const second = runMessageRetentionCleanup(options);
  assert.equal(second.archivedCount, 0);
  assert.equal(fs.readFileSync(archiveFile, 'utf8').trim().split('\n').length, 1);
  fs.writeFileSync(messagesFile, JSON.stringify([
    { messageId: 'old', conversationId: 'conv-1', senderUid: 'uid-a', text: 'archive', createdAt: new Date(now - MESSAGE_RETENTION_MS).toISOString() },
    { messageId: 'new', conversationId: 'conv-1', senderUid: 'uid-b', text: 'keep', createdAt: new Date(now - MESSAGE_RETENTION_MS + 1000).toISOString() },
  ]));
  const crashRetry = runMessageRetentionCleanup(options);
  assert.equal(crashRetry.archivedCount, 1);
  assert.equal(fs.readFileSync(archiveFile, 'utf8').trim().split('\n').length, 1);
});
