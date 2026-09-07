const DEVICE_KEY = 'nas_workspace_device_id';

export const getWorkspaceDeviceId = () => {
  if (typeof window === 'undefined' || !window.localStorage) return 'server-render-device';
  let value;
  try { value = window.localStorage.getItem(DEVICE_KEY); } catch { return 'private-session-device'; }
  if (/^[a-zA-Z0-9_-]{8,80}$/.test(value || '')) return value;
  value = (window.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^a-zA-Z0-9_-]/g, '');
  try { window.localStorage.setItem(DEVICE_KEY, value); } catch {}
  return value;
};

const descriptorParams = (descriptor = {}) => ({
  kind: descriptor.kind,
  ...(descriptor.path ? { path: descriptor.path } : {}),
  ...(descriptor.noteId ? { noteId: descriptor.noteId } : {}),
  deviceId: getWorkspaceDeviceId(),
});

export const loadWorkspaceViewState = async (descriptor, signal) => {
  const query = new URLSearchParams(descriptorParams(descriptor));
  const response = await fetch(`/api/workspace/view-state?${query}`, { credentials: 'include', signal });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || '마지막 작업 위치를 불러오지 못했습니다.');
  return (await response.json()).viewState || null;
};

const persist = async (payload, keepalive = false) => {
  const response = await fetch('/api/workspace/view-state', {
    method: 'PUT', credentials: 'include', keepalive,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...descriptorParams(payload.descriptor), state: payload.state, contentRevision: payload.contentRevision ?? null }),
  });
  if (!response.ok) throw new Error('마지막 작업 위치를 저장하지 못했습니다.');
};

export const createWorkspaceViewStateQueue = ({ delay = 650, onError = () => {} } = {}) => {
  let timer = null;
  let pending = null;
  let saving = false;
  let retries = 0;
  const flush = async ({ keepalive = false } = {}) => {
    if (timer) { window.clearTimeout(timer); timer = null; }
    if (saving || !pending) return;
    const current = pending;
    pending = null;
    saving = true;
    try { await persist(current, keepalive); }
    catch (error) {
      pending = pending || current;
      retries += 1;
      onError(error);
      if (!keepalive && retries <= 4) timer = window.setTimeout(() => flush(), Math.min(8000, 500 * (2 ** retries)));
    }
    finally {
      saving = false;
      if (!pending) retries = 0;
      else if (!timer && retries === 0) flush({ keepalive });
    }
  };
  return {
    schedule(descriptor, state, contentRevision = null) {
      if (!descriptor?.kind || !state) return;
      pending = { descriptor, state, contentRevision };
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => flush(), delay);
    },
    flush,
    discard() {
      if (timer) window.clearTimeout(timer);
      timer = null;
      pending = null;
      retries = 0;
    },
    dispose() { flush({ keepalive: true }); },
  };
};
