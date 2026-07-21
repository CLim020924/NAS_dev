const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const archiver = require('archiver');
const config = require('./config/env');
const {
  normalizeQuotaFields,
  findMemberByAnyId,
  getLoginId,
  getAccessBasePath,
  resolveInside,
  isSameOrChild
} = require('./storageQuota');

const router = express.Router();

const JWT_SECRET = config.JWT_SECRET;
const DATA_DIR = path.join(__dirname, 'data');
const SHARES_FILE = path.join(DATA_DIR, 'shares.json');
const SHARE_LOGS_FILE = path.join(DATA_DIR, 'share_logs.json');
const DEFAULT_EXPIRE_DAYS = 15;
const MAX_EXPIRE_DAYS = 90;
const SHARE_PASSWORD_COOKIE_PREFIX = 'share_access_';
const DEFAULT_PUBLIC_BASE_URL = config.PUBLIC_BASE_URL;
const SHARED_COOKIE_DOMAIN = config.COOKIE_DOMAIN;

const normalizeBaseUrl = (value) => {
  const url = String(value || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(url) ? url : '';
};

const isHttpsRequest = (req) =>
  !!req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';

const getRequestHostname = (req) =>
  String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .split(':')[0]
    .toLowerCase();

const shouldUseSharedCookieDomain = (req) => {
  const hostname = getRequestHostname(req);
  return hostname === config.APP_DOMAIN || hostname.endsWith(config.COOKIE_DOMAIN);
};

const getShareAccessCookieOptions = (req) => {
  const options = {
    httpOnly: true,
    sameSite: isHttpsRequest(req) ? 'none' : 'lax',
    secure: isHttpsRequest(req),
    maxAge: 12 * 60 * 60 * 1000,
    path: '/'
  };
  if (isHttpsRequest(req) && shouldUseSharedCookieDomain(req)) {
    options.domain = SHARED_COOKIE_DOMAIN;
  }
  return options;
};

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

const readShares = () => {
  ensureDataDir();
  try {
    if (!fs.existsSync(SHARES_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(SHARES_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
};

const writeShares = (shares) => {
  ensureDataDir();
  fs.writeFileSync(SHARES_FILE, JSON.stringify(shares, null, 2));
};

const readShareLogs = () => {
  ensureDataDir();
  try {
    if (!fs.existsSync(SHARE_LOGS_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(SHARE_LOGS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
};

const writeShareLogs = (logs) => {
  ensureDataDir();
  fs.writeFileSync(SHARE_LOGS_FILE, JSON.stringify(logs.slice(-5000), null, 2));
};

const hashToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

const createShareToken = () => `shr_${crypto.randomBytes(32).toString('base64url')}`;

const hashSharePassword = (password, salt = crypto.randomBytes(16).toString('hex')) => {
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex');
  return { salt, hash };
};

const verifySharePassword = (password, passwordHash = {}) => {
  if (!passwordHash?.salt || !passwordHash?.hash) return false;
  const next = hashSharePassword(password, passwordHash.salt).hash;
  return crypto.timingSafeEqual(Buffer.from(next, 'hex'), Buffer.from(passwordHash.hash, 'hex'));
};

const isExpired = (share) => {
  const expiresAt = new Date(share.expiresAt || 0).getTime();
  return !expiresAt || Date.now() > expiresAt;
};

const isPublicShareActive = (share) => {
  return share && !share.revoked && !isExpired(share);
};

const getTokenShare = (token) => {
  const tokenHash = hashToken(token);
  return readShares().find((share) => share.tokenHash === tokenHash) || null;
};

const updateStoredShare = (shareId, updater) => {
  const shares = readShares();
  const index = shares.findIndex((share) => share.shareId === shareId);
  if (index < 0) return null;
  shares[index] = typeof updater === 'function' ? updater(shares[index]) : { ...shares[index], ...updater };
  writeShares(shares);
  return shares[index];
};

const maskIp = (ip = '') => {
  const value = String(ip || '').replace(/^::ffff:/, '');
  if (!value) return '';
  if (value.includes(':')) return value.split(':').slice(0, 3).join(':') + ':*';
  const parts = value.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.*` : value;
};

const getClientIp = (req) => String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '').split(',')[0].trim();

const addShareLog = (req, share, event, detail = {}) => {
  if (!share?.shareId) return;
  const logs = readShareLogs();
  logs.push({
    id: `log_${crypto.randomBytes(10).toString('hex')}`,
    shareId: share.shareId,
    event,
    detail,
    ip: maskIp(getClientIp(req)),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 240),
    createdAt: new Date().toISOString()
  });
  writeShareLogs(logs);
};

const getShareAccessCookieName = (share) => `${SHARE_PASSWORD_COOKIE_PREFIX}${share.shareId}`;

const createShareAccessToken = (share) => jwt.sign({
  purpose: 'public-share-access',
  shareId: share.shareId,
  tokenHash: share.tokenHash
}, JWT_SECRET, { expiresIn: '12h' });

const hasSharePasswordAccess = (req, share) => {
  if (!share.passwordHash?.hash) return true;
  const cookie = req.cookies?.[getShareAccessCookieName(share)];
  if (!cookie) return false;
  try {
    const decoded = jwt.verify(cookie, JWT_SECRET);
    return decoded?.purpose === 'public-share-access' &&
      decoded?.shareId === share.shareId &&
      decoded?.tokenHash === share.tokenHash;
  } catch (err) {
    return false;
  }
};

const assertShareUsable = (share, action = 'view') => {
  if (!share) {
    const err = new Error('존재하지 않는 공유 링크입니다.');
    err.status = 404;
    throw err;
  }
  if (share.revoked || share.paused) {
    const err = new Error(share.paused ? '일시 중지된 공유 링크입니다.' : '비활성화된 공유 링크입니다.');
    err.status = 410;
    throw err;
  }
  if (isExpired(share)) {
    const err = new Error('만료된 공유 링크입니다.');
    err.status = 410;
    throw err;
  }
  if (action === 'view' && Number(share.maxViews || 0) > 0 && Number(share.viewCount || 0) >= Number(share.maxViews)) {
    const err = new Error('열람 횟수를 초과한 공유 링크입니다.');
    err.status = 410;
    throw err;
  }
  if (action === 'download' && Number(share.maxDownloads || 0) > 0 && Number(share.downloadCount || 0) >= Number(share.maxDownloads)) {
    const err = new Error('다운로드 횟수를 초과한 공유 링크입니다.');
    err.status = 410;
    throw err;
  }
};

const assertPublicShareAccess = (req, share, action = 'view') => {
  assertShareUsable(share, action);
  if (!hasSharePasswordAccess(req, share)) {
    const err = new Error('비밀번호 확인이 필요합니다.');
    err.status = 423;
    err.requiresPassword = true;
    throw err;
  }
};

const getUserFromRequest = (req) => {
  const token = req.cookies?.token;
  if (!token) {
    const err = new Error('로그인이 필요합니다.');
    err.status = 401;
    throw err;
  }

  const decoded = jwt.verify(token, JWT_SECRET);
  const latest = findMemberByAnyId(decoded);
  if (!latest) {
    const err = new Error('사용자를 찾을 수 없습니다.');
    err.status = 401;
    throw err;
  }

  return normalizeQuotaFields({ ...decoded, ...latest });
};

const getPublicBaseUrl = () =>
  normalizeBaseUrl(process.env.PUBLIC_BASE_URL) || DEFAULT_PUBLIC_BASE_URL;

const getFileType = (targetPath) => {
  if (!fs.existsSync(targetPath)) {
    const err = new Error('공유 대상이 존재하지 않습니다.');
    err.status = 404;
    throw err;
  }

  const stat = fs.statSync(targetPath);
  return stat.isDirectory() ? 'folder' : 'file';
};

const toPublicItem = (rootPath, fullPath, share) => {
  const stat = fs.statSync(fullPath);
  const rel = path.relative(rootPath, fullPath).replace(/\\/g, '/');
  const type = stat.isDirectory() ? 'folder' : 'file';
  return {
    name: path.basename(fullPath),
    type,
    relativePath: rel || '',
    size: type === 'file' ? stat.size : null,
    modifiedAt: stat.mtime.toISOString(),
    canEnter: type === 'folder' && share.includeSubfolders !== false
  };
};

const getShareRoot = (share) => {
  if (!share?.targetPath || !fs.existsSync(share.targetPath)) {
    const err = new Error('공유된 파일을 찾을 수 없습니다.');
    err.status = 404;
    throw err;
  }
  return path.resolve(share.targetPath);
};

const getShareTargets = (share) => {
  if (Array.isArray(share?.targets) && share.targets.length > 0) {
    return share.targets.map((target) => ({
      path: path.resolve(target.path),
      type: target.type,
      name: target.name || path.basename(target.path) || '공유 항목'
    }));
  }
  if (!share?.targetPath) return [];
  return [{
    path: path.resolve(share.targetPath),
    type: share.targetType,
    name: share.displayName || path.basename(share.targetPath) || '공유 항목'
  }];
};

const isBundleShare = (share) => share.targetType === 'bundle' || getShareTargets(share).length > 1;

const getSafeBundleName = (target, index) => {
  const raw = String(target.name || path.basename(target.path) || `item-${index + 1}`).replace(/[\\/]+/g, ' ').trim();
  return raw || `item-${index + 1}`;
};

const getSafeArchiveEntryName = (value, fallback = 'shared-item') => {
  const raw = String(value || fallback).replace(/[\\/]+/g, ' ').trim();
  return raw || fallback;
};

const findBundleTarget = (share, relativePath = '') => {
  const clean = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const [head, ...rest] = clean.split('/').filter(Boolean);
  const targets = getShareTargets(share);
  if (!head) return { target: null, root: null, rest: '' };
  const target = targets.find((item, index) => getSafeBundleName(item, index) === head);
  if (!target) {
    const err = new Error('공유 항목을 찾을 수 없습니다.');
    err.status = 404;
    throw err;
  }
  return { target, root: path.resolve(target.path), rest: rest.join('/') };
};

const resolveSharedPath = (share, relativePath = '') => {
  if (isBundleShare(share)) {
    const { target, root, rest } = findBundleTarget(share, relativePath);
    if (!target) {
      const err = new Error('공유 항목을 선택해야 합니다.');
      err.status = 400;
      throw err;
    }
    const resolved = target.type === 'file' ? root : resolveInside(root, rest || '');
    if (!isSameOrChild(root, resolved)) {
      const err = new Error('공유 범위를 벗어난 경로입니다.');
      err.status = 403;
      throw err;
    }
    if (target.type === 'folder' && share.includeSubfolders === false && rest && rest.includes('/')) {
      const err = new Error('하위 폴더 접근이 허용되지 않은 공유 링크입니다.');
      err.status = 403;
      throw err;
    }
    return resolved;
  }

  const root = getShareRoot(share);
  const target = resolveInside(root, relativePath || '');
  if (!isSameOrChild(root, target)) {
    const err = new Error('공유 범위를 벗어난 경로입니다.');
    err.status = 403;
    throw err;
  }

  const rel = path.relative(root, target).replace(/\\/g, '/');
  if (share.includeSubfolders === false && rel && rel.includes('/')) {
    const err = new Error('하위 폴더 접근이 허용되지 않은 공유 링크입니다.');
    err.status = 403;
    throw err;
  }

  return target;
};

const getPublicSharePayload = (share, req) => {
  const bundle = isBundleShare(share);
  const root = bundle ? null : getShareRoot(share);
  const type = bundle ? 'bundle' : getFileType(root);
  const stat = root ? fs.statSync(root) : null;
  return {
    shareId: share.shareId,
    name: share.displayName || (root ? path.basename(root) : '?? ??') || '?? ??',
    type,
    itemCount: getShareTargets(share).length,
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    allowPreview: share.allowPreview !== false,
    allowDownload: share.allowDownload !== false,
    allowFolderDownload: share.allowFolderDownload === true,
    includeSubfolders: share.includeSubfolders !== false,
    requiresPassword: !!share.passwordHash?.hash,
    note: share.note || '',
    maxViews: Number(share.maxViews || 0),
    viewCount: Number(share.viewCount || 0),
    maxDownloads: Number(share.maxDownloads || 0),
    size: type === 'file' ? stat.size : null,
    modifiedAt: stat ? stat.mtime.toISOString() : (share.updatedAt || share.createdAt),
    ownerDisplayName: share.ownerDisplayName || share.ownerLoginId || '',
    downloadCount: Number(share.downloadCount || 0),
    url: share.publicToken ? getPublicBaseUrl(req) + '/share/' + share.publicToken : ''
  };
};

const toClientPath = (basePath, targetPath) => {
  const rel = path.relative(path.resolve(basePath), path.resolve(targetPath)).replace(/\\/g, '/');
  return rel ? `/${rel}` : '/';
};

const resolveUserShareTarget = (basePath, requestedPath) => {
  const raw = String(requestedPath || '').trim();
  if (path.isAbsolute(raw)) {
    const resolved = path.resolve(raw);
    if (isSameOrChild(basePath, resolved)) return resolved;
  }
  return resolveInside(basePath, raw);
};

const removeNestedShareTargets = (targets = []) => {
  const unique = [];
  const seen = new Set();

  targets.forEach((target) => {
    if (!target?.path) return;
    const resolved = path.resolve(target.path);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    unique.push({ ...target, path: resolved });
  });

  unique.sort((a, b) => a.path.length - b.path.length);

  return unique.filter((target, index, list) => !list.some((candidate, candidateIndex) => {
    if (candidateIndex >= index) return false;
    if (candidate.type !== 'folder') return false;
    return isSameOrChild(candidate.path, target.path);
  }));
};

router.post('/shares', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const requestedPaths = Array.isArray(req.body?.paths) ? req.body.paths : [req.body?.path];
    const cleanPaths = requestedPaths.filter(Boolean).map(String);
    if (cleanPaths.length === 0) return res.status(400).json({ error: '공유할 경로가 필요합니다.' });

    const basePath = getAccessBasePath(user);
    const targets = removeNestedShareTargets(cleanPaths.map((requestedPath) => {
      const resolvedPath = resolveUserShareTarget(basePath, requestedPath);
      return {
        path: resolvedPath,
        type: getFileType(resolvedPath),
        name: path.basename(resolvedPath) || '공유 항목'
      };
    }));
    const targetPath = targets[0].path;
    const targetType = targets.length > 1 ? 'bundle' : targets[0].type;
    const token = createShareToken();
    const now = new Date();
    const days = Math.max(1, Math.min(MAX_EXPIRE_DAYS, Number(req.body?.expireDays || DEFAULT_EXPIRE_DAYS)));
    const requestedExpiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    const maxExpiresAt = new Date(now.getTime() + MAX_EXPIRE_DAYS * 24 * 60 * 60 * 1000);
    const expiresAt = requestedExpiresAt && Number.isFinite(requestedExpiresAt.getTime()) && requestedExpiresAt > now
      ? new Date(Math.min(requestedExpiresAt.getTime(), maxExpiresAt.getTime()))
      : new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const shareId = `share_${crypto.randomBytes(12).toString('hex')}`;
    const displayName = String(req.body?.displayName || path.basename(targetPath) || '공유 항목').trim().slice(0, 120);
    const rawPassword = String(req.body?.password || '').trim();
    const passwordHash = rawPassword ? hashSharePassword(rawPassword) : null;

    const share = {
      shareId,
      tokenHash: hashToken(token),
      publicToken: token,
      ownerUid: user.userUid || '',
      ownerLoginId: getLoginId(user),
      ownerDisplayName: user.displayName || user.nickname || getLoginId(user),
      targetPath,
      targetType,
      targets,
      displayName,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      revoked: false,
      paused: req.body?.paused === true,
      passwordHash,
      note: String(req.body?.note || '').trim().slice(0, 1000),
      maxViews: Math.max(0, Math.floor(Number(req.body?.maxViews || 0))),
      viewCount: 0,
      maxDownloads: Math.max(0, Math.floor(Number(req.body?.maxDownloads || 0))),
      allowPreview: req.body?.allowPreview !== false,
      allowDownload: req.body?.allowDownload !== false,
      includeSubfolders: (targetType === 'folder' || targetType === 'bundle') ? req.body?.includeSubfolders !== false : false,
      allowFolderDownload: (targetType === 'folder' || targetType === 'bundle') ? req.body?.allowFolderDownload === true : false,
      downloadCount: 0,
      lastAccessedAt: ''
    };

    const shares = readShares();
    shares.push(share);
    writeShares(shares);

    return res.json({
      share: {
        ...getPublicSharePayload({ ...share, publicToken: token }, req),
        shareId
      },
      token,
      url: `${getPublicBaseUrl(req)}/share/${token}`
    });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '공유 링크 생성에 실패했습니다.' });
  }
});

router.get('/shares', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const basePath = getAccessBasePath(user);
    const ownerKeys = [user.userUid, getLoginId(user)].filter(Boolean).map(String);
    const shares = readShares()
      .filter((share) => ownerKeys.includes(String(share.ownerUid || '')) || ownerKeys.includes(String(share.ownerLoginId || '')))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map((share) => ({
        shareId: share.shareId,
        name: share.displayName,
        type: share.targetType,
        targetPath: toClientPath(basePath, share.targetPath),
        targets: getShareTargets(share).map((target, index) => ({
          name: getSafeBundleName(target, index),
          type: target.type,
          targetPath: toClientPath(basePath, target.path)
        })),
        url: share.publicToken ? `${getPublicBaseUrl(req)}/share/${share.publicToken}` : '',
        createdAt: share.createdAt,
        expiresAt: share.expiresAt,
        revoked: !!share.revoked,
        paused: !!share.paused,
        expired: isExpired(share),
        requiresPassword: !!share.passwordHash?.hash,
        note: share.note || '',
        maxViews: Number(share.maxViews || 0),
        viewCount: Number(share.viewCount || 0),
        maxDownloads: Number(share.maxDownloads || 0),
        allowPreview: share.allowPreview !== false,
        allowDownload: share.allowDownload !== false,
        allowFolderDownload: share.allowFolderDownload === true,
        includeSubfolders: share.includeSubfolders !== false,
        downloadCount: Number(share.downloadCount || 0)
      }));

    return res.json({ shares });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '공유 링크 목록을 불러오지 못했습니다.' });
  }
});

router.patch('/shares/:shareId', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const loginId = getLoginId(user);
    const shares = readShares();
    const index = shares.findIndex((share) => share.shareId === req.params.shareId);
    if (index < 0) return res.status(404).json({ error: '공유 링크를 찾을 수 없습니다.' });

    const share = shares[index];
    const ownsShare = share.ownerUid === user.userUid || share.ownerLoginId === loginId;
    const isManager = user.Masters || user.Managers || user.role === 'MASTER' || user.role === 'MANAGER';
    if (!ownsShare && !isManager) return res.status(403).json({ error: '공유 링크를 수정할 권한이 없습니다.' });

    let nextTargetPath = share.targetPath;
    let nextTargetType = share.targetType;
    if (typeof req.body?.path === 'string' && req.body.path.trim()) {
      const basePath = getAccessBasePath(user);
      nextTargetPath = resolveUserShareTarget(basePath, req.body.path);
      nextTargetType = getFileType(nextTargetPath);
    }

    let nextExpiresAt = share.expiresAt;
    if (req.body?.expireDays !== undefined) {
      const days = Math.max(1, Math.min(MAX_EXPIRE_DAYS, Number(req.body.expireDays || DEFAULT_EXPIRE_DAYS)));
      nextExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }
    if (req.body?.expiresAt) {
      const requestedExpiresAt = new Date(req.body.expiresAt);
      const now = new Date();
      const maxExpiresAt = new Date(now.getTime() + MAX_EXPIRE_DAYS * 24 * 60 * 60 * 1000);
      if (Number.isFinite(requestedExpiresAt.getTime()) && requestedExpiresAt > now) {
        nextExpiresAt = new Date(Math.min(requestedExpiresAt.getTime(), maxExpiresAt.getTime())).toISOString();
      }
    }

    const displayName = String(req.body?.displayName || share.displayName || path.basename(nextTargetPath) || '공유 항목').trim().slice(0, 120);
    let nextPasswordHash = share.passwordHash || null;
    if (req.body?.clearPassword === true) nextPasswordHash = null;
    const rawPassword = String(req.body?.password || '').trim();
    if (rawPassword) nextPasswordHash = hashSharePassword(rawPassword);

    shares[index] = {
      ...share,
      targetPath: nextTargetPath,
      targetType: nextTargetType,
      targets: [{ path: nextTargetPath, type: nextTargetType, name: path.basename(nextTargetPath) || displayName }],
      displayName,
      expiresAt: nextExpiresAt,
      paused: req.body?.paused !== undefined ? req.body.paused === true : !!share.paused,
      passwordHash: nextPasswordHash,
      note: req.body?.note !== undefined ? String(req.body.note || '').trim().slice(0, 1000) : (share.note || ''),
      maxViews: req.body?.maxViews !== undefined ? Math.max(0, Math.floor(Number(req.body.maxViews || 0))) : Number(share.maxViews || 0),
      maxDownloads: req.body?.maxDownloads !== undefined ? Math.max(0, Math.floor(Number(req.body.maxDownloads || 0))) : Number(share.maxDownloads || 0),
      allowPreview: req.body?.allowPreview !== undefined ? req.body.allowPreview !== false : share.allowPreview !== false,
      allowDownload: req.body?.allowDownload !== undefined ? req.body.allowDownload !== false : share.allowDownload !== false,
      includeSubfolders: (nextTargetType === 'folder' || nextTargetType === 'bundle')
        ? (req.body?.includeSubfolders !== undefined ? req.body.includeSubfolders !== false : share.includeSubfolders !== false)
        : false,
      allowFolderDownload: (nextTargetType === 'folder' || nextTargetType === 'bundle')
        ? (req.body?.allowFolderDownload !== undefined ? req.body.allowFolderDownload === true : share.allowFolderDownload === true)
        : false,
      updatedAt: new Date().toISOString()
    };

    writeShares(shares);
    return res.json({ share: shares[index] });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '공유 링크 수정에 실패했습니다.' });
  }
});

router.post('/shares/:shareId/regenerate-token', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const loginId = getLoginId(user);
    const shares = readShares();
    const index = shares.findIndex((share) => share.shareId === req.params.shareId);
    if (index < 0) return res.status(404).json({ error: '공유 링크를 찾을 수 없습니다.' });

    const share = shares[index];
    const ownsShare = share.ownerUid === user.userUid || share.ownerLoginId === loginId;
    const isManager = user.Masters || user.Managers || user.role === 'MASTER' || user.role === 'MANAGER';
    if (!ownsShare && !isManager) return res.status(403).json({ error: '공유 링크를 재발급할 권한이 없습니다.' });

    const token = createShareToken();
    shares[index] = {
      ...share,
      tokenHash: hashToken(token),
      publicToken: token,
      revoked: false,
      regeneratedAt: new Date().toISOString()
    };
    writeShares(shares);
    return res.json({ token, url: `${getPublicBaseUrl(req)}/share/${token}` });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '공유 링크 재발급에 실패했습니다.' });
  }
});

router.get('/shares/:shareId/logs', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const loginId = getLoginId(user);
    const shares = readShares();
    const share = shares.find((item) => item.shareId === req.params.shareId);
    if (!share) return res.status(404).json({ error: '공유 링크를 찾을 수 없습니다.' });

    const ownsShare = share.ownerUid === user.userUid || share.ownerLoginId === loginId;
    const isManager = user.Masters || user.Managers || user.role === 'MASTER' || user.role === 'MANAGER';
    if (!ownsShare && !isManager) return res.status(403).json({ error: '공유 로그를 볼 권한이 없습니다.' });

    const logs = readShareLogs()
      .filter((log) => log.shareId === share.shareId)
      .slice(-200)
      .reverse();
    return res.json({ logs });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '공유 로그를 불러오지 못했습니다.' });
  }
});

router.delete('/shares/:shareId', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const loginId = getLoginId(user);
    const shares = readShares();
    const index = shares.findIndex((share) => share.shareId === req.params.shareId);
    if (index < 0) return res.status(404).json({ error: '공유 링크를 찾을 수 없습니다.' });

    const share = shares[index];
    const ownsShare = share.ownerUid === user.userUid || share.ownerLoginId === loginId;
    const isManager = user.Masters || user.Managers || user.role === 'MASTER' || user.role === 'MANAGER';
    if (!ownsShare && !isManager) return res.status(403).json({ error: '공유 링크를 삭제할 권한이 없습니다.' });

    shares[index] = { ...share, revoked: true, revokedAt: new Date().toISOString() };
    writeShares(shares);
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '공유 링크 삭제에 실패했습니다.' });
  }
});

router.delete('/shares/:shareId/purge', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const loginId = getLoginId(user);
    const shares = readShares();
    const index = shares.findIndex((share) => share.shareId === req.params.shareId);
    if (index < 0) return res.status(404).json({ error: '공유 링크를 찾을 수 없습니다.' });

    const share = shares[index];
    const ownsShare = share.ownerUid === user.userUid || share.ownerLoginId === loginId;
    const isManager = user.Masters || user.Managers || user.role === 'MASTER' || user.role === 'MANAGER';
    if (!ownsShare && !isManager) return res.status(403).json({ error: '공유 링크를 제거할 권한이 없습니다.' });
    if (!share.revoked) return res.status(409).json({ error: '먼저 공유 링크를 삭제해 비활성화해야 합니다.' });

    shares.splice(index, 1);
    writeShares(shares);

    const logs = readShareLogs().filter((log) => log.shareId !== req.params.shareId);
    writeShareLogs(logs);

    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '공유 링크 제거에 실패했습니다.' });
  }
});

router.get('/public-shares/:token', (req, res) => {
  try {
    const share = getTokenShare(req.params.token);
    assertShareUsable(share, 'view');
    if (!hasSharePasswordAccess(req, share)) {
      addShareLog(req, share, 'password_required');
      return res.status(423).json({
        requiresPassword: true,
        share: {
          shareId: share.shareId,
          name: share.displayName || '비밀번호 보호 공유',
          requiresPassword: true,
          expiresAt: share.expiresAt
        }
      });
    }

    const updated = updateStoredShare(share.shareId, (item) => ({
      ...item,
      viewCount: Number(item.viewCount || 0) + 1,
      lastAccessedAt: new Date().toISOString()
    })) || share;
    addShareLog(req, updated, 'view');
    return res.json({ share: getPublicSharePayload(updated, req) });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '공유 링크 정보를 불러오지 못했습니다.' });
  }
});

router.post('/public-shares/:token/password', (req, res) => {
  try {
    const share = getTokenShare(req.params.token);
    assertShareUsable(share, 'view');
    const password = String(req.body?.password || '');
    if (!share.passwordHash?.hash || !verifySharePassword(password, share.passwordHash)) {
      if (share) addShareLog(req, share, 'password_failed');
      return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' });
    }

    res.cookie(getShareAccessCookieName(share), createShareAccessToken(share), getShareAccessCookieOptions(req));
    addShareLog(req, share, 'password_success');
    return res.json({ success: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '비밀번호 확인에 실패했습니다.' });
  }
});

router.get('/public-shares/:token/list', (req, res) => {
  try {
    const share = getTokenShare(req.params.token);
    assertPublicShareAccess(req, share, 'view');
    if (share.targetType !== 'folder' && share.targetType !== 'bundle') return res.status(400).json({ error: '폴더 공유 링크가 아닙니다.' });
    addShareLog(req, share, 'list', { path: req.query.path || '' });

    const requestedRelative = String(req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (isBundleShare(share) && !requestedRelative) {
      const items = getShareTargets(share)
        .map((target, index) => {
          try {
            const stat = fs.statSync(target.path);
            const type = stat.isDirectory() ? 'folder' : 'file';
            const name = getSafeBundleName(target, index);
            return {
              name,
              type,
              relativePath: name,
              size: type === 'file' ? stat.size : null,
              modifiedAt: stat.mtime.toISOString(),
              canEnter: type === 'folder' && share.includeSubfolders !== false
            };
          } catch (err) {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
      return res.json({ path: '', items });
    }

    const root = isBundleShare(share) ? findBundleTarget(share, requestedRelative).root : getShareRoot(share);
    const current = resolveSharedPath(share, requestedRelative);
    if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()) {
      return res.status(400).json({ error: '폴더가 아닙니다.' });
    }

    const items = fs.readdirSync(current)
      .filter((name) => !name.startsWith('.msp-'))
      .map((name) => {
        try {
          const item = toPublicItem(root, path.join(current, name), share);
          if (isBundleShare(share)) {
            return {
              ...item,
              relativePath: [requestedRelative, item.relativePath].filter(Boolean).join('/')
            };
          }
          return item;
        } catch (err) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    const relativePath = isBundleShare(share)
      ? requestedRelative
      : path.relative(root, current).replace(/\\/g, '/');
    return res.json({ path: relativePath || '', items });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '공유 폴더 목록을 불러오지 못했습니다.' });
  }
});

const sendSharedFile = (req, res, disposition) => {
  const share = getTokenShare(req.params.token);
  assertPublicShareAccess(req, share, disposition === 'attachment' ? 'download' : 'view');
  if (disposition === 'inline' && share.allowPreview === false) return res.status(403).json({ error: '미리보기가 허용되지 않았습니다.' });
  if (disposition === 'attachment' && share.allowDownload === false) return res.status(403).json({ error: '다운로드가 허용되지 않았습니다.' });

  const targetPath = (share.targetType === 'file' && !isBundleShare(share))
    ? getShareRoot(share)
    : resolveSharedPath(share, req.query.path || '');

  if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
    return res.status(404).json({ error: '공유 파일을 찾을 수 없습니다.' });
  }

  if (disposition === 'attachment') {
    const shares = readShares().map((item) => item.shareId === share.shareId
      ? { ...item, downloadCount: Number(item.downloadCount || 0) + 1, lastDownloadedAt: new Date().toISOString() }
      : item);
    writeShares(shares);
    addShareLog(req, share, 'download', { path: req.query.path || '', name: path.basename(targetPath) });
    res.download(targetPath, path.basename(targetPath), { dotfiles: 'allow' });
    return;
  }

  addShareLog(req, share, 'preview', { path: req.query.path || '', name: path.basename(targetPath) });
  res.sendFile(targetPath, { dotfiles: 'allow' });
};

router.get('/public-shares/:token/preview', (req, res) => {
  try {
    return sendSharedFile(req, res, 'inline');
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '미리보기를 열 수 없습니다.' });
  }
});

router.get('/public-shares/:token/download', (req, res) => {
  try {
    return sendSharedFile(req, res, 'attachment');
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || '다운로드할 수 없습니다.' });
  }
});

router.get('/public-shares/:token/download-folder', (req, res) => {
  try {
    const share = getTokenShare(req.params.token);
    assertPublicShareAccess(req, share, 'download');
    if (share.targetType !== 'folder' && share.targetType !== 'bundle') return res.status(400).json({ error: '폴더 공유 링크가 아닙니다.' });
    if (share.allowDownload === false || share.allowFolderDownload !== true) {
      return res.status(403).json({ error: '폴더 전체 다운로드가 허용되지 않았습니다.' });
    }

    const requestedRelative = String(req.query.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const targetPath = (isBundleShare(share) && !requestedRelative) ? null : resolveSharedPath(share, requestedRelative);
    if (targetPath && (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory())) {
      return res.status(400).json({ error: '폴더가 아닙니다.' });
    }

    const folderName = targetPath ? (path.basename(targetPath) || share.displayName || 'shared-folder') : (share.displayName || 'shared-bundle');
    const shares = readShares().map((item) => item.shareId === share.shareId
      ? { ...item, downloadCount: Number(item.downloadCount || 0) + 1, lastDownloadedAt: new Date().toISOString() }
      : item);
    writeShares(shares);
    addShareLog(req, share, 'download-folder', { path: requestedRelative || '', name: folderName });

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(folderName)}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);
    if (targetPath) {
      archive.directory(targetPath, folderName);
    } else {
      getShareTargets(share).forEach((target, index) => {
        const entryName = getSafeBundleName(target, index);
        if (!fs.existsSync(target.path)) return;
        if (fs.statSync(target.path).isDirectory()) archive.directory(target.path, entryName);
        else archive.file(target.path, { name: entryName });
      });
    }
    archive.finalize();
  } catch (err) {
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message || '폴더를 다운로드할 수 없습니다.' });
  }
});

router.post('/public-shares/:token/download-selected', express.json(), (req, res) => {
  try {
    const share = getTokenShare(req.params.token);
    assertPublicShareAccess(req, share, 'download');
    if (share.allowDownload === false) {
      return res.status(403).json({ error: '다운로드가 허용되지 않았습니다.' });
    }

    const rawPaths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    const cleanPaths = [...new Set(rawPaths.map((item) =>
      String(item || '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
    ).filter((item) => item || (share.targetType === 'file' && !isBundleShare(share))))].slice(0, 200);

    if (cleanPaths.length === 0) return res.status(400).json({ error: '다운로드할 항목을 선택해주세요.' });

    const resolvedItems = cleanPaths.map((relativePath) => {
      const fullPath = (share.targetType === 'file' && !isBundleShare(share))
        ? getShareRoot(share)
        : resolveSharedPath(share, relativePath);
      if (!fs.existsSync(fullPath)) {
        const err = new Error('선택한 공유 항목을 찾을 수 없습니다.');
        err.status = 404;
        throw err;
      }
      const stat = fs.statSync(fullPath);
      return {
        relativePath,
        fullPath,
        type: stat.isDirectory() ? 'folder' : 'file',
        name: getSafeArchiveEntryName(path.basename(fullPath) || relativePath || share.displayName || 'shared-item')
      };
    });

    const hasFolder = resolvedItems.some((item) => item.type === 'folder');
    if (!hasFolder && resolvedItems.length === 1) {
      const target = resolvedItems[0];
      const shares = readShares().map((item) => item.shareId === share.shareId
        ? { ...item, downloadCount: Number(item.downloadCount || 0) + 1, lastDownloadedAt: new Date().toISOString() }
        : item);
      writeShares(shares);
      addShareLog(req, share, 'download-selected-file', { path: target.relativePath, name: target.name });
      return res.download(target.fullPath, target.name, { dotfiles: 'allow' });
    }

    const archiveName = getSafeArchiveEntryName(share.displayName || 'selected-items');
    const shares = readShares().map((item) => item.shareId === share.shareId
      ? { ...item, downloadCount: Number(item.downloadCount || 0) + 1, lastDownloadedAt: new Date().toISOString() }
      : item);
    writeShares(shares);
    addShareLog(req, share, 'download-selected-zip', {
      count: resolvedItems.length,
      hasFolder,
      paths: resolvedItems.map((item) => item.relativePath).slice(0, 50)
    });

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(archiveName)}-selected.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);

    const usedEntryNames = new Map();
    const uniqueEntryName = (name) => {
      const safeName = getSafeArchiveEntryName(name);
      const count = usedEntryNames.get(safeName) || 0;
      usedEntryNames.set(safeName, count + 1);
      if (!count) return safeName;
      const ext = path.extname(safeName);
      const base = ext ? safeName.slice(0, -ext.length) : safeName;
      return `${base}-${count + 1}${ext}`;
    };

    resolvedItems.forEach((item) => {
      const entryName = uniqueEntryName(item.name);
      if (item.type === 'folder') archive.directory(item.fullPath, entryName);
      else archive.file(item.fullPath, { name: entryName });
    });
    archive.finalize();
  } catch (err) {
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message || '선택 항목을 다운로드할 수 없습니다.' });
  }
});

module.exports = router;
