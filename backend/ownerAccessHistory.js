const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const RESTORE_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;
const MUTATION_TYPES = new Set([
  'file-created', 'file-updated', 'folder-created', 'moved-to-trash',
  'trash-restored', 'trash-permanently-deleted', 'item-copied', 'item-moved',
  'pdf-annotations-updated', 'version-restored', 'moved-to-agent-trash',
  'conflict-copy-created'
]);

const sameOrChild = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
};

const ownerForPath = (nasRoot, targetPath, members) => {
  const root = path.resolve(nasRoot);
  const target = path.resolve(targetPath);
  if (!sameOrChild(root, target)) return null;
  const parts = path.relative(root, target).split(path.sep);
  if (parts[0] !== 'users' || parts.length < 2) return null;
  const owner = members.find((member) => String(member.loginId || member.id || member.username) === parts[1]);
  if (!owner || !owner.userUid) return null;
  const ownerRoot = path.join(root, 'users', parts[1]);
  if (!sameOrChild(ownerRoot, target)) return null;
  return { owner, ownerRoot, relativePath: `/${path.relative(ownerRoot, target).replace(/\\/g, '/')}`.replace(/\/$/, '') || '/' };
};

const externalEvent = ({ nasRoot, targetPath, members, actor, type, extra = {} }) => {
  const result = ownerForPath(nasRoot, targetPath, members);
  if (!result) return null;
  const actorUid = String(actor?.userUid || '');
  if (!actorUid || actorUid === String(result.owner.userUid)) return null;
  const now = new Date();
  return {
    ...extra,
    type,
    path: result.relativePath,
    actorUid,
    actorName: String(actor?.nickname || actor?.displayName || actor?.loginId || actor?.username || actorUid).slice(0, 120),
    ownerUid: String(result.owner.userUid),
    at: now.toISOString(),
    // A change is not restorable until its pre-change bytes are durably captured.
    restorable: false
  };
};

const assertRealOwnerPath = (ownerRoot, targetPath) => {
  if (!sameOrChild(ownerRoot, targetPath)) return false;
  const realRoot = fs.realpathSync(ownerRoot);
  const realTarget = fs.realpathSync(targetPath);
  return sameOrChild(realRoot, realTarget);
};

const accessFile = (ownerRoot) => path.join(ownerRoot, '.agent_versions', 'external-access.ndjson');

const appendOwnerAccess = (ownerRoot, event) => {
  const file = accessFile(ownerRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const existing = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!assertRealOwnerPath(ownerRoot, path.dirname(file)) || (existing && !existing.isFile())) {
    throw new Error('접근 기록 저장 경로가 계정 경계를 벗어났습니다.');
  }
  const row = { ...event, activityId: crypto.randomUUID() };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
  return row;
};

const listOwnerAccess = (ownerRoot, limit = 100) => {
  const file = accessFile(ownerRoot);
  if (!fs.existsSync(file)) return [];
  if (!assertRealOwnerPath(ownerRoot, file)) throw new Error('접근 기록 조회 경로가 계정 경계를 벗어났습니다.');
  const count = Math.max(1, Math.min(500, Number(limit) || 100));
  const fd = fs.openSync(file, 'r');
  const chunks = [];
  let bytes = 0;
  let newlines = 0;
  try {
    let position = fs.fstatSync(fd).size;
    while (position > 0 && newlines <= count && bytes < 4 * 1024 * 1024) {
      const size = Math.min(position, 64 * 1024, 4 * 1024 * 1024 - bytes);
      const chunk = Buffer.allocUnsafe(size);
      position -= size;
      fs.readSync(fd, chunk, 0, size, position);
      chunks.unshift(chunk);
      bytes += size;
      for (const byte of chunk) if (byte === 10) newlines += 1;
    }
    if (position > 0 && chunks.length) {
      const firstNewline = chunks[0].indexOf(10);
      if (firstNewline >= 0) chunks[0] = chunks[0].subarray(firstNewline + 1);
    }
  } finally {
    fs.closeSync(fd);
  }
  return Buffer.concat(chunks).toString('utf8').split(/\r?\n/).filter(Boolean).slice(-count).reverse()
    .map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
};

module.exports = { RESTORE_WINDOW_MS, MUTATION_TYPES, ownerForPath, externalEvent, assertRealOwnerPath, appendOwnerAccess, listOwnerAccess };
