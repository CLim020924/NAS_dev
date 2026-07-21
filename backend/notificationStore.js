const fs = require('fs');
const path = require('path');

const notificationsFilePath = path.join(__dirname, 'data', 'notifications.json');

const readNotifications = () => {
  try {
    if (!fs.existsSync(notificationsFilePath)) return [];
    const raw = JSON.parse(fs.readFileSync(notificationsFilePath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
};

const writeNotifications = (items) => {
  fs.writeFileSync(notificationsFilePath, JSON.stringify(items, null, 2));
};

const normalizeNotification = (n = {}) => ({
  notificationId: n.notificationId || `ntf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
  userUid: n.userUid || '',
  type: n.type || 'system',
  title: n.title || '알림',
  message: n.message || '',
  isRead: !!n.isRead,
  createdAt: n.createdAt || new Date().toISOString(),
  readAt: n.readAt || null,
  meta: n.meta && typeof n.meta === 'object' ? n.meta : {},
});

const createNotification = ({ userUid, type, title, message, meta = {} }) => {
  if (!userUid) return null;
  const items = readNotifications();
  const notification = normalizeNotification({
    userUid,
    type,
    title,
    message,
    isRead: false,
    meta,
  });
  items.push(notification);
  writeNotifications(items);
  return notification;
};

const listNotificationsForUser = (userUid) => {
  return readNotifications()
    .filter(n => n.userUid === userUid)
    .map(normalizeNotification)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
};

const getUnreadCount = (userUid) => {
  const unread = listNotificationsForUser(userUid).filter((n) => !n.isRead);
  const chatGroupKeys = new Set();
  let otherCount = 0;

  unread.forEach((n) => {
    if (n.type === 'chat_message') {
      const key = String(
        n.meta?.fromUserUid ||
        n.meta?.conversationId ||
        n.notificationId ||
        ''
      ).trim();

      if (key) {
        chatGroupKeys.add(key);
      } else {
        otherCount += 1;
      }
      return;
    }

    otherCount += 1;
  });

  return otherCount + chatGroupKeys.size;
};

const markNotificationRead = (userUid, notificationId) => {
  const items = readNotifications();
  let changed = false;

  const next = items.map((item) => {
    const n = normalizeNotification(item);
    if (n.userUid === userUid && n.notificationId === notificationId && !n.isRead) {
      changed = true;
      return {
        ...n,
        isRead: true,
        readAt: new Date().toISOString(),
      };
    }
    return n;
  });

  if (changed) writeNotifications(next);
  return changed;
};

const markAllNotificationsRead = (userUid) => {
  const items = readNotifications();
  const now = new Date().toISOString();
  let changed = false;

  const next = items.map((item) => {
    const n = normalizeNotification(item);
    if (n.userUid === userUid && !n.isRead) {
      changed = true;
      return {
        ...n,
        isRead: true,
        readAt: now,
      };
    }
    return n;
  });

  if (changed) writeNotifications(next);
  return changed;
};

const markChatNotificationsRead = ({ userUid, conversationId = '', fromUserUid = '' } = {}) => {
  if (!userUid) return false;

  const targetConversationId = String(conversationId || '').trim();
  const targetFromUserUid = String(fromUserUid || '').trim();

  if (!targetConversationId && !targetFromUserUid) return false;

  const items = readNotifications();
  const now = new Date().toISOString();
  let changed = false;

  const next = items.map((item) => {
    const n = normalizeNotification(item);
    if (n.userUid !== userUid || n.isRead || n.type !== 'chat_message') {
      return n;
    }

    const itemConversationId = String(n.meta?.conversationId || '').trim();
    const itemFromUserUid = String(n.meta?.fromUserUid || '').trim();

    const sameConversation =
      !!targetConversationId && itemConversationId === targetConversationId;

    const sameSender =
      !targetConversationId && !!targetFromUserUid && itemFromUserUid === targetFromUserUid;

    if (!sameConversation && !sameSender) {
      return n;
    }

    changed = true;
    return {
      ...n,
      isRead: true,
      readAt: now,
    };
  });

  if (changed) writeNotifications(next);
  return changed;
};

const deleteNotification = (userUid, notificationId) => {
  const targetId = String(notificationId || '').trim();
  if (!userUid || !targetId) return false;

  const items = readNotifications();
  const next = items.filter((item) => {
    const n = normalizeNotification(item);
    return !(n.userUid === userUid && n.notificationId === targetId);
  });

  const changed = next.length !== items.length;
  if (changed) writeNotifications(next);
  return changed;
};

const deleteReadNotifications = (userUid) => {
  if (!userUid) return 0;

  const items = readNotifications();
  let removed = 0;
  const next = items.filter((item) => {
    const n = normalizeNotification(item);
    if (n.userUid === userUid && n.isRead) {
      removed += 1;
      return false;
    }
    return true;
  });

  if (removed > 0) writeNotifications(next);
  return removed;
};

module.exports = {
  createNotification,
  listNotificationsForUser,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  markChatNotificationsRead,
  deleteNotification,
  deleteReadNotifications,
};
