const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  getBundle,
  updateBundle,
  cleanupExpiredPendingBundles,
} = require('./chatAttachmentStore');

const conversationsFilePath = path.join(__dirname, 'data', 'conversations.json');
const messagesFilePath = path.join(__dirname, 'data', 'messages.json');
const CHAT_TEMP_ROOT = '/mnt/nas/chat_tmp';

const nowIso = () => new Date().toISOString();

const generateId = (prefix) => {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
};

const ensureArrayFile = (filePath) => {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

const sortParticipantUids = (uids) => {
  return Array.from(new Set((uids || []).filter(Boolean))).sort();
};

const normalizeConversation = (conversation = {}) => {
  const createdAt = conversation.createdAt || nowIso();
  return {
    conversationId: conversation.conversationId || generateId('cv'),
    type: conversation.type || 'direct',
    title: typeof conversation.title === 'string' ? conversation.title : '',
    createdByUid: conversation.createdByUid || '',
    participantUids: sortParticipantUids(conversation.participantUids || []),
    pendingInviteUids: sortParticipantUids(conversation.pendingInviteUids || []),
    createdAt,
    updatedAt: conversation.updatedAt || createdAt,
    lastMessageId: conversation.lastMessageId || null,
    lastMessagePreview: typeof conversation.lastMessagePreview === 'string' ? conversation.lastMessagePreview : '',
    lastMessageAt: conversation.lastMessageAt || null,
  };
};

const normalizeAttachmentBundle = (bundle = {}) => ({
  ...bundle,
  items: Array.isArray(bundle.items) ? bundle.items : [],
  itemCount: Number(bundle.itemCount) || (Array.isArray(bundle.items) ? bundle.items.length : 0),
});

const normalizeMessage = (message = {}) => {
  const createdAt = message.createdAt || nowIso();
  const attachments = Array.isArray(message.attachments)
    ? message.attachments.map(normalizeAttachmentBundle)
    : [];

  return {
    messageId: message.messageId || generateId('msg'),
    conversationId: message.conversationId || '',
    senderUid: message.senderUid || '',
    recipientUid: message.recipientUid || '',
    text: typeof message.text === 'string' ? message.text : '',
    messageType: message.messageType || 'text',
    attachments,
    attachmentCount: Number(message.attachmentCount) || attachments.reduce((sum, item) => sum + (item.itemCount || 0), 0),
    createdAt,
    readByUids: Array.from(new Set(Array.isArray(message.readByUids) ? message.readByUids.filter(Boolean) : [])),
    savedByUids: Array.from(new Set(Array.isArray(message.savedByUids) ? message.savedByUids.filter(Boolean) : [])),
    savedAttachmentPathsByUid:
      message.savedAttachmentPathsByUid && typeof message.savedAttachmentPathsByUid === 'object'
        ? message.savedAttachmentPathsByUid
        : {},
    deleted: !!message.deleted,
  };
};

const getAllConversations = () => readArray(conversationsFilePath).map(normalizeConversation);
const getAllMessages = () => readArray(messagesFilePath).map(normalizeMessage);

const saveConversations = (items) => writeArray(conversationsFilePath, items.map(normalizeConversation));
const saveMessages = (items) => writeArray(messagesFilePath, items.map(normalizeMessage));

const getConversationById = (conversationId) => {
  return getAllConversations().find((c) => c.conversationId === conversationId) || null;
};

const getMessageById = (messageId) => {
  return getAllMessages().find((m) => m.messageId === messageId) || null;
};

const findDirectConversation = (userAUid, userBUid) => {
  const pair = sortParticipantUids([userAUid, userBUid]);
  return getAllConversations().find((conversation) =>
    conversation.type === 'direct' &&
    conversation.participantUids.length === 2 &&
    conversation.participantUids[0] === pair[0] &&
    conversation.participantUids[1] === pair[1]
  ) || null;
};

const ensureDirectConversation = (userAUid, userBUid) => {
  const existing = findDirectConversation(userAUid, userBUid);
  if (existing) return existing;

  const conversations = getAllConversations();
  const created = normalizeConversation({
    type: 'direct',
    participantUids: [userAUid, userBUid],
  });

  conversations.push(created);
  saveConversations(conversations);
  return created;
};

const listConversationsForUser = (userUid) => {
  return getAllConversations()
    .filter((conversation) =>
      conversation.participantUids.includes(userUid) ||
      conversation.pendingInviteUids.includes(userUid)
    )
    .sort((a, b) => {
      const aKey = a.lastMessageAt || a.updatedAt || a.createdAt || '';
      const bKey = b.lastMessageAt || b.updatedAt || b.createdAt || '';
      return String(bKey).localeCompare(String(aKey));
    });
};

const createGroupConversation = ({ title, creatorUid, inviteeUids = [] }) => {
  const safeTitle = String(title || '').trim().slice(0, 60) || '그룹 채팅';
  const pendingInviteUids = sortParticipantUids(inviteeUids).filter((uid) => uid && uid !== creatorUid);
  const conversations = getAllConversations();
  const createdAt = nowIso();
  const created = normalizeConversation({
    type: 'group',
    title: safeTitle,
    createdByUid: creatorUid,
    participantUids: [creatorUid],
    pendingInviteUids,
    createdAt,
    updatedAt: createdAt,
  });

  conversations.push(created);
  saveConversations(conversations);
  return created;
};

const inviteUsersToConversation = ({ conversationId, inviterUid, inviteeUids = [] }) => {
  const conversations = getAllConversations();
  const target = conversations.find((conversation) => conversation.conversationId === conversationId);
  if (!target) throw new Error('CONVERSATION_NOT_FOUND');
  if (target.type !== 'group') throw new Error('GROUP_ONLY');
  if (!target.participantUids.includes(inviterUid)) throw new Error('FORBIDDEN_PARTICIPANT');

  const nextPending = sortParticipantUids([
    ...target.pendingInviteUids,
    ...inviteeUids.filter((uid) => uid && !target.participantUids.includes(uid) && uid !== inviterUid),
  ]);
  const updatedAt = nowIso();
  const next = conversations.map((conversation) =>
    conversation.conversationId === conversationId
      ? normalizeConversation({ ...conversation, pendingInviteUids: nextPending, updatedAt })
      : conversation
  );

  saveConversations(next);
  return next.find((conversation) => conversation.conversationId === conversationId);
};

const respondConversationInvite = ({ conversationId, userUid, accept }) => {
  const conversations = getAllConversations();
  const target = conversations.find((conversation) => conversation.conversationId === conversationId);
  if (!target) throw new Error('CONVERSATION_NOT_FOUND');
  if (!target.pendingInviteUids.includes(userUid)) throw new Error('INVITE_NOT_FOUND');

  const updatedAt = nowIso();
  const next = conversations.map((conversation) => {
    if (conversation.conversationId !== conversationId) return conversation;
    return normalizeConversation({
      ...conversation,
      participantUids: accept
        ? sortParticipantUids([...conversation.participantUids, userUid])
        : conversation.participantUids,
      pendingInviteUids: conversation.pendingInviteUids.filter((uid) => uid !== userUid),
      updatedAt,
    });
  });

  saveConversations(next);
  return next.find((conversation) => conversation.conversationId === conversationId);
};

const listMessagesForConversation = (conversationId) => {
  return getAllMessages()
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
};

const countUnreadForConversation = (conversationId, userUid) => {
  return listMessagesForConversation(conversationId).filter((message) =>
    message.senderUid !== userUid &&
    !message.deleted &&
    !message.readByUids.includes(userUid)
  ).length;
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

const deriveMessageType = ({ text, attachments }) => {
  const hasText = !!String(text || '').trim();
  const items = attachments.flatMap((bundle) => Array.isArray(bundle.items) ? bundle.items : []);

  if (items.length === 0) return 'text';
  if (hasText) return 'mixed';

  if (items.length === 1) {
    const first = items[0];
    if (first.type === 'folder') return 'folder';
    if (isImageName(first.name)) return 'image';
    return 'file';
  }

  return 'attachment';
};

const buildConversationPreview = ({ text, attachments }) => {
  const trimmed = String(text || '').trim();
  if (trimmed) return trimmed.slice(0, 120);
  return summarizeAttachments(attachments).slice(0, 120);
};

const ensureUniqueName = (dirPath, wantedName) => {
  const ext = path.extname(wantedName);
  const base = path.basename(wantedName, ext);
  let candidate = wantedName;
  let counter = 1;

  while (fs.existsSync(path.join(dirPath, candidate))) {
    candidate = ext
      ? `${base} (${counter})${ext}`
      : `${base} (${counter})`;
    counter += 1;
  }

  return candidate;
};

const copyPathRecursive = (srcPath, destPath) => {
  const stat = fs.statSync(srcPath);
  if (stat.isDirectory()) {
    fs.cpSync(srcPath, destPath, { recursive: true });
  } else {
    fs.copyFileSync(srcPath, destPath);
  }
};

const createMessage = ({ conversationId, senderUid, text, attachmentBundleIds = [] }) => {
  const trimmed = String(text || '').trim();
  const bundleIds = Array.from(new Set((Array.isArray(attachmentBundleIds) ? attachmentBundleIds : []).filter(Boolean)));

  if (!trimmed && bundleIds.length === 0) {
    throw new Error('EMPTY_PAYLOAD');
  }

  const conversations = getAllConversations();
  const targetConversation = conversations.find((conversation) => conversation.conversationId === conversationId);

  if (!targetConversation) {
    throw new Error('CONVERSATION_NOT_FOUND');
  }

  if (!targetConversation.participantUids.includes(senderUid)) {
    throw new Error('FORBIDDEN_PARTICIPANT');
  }

  cleanupExpiredPendingBundles();

  const attachments = bundleIds.map((bundleId) => {
    const bundle = getBundle(bundleId);
    if (!bundle) throw new Error('ATTACHMENT_BUNDLE_NOT_FOUND');
    if (bundle.ownerUid !== senderUid) throw new Error('ATTACHMENT_BUNDLE_FORBIDDEN');
    if (bundle.status !== 'pending') throw new Error('ATTACHMENT_BUNDLE_INVALID_STATE');
    return normalizeAttachmentBundle(bundle);
  });

  const recipientUid = targetConversation.participantUids.find((uid) => uid !== senderUid) || senderUid;
  const createdAt = nowIso();
  const messageType = deriveMessageType({ text: trimmed, attachments });
  const attachmentCount = attachments.reduce((sum, bundle) => sum + (bundle.itemCount || 0), 0);

  const message = normalizeMessage({
    conversationId,
    senderUid,
    recipientUid,
    text: trimmed,
    messageType,
    attachments,
    attachmentCount,
    createdAt,
    readByUids: [senderUid],
    savedByUids: [],
    deleted: false,
  });

  const messages = getAllMessages();
  messages.push(message);
  saveMessages(messages);

  attachments.forEach((bundle) => {
    updateBundle(bundle.bundleId, {
      status: 'sent',
      linkedConversationId: conversationId,
      linkedMessageId: message.messageId,
      sentAt: createdAt,
    });
  });

  const lastMessagePreview = buildConversationPreview({ text: trimmed, attachments });

  const updatedConversations = conversations.map((conversation) => {
    if (conversation.conversationId !== conversationId) return conversation;
    return normalizeConversation({
      ...conversation,
      updatedAt: createdAt,
      lastMessageId: message.messageId,
      lastMessagePreview,
      lastMessageAt: createdAt,
    });
  });

  saveConversations(updatedConversations);

  const updatedConversation = updatedConversations.find((conversation) => conversation.conversationId === conversationId);
  return { conversation: updatedConversation, message };
};

const createTextMessage = ({ conversationId, senderUid, text }) => {
  return createMessage({ conversationId, senderUid, text, attachmentBundleIds: [] });
};

const saveReceivedAttachmentsForUser = ({ messageId, userUid, receivedDir, receivedRequestRoot = '/받은 파일' }) => {
  const messages = getAllMessages();
  const targetMessage = messages.find((message) => message.messageId === messageId);

  if (!targetMessage) {
    throw new Error('MESSAGE_NOT_FOUND');
  }

  if (!Array.isArray(targetMessage.attachments) || targetMessage.attachments.length === 0) {
    throw new Error('NO_ATTACHMENTS');
  }

  fs.mkdirSync(receivedDir, { recursive: true });

  const savedEntries = [];

  targetMessage.attachments.forEach((bundle) => {
    const bundleDir = path.join(CHAT_TEMP_ROOT, bundle.bundleId);
    if (!fs.existsSync(bundleDir)) {
      throw new Error('ATTACHMENT_SOURCE_MISSING');
    }

    const topLevelEntries = fs.readdirSync(bundleDir);
    topLevelEntries.forEach((entryName) => {
      const srcPath = path.join(bundleDir, entryName);
      const srcStat = fs.statSync(srcPath);
      const finalName = ensureUniqueName(receivedDir, entryName);
      const destPath = path.join(receivedDir, finalName);
      copyPathRecursive(srcPath, destPath);

      const requestRootRaw = String(receivedRequestRoot || '/받은 파일').split('\\').join('/');
      const requestRoot = requestRootRaw.endsWith('/') ? requestRootRaw.slice(0, -1) : requestRootRaw;
      savedEntries.push({
        name: finalName,
        type: srcStat.isDirectory() ? 'folder' : 'file',
        relativePath: `${requestRoot}/${finalName}`.replace(/\/+/g, '/'),
      });
    });
  });

  const nextMessages = messages.map((message) => {
    if (message.messageId !== messageId) return message;

    const prevMap =
      message.savedAttachmentPathsByUid && typeof message.savedAttachmentPathsByUid === 'object'
        ? message.savedAttachmentPathsByUid
        : {};

    return normalizeMessage({
      ...message,
      savedByUids: Array.from(new Set([...(message.savedByUids || []), userUid])),
      savedAttachmentPathsByUid: {
        ...prevMap,
        [userUid]: savedEntries,
      },
    });
  });

  saveMessages(nextMessages);

  const updatedMessage = nextMessages.find((message) => message.messageId === messageId);
  return { message: updatedMessage, savedEntries, alreadySaved: false };
};

const markConversationRead = ({ conversationId, userUid }) => {
  const messages = getAllMessages();
  const updatedMessageIds = [];
  let changed = false;

  const next = messages.map((message) => {
    if (
      message.conversationId === conversationId &&
      message.senderUid !== userUid &&
      !message.deleted &&
      !message.readByUids.includes(userUid)
    ) {
      changed = true;
      updatedMessageIds.push(message.messageId);
      return normalizeMessage({
        ...message,
        readByUids: [...message.readByUids, userUid],
      });
    }
    return message;
  });

  if (changed) {
    saveMessages(next);
  }

  return updatedMessageIds;
};

const ensureStoreFiles = () => {
  ensureArrayFile(conversationsFilePath);
  ensureArrayFile(messagesFilePath);
};

module.exports = {
  ensureStoreFiles,
  getConversationById,
  getMessageById,
  findDirectConversation,
  ensureDirectConversation,
  createGroupConversation,
  inviteUsersToConversation,
  respondConversationInvite,
  listConversationsForUser,
  listMessagesForConversation,
  countUnreadForConversation,
  createMessage,
  createTextMessage,
  saveReceivedAttachmentsForUser,
  markConversationRead,
};
