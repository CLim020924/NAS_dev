const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const {
  listNotificationsForUser,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  markChatNotificationsRead,
  deleteNotification,
  deleteReadNotifications,
} = require('./notificationStore');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'my-service-platform-secure-key-2026';
const membersFilePath = path.join(__dirname, 'data', 'members.json');

const readMembers = () => {
  try {
    if (!fs.existsSync(membersFilePath)) return [];
    const raw = JSON.parse(fs.readFileSync(membersFilePath, 'utf8'));
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

const findMemberFromToken = (tokenUser, members) => {
  return members.find(u =>
    [u.userUid, u.loginId, u.id, u.username].filter(Boolean).includes(
      tokenUser.userUid || tokenUser.loginId || tokenUser.id || tokenUser.username
    )
  );
};

router.get('/notifications', verifyToken, (req, res) => {
  const members = readMembers();
  const me = findMemberFromToken(req.user, members);
  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });

  return res.json({
    notifications: listNotificationsForUser(me.userUid),
  });
});

router.get('/notifications/unread-count', verifyToken, (req, res) => {
  const members = readMembers();
  const me = findMemberFromToken(req.user, members);
  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });

  return res.json({
    unreadCount: getUnreadCount(me.userUid),
  });
});

router.post('/notifications/read', verifyToken, (req, res) => {
  const { notificationId, conversationId, fromUserUid } = req.body || {};
  const members = readMembers();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });

  const targetConversationId = String(conversationId || '').trim();
  const targetFromUserUid = String(fromUserUid || '').trim();

  if (!notificationId && !targetConversationId && !targetFromUserUid) {
    return res.status(400).json({ error: '알림 식별자 또는 채팅 식별자가 필요합니다.' });
  }

  if (notificationId) {
    markNotificationRead(me.userUid, notificationId);
  }

  if (targetConversationId || targetFromUserUid) {
    markChatNotificationsRead({
      userUid: me.userUid,
      conversationId: targetConversationId,
      fromUserUid: targetFromUserUid,
    });
  }

  return res.json({ success: true });
});

router.post('/notifications/read-all', verifyToken, (req, res) => {
  const members = readMembers();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });

  markAllNotificationsRead(me.userUid);
  return res.json({ success: true });
});

router.delete('/notifications/read', verifyToken, (req, res) => {
  const members = readMembers();
  const me = findMemberFromToken(req.user, members);
  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });

  const deletedCount = deleteReadNotifications(me.userUid);
  return res.json({ success: true, deletedCount });
});

router.delete('/notifications/:notificationId', verifyToken, (req, res) => {
  const members = readMembers();
  const me = findMemberFromToken(req.user, members);
  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });

  const ok = deleteNotification(me.userUid, req.params.notificationId);
  return res.json({ success: true, deleted: ok });
});

module.exports = router;
