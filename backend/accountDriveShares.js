'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SHARED_ROOT_NAME = '다른 NAS 계정에서 공유됨';

const normalizeRelativePath = (value, { allowEmpty = false } = {}) => {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!raw) {
    if (allowEmpty) return '';
    throw Object.assign(new Error('공유할 파일 또는 폴더를 선택해 주세요.'), { status: 400 });
  }
  const parts = raw.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw Object.assign(new Error('잘못된 공유 경로입니다.'), { status: 400 });
  }
  return parts.join('/');
};

const safeDisplaySegment = (value, fallback = '계정') => {
  const cleaned = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || fallback).slice(0, 80);
};

const createShareId = () => `ash_${crypto.randomBytes(12).toString('hex')}`;

const shareVirtualBase = (share) => {
  const source = safeDisplaySegment(share.sourceDisplayName || share.sourceLoginId, '계정');
  const item = safeDisplaySegment(share.sourceItemName, share.sourceRelPath ? '공유 항목' : '전체 파일');
  const suffix = String(share.shareId || '').slice(-6) || 'share';
  return `${SHARED_ROOT_NAME}/${source}/${item} · ${suffix}`;
};

const isLiveShare = share => !!share && !share.revokedAt;

const sharesForRecipient = (shares, ownerKey) => (Array.isArray(shares) ? shares : [])
  .filter(share => isLiveShare(share) && String(share.recipientOwnerKey) === String(ownerKey));

const combineRevision = (baseRevision, shares, sourceRevisionFor) => {
  const signatures = (Array.isArray(shares) ? shares : []).filter(isLiveShare).map(share => [
    share.shareId,
    share.updatedAt || share.createdAt || '',
    typeof sourceRevisionFor === 'function' ? sourceRevisionFor(share) : ''
  ]);
  return crypto.createHash('sha256').update(JSON.stringify([baseRevision || '', signatures])).digest('hex');
};

const buildSharedManifestEntries = (share, sourceRoot, listEntries) => {
  if (!isLiveShare(share)) return [];
  const selectedRel = normalizeRelativePath(share.sourceRelPath, { allowEmpty: true });
  const selectedPath = selectedRel ? path.resolve(sourceRoot, ...selectedRel.split('/')) : path.resolve(sourceRoot);
  if (!fs.existsSync(selectedPath)) return [];
  const selectedStat = fs.lstatSync(selectedPath);
  if (selectedStat.isSymbolicLink() || (!selectedStat.isDirectory() && !selectedStat.isFile())) return [];
  const base = shareVirtualBase(share);
  const sourceAccountFolder = base.split('/').slice(0, 2).join('/');
  const out = [
    { type: 'folder', relPath: SHARED_ROOT_NAME, mtimeMs: Math.round(selectedStat.mtimeMs) },
    { type: 'folder', relPath: sourceAccountFolder, mtimeMs: Math.round(selectedStat.mtimeMs) },
    { type: 'folder', relPath: base, mtimeMs: Math.round(selectedStat.mtimeMs) }
  ];
  const itemName = safeDisplaySegment(share.sourceItemName, selectedRel ? path.basename(selectedRel) : '전체 파일');
  const itemBase = `${base}/${itemName}`;
  if (selectedStat.isFile()) {
    out.push({ type: 'file', relPath: itemBase, size: selectedStat.size, mtimeMs: Math.round(selectedStat.mtimeMs) });
    return out;
  }
  out.push({ type: 'folder', relPath: itemBase, mtimeMs: Math.round(selectedStat.mtimeMs) });
  for (const entry of listEntries(selectedPath)) {
    out.push({ ...entry, relPath: `${itemBase}/${entry.relPath}` });
  }
  return out;
};

const resolveSharedFile = (shares, recipientOwnerKey, requestedRelPath, resolveSourceRoot) => {
  const relPath = normalizeRelativePath(requestedRelPath);
  if (!relPath.startsWith(`${SHARED_ROOT_NAME}/`)) return null;
  for (const share of sharesForRecipient(shares, recipientOwnerKey)) {
    const base = shareVirtualBase(share);
    const itemName = safeDisplaySegment(share.sourceItemName, share.sourceRelPath ? path.basename(share.sourceRelPath) : '전체 파일');
    const itemBase = `${base}/${itemName}`;
    if (relPath !== itemBase && !relPath.startsWith(`${itemBase}/`)) continue;
    const sourceRoot = resolveSourceRoot(share);
    const suffix = relPath === itemBase ? '' : relPath.slice(itemBase.length + 1);
    const selectedRel = normalizeRelativePath(share.sourceRelPath, { allowEmpty: true });
    const sourceRel = [selectedRel, suffix].filter(Boolean).join('/');
    const finalPath = path.resolve(sourceRoot, ...sourceRel.split('/').filter(Boolean));
    const root = path.resolve(sourceRoot);
    if (finalPath !== root && !finalPath.startsWith(root + path.sep)) {
      throw Object.assign(new Error('공유 범위를 벗어난 경로입니다.'), { status: 403 });
    }
    return { share, sourceRoot: root, finalPath, relPath: sourceRel };
  }
  throw Object.assign(new Error('공유가 해제되었거나 접근 권한이 없습니다.'), { status: 403 });
};

module.exports = {
  SHARED_ROOT_NAME,
  normalizeRelativePath,
  safeDisplaySegment,
  createShareId,
  shareVirtualBase,
  sharesForRecipient,
  combineRevision,
  buildSharedManifestEntries,
  resolveSharedFile
};
