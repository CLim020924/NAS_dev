const DEFAULT_PERSIST_INTERVAL_MS = 5 * 60 * 1000;

const durableSyncState = (device = {}) => {
  const state = String(device.syncState || '');
  return device.syncPaused || state === 'paused'
    ? 'paused'
    : (state === 'error' && String(device.lastError || '').trim() ? 'error' : 'active');
};

const stateSignature = (device = {}) => JSON.stringify([
  device.status || '',
  durableSyncState(device),
  !!device.syncPaused,
  device.revokedAt || '',
]);

const createDeviceHeartbeatPersistence = ({
  persistIntervalMs = DEFAULT_PERSIST_INTERVAL_MS,
  now = () => Date.now(),
} = {}) => {
  const live = new Map();
  const lastPersistedAt = new Map();

  const overlay = (rows = []) => {
    const merged = rows.map((row) => live.get(String(row.deviceId || '')) || row);
    const known = new Set(merged.map((row) => String(row.deviceId || '')));
    for (const [deviceId, device] of live) {
      if (!known.has(deviceId)) merged.push(device);
    }
    return merged;
  };

  const stage = (device, { previousDevice = null, force = false } = {}) => {
    const deviceId = String(device?.deviceId || '');
    if (!deviceId) return { persist: false, device };
    const previous = live.get(deviceId) || previousDevice || null;
    live.set(deviceId, device);
    const stateChanged = previous ? stateSignature(previous) !== stateSignature(device) : true;
    const lastPersisted = Number(lastPersistedAt.get(deviceId) || 0);
    const persist = force || stateChanged || now() - lastPersisted >= persistIntervalMs;
    return { persist, stateChanged, device };
  };

  const markPersisted = (rows = []) => {
    const persistedAt = now();
    for (const row of rows) {
      const deviceId = String(row?.deviceId || '');
      if (!deviceId) continue;
      live.set(deviceId, row);
      lastPersistedAt.set(deviceId, persistedAt);
    }
  };

  return { overlay, stage, markPersisted };
};

module.exports = { createDeviceHeartbeatPersistence, _test: { stateSignature, durableSyncState, DEFAULT_PERSIST_INTERVAL_MS } };
