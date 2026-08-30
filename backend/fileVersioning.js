const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VERSION_ROOT_DIR = '.agent_versions';
const VERSION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FILE_VERSIONS = 100;
const MAX_RESTORE_POINTS = 30;
const RESERVED_ROOT_NAMES = new Set([
  VERSION_ROOT_DIR,
  '.nas_trash',
  '.agent_trash',
  '.agent_incoming'
]);

const isSameOrChild = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
};

const ensureInside = (basePath, targetPath) => {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  if (!isSameOrChild(base, target)) {
    const error = new Error('복구 경로가 사용자 저장공간을 벗어났습니다.');
    error.status = 403;
    throw error;
  }
  return target;
};

const normalizeRelativePath = (basePath, targetPath) => {
  const target = ensureInside(basePath, targetPath);
  const relativePath = path.relative(path.resolve(basePath), target).replace(/\\/g, '/');
  if (!relativePath || relativePath.split('/').some((part) => RESERVED_ROOT_NAMES.has(part))) {
    const error = new Error('내부 복구 저장소는 버전 대상으로 사용할 수 없습니다.');
    error.status = 400;
    throw error;
  }
  return relativePath;
};

const safeId = (value, label) => {
  const id = String(value || '');
  if (!/^[a-z0-9-]{12,100}$/i.test(id)) {
    const error = new Error(`잘못된 ${label}입니다.`);
    error.status = 400;
    throw error;
  }
  return id;
};

const createId = () => `${Date.now().toString(36)}-${crypto.randomBytes(10).toString('hex')}`;
const getVersionRoot = (basePath) => path.join(path.resolve(basePath), VERSION_ROOT_DIR);
const getHistoryRoot = (basePath) => path.join(getVersionRoot(basePath), 'history');
const getRestorePointsRoot = (basePath) => path.join(getVersionRoot(basePath), 'restore-points');
const getActivityPath = (basePath) => path.join(getVersionRoot(basePath), 'activity.ndjson');
const getFavoritesPath = (basePath) => path.join(getVersionRoot(basePath), 'favorites.json');
const getHistoryKey = (relativePath) => crypto.createHash('sha256').update(relativePath).digest('hex');

const writeJsonAtomic = (target, value) => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, target);
};

const readJson = (target, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return fallback;
  }
};

const cloneFile = (source, destination, preferHardLink = false) => {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (preferHardLink) {
    try {
      fs.linkSync(source, destination);
      return 'hardlink';
    } catch {}
  }
  try {
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_FICLONE);
    return 'clone';
  } catch {
    fs.copyFileSync(source, destination);
    return 'copy';
  }
};

const appendActivity = (basePath, activity = {}) => {
  const activityPath = getActivityPath(basePath);
  fs.mkdirSync(path.dirname(activityPath), { recursive: true });
  const row = {
    activityId: createId(),
    at: new Date().toISOString(),
    ...activity
  };
  fs.appendFileSync(activityPath, `${JSON.stringify(row)}\n`, 'utf8');
  return row;
};

const listActivity = (basePath, limit = 100) => {
  const activityPath = getActivityPath(basePath);
  if (!fs.existsSync(activityPath)) return [];
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  return fs.readFileSync(activityPath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-safeLimit)
    .reverse()
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
};

const getItemSummary = (basePath, targetPath) => {
  const relativePath = normalizeRelativePath(basePath, targetPath);
  if (!fs.existsSync(targetPath)) return null;
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) return null;
  return {
    name: path.basename(targetPath),
    fullPath: `/${relativePath}`,
    type: stat.isDirectory() ? 'folder' : 'file',
    size: stat.isFile() ? stat.size : null,
    modified: new Date(stat.mtimeMs).toISOString()
  };
};

const listFavorites = (basePath) => {
  const rows = readJson(getFavoritesPath(basePath), []);
  const items = (Array.isArray(rows) ? rows : [])
    .map((relativePath) => {
      try { return getItemSummary(basePath, ensureInside(basePath, path.join(basePath, relativePath))); } catch { return null; }
    })
    .filter(Boolean);
  const normalizedRows = items.map((item) => item.fullPath.replace(/^\//, ''));
  if (JSON.stringify(normalizedRows) !== JSON.stringify(Array.isArray(rows) ? rows : [])) {
    writeJsonAtomic(getFavoritesPath(basePath), normalizedRows);
  }
  return items;
};

const setFavorite = (basePath, targetPath, favorite) => {
  const relativePath = normalizeRelativePath(basePath, targetPath);
  if (!fs.existsSync(targetPath)) {
    const error = new Error('즐겨찾기에 추가할 항목을 찾을 수 없습니다.');
    error.status = 404;
    throw error;
  }
  const current = readJson(getFavoritesPath(basePath), []);
  const next = (Array.isArray(current) ? current : []).filter((item) => item !== relativePath);
  if (favorite) next.push(relativePath);
  writeJsonAtomic(getFavoritesPath(basePath), next);
  appendActivity(basePath, { type: favorite ? 'favorite-added' : 'favorite-removed', path: `/${relativePath}` });
  return { favorite: !!favorite, item: getItemSummary(basePath, targetPath) };
};

const listRecentFiles = (basePath, limit = 50) => {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const newest = [];
  let visited = 0;
  let limited = false;
  const scan = (currentPath) => {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if (visited >= 60000) { limited = true; return; }
      if (currentPath === path.resolve(basePath) && RESERVED_ROOT_NAMES.has(entry.name)) continue;
      const source = path.join(currentPath, entry.name);
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) continue;
      visited += 1;
      if (entry.isDirectory()) {
        scan(source);
        if (limited) return;
      } else if (entry.isFile()) {
        const summary = getItemSummary(basePath, source);
        if (!summary) continue;
        newest.push({ ...summary, mtimeMs: stat.mtimeMs });
        newest.sort((a, b) => b.mtimeMs - a.mtimeMs);
        if (newest.length > safeLimit) newest.length = safeLimit;
      }
    }
  };
  scan(path.resolve(basePath));
  return { items: newest.map(({ mtimeMs, ...item }) => item), limited };
};

const cleanupFileHistory = (historyDir) => {
  if (!fs.existsSync(historyDir)) return;
  const cutoff = Date.now() - VERSION_RETENTION_MS;
  const versions = fs.readdirSync(historyDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(historyDir, entry.name);
      const meta = readJson(path.join(dir, 'meta.json'), {});
      return { dir, createdAt: Date.parse(meta.createdAt || 0) || fs.statSync(dir).mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  versions.forEach((version, index) => {
    if (index >= MAX_FILE_VERSIONS || version.createdAt < cutoff) {
      fs.rmSync(version.dir, { recursive: true, force: true });
    }
  });
};

const captureFileVersion = (basePath, targetPath, details = {}) => {
  const relativePath = normalizeRelativePath(basePath, targetPath);
  if (!fs.existsSync(targetPath)) return null;
  const stat = fs.lstatSync(targetPath);
  if (!stat.isFile() || stat.isSymbolicLink()) return null;
  const versionId = createId();
  const historyDir = path.join(getHistoryRoot(basePath), getHistoryKey(relativePath));
  const versionDir = path.join(historyDir, versionId);
  fs.mkdirSync(versionDir, { recursive: true });
  const storageMode = cloneFile(targetPath, path.join(versionDir, 'content'), true);
  const meta = {
    versionId,
    relativePath,
    name: path.basename(targetPath),
    size: stat.size,
    sourceMtimeMs: Math.round(stat.mtimeMs),
    createdAt: new Date().toISOString(),
    reason: String(details.reason || 'overwrite').slice(0, 80),
    source: String(details.source || 'web').slice(0, 80),
    actor: String(details.actor || '').slice(0, 160),
    deviceId: String(details.deviceId || '').slice(0, 160),
    storageMode
  };
  writeJsonAtomic(path.join(versionDir, 'meta.json'), meta);
  cleanupFileHistory(historyDir);
  appendActivity(basePath, { type: 'version-created', path: `/${relativePath}`, versionId, source: meta.source, actor: meta.actor });
  return meta;
};

const listFileVersions = (basePath, targetPath) => {
  const relativePath = normalizeRelativePath(basePath, targetPath);
  const historyDir = path.join(getHistoryRoot(basePath), getHistoryKey(relativePath));
  cleanupFileHistory(historyDir);
  if (!fs.existsSync(historyDir)) return [];
  return fs.readdirSync(historyDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJson(path.join(historyDir, entry.name, 'meta.json')))
    .filter((meta) => meta && meta.relativePath === relativePath)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
};

const getFileVersion = (basePath, targetPath, versionIdValue) => {
  const relativePath = normalizeRelativePath(basePath, targetPath);
  const versionId = safeId(versionIdValue, '파일 버전');
  const versionDir = path.join(getHistoryRoot(basePath), getHistoryKey(relativePath), versionId);
  const meta = readJson(path.join(versionDir, 'meta.json'));
  const contentPath = path.join(versionDir, 'content');
  if (!meta || meta.relativePath !== relativePath || !fs.existsSync(contentPath)) {
    const error = new Error('파일 버전을 찾을 수 없습니다.');
    error.status = 404;
    throw error;
  }
  return { meta, contentPath };
};

const restoreFileVersion = (basePath, targetPath, versionId, details = {}) => {
  const target = ensureInside(basePath, targetPath);
  const { meta, contentPath } = getFileVersion(basePath, target, versionId);
  if (fs.existsSync(target)) captureFileVersion(basePath, target, { ...details, reason: 'before-version-restore' });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${createId()}.restore`);
  cloneFile(contentPath, temporary, false);
  try { fs.utimesSync(temporary, new Date(), new Date(meta.sourceMtimeMs || Date.now())); } catch {}
  fs.renameSync(temporary, target);
  appendActivity(basePath, { type: 'version-restored', path: `/${meta.relativePath}`, versionId: meta.versionId, actor: String(details.actor || '') });
  return { ...meta, restoredPath: target };
};

const walkVisibleTree = (basePath, currentPath, visitor) => {
  for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
    if (currentPath === path.resolve(basePath) && RESERVED_ROOT_NAMES.has(entry.name)) continue;
    const source = path.join(currentPath, entry.name);
    const relativePath = path.relative(basePath, source).replace(/\\/g, '/');
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) continue;
    visitor({ source, relativePath, stat, entry });
    if (entry.isDirectory()) walkVisibleTree(basePath, source, visitor);
  }
};

const cleanupRestorePoints = (basePath) => {
  const root = getRestorePointsRoot(basePath);
  if (!fs.existsSync(root)) return;
  const cutoff = Date.now() - VERSION_RETENTION_MS;
  const points = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(root, entry.name);
      const meta = readJson(path.join(dir, 'meta.json'), {});
      return { dir, createdAt: Date.parse(meta.createdAt || 0) || fs.statSync(dir).mtimeMs };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  points.forEach((point, index) => {
    if (index >= MAX_RESTORE_POINTS || point.createdAt < cutoff) fs.rmSync(point.dir, { recursive: true, force: true });
  });
};

const createDriveRestorePoint = (basePath, details = {}) => {
  const base = path.resolve(basePath);
  fs.mkdirSync(base, { recursive: true });
  const restorePointId = createId();
  const pointDir = path.join(getRestorePointsRoot(base), restorePointId);
  const treeDir = path.join(pointDir, 'tree');
  fs.mkdirSync(treeDir, { recursive: true });
  let fileCount = 0;
  let directoryCount = 0;
  let logicalBytes = 0;
  walkVisibleTree(base, base, ({ source, relativePath, stat, entry }) => {
    const destination = path.join(treeDir, relativePath);
    if (entry.isDirectory()) {
      fs.mkdirSync(destination, { recursive: true });
      directoryCount += 1;
    } else if (entry.isFile()) {
      cloneFile(source, destination, true);
      try { fs.utimesSync(destination, stat.atime, stat.mtime); } catch {}
      fileCount += 1;
      logicalBytes += stat.size;
    }
  });
  const meta = {
    restorePointId,
    createdAt: new Date().toISOString(),
    label: String(details.label || '자동 복구 지점').slice(0, 120),
    source: String(details.source || 'web').slice(0, 80),
    actor: String(details.actor || '').slice(0, 160),
    fileCount,
    directoryCount,
    logicalBytes
  };
  writeJsonAtomic(path.join(pointDir, 'meta.json'), meta);
  cleanupRestorePoints(base);
  appendActivity(base, { type: 'restore-point-created', restorePointId, label: meta.label, actor: meta.actor });
  return meta;
};

const listDriveRestorePoints = (basePath) => {
  cleanupRestorePoints(basePath);
  const root = getRestorePointsRoot(basePath);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readJson(path.join(root, entry.name, 'meta.json')))
    .filter(Boolean)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
};

const cloneTree = (sourceRoot, destinationRoot) => {
  fs.mkdirSync(destinationRoot, { recursive: true });
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const source = path.join(current, entry.name);
      const relativePath = path.relative(sourceRoot, source);
      const destination = path.join(destinationRoot, relativePath);
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        fs.mkdirSync(destination, { recursive: true });
        walk(source);
      } else if (entry.isFile()) {
        cloneFile(source, destination, false);
        try { fs.utimesSync(destination, stat.atime, stat.mtime); } catch {}
      }
    }
  };
  walk(sourceRoot);
};

const moveVisibleRootEntries = (basePath, destinationRoot) => {
  fs.mkdirSync(destinationRoot, { recursive: true });
  const moved = [];
  for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
    if (RESERVED_ROOT_NAMES.has(entry.name)) continue;
    const source = path.join(basePath, entry.name);
    const destination = path.join(destinationRoot, entry.name);
    fs.renameSync(source, destination);
    moved.push({ source, destination });
  }
  return moved;
};

const restoreDriveFromPoint = (basePath, restorePointIdValue, details = {}) => {
  const base = path.resolve(basePath);
  const restorePointId = safeId(restorePointIdValue, '드라이브 복구 지점');
  const pointDir = path.join(getRestorePointsRoot(base), restorePointId);
  const treeDir = path.join(pointDir, 'tree');
  const pointMeta = readJson(path.join(pointDir, 'meta.json'));
  if (!pointMeta || !fs.existsSync(treeDir)) {
    const error = new Error('드라이브 복구 지점을 찾을 수 없습니다.');
    error.status = 404;
    throw error;
  }
  const safetyPoint = createDriveRestorePoint(base, {
    label: `복원 직전 자동 보존 - ${pointMeta.label}`,
    source: 'pre-restore',
    actor: details.actor
  });
  const temporaryRoot = path.join(getVersionRoot(base), 'restore-tmp', createId());
  const currentBackup = path.join(temporaryRoot, 'current');
  let moved = [];
  try {
    moved = moveVisibleRootEntries(base, currentBackup);
    cloneTree(treeDir, base);
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  } catch (error) {
    try {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        if (!RESERVED_ROOT_NAMES.has(entry.name)) fs.rmSync(path.join(base, entry.name), { recursive: true, force: true });
      }
      moved.reverse().forEach(({ source, destination }) => {
        if (fs.existsSync(destination)) fs.renameSync(destination, source);
      });
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    } catch {}
    throw error;
  }
  appendActivity(base, {
    type: 'drive-restored',
    restorePointId,
    safetyRestorePointId: safetyPoint.restorePointId,
    actor: String(details.actor || '')
  });
  return { restorePoint: pointMeta, safetyRestorePoint: safetyPoint };
};

module.exports = {
  VERSION_ROOT_DIR,
  VERSION_RETENTION_MS,
  MAX_FILE_VERSIONS,
  captureFileVersion,
  listFileVersions,
  getFileVersion,
  restoreFileVersion,
  createDriveRestorePoint,
  listDriveRestorePoints,
  restoreDriveFromPoint,
  appendActivity,
  listActivity,
  listFavorites,
  setFavorite,
  listRecentFiles,
  _test: {
    cloneFile,
    normalizeRelativePath,
    cleanupFileHistory,
    RESERVED_ROOT_NAMES
  }
};
