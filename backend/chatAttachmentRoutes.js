const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const {
  TEMP_ROOT,
  INCOMING_ROOT,
  ensureStore,
  getBundleDir,
  ensureUniqueName,
  cleanupExpiredPendingBundles,
  createBundleRecord,
  getBundle,
  cancelBundle,
} = require('./chatAttachmentStore');
const {
  NAS_ROOT,
  findMemberByAnyId,
  normalizeQuotaFields,
  getAccessBasePath,
  resolveInside,
  getCachedPathUsage,
  invalidateUsageCache,
  assertQuotaAvailable
} = require('./storageQuota');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'my-service-platform-secure-key-2026';
const nasPath = NAS_ROOT;

ensureStore();

const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = normalizeQuotaFields({ ...decoded, ...(findMemberByAnyId(decoded) || {}) });
    next();
  } catch (e) {
    return res.status(401).json({ error: '인증실패' });
  }
};

const getLoginId = (user = {}) => user.loginId || user.id || user.username || '';

const getValidatedNasPath = (user, requestedPath) => {
  const normalized = normalizeQuotaFields(user || {});
  const basePath = getAccessBasePath(normalized);
  const targetPath = resolveInside(basePath, requestedPath || '');
  return { basePath, targetPath };
};

const prepareBundleUpload = (req, res, next) => {
  cleanupExpiredPendingBundles();
  req.uploadBundleId = `cab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  req.uploadBundleDir = getBundleDir(req.uploadBundleId);
  fs.mkdirSync(req.uploadBundleDir, { recursive: true });
  next();
};

const upload = multer({
  dest: INCOMING_ROOT,
  limits: {
    files: 200,
    fileSize: 1024 * 1024 * 1024,
  },
});

const normalizeRelPath = (value = '') => {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.(\/|\\)/g, '');
};

const buildDeviceManifestMap = (manifestRaw) => {
  try {
    const parsed = JSON.parse(manifestRaw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    return [];
  }
};

router.post(
  '/chat/attachments/from-device',
  verifyToken,
  prepareBundleUpload,
  upload.any(),
  async (req, res) => {
    try {
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) {
        return res.status(400).json({ error: '업로드할 파일이 없습니다.' });
      }

      const incomingBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
      await assertQuotaAvailable(req.user, incomingBytes, req.uploadBundleDir);

      const manifest = buildDeviceManifestMap(req.body.manifest);
      const manifestByKey = new Map();
      manifest.forEach((item, idx) => {
        const key = `${item.originalName || ''}__${idx}`;
        manifestByKey.set(key, item);
      });

      const bundleDir = req.uploadBundleDir;
      const items = [];

      files.forEach((file, idx) => {
        const originalName = Buffer.from(file.originalname || '', 'latin1').toString('utf8') || `file_${idx}`;
        const manifestItem = manifestByKey.get(`${originalName}__${idx}`) || manifest[idx] || {};
        const relPath = normalizeRelPath(manifestItem.relativePath || originalName);
        const relDir = path.dirname(relPath) === '.' ? '' : path.dirname(relPath);
        const wantedName = path.basename(relPath) || originalName;
        const destDir = relDir ? path.join(bundleDir, relDir) : bundleDir;

        fs.mkdirSync(destDir, { recursive: true });
        const finalName = ensureUniqueName(destDir, wantedName);
        const finalPath = path.join(destDir, finalName);
        fs.renameSync(file.path, finalPath);

        items.push({
          entryId: `entry_${idx}_${Date.now()}`,
          sourceType: 'device',
          type: 'file',
          name: finalName,
          relativePath: relDir ? `${relDir}/${finalName}` : finalName,
          size: fs.statSync(finalPath).size,
        });
      });

      const record = createBundleRecord({
        ownerUid: req.user.userUid || getLoginId(req.user),
        ownerLoginId: getLoginId(req.user),
        sourceType: 'device',
        items,
      });

      const oldDir = bundleDir;
      const finalDir = getBundleDir(record.bundleId);
      if (oldDir !== finalDir) {
        if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
        fs.renameSync(oldDir, finalDir);
      }
      invalidateUsageCache(finalDir);

      return res.json({ bundle: record });
    } catch (err) {
      [...(Array.isArray(req.files) ? req.files : []).map((file) => file.path), req.uploadBundleDir]
        .filter(Boolean)
        .forEach((targetPath) => {
          try {
            if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true, force: true });
          } catch (e) {}
        });
      return res.status(err.status || 500).json({ error: err.message || '디바이스 첨부 업로드에 실패했습니다.' });
    }
  }
);

router.post('/chat/attachments/from-nas', verifyToken, async (req, res) => {
  try {
    cleanupExpiredPendingBundles();

    const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    if (paths.length === 0) {
      return res.status(400).json({ error: '첨부할 NAS 경로가 없습니다.' });
    }

    const tempBundleId = `cab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const bundleDir = getBundleDir(tempBundleId);
    fs.mkdirSync(bundleDir, { recursive: true });

    const items = [];
    let incomingBytes = 0;
    const preparedCopies = [];

    for (let idx = 0; idx < paths.length; idx += 1) {
      const reqPath = paths[idx];
      const { targetPath } = getValidatedNasPath(req.user, reqPath);
      if (!fs.existsSync(targetPath)) continue;

      const stat = fs.statSync(targetPath);
      const originalName = path.basename(targetPath);
      const finalName = ensureUniqueName(bundleDir, originalName);
      const destPath = path.join(bundleDir, finalName);
      const usage = await getCachedPathUsage(targetPath);
      incomingBytes += Number(usage.sizeBytes || 0);
      preparedCopies.push({ targetPath, destPath, isDirectory: stat.isDirectory() });

      items.push({
        entryId: `entry_${idx}_${Date.now()}`,
        sourceType: 'nas',
        type: stat.isDirectory() ? 'folder' : 'file',
        name: finalName,
        relativePath: finalName,
        size: stat.isDirectory() ? 0 : stat.size,
        sourcePath: String(reqPath || ''),
      });
    }

    await assertQuotaAvailable(req.user, incomingBytes, bundleDir);

    preparedCopies.forEach(({ targetPath, destPath, isDirectory }) => {
      if (isDirectory) fs.cpSync(targetPath, destPath, { recursive: true });
      else fs.copyFileSync(targetPath, destPath);
    });

    if (items.length === 0) {
      fs.rmSync(bundleDir, { recursive: true, force: true });
      return res.status(400).json({ error: '복사할 수 있는 NAS 항목이 없습니다.' });
    }

    const record = createBundleRecord({
      ownerUid: req.user.userUid || getLoginId(req.user),
      ownerLoginId: getLoginId(req.user),
      sourceType: 'nas',
      items,
    });

    const finalDir = getBundleDir(record.bundleId);
    if (bundleDir !== finalDir) {
      if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
      fs.renameSync(bundleDir, finalDir);
    }
    invalidateUsageCache(finalDir);

    return res.json({ bundle: record });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'NAS 첨부 준비에 실패했습니다.' });
  }
});

router.get('/chat/attachments/bundle/:bundleId', verifyToken, (req, res) => {
  const bundle = getBundle(req.params.bundleId);
  if (!bundle) return res.status(404).json({ error: '첨부 번들을 찾을 수 없습니다.' });

  const ownerUid = req.user.userUid || getLoginId(req.user);
  if (bundle.ownerUid !== ownerUid) {
    return res.status(403).json({ error: '다른 사용자의 첨부 번들은 볼 수 없습니다.' });
  }

  return res.json({ bundle });
});

router.delete('/chat/attachments/bundle/:bundleId', verifyToken, (req, res) => {
  const bundle = getBundle(req.params.bundleId);
  if (!bundle) return res.status(404).json({ error: '첨부 번들을 찾을 수 없습니다.' });

  const ownerUid = req.user.userUid || getLoginId(req.user);
  if (bundle.ownerUid !== ownerUid) {
    return res.status(403).json({ error: '다른 사용자의 첨부 번들은 취소할 수 없습니다.' });
  }

  invalidateUsageCache(getBundleDir(req.params.bundleId));
  const canceled = cancelBundle(req.params.bundleId);
  return res.json({ success: true, bundle: canceled });
});

module.exports = router;
