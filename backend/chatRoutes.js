const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createNotification, markChatNotificationsRead } = require('./notificationStore');
const {
  ensureDirectConversation,
  getConversationById,
  getMessageById,
  listConversationsForUser,
  listMessagesForConversation,
  countUnreadForConversation,
  createGroupConversation,
  inviteUsersToConversation,
  respondConversationInvite,
  createMessage,
  saveReceivedAttachmentsForUser,
  markConversationRead,
} = require('./chatStore');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'my-service-platform-secure-key-2026';
const membersFilePath = path.join(__dirname, 'data', 'members.json');
const friendsFilePath = path.join(__dirname, 'data', 'friends.json');
const nasPath = '/mnt/nas';

const readJsonArray = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
};

const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: '인증실패' });
  }
};

const getAllMembers = () => readJsonArray(membersFilePath).filter((user) => user && !user.disabled);
const getAllRelations = () => readJsonArray(friendsFilePath);

const getLoginId = (user = {}) => user.loginId || user.id || user.username || '';
const getDisplayName = (user = {}) => user.displayName || user.nickname || getLoginId(user);
const getRole = (user = {}) => user.role || (user.Masters ? 'MASTER' : (user.Managers ? 'MANAGER' : 'USER'));

const findMemberFromToken = (tokenUser, members) => {
  return members.find((user) =>
    [user.userUid, user.loginId, user.id, user.username].filter(Boolean).includes(
      tokenUser.userUid || tokenUser.loginId || tokenUser.id || tokenUser.username
    )
  );
};

const pairMatches = (relation, aUid, bUid) => {
  return (
    (relation.userAUid === aUid && relation.userBUid === bUid) ||
    (relation.userAUid === bUid && relation.userBUid === aUid)
  );
};

const isAcceptedFriendPair = (relations, aUid, bUid) => {
  return relations.some((relation) => pairMatches(relation, aUid, bUid) && relation.status === 'ACCEPTED');
};

const serializeOtherUser = (member = {}) => ({
  userUid: member.userUid,
  id: getLoginId(member),
  loginId: getLoginId(member),
  username: getLoginId(member),
  displayName: getDisplayName(member),
  nickname: member.nickname || '',
  role: getRole(member),
  globalAccess: !!member.globalAccess,
});

const serializeParticipant = (member = {}) => ({
  userUid: member.userUid,
  username: getLoginId(member),
  displayName: getDisplayName(member),
  role: getRole(member),
});

const serializeConversationForViewer = (conversation, viewerUid, members) => {
  const otherUid = (conversation.participantUids || []).find((uid) => uid !== viewerUid) || viewerUid;
  const otherUser = members.find((member) => member.userUid === otherUid) || null;
  const participantMembers = (conversation.participantUids || [])
    .map((uid) => members.find((member) => member.userUid === uid))
    .filter(Boolean);
  const pendingMembers = (conversation.pendingInviteUids || [])
    .map((uid) => members.find((member) => member.userUid === uid))
    .filter(Boolean);

  return {
    conversationId: conversation.conversationId,
    type: conversation.type,
    title: conversation.title || '',
    createdByUid: conversation.createdByUid || '',
    participantUids: conversation.participantUids,
    pendingInviteUids: conversation.pendingInviteUids || [],
    inviteStatus: (conversation.pendingInviteUids || []).includes(viewerUid) ? 'PENDING' : 'ACCEPTED',
    participants: participantMembers.map(serializeParticipant),
    pendingInvites: pendingMembers.map(serializeParticipant),
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageId: conversation.lastMessageId,
    lastMessagePreview: conversation.lastMessagePreview,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: countUnreadForConversation(conversation.conversationId, viewerUid),
    otherUser: otherUser ? serializeOtherUser(otherUser) : null,
  };
};

const resolveInviteTargets = ({ values = [], members, me }) => {
  const rawValues = Array.from(new Set(
    (Array.isArray(values) ? values : [values])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  ));

  const targets = rawValues
    .map((value) => {
      const lower = value.toLowerCase();
      return members.find((member) =>
        member.userUid === value ||
        String(getLoginId(member)).toLowerCase() === lower ||
        String(getDisplayName(member)).toLowerCase() === lower ||
        String(member.nickname || '').toLowerCase() === lower
      );
    })
    .filter(Boolean)
    .filter((member) => member.userUid !== me.userUid);

  return Array.from(new Map(targets.map((member) => [member.userUid, member])).values());
};

const buildNotificationPreview = (message = {}) => {
  const text = String(message.text || '').trim();
  if (text) return text.length > 80 ? `${text.slice(0, 80)}…` : text;

  const count = Number(message.attachmentCount) || 0;
  switch (message.messageType) {
    case 'image':
      return '사진을 보냈습니다.';
    case 'folder':
      return '폴더를 보냈습니다.';
    case 'file':
      return '파일을 보냈습니다.';
    case 'attachment':
      return count > 1 ? `첨부 ${count}개를 보냈습니다.` : '첨부를 보냈습니다.';
    case 'mixed':
      return text || (count > 1 ? `첨부 ${count}개를 보냈습니다.` : '첨부를 보냈습니다.');
    default:
      return '새 메시지';
  }
};

const getUserBasePath = (user) => {
  const isPrivileged = user.Masters || user.globalAccess;
  const currentLoginId = getLoginId(user);
  const relativeRoot = user.rootPath
    ? user.rootPath.replace(/^(\/|\\)+/, '')
    : path.join('users', currentLoginId);

  return isPrivileged ? nasPath : path.resolve(nasPath, relativeRoot);
};

const ensureFixedSystemFolders = (user) => {
  const basePath = getUserBasePath(user);
  const receivedFolderPath = path.join(basePath, '받은 파일');
  if (!fs.existsSync(receivedFolderPath)) {
    fs.mkdirSync(receivedFolderPath, { recursive: true });
  }

  if (user.Masters || user.globalAccess) {
    const chatdataPath = path.join(nasPath, 'chatdata');
    if (!fs.existsSync(chatdataPath)) {
      fs.mkdirSync(chatdataPath, { recursive: true });
    }
  }

  return { basePath, receivedFolderPath };
};

const normalizeRequestPath = (value = '/') => {
  const cleaned = String(value || '').replace(/\\/g, '/');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
};

const serializeMessageForViewer = (message, viewer) => {
  const basePath = getUserBasePath(viewer);
  const savedMap =
    message.savedAttachmentPathsByUid && typeof message.savedAttachmentPathsByUid === 'object'
      ? message.savedAttachmentPathsByUid
      : {};

  const savedEntries = Array.isArray(savedMap[viewer.userUid]) ? savedMap[viewer.userUid] : [];
  const existingEntries = savedEntries.filter((entry) => {
    const rel = String(entry.relativePath || '').replace(/^(\/|\\)+/, '');
    if (!rel) return false;
    return fs.existsSync(path.resolve(basePath, rel));
  });

  const viewerSavedState =
    savedEntries.length === 0 ? 'none' : (existingEntries.length === savedEntries.length ? 'ready' : 'missing');

  let viewerOpenTarget = null;
  if (viewerSavedState === 'ready') {
    if (existingEntries.length === 1) {
      const entry = existingEntries[0];
      viewerOpenTarget = {
        type: entry.type === 'folder' ? 'folder' : 'file',
        relativePath: normalizeRequestPath(entry.relativePath),
        name: entry.name || path.basename(String(entry.relativePath || '')),
      };
    } else if (existingEntries.length > 1) {
      viewerOpenTarget = {
        type: 'folder',
        relativePath: '/받은 파일',
        name: '받은 파일',
      };
    }
  }

  return {
    ...message,
    viewerSavedEntries: savedEntries,
    viewerSavedState,
    viewerOpenTarget,
  };
};

router.post('/chat/direct', verifyToken, (req, res) => {
  const { targetUserUid } = req.body || {};
  const members = getAllMembers();
  const relations = getAllRelations();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!targetUserUid) return res.status(400).json({ error: '대상 사용자가 필요합니다.' });
  if (targetUserUid === me.userUid) return res.status(400).json({ error: '자기 자신과는 채팅할 수 없습니다.' });

  const target = members.find((member) => member.userUid === targetUserUid);
  if (!target) return res.status(404).json({ error: '대상 사용자가 없습니다.' });

  if (!isAcceptedFriendPair(relations, me.userUid, targetUserUid)) {
    return res.status(403).json({ error: '친구인 사용자와만 채팅할 수 있습니다.' });
  }

  const conversation = ensureDirectConversation(me.userUid, targetUserUid);
  return res.json({
    conversation: serializeConversationForViewer(conversation, me.userUid, members),
  });
});

router.get('/chat/conversations', verifyToken, (req, res) => {
  const members = getAllMembers();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });

  const conversations = listConversationsForUser(me.userUid).map((conversation) =>
    serializeConversationForViewer(conversation, me.userUid, members)
  );

  return res.json({ conversations });
});

router.post('/chat/group', verifyToken, (req, res) => {
  const { title, inviteeUids, invitees } = req.body || {};
  const members = getAllMembers();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });

  const explicitInvitees = Array.isArray(inviteeUids) ? inviteeUids : [];
  const typedInvitees = Array.isArray(invitees) ? invitees : [];
  const targets = resolveInviteTargets({ values: [...explicitInvitees, ...typedInvitees], members, me });

  const conversation = createGroupConversation({
    title,
    creatorUid: me.userUid,
    inviteeUids: targets.map((member) => member.userUid),
  });

  targets.forEach((target) => {
    createNotification({
      userUid: target.userUid,
      type: 'chat_room_invite',
      title: '채팅방 초대',
      message: `${getDisplayName(me)}님이 ${conversation.title || '그룹 채팅'}에 초대했습니다.`,
      meta: {
        conversationId: conversation.conversationId,
        fromUserUid: me.userUid,
        fromUsername: getLoginId(me),
        fromDisplayName: getDisplayName(me),
      },
    });
  });

  const io = req.app.get('io');
  targets.forEach((target) => {
    io.to(`user:${target.userUid}`).emit('chat:conversation-invite', {
      conversation: serializeConversationForViewer(conversation, target.userUid, members),
    });
  });

  return res.json({
    conversation: serializeConversationForViewer(conversation, me.userUid, members),
  });
});

router.post('/chat/group/:conversationId/invite', verifyToken, (req, res) => {
  const conversationId = String(req.params.conversationId || '').trim();
  const { inviteeUids, invitees } = req.body || {};
  const members = getAllMembers();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!conversationId) return res.status(400).json({ error: '대화방 식별자가 필요합니다.' });

  const explicitInvitees = Array.isArray(inviteeUids) ? inviteeUids : [];
  const typedInvitees = Array.isArray(invitees) ? invitees : [];
  const targets = resolveInviteTargets({ values: [...explicitInvitees, ...typedInvitees], members, me });
  if (targets.length === 0) return res.status(400).json({ error: '초대할 사용자를 찾을 수 없습니다.' });

  try {
    const conversation = inviteUsersToConversation({
      conversationId,
      inviterUid: me.userUid,
      inviteeUids: targets.map((member) => member.userUid),
    });

    targets.forEach((target) => {
      createNotification({
        userUid: target.userUid,
        type: 'chat_room_invite',
        title: '채팅방 초대',
        message: `${getDisplayName(me)}님이 ${conversation.title || '그룹 채팅'}에 초대했습니다.`,
        meta: {
          conversationId: conversation.conversationId,
          fromUserUid: me.userUid,
          fromUsername: getLoginId(me),
          fromDisplayName: getDisplayName(me),
        },
      });
    });

    const io = req.app.get('io');
    targets.forEach((target) => {
      io.to(`user:${target.userUid}`).emit('chat:conversation-invite', {
        conversation: serializeConversationForViewer(conversation, target.userUid, members),
      });
    });
    (conversation.participantUids || []).forEach((uid) => {
      io.to(`user:${uid}`).emit('chat:conversation-updated', {
        conversation: serializeConversationForViewer(conversation, uid, members),
      });
    });

    return res.json({
      conversation: serializeConversationForViewer(conversation, me.userUid, members),
    });
  } catch (e) {
    if (e.message === 'CONVERSATION_NOT_FOUND') return res.status(404).json({ error: '대화방이 없습니다.' });
    if (e.message === 'GROUP_ONLY') return res.status(400).json({ error: '그룹 채팅방에만 초대할 수 있습니다.' });
    if (e.message === 'FORBIDDEN_PARTICIPANT') return res.status(403).json({ error: '참가자만 초대할 수 있습니다.' });
    return res.status(500).json({ error: '초대에 실패했습니다.' });
  }
});

router.post('/chat/group/:conversationId/respond', verifyToken, (req, res) => {
  const conversationId = String(req.params.conversationId || '').trim();
  const { accept } = req.body || {};
  const members = getAllMembers();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!conversationId) return res.status(400).json({ error: '대화방 식별자가 필요합니다.' });

  try {
    const conversation = respondConversationInvite({
      conversationId,
      userUid: me.userUid,
      accept: !!accept,
    });

    const io = req.app.get('io');
    [...(conversation.participantUids || []), ...(conversation.pendingInviteUids || [])].forEach((uid) => {
      io.to(`user:${uid}`).emit('chat:conversation-updated', {
        conversation: serializeConversationForViewer(conversation, uid, members),
      });
    });

    return res.json({
      conversation: serializeConversationForViewer(conversation, me.userUid, members),
    });
  } catch (e) {
    if (e.message === 'CONVERSATION_NOT_FOUND') return res.status(404).json({ error: '대화방이 없습니다.' });
    if (e.message === 'INVITE_NOT_FOUND') return res.status(404).json({ error: '초대가 없습니다.' });
    return res.status(500).json({ error: '초대 응답에 실패했습니다.' });
  }
});

router.get('/chat/messages', verifyToken, (req, res) => {
  const conversationId = String(req.query.conversationId || '').trim();
  const members = getAllMembers();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!conversationId) return res.status(400).json({ error: '대화방 식별자가 필요합니다.' });

  const conversation = getConversationById(conversationId);
  if (!conversation) return res.status(404).json({ error: '대화방이 없습니다.' });
  if (!(conversation.participantUids || []).includes(me.userUid)) {
    return res.status(403).json({ error: '접근 권한이 없습니다.' });
  }

  return res.json({
    conversationId,
    messages: listMessagesForConversation(conversationId).map((message) => serializeMessageForViewer(message, me)),
  });
});

router.post('/chat/messages', verifyToken, (req, res) => {
  const { conversationId, text, attachmentBundleIds } = req.body || {};
  const members = getAllMembers();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!conversationId) return res.status(400).json({ error: '대화방 식별자가 필요합니다.' });

  const conversation = getConversationById(conversationId);
  if (!conversation) return res.status(404).json({ error: '대화방이 없습니다.' });
  if (!(conversation.participantUids || []).includes(me.userUid)) {
    return res.status(403).json({ error: '접근 권한이 없습니다.' });
  }

  try {
    const result = createMessage({
      conversationId,
      senderUid: me.userUid,
      text,
      attachmentBundleIds,
    });

    const io = req.app.get('io');
    const previewMessage = buildNotificationPreview(result.message);
    const recipientUids = (result.conversation.participantUids || []).filter((uid) => uid !== me.userUid);

    recipientUids.forEach((recipientUid) => {
      createNotification({
        userUid: recipientUid,
        type: 'chat_message',
        title: '새 메시지',
        message: `${getDisplayName(me)}: ${previewMessage}`,
        meta: {
          conversationId: result.conversation.conversationId,
          messageId: result.message.messageId,
          fromUserUid: me.userUid,
          fromUsername: getLoginId(me),
          fromDisplayName: getDisplayName(me),
          fromRole: getRole(me),
        },
      });

      const recipientMember = members.find((member) => member.userUid === recipientUid) || { userUid: recipientUid };
      io.to(`user:${recipientUid}`).emit('chat:message', {
        conversationId: result.conversation.conversationId,
        message: serializeMessageForViewer(result.message, recipientMember),
        sender: serializeOtherUser(me),
      });
    });

    return res.json({
      conversation: serializeConversationForViewer(result.conversation, me.userUid, members),
      message: serializeMessageForViewer(result.message, me),
    });
  } catch (e) {
    if (e.message === 'EMPTY_PAYLOAD') {
      return res.status(400).json({ error: '메시지나 첨부 중 하나는 필요합니다.' });
    }
    if (e.message === 'FORBIDDEN_PARTICIPANT') {
      return res.status(403).json({ error: '대화 참가자가 아닙니다.' });
    }
    if (e.message === 'CONVERSATION_NOT_FOUND') {
      return res.status(404).json({ error: '대화방이 없습니다.' });
    }
    if (e.message === 'ATTACHMENT_BUNDLE_NOT_FOUND') {
      return res.status(404).json({ error: '첨부 번들을 찾을 수 없습니다.' });
    }
    if (e.message === 'ATTACHMENT_BUNDLE_FORBIDDEN') {
      return res.status(403).json({ error: '다른 사용자의 첨부 번들은 보낼 수 없습니다.' });
    }
    if (e.message === 'ATTACHMENT_BUNDLE_INVALID_STATE') {
      return res.status(400).json({ error: '이미 사용되었거나 만료된 첨부 번들입니다.' });
    }
    return res.status(500).json({ error: '메시지 전송에 실패했습니다.' });
  }
});

router.post('/chat/messages/:messageId/save', verifyToken, (req, res) => {
  const members = getAllMembers();
  const me = findMemberFromToken(req.user, members);
  const messageId = String(req.params.messageId || '').trim();

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!messageId) return res.status(400).json({ error: '메시지 식별자가 필요합니다.' });

  const message = getMessageById(messageId);
  if (!message) return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });

  const conversation = getConversationById(message.conversationId);
  if (!conversation) return res.status(404).json({ error: '대화방이 없습니다.' });
  if (!(conversation.participantUids || []).includes(me.userUid)) {
    return res.status(403).json({ error: '접근 권한이 없습니다.' });
  }
  try {
    const { receivedFolderPath } = ensureFixedSystemFolders(me);
    const result = saveReceivedAttachmentsForUser({
      messageId,
      userUid: me.userUid,
      receivedDir: receivedFolderPath,
    });

    return res.json({
      success: true,
      alreadySaved: !!result.alreadySaved,
      message: serializeMessageForViewer(result.message, me),
      savedEntries: result.savedEntries || [],
      receivedFolderPath,
    });
  } catch (e) {
    if (e.message === 'MESSAGE_NOT_FOUND') {
      return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
    }
    if (e.message === 'NO_ATTACHMENTS') {
      return res.status(400).json({ error: '저장할 첨부가 없습니다.' });
    }
    if (e.message === 'ATTACHMENT_SOURCE_MISSING') {
      return res.status(410).json({ error: '첨부 원본이 만료되었거나 존재하지 않습니다.' });
    }
    return res.status(500).json({ error: '첨부 저장에 실패했습니다.' });
  }
});

router.post('/chat/read', verifyToken, (req, res) => {
  const { conversationId } = req.body || {};
  const members = getAllMembers();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!conversationId) return res.status(400).json({ error: '대화방 식별자가 필요합니다.' });

  const conversation = getConversationById(conversationId);
  if (!conversation) return res.status(404).json({ error: '대화방이 없습니다.' });
  if (!(conversation.participantUids || []).includes(me.userUid)) {
    return res.status(403).json({ error: '접근 권한이 없습니다.' });
  }

  const updatedMessageIds = markConversationRead({
    conversationId,
    userUid: me.userUid,
  });

  const otherUid = (conversation.participantUids || []).find((uid) => uid !== me.userUid) || '';

  markChatNotificationsRead({
    userUid: me.userUid,
    conversationId,
    fromUserUid: otherUid,
  });

  if (updatedMessageIds.length > 0) {
    const io = req.app.get('io');
    if (otherUid) {
      io.to(`user:${otherUid}`).emit('chat:read', {
        conversationId,
        readByUid: me.userUid,
        updatedMessageIds,
      });
    }
  }

  return res.json({
    success: true,
    updatedMessageIds,
  });
});

module.exports = router;
