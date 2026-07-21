export const groupNotificationsForDisplay = (items = []) => {
  const all = Array.isArray(items) ? items : [];
  const unread = all.filter((n) => !n?.isRead);
  const read = all.filter((n) => n?.isRead);

  const latestChatBySender = new Map();
  const others = [];

  unread.forEach((n) => {
    if (n?.type === 'chat_message') {
      const senderKey =
        n?.meta?.fromUserUid ||
        n?.meta?.conversationId ||
        n?.notificationId;

      const prev = latestChatBySender.get(senderKey);

      if (!prev) {
        latestChatBySender.set(senderKey, {
          latest: n,
          unreadGroupCount: 1,
        });
        return;
      }

      const latest =
        String(prev.latest?.createdAt || '') < String(n?.createdAt || '')
          ? n
          : prev.latest;

      latestChatBySender.set(senderKey, {
        latest,
        unreadGroupCount: Number(prev.unreadGroupCount || 0) + 1,
      });
      return;
    }

    others.push(n);
  });

  const groupedChats = Array.from(latestChatBySender.values()).map((entry) => ({
    ...entry.latest,
    unreadGroupCount: entry.unreadGroupCount,
  }));

  return [...others, ...groupedChats, ...read].sort(
    (a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))
  );
};

export const getNotificationBadgeCount = (items = []) => {
  const unread = (Array.isArray(items) ? items : []).filter((n) => !n?.isRead);
  return groupNotificationsForDisplay(unread).length;
};

export const markNotificationGroupAsReadLocal = (items = [], notification = null) => {
  if (!notification) return Array.isArray(items) ? items : [];

  const clickedConversationId = String(notification?.meta?.conversationId || '');
  const clickedFromUserUid = String(notification?.meta?.fromUserUid || '');
  const now = new Date().toISOString();

  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item) return item;

    if (item.notificationId === notification.notificationId) {
      return {
        ...item,
        isRead: true,
        readAt: item.readAt || now,
      };
    }

    if (
      notification.type === 'chat_message' &&
      item.type === 'chat_message' &&
      !item.isRead
    ) {
      const itemConversationId = String(item?.meta?.conversationId || '');
      const itemFromUserUid = String(item?.meta?.fromUserUid || '');

      const sameConversation =
        !!clickedConversationId && itemConversationId === clickedConversationId;

      const sameSender =
        !clickedConversationId &&
        !!clickedFromUserUid &&
        itemFromUserUid === clickedFromUserUid;

      if (sameConversation || sameSender) {
        return {
          ...item,
          isRead: true,
          readAt: item.readAt || now,
        };
      }
    }

    return item;
  });
};

export const markAllNotificationsAsReadLocal = (items = []) => {
  const now = new Date().toISOString();
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item?.isRead) {
      return {
        ...item,
        isRead: true,
        readAt: item?.readAt || now,
      };
    }
    return item;
  });
};
