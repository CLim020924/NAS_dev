const fs = require('fs');
const path = require('path');
const config = require('./config/env');
const { getQuotaBasePath, normalizeQuotaFields } = require('./storageQuota');
const { cleanupExpiredPendingBundles, isSafeBundleId } = require('./chatAttachmentStore');

const NAS_ROOT = config.NAS_ROOT;
const CHATDATA_ROOT = config.CHATDATA_ROOT;
const CONVERSATIONS_FILE = path.join(__dirname, 'data', 'conversations.json');
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');
const MEMBERS_FILE = path.join(__dirname, 'data', 'members.json');
const CHAT_ATTACHMENTS_FILE = path.join(__dirname, 'data', 'chatAttachments.json');
const CHAT_TEMP_ROOT = config.CHAT_TEMP_ROOT;

const MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ATTACHMENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RECEIVED_FILE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const nowIso = () => new Date().toISOString();

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
};

const ensureArrayFile = (filePath) => {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, '[]\n');
};

const readArray = (filePath) => {
  ensureArrayFile(filePath);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
};

const writeArray = (filePath, items) => {
  ensureArrayFile(filePath);
  fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
};

const safeRm = (targetPath) => {
  try {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    return !fs.existsSync(targetPath);
  } catch (e) { return false; }
};

const getUserBasePath = (user = {}) => {
  return getQuotaBasePath(normalizeQuotaFields(user));
};

const getReceivedFolderPaths = () => {
  const members = readArray(MEMBERS_FILE);
  const unique = new Set();

  members.forEach((user) => {
    const basePath = getUserBasePath(user);
    const receivedPath = path.join(basePath, '받은 파일');
    unique.add(receivedPath);
  });

  unique.add(path.join(NAS_ROOT, '받은 파일'));
  return Array.from(unique);
};

const safeName = (value, fallback = 'unknown') => {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return text.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, ' ').trim() || fallback;
};

const buildLoginIdMap = (membersFile = MEMBERS_FILE) => {
  const members = readArray(membersFile);
  const map = new Map();
  members.forEach((user) => {
    const uid = user.userUid;
    const loginId = user.loginId || user.id || user.username || '';
    if (uid && loginId) map.set(uid, loginId);
  });
  return map;
};

const isImageName = (name = '') => {
  const ext = path.extname(String(name || '')).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(ext);
};

const summarizeAttachments = (attachments = []) => {
  const items = attachments.flatMap((bundle) => Array.isArray(bundle.items) ? bundle.items : []);
  const total = items.length;
  if (total === 0) return '첨부를 보냈습니다.';
  if (total === 1) {
    const first = items[0];
    if (first.type === 'folder') return '폴더를 보냈습니다.';
    if (isImageName(first.name)) return '사진을 보냈습니다.';
    return '파일을 보냈습니다.';
  }
  return `첨부 ${total}개를 보냈습니다.`;
};

const buildConversationPreview = (message = {}) => {
  const trimmed = String(message.text || '').trim();
  if (trimmed) return trimmed.slice(0, 120);
  return summarizeAttachments(message.attachments || []).slice(0, 120);
};

const resolveArchiveBucket = ({ conversation, message, loginIdByUid }) => {
  const senderLoginId = safeName(loginIdByUid.get(message.senderUid) || message.senderUid, 'unknown_sender');

  if (conversation && conversation.type === 'direct') {
    const otherUid = (conversation.participantUids || []).find((uid) => uid !== message.senderUid) || message.recipientUid;
    const otherLoginId = safeName(loginIdByUid.get(otherUid) || otherUid, 'unknown_target');
    return {
      senderFolder: senderLoginId,
      targetFolder: otherLoginId,
      senderLoginId,
      targetLoginId: otherLoginId,
    };
  }

  const targetFolder = safeName(`conversation_${message.conversationId}`, 'unknown_conversation');
  return {
    senderFolder: senderLoginId,
    targetFolder,
    senderLoginId,
    targetLoginId: targetFolder,
  };
};

const appendArchivedMessage = ({ archiveRoot, conversation, message, loginIdByUid, archivedKeysByFile }) => {
  const bucket = resolveArchiveBucket({ conversation, message, loginIdByUid });
  const created = new Date(message.createdAt || 0);
  const yyyyMm = Number.isNaN(created.getTime()) ? 'unknown-month' : created.toISOString().slice(0, 7);

  const targetDir = path.join(archiveRoot, bucket.senderFolder, bucket.targetFolder);
  ensureDir(targetDir);

  const archiveFile = path.join(targetDir, `${yyyyMm}.jsonl`);
  const items = (message.attachments || []).flatMap((bundle) => Array.isArray(bundle.items) ? bundle.items : []);

  const record = {
    archivedAt: nowIso(),
    originalCreatedAt: message.createdAt || null,
    conversationId: message.conversationId || null,
    messageId: message.messageId || null,
    conversationType: conversation?.type || 'direct',
    senderUid: message.senderUid || null,
    senderLoginId: bucket.senderLoginId,
    recipientUid: message.recipientUid || null,
    targetLoginId: bucket.targetLoginId,
    messageType: message.messageType || 'text',
    text: typeof message.text === 'string' ? message.text : '',
    attachmentCount: Number(message.attachmentCount) || items.length,
    attachmentNames: items.map((item) => ({
      name: item.name || '',
      type: item.type || 'file',
      relativePath: item.relativePath || item.name || '',
    })),
    readByUids: Array.isArray(message.readByUids) ? message.readByUids : [],
    savedByUids: Array.isArray(message.savedByUids) ? message.savedByUids : [],
  };

  let knownKeys = archivedKeysByFile.get(archiveFile);
  if (!knownKeys) {
    knownKeys = new Set();
    if (fs.existsSync(archiveFile)) {
      for (const line of fs.readFileSync(archiveFile, 'utf8').split('\n').filter(Boolean)) {
        const prior = JSON.parse(line);
        knownKeys.add(`${prior.conversationId}:${prior.messageId}`);
      }
    }
    archivedKeysByFile.set(archiveFile, knownKeys);
  }
  const archiveKey = `${record.conversationId}:${record.messageId}`;
  if (knownKeys.has(archiveKey)) return;
  fs.appendFileSync(archiveFile, `${JSON.stringify(record)}\n`, 'utf8');
  knownKeys.add(archiveKey);
};

const recomputeConversations = (conversations, messages) => {
  return conversations.map((conversation) => {
    const related = messages
      .filter((message) => message.conversationId === conversation.conversationId && !message.deleted)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));

    const last = related.length > 0 ? related[related.length - 1] : null;

    return {
      ...conversation,
      lastMessageId: last ? (last.messageId || null) : null,
      lastMessagePreview: last ? buildConversationPreview(last) : '',
      lastMessageAt: last ? (last.createdAt || null) : null,
    };
  });
};

const cleanupExpiredSentAttachmentBundles = ({ nowMs = Date.now(), dataFile = CHAT_ATTACHMENTS_FILE, tempRoot = CHAT_TEMP_ROOT } = {}) => {
  const bundles = readArray(dataFile);
  const keep = [];
  let removedCount = 0;

  bundles.forEach((bundle) => {
    const baseTime = bundle.sentAt || bundle.updatedAt || bundle.createdAt || null;
    const ts = baseTime ? new Date(baseTime).getTime() : 0;
    const expired = ts > 0 && (nowMs - ts >= ATTACHMENT_RETENTION_MS);

    if (bundle.status === 'sent' && expired && isSafeBundleId(bundle.bundleId)) {
      if (safeRm(path.join(tempRoot, bundle.bundleId))) {
        removedCount += 1;
        return;
      }
    }

    keep.push(bundle);
  });

  if (keep.length !== bundles.length) {
    writeArray(dataFile, keep);
  }

  return { removedCount, remainingCount: keep.length };
};

const cleanupExpiredReceivedFiles = ({ nowMs = Date.now(), receivedRoots = getReceivedFolderPaths() } = {}) => {
  let removedCount = 0;

  receivedRoots.forEach((receivedRoot) => {
    if (!fs.existsSync(receivedRoot)) return;

    let names = [];
    try {
      names = fs.readdirSync(receivedRoot);
    } catch (e) {
      return;
    }

    names.forEach((name) => {
      const targetPath = path.join(receivedRoot, name);
      let stat;
      try {
        stat = fs.statSync(targetPath);
      } catch (e) {
        return;
      }

      const baseTime = stat.mtimeMs || stat.ctimeMs || 0;
      const expired = baseTime > 0 && (nowMs - baseTime >= RECEIVED_FILE_RETENTION_MS);
      if (!expired) return;

      if (safeRm(targetPath)) removedCount += 1;
    });
  });

  return { removedCount, scannedRoots: receivedRoots.length };
};


const runMessageRetentionCleanup = ({
  nowMs = Date.now(),
  membersFile = MEMBERS_FILE,
  conversationsFile = CONVERSATIONS_FILE,
  messagesFile = MESSAGES_FILE,
  chatAttachmentsFile = CHAT_ATTACHMENTS_FILE,
  chatTempRoot = CHAT_TEMP_ROOT,
  archiveRoot = CHATDATA_ROOT,
  receivedRoots,
} = {}) => {
  ensureDir(archiveRoot);

  const loginIdByUid = buildLoginIdMap(membersFile);
  const conversations = readArray(conversationsFile);
  const messages = readArray(messagesFile);

  const conversationMap = new Map(
    conversations.map((conversation) => [conversation.conversationId, conversation])
  );

  const keepMessages = [];
  const expiredMessages = [];

  messages.forEach((message) => {
    const createdAtMs = new Date(message.createdAt || 0).getTime();
    const expired = createdAtMs > 0 && (nowMs - createdAtMs >= MESSAGE_RETENTION_MS);

    if (!expired) {
      keepMessages.push(message);
      return;
    }

    expiredMessages.push(message);
  });

  const archivedKeysByFile = new Map();
  expiredMessages.forEach((message) => {
    const conversation = conversationMap.get(message.conversationId) || null;
    appendArchivedMessage({
      archiveRoot,
      conversation,
      message,
      loginIdByUid,
      archivedKeysByFile,
    });
  });

  if (expiredMessages.length > 0) {
    writeArray(messagesFile, keepMessages);
    const nextConversations = recomputeConversations(conversations, keepMessages);
    writeArray(conversationsFile, nextConversations);
  }

  const pendingCleanup = cleanupExpiredPendingBundles({ atMs: nowMs, dataFile: chatAttachmentsFile, tempRoot: chatTempRoot });
  const attachmentCleanup = cleanupExpiredSentAttachmentBundles({ nowMs, dataFile: chatAttachmentsFile, tempRoot: chatTempRoot });
  const receivedCleanup = cleanupExpiredReceivedFiles({ nowMs, receivedRoots });

  return {
    archivedCount: expiredMessages.length,
    remainingCount: keepMessages.length,
    attachmentBundleRemovedCount: attachmentCleanup.removedCount,
    attachmentBundleRemainingCount: attachmentCleanup.remainingCount,
    pendingBundleRemovedCount: pendingCleanup.removedCount,
    receivedFileRemovedCount: receivedCleanup.removedCount,
    receivedRootCount: receivedCleanup.scannedRoots,
    ranAt: nowIso(),
  };
};

module.exports = {
  MESSAGE_RETENTION_MS,
  ATTACHMENT_RETENTION_MS,
  RECEIVED_FILE_RETENTION_MS,
  CHATDATA_ROOT,
  runMessageRetentionCleanup,
  cleanupExpiredSentAttachmentBundles,
  cleanupExpiredReceivedFiles,
};
