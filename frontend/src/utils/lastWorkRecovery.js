export const RECOVERY_LOGIN_KEY = 'nas_resume_pending_for';

const APP_IDS = new Set(['note-studio', 'document-workspace', 'document-studio', 'meeting']);

export const normalizeLastWork = (target) => {
  if (!target || typeof target !== 'object') return null;
  if (target.type === 'app' && APP_IDS.has(target.appId)) {
    return { type: 'app', appId: target.appId, label: String(target.label || '앱').slice(0, 120) };
  }
  if (target.type === 'file' || target.type === 'folder') {
    const path = String(target.path || '');
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\0') || path.split('/').some((part) => part === '..' || part === '.')) return null;
    return { type: target.type, path, label: String(target.label || path.split('/').filter(Boolean).pop() || '파일 관리자').slice(0, 120) };
  }
  return null;
};

export const recoveryOfferForAccount = (storage, accountId, savedState) => {
  if (!accountId || storage?.getItem(RECOVERY_LOGIN_KEY) !== accountId) return null;
  return normalizeLastWork(savedState?.target);
};
