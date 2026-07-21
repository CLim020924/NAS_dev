import axios from 'axios';

export const listNotifications = async () => {
  const res = await axios.get('/api/notifications', { withCredentials: true });
  return Array.isArray(res.data?.notifications) ? res.data.notifications : [];
};

export const getUnreadNotificationCount = async () => {
  const res = await axios.get('/api/notifications/unread-count', { withCredentials: true });
  return Number(res.data?.unreadCount || 0);
};

export const readNotificationGroup = async ({ notificationId, conversationId, fromUserUid }) => {
  await axios.post(
    '/api/notifications/read',
    {
      notificationId,
      conversationId,
      fromUserUid,
    },
    { withCredentials: true }
  );
};

export const readAllNotifications = async () => {
  await axios.post('/api/notifications/read-all', {}, { withCredentials: true });
};

export const deleteNotification = async (notificationId) => {
  await axios.delete(`/api/notifications/${encodeURIComponent(notificationId)}`, { withCredentials: true });
};

export const deleteReadNotifications = async () => {
  await axios.delete('/api/notifications/read', { withCredentials: true });
};
