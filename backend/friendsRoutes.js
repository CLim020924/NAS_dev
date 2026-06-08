const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { createNotification } = require('./notificationStore');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'my-service-platform-secure-key-2026';
const membersFilePath = path.join(__dirname, 'data', 'members.json');
const friendsFilePath = path.join(__dirname, 'data', 'friends.json');

const readJsonArray = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch (e) {
    return [];
  }
};

const writeJsonArray = (filePath, value) => {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
};

const verifyToken = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: '인증실패' });
  }
};

const ensureRelationShape = (rel = {}) => ({
  ...rel,
  favoriteByUids: Array.isArray(rel.favoriteByUids) ? rel.favoriteByUids : [],
  blockedByUids: Array.isArray(rel.blockedByUids) ? rel.blockedByUids : [],
});

const getAllMembers = () => readJsonArray(membersFilePath).filter(u => u && !u.disabled);
const getAllRelations = () => readJsonArray(friendsFilePath).map(ensureRelationShape);

const getLoginId = (user = {}) => user.loginId || user.id || user.username || '';
const getDisplayName = (user = {}) => user.displayName || user.nickname || getLoginId(user);
const getRole = (user = {}) => user.role || (user.Masters ? 'MASTER' : (user.Managers ? 'MANAGER' : 'USER'));
const isPrivileged = (user = {}) => !!(user.Masters || user.Managers || user.role === 'MASTER' || user.role === 'MANAGER');

const findMemberFromToken = (tokenUser, members) => {
  return members.find(u =>
    [u.userUid, u.loginId, u.id, u.username].filter(Boolean).includes(
      tokenUser.userUid || tokenUser.loginId || tokenUser.id || tokenUser.username
    )
  );
};

const pairMatches = (rel, aUid, bUid) => {
  return (
    (rel.userAUid === aUid && rel.userBUid === bUid) ||
    (rel.userAUid === bUid && rel.userBUid === aUid)
  );
};

const getRelationWith = (relations, aUid, bUid) =>
  relations.find(rel => pairMatches(rel, aUid, bUid));

const buildRelation = (aUid, bUid, requestedByUid = null, status = 'NONE') => {
  const now = new Date().toISOString();
  return ensureRelationShape({
    relationId: `fr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    userAUid: aUid < bUid ? aUid : bUid,
    userBUid: aUid < bUid ? bUid : aUid,
    requestedByUid,
    status,
    createdAt: now,
    updatedAt: now,
    favoriteByUids: [],
    blockedByUids: [],
  });
};

const getConnectedSets = (io) => {
  const socketValues = Array.from(io.sockets.sockets.values());
  return {
    loginIds: new Set(socketValues.map(s => s.userId).filter(Boolean)),
    userUids: new Set(socketValues.map(s => s.userUid).filter(Boolean)),
  };
};

const getRelationStatusForViewer = (rel, viewerUid) => {
  if (!rel) return 'NONE';
  if ((rel.blockedByUids || []).includes(viewerUid)) return 'BLOCKED_BY_ME';
  if ((rel.blockedByUids || []).some(uid => uid !== viewerUid)) return 'BLOCKED_ME';
  if (rel.status === 'ACCEPTED') return 'ACCEPTED';
  if (rel.status === 'PENDING') return rel.requestedByUid === viewerUid ? 'OUTGOING' : 'INCOMING';
  return 'NONE';
};

const serializeUserForViewer = (member, viewerUid, relations, connectedSets) => {
  const loginId = getLoginId(member);
  const relation = viewerUid ? getRelationWith(relations, viewerUid, member.userUid) : null;
  const blockedByUids = relation?.blockedByUids || [];
  const favoriteByUids = relation?.favoriteByUids || [];

  return {
    userUid: member.userUid,
    id: loginId,
    loginId,
    username: loginId,
    displayName: getDisplayName(member),
    nickname: member.nickname || '',
    role: getRole(member),
    globalAccess: !!member.globalAccess,
    isOnline: connectedSets.loginIds.has(loginId) || connectedSets.userUids.has(member.userUid),
    relationId: relation?.relationId || null,
    relationStatus: viewerUid ? getRelationStatusForViewer(relation, viewerUid) : 'NONE',
    isFavorite: favoriteByUids.includes(viewerUid),
    isBlockedByMe: blockedByUids.includes(viewerUid),
    isBlockedMe: blockedByUids.includes(member.userUid),
  };
};

const sortUsers = (users) =>
  users.slice().sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    if (a.isOnline !== b.isOnline) return a.isOnline ? -1 : 1;
    return String(a.displayName || a.username).localeCompare(String(b.displayName || b.username), 'ko');
  });

const persistRelations = (relations) => {
  const cleaned = relations
    .map(ensureRelationShape)
    .filter(rel => {
      const hasMeaningfulState =
        rel.status === 'ACCEPTED' ||
        rel.status === 'PENDING' ||
        (rel.favoriteByUids && rel.favoriteByUids.length > 0) ||
        (rel.blockedByUids && rel.blockedByUids.length > 0);
      return hasMeaningfulState;
    });
  writeJsonArray(friendsFilePath, cleaned);
};

router.get('/friends/sidebar', verifyToken, (req, res) => {
  const io = req.app.get('io');
  const members = getAllMembers();
  const relations = getAllRelations();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });

  const connectedSets = getConnectedSets(io);
  const others = members.filter(u => u.userUid !== me.userUid);
  const privileged = isPrivileged(me);

  const blockedUsers = others
    .filter(u => {
      const rel = getRelationWith(relations, me.userUid, u.userUid);
      return rel && (rel.blockedByUids || []).includes(me.userUid);
    })
    .map(u => serializeUserForViewer(u, me.userUid, relations, connectedSets));

  const isBlockedPair = (u) => {
    const rel = getRelationWith(relations, me.userUid, u.userUid);
    if (!rel) return false;
    const blocked = rel.blockedByUids || [];
    return blocked.includes(me.userUid) || blocked.includes(u.userUid);
  };

  let visibleUsers = [];
  if (privileged) {
    visibleUsers = others
      .filter(u => !isBlockedPair(u))
      .map(u => serializeUserForViewer(u, me.userUid, relations, connectedSets));
  } else {
    const acceptedUids = relations
      .filter(rel => rel.status === 'ACCEPTED' && (rel.userAUid === me.userUid || rel.userBUid === me.userUid))
      .map(rel => (rel.userAUid === me.userUid ? rel.userBUid : rel.userAUid));

    visibleUsers = others
      .filter(u => acceptedUids.includes(u.userUid))
      .filter(u => !isBlockedPair(u))
      .map(u => serializeUserForViewer(u, me.userUid, relations, connectedSets));
  }

  const incomingRequests = others
    .filter(u => {
      const rel = getRelationWith(relations, me.userUid, u.userUid);
      if (!rel || rel.status !== 'PENDING' || rel.requestedByUid === me.userUid) return false;
      const blocked = rel.blockedByUids || [];
      return !blocked.includes(me.userUid) && !blocked.includes(u.userUid);
    })
    .map(u => serializeUserForViewer(u, me.userUid, relations, connectedSets));

  const outgoingRequests = others
    .filter(u => {
      const rel = getRelationWith(relations, me.userUid, u.userUid);
      if (!rel || rel.status !== 'PENDING' || rel.requestedByUid !== me.userUid) return false;
      const blocked = rel.blockedByUids || [];
      return !blocked.includes(me.userUid) && !blocked.includes(u.userUid);
    })
    .map(u => serializeUserForViewer(u, me.userUid, relations, connectedSets));

  return res.json({
    viewer: {
      userUid: me.userUid,
      username: getLoginId(me),
      displayName: getDisplayName(me),
      role: getRole(me),
    },
    canViewAllUsers: privileged,
    friends: sortUsers(visibleUsers),
    incomingRequests: sortUsers(incomingRequests),
    outgoingRequests: sortUsers(outgoingRequests),
    blockedUsers: sortUsers(blockedUsers),
  });
});

router.get('/friends/search', verifyToken, (req, res) => {
  const io = req.app.get('io');
  const q = String(req.query.q || '').trim().toLowerCase();

  if (!q) return res.json({ results: [] });

  const members = getAllMembers();
  const relations = getAllRelations();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });

  const connectedSets = getConnectedSets(io);

  const results = members
    .filter(u => u.userUid !== me.userUid)
    .filter(u => {
      const values = [getLoginId(u), getDisplayName(u), u.nickname || ''].map(v => String(v).toLowerCase());
      return values.some(v => v.includes(q));
    })
    .slice(0, 30)
    .map(u => serializeUserForViewer(u, me.userUid, relations, connectedSets));

  return res.json({ results: sortUsers(results) });
});

router.post('/friends/request', verifyToken, (req, res) => {
  const { targetUserUid } = req.body || {};
  const members = getAllMembers();
  const relations = getAllRelations();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!targetUserUid) return res.status(400).json({ error: '대상 사용자가 필요합니다.' });
  if (targetUserUid === me.userUid) return res.status(400).json({ error: '자기 자신에게 친구 요청을 보낼 수 없습니다.' });

  const target = members.find(u => u.userUid === targetUserUid);
  if (!target) return res.status(404).json({ error: '대상 사용자가 없습니다.' });

  let existing = getRelationWith(relations, me.userUid, targetUserUid);

  if (existing && (existing.blockedByUids || []).includes(me.userUid)) {
    return res.status(400).json({ error: '차단한 사용자는 친구 요청을 보낼 수 없습니다. 먼저 차단을 해제하세요.' });
  }
  if (existing && (existing.blockedByUids || []).includes(targetUserUid)) {
    return res.status(400).json({ error: '상대방이 나를 차단한 상태입니다.' });
  }

  if (existing?.status === 'ACCEPTED') {
    return res.status(400).json({ error: '이미 친구입니다.' });
  }

  if (existing?.status === 'PENDING') {
    if (existing.requestedByUid === me.userUid) {
      return res.status(400).json({ error: '이미 친구 요청을 보냈습니다.' });
    }
    return res.status(400).json({ error: '상대방의 요청이 이미 도착해 있습니다. 받은 요청에서 수락하세요.' });
  }

  const now = new Date().toISOString();
  if (!existing) {
    existing = buildRelation(me.userUid, targetUserUid, me.userUid, 'PENDING');
    relations.push(existing);
  } else {
    existing.requestedByUid = me.userUid;
    existing.status = 'PENDING';
    existing.updatedAt = now;
  }

  persistRelations(relations);

  createNotification({
    userUid: target.userUid,
    type: 'friend_request',
    title: '친구 요청 도착',
    message: `${getDisplayName(me)}님이 친구 요청을 보냈습니다.`,
    meta: {
      relationId: existing.relationId,
      fromUserUid: me.userUid,
      fromUsername: getLoginId(me),
      fromDisplayName: getDisplayName(me),
    },
  });

  req.app.get('io').emit('friendsChanged');
  return res.json({ success: true });
});

router.post('/friends/accept', verifyToken, (req, res) => {
  const { relationId } = req.body || {};
  const members = getAllMembers();
  const relations = getAllRelations();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!relationId) return res.status(400).json({ error: '요청 식별자가 필요합니다.' });

  const rel = relations.find(r => r.relationId === relationId);
  if (!rel || rel.status !== 'PENDING') return res.status(404).json({ error: '친구 요청을 찾을 수 없습니다.' });

  const isRecipient = (rel.userAUid === me.userUid || rel.userBUid === me.userUid) && rel.requestedByUid !== me.userUid;
  if (!isRecipient) return res.status(403).json({ error: '수락 권한이 없습니다.' });

  rel.status = 'ACCEPTED';
  rel.updatedAt = new Date().toISOString();

  persistRelations(relations);

  createNotification({
    userUid: rel.requestedByUid,
    type: 'friend_accept',
    title: '친구 요청 수락',
    message: `${getDisplayName(me)}님이 친구 요청을 수락했습니다.`,
    meta: {
      relationId: rel.relationId,
      fromUserUid: me.userUid,
      fromUsername: getLoginId(me),
      fromDisplayName: getDisplayName(me),
    },
  });

  req.app.get('io').emit('friendsChanged');
  return res.json({ success: true });
});

router.post('/friends/reject', verifyToken, (req, res) => {
  const { relationId } = req.body || {};
  const members = getAllMembers();
  const relations = getAllRelations();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!relationId) return res.status(400).json({ error: '요청 식별자가 필요합니다.' });

  const rel = relations.find(r => r.relationId === relationId);
  if (!rel || rel.status !== 'PENDING') return res.status(404).json({ error: '친구 요청을 찾을 수 없습니다.' });

  const isRecipient = (rel.userAUid === me.userUid || rel.userBUid === me.userUid) && rel.requestedByUid !== me.userUid;
  if (!isRecipient) return res.status(403).json({ error: '거절 권한이 없습니다.' });

  rel.status = 'NONE';
  rel.requestedByUid = null;
  rel.updatedAt = new Date().toISOString();

  persistRelations(relations);
  req.app.get('io').emit('friendsChanged');
  return res.json({ success: true });
});

router.post('/friends/remove', verifyToken, (req, res) => {
  const { targetUserUid } = req.body || {};
  const members = getAllMembers();
  const relations = getAllRelations();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!targetUserUid) return res.status(400).json({ error: '대상 사용자가 필요합니다.' });

  const rel = getRelationWith(relations, me.userUid, targetUserUid);
  if (!rel) return res.status(404).json({ error: '친구 관계가 없습니다.' });
  if (rel.status !== 'ACCEPTED' && rel.status !== 'PENDING') return res.status(400).json({ error: '제거할 친구 관계가 없습니다.' });

  rel.status = 'NONE';
  rel.requestedByUid = null;
  rel.favoriteByUids = [];
  rel.updatedAt = new Date().toISOString();

  persistRelations(relations);
  req.app.get('io').emit('friendsChanged');
  return res.json({ success: true });
});

router.post('/friends/favorite', verifyToken, (req, res) => {
  const { targetUserUid, favorite } = req.body || {};
  const members = getAllMembers();
  const relations = getAllRelations();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!targetUserUid) return res.status(400).json({ error: '대상 사용자가 필요합니다.' });

  const rel = getRelationWith(relations, me.userUid, targetUserUid);
  if (!rel || rel.status !== 'ACCEPTED') return res.status(400).json({ error: '친구만 즐겨찾기할 수 있습니다.' });

  rel.favoriteByUids = (rel.favoriteByUids || []).filter(uid => uid !== me.userUid);
  if (favorite) rel.favoriteByUids.push(me.userUid);
  rel.updatedAt = new Date().toISOString();

  persistRelations(relations);
  req.app.get('io').emit('friendsChanged');
  return res.json({ success: true });
});

router.post('/friends/block', verifyToken, (req, res) => {
  const { targetUserUid, blocked } = req.body || {};
  const members = getAllMembers();
  const relations = getAllRelations();
  const me = findMemberFromToken(req.user, members);

  if (!me) return res.status(401).json({ error: '현재 사용자 정보를 찾을 수 없습니다.' });
  if (!targetUserUid) return res.status(400).json({ error: '대상 사용자가 필요합니다.' });
  if (targetUserUid === me.userUid) return res.status(400).json({ error: '자기 자신은 차단할 수 없습니다.' });

  const target = members.find(u => u.userUid === targetUserUid);
  if (!target) return res.status(404).json({ error: '대상 사용자가 없습니다.' });

  let rel = getRelationWith(relations, me.userUid, targetUserUid);
  if (!rel) {
    rel = buildRelation(me.userUid, targetUserUid, null, 'NONE');
    relations.push(rel);
  }

  rel.blockedByUids = (rel.blockedByUids || []).filter(uid => uid !== me.userUid);
  if (blocked) {
    rel.blockedByUids.push(me.userUid);
    rel.favoriteByUids = (rel.favoriteByUids || []).filter(uid => uid !== me.userUid);
  }

  rel.updatedAt = new Date().toISOString();

  persistRelations(relations);
  req.app.get('io').emit('friendsChanged');
  return res.json({ success: true });
});

module.exports = router;
