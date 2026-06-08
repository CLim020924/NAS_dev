import axios from 'axios';

let isHandlingForcedLogout = false;

const getErrorText = (data) => {
  if (!data) return '';
  if (typeof data === 'string') return data;
  return [
    data.error,
    data.message,
    data.reason
  ].filter(Boolean).join(' ');
};

axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const url = String(error?.config?.url || '');

    const isAuthRequest =
      url.includes('/api/login') ||
      url.includes('/api/signup-request');

    if (status === 401 && !isAuthRequest && !isHandlingForcedLogout) {
      isHandlingForcedLogout = true;

      const errorText = getErrorText(data);
      const isSessionReplaced =
        errorText.includes('SESSION_REPLACED') ||
        errorText.includes('다른 기기') ||
        errorText.includes('다른 장소');

      try {
        localStorage.removeItem('user');
        localStorage.setItem(
          'last_logout_reason',
          isSessionReplaced ? 'SESSION_REPLACED' : 'SESSION_EXPIRED'
        );
      } catch (e) {}

      if (isSessionReplaced) {
        alert('다른 장소에서 로그인되어 현재 기기에서 로그아웃됩니다.');
      } else {
        alert('로그인이 만료되어 다시 로그인해야 합니다.');
      }

      window.location.href = '/login';
    }

    return Promise.reject(error);
  }
);
