import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteNotification,
  deleteReadNotifications,
  listNotifications,
  readAllNotifications,
  readNotificationGroup,
} from './notificationApi';
import {
  getNotificationBadgeCount,
  groupNotificationsForDisplay,
  markAllNotificationsAsReadLocal,
} from './notificationSelectors';

const useNotifications = ({
  user,
  open = false,
  socket = null,
  onNavigateFromNotification = () => {},
}) => {
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState([]);

  const syncNotifications = useCallback((items, { preserveLocal = true } = {}) => {
    setNotifications((prev) => {
      const incoming = Array.isArray(items) ? items : [];
      const incomingHasLocal = incoming.some((item) => item?.meta?.localOnly);
      const localItems = incomingHasLocal
        ? incoming.filter((item) => item?.meta?.localOnly)
        : (preserveLocal ? (Array.isArray(prev) ? prev : []).filter((item) => item?.meta?.localOnly) : []);
      const serverItems = incoming.filter((item) => !item?.meta?.localOnly);
      const serverIds = new Set(serverItems.map((item) => item?.notificationId).filter(Boolean));
      return [
        ...localItems.filter((item) => !serverIds.has(item.notificationId)),
        ...serverItems
      ];
    });
  }, []);

  const refreshNotifications = useCallback(async ({ silent = false } = {}) => {
    if (!user) {
      syncNotifications([]);
      return;
    }

    try {
      if (!silent) setLoading(true);
      const items = await listNotifications();
      syncNotifications(items);
    } catch (err) {
      console.error('알림 목록 로드 실패', err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user, syncNotifications]);

  useEffect(() => {
    refreshNotifications();
    if (!user) return undefined;

    const interval = setInterval(() => {
      refreshNotifications({ silent: true });
    }, 10000);

    return () => clearInterval(interval);
  }, [user, refreshNotifications]);

  useEffect(() => {
    if (!open || !user) return undefined;
    refreshNotifications({ silent: true });
    return undefined;
  }, [open, user, refreshNotifications]);

  useEffect(() => {
    if (!socket || !user) return undefined;

    const handleIncomingChatMessage = () => {
      refreshNotifications({ silent: true });
    };

    socket.on('chat:message', handleIncomingChatMessage);

    return () => {
      socket.off('chat:message', handleIncomingChatMessage);
    };
  }, [socket, user, refreshNotifications]);

  useEffect(() => {
    const handleLocalNotification = (event) => {
      const item = event.detail;
      if (!item?.notificationId) return;
      setNotifications((prev) => [
        item,
        ...(Array.isArray(prev) ? prev.filter((n) => n?.notificationId !== item.notificationId) : [])
      ]);
    };

    window.addEventListener('nas_local_notification', handleLocalNotification);
    return () => window.removeEventListener('nas_local_notification', handleLocalNotification);
  }, []);

  const handleNotificationClick = useCallback(async (notification) => {
    try {
      if (notification?.meta?.localOnly) {
        const now = new Date().toISOString();
        setNotifications((prev) => (Array.isArray(prev) ? prev : []).map((item) =>
          item?.notificationId === notification.notificationId
            ? { ...item, isRead: true, readAt: item.readAt || now }
            : item
        ));
        onNavigateFromNotification(notification);
        return;
      }

      if (notification && !notification.isRead) {
        await readNotificationGroup({
          notificationId: notification.notificationId,
          conversationId: String(notification?.meta?.conversationId || ''),
          fromUserUid: String(notification?.meta?.fromUserUid || ''),
        });
      }

      await refreshNotifications({ silent: true });
      onNavigateFromNotification(notification);
    } catch (err) {
      alert(err.response?.data?.error || '알림 처리에 실패했습니다.');
    }
  }, [onNavigateFromNotification, refreshNotifications]);

  const handleReadAll = useCallback(async () => {
    const prev = notifications;
    const next = markAllNotificationsAsReadLocal(notifications);

    try {
      syncNotifications(next, { preserveLocal: false });
      await readAllNotifications();
    } catch (err) {
      syncNotifications(prev, { preserveLocal: false });
      alert(err.response?.data?.error || '전체 읽음 처리에 실패했습니다.');
    }
  }, [notifications, syncNotifications]);

  const handleReadNotification = useCallback(async (notification) => {
    if (!notification) return;
    const prev = notifications;
    const now = new Date().toISOString();
    const next = notifications.map((item) => item?.notificationId === notification.notificationId
      ? { ...item, isRead: true, readAt: item.readAt || now }
      : item);

    try {
      syncNotifications(next, { preserveLocal: false });
      if (notification?.meta?.localOnly) return;
      await readNotificationGroup({
        notificationId: notification.notificationId,
        conversationId: '',
        fromUserUid: '',
      });
      await refreshNotifications({ silent: true });
    } catch (err) {
      syncNotifications(prev, { preserveLocal: false });
      alert(err.response?.data?.error || '알림 읽음 처리에 실패했습니다.');
    }
  }, [notifications, refreshNotifications, syncNotifications]);

  const handleDeleteNotification = useCallback(async (notification) => {
    if (!notification?.notificationId) return;
    const prev = notifications;
    const next = notifications.filter((item) => item?.notificationId !== notification.notificationId);

    try {
      syncNotifications(next, { preserveLocal: false });
      if (notification?.meta?.localOnly) return;
      await deleteNotification(notification.notificationId);
      await refreshNotifications({ silent: true });
    } catch (err) {
      syncNotifications(prev, { preserveLocal: false });
      alert(err.response?.data?.error || '알림 삭제에 실패했습니다.');
    }
  }, [notifications, refreshNotifications, syncNotifications]);

  const handleDeleteReadNotifications = useCallback(async () => {
    const prev = notifications;
    const next = notifications.filter((item) => !item?.isRead);

    try {
      syncNotifications(next, { preserveLocal: false });
      await deleteReadNotifications();
      await refreshNotifications({ silent: true });
    } catch (err) {
      syncNotifications(prev, { preserveLocal: false });
      alert(err.response?.data?.error || '읽은 알림 삭제에 실패했습니다.');
    }
  }, [notifications, refreshNotifications, syncNotifications]);

  const visibleNotifications = useMemo(
    () => groupNotificationsForDisplay(notifications),
    [notifications]
  );

  const unreadCount = useMemo(
    () => getNotificationBadgeCount(notifications),
    [notifications]
  );

  return {
    loading,
    notifications,
    visibleNotifications,
    unreadCount,
    refreshNotifications,
    handleNotificationClick,
    handleReadNotification,
    handleDeleteNotification,
    deleteReadNotifications: handleDeleteReadNotifications,
    readAllNotifications: handleReadAll,
  };
};

export default useNotifications;
