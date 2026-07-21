const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('./config/env');
const {
  getAiStatus,
  summarizeMeetingMessages,
} = require('./services/aiService');
const {
  appendMessages,
  listMessages,
  listActions,
  createAction,
  updateAction,
  getPreferences,
  setPreferences,
} = require('./aiAgentStore');
const {
  normalizeQuotaFields,
  findMemberByAnyId,
  getAccessBasePath,
  resolveInside,
  isSameOrChild,
  invalidateUsageCache,
} = require('./storageQuota');

const router = express.Router();

const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.csv', '.tsv', '.log', '.js', '.jsx', '.ts', '.tsx',
  '.css', '.html', '.xml', '.yml', '.yaml', '.env', '.ini', '.conf',
]);
const MAX_SEARCH_RESULTS = 80;
const MAX_READ_BYTES = 180 * 1024;

const getToken = (req) => req.cookies?.token;

const getUserFromRequest = (req) => {
  const token = getToken(req);
  if (!token) {
    const err = new Error('로그인이 필요합니다.');
    err.status = 401;
    throw err;
  }
  const decoded = jwt.verify(token, config.JWT_SECRET);
  const latest = findMemberByAnyId(decoded.userUid || decoded.loginId || decoded.id || decoded.username || decoded);
  if (!latest || latest.disabled) {
    const err = new Error('사용자를 찾을 수 없습니다.');
    err.status = 401;
    throw err;
  }
  return normalizeQuotaFields({ ...decoded, ...latest });
};

const toRelativePath = (user, fullPath) => {
  const basePath = getAccessBasePath(user);
  const rel = path.relative(basePath, fullPath).replace(/\\/g, '/');
  return rel ? `/${rel}` : '/';
};

const getSafePath = (user, requestedPath = '/') => {
  const basePath = getAccessBasePath(user);
  return resolveInside(basePath, requestedPath || '/');
};

const statToItem = (user, fullPath) => {
  const stat = fs.statSync(fullPath);
  return {
    name: path.basename(fullPath),
    path: toRelativePath(user, fullPath),
    type: stat.isDirectory() ? 'folder' : 'file',
    size: stat.isFile() ? stat.size : null,
    modifiedAt: stat.mtime.toISOString(),
  };
};

const searchFiles = (user, query, rootPath = '/') => {
  const needle = String(query || '').trim().toLocaleLowerCase('ko-KR');
  if (!needle) return [];
  const startPath = getSafePath(user, rootPath || '/');
  if (!fs.existsSync(startPath)) return [];

  const results = [];
  const visit = (dirPath, depth = 0) => {
    if (results.length >= MAX_SEARCH_RESULTS || depth > 8) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
      return;
    }

    for (const entry of entries) {
      if (results.length >= MAX_SEARCH_RESULTS) break;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      const lowerName = entry.name.toLocaleLowerCase('ko-KR');
      try {
        if (lowerName.includes(needle)) results.push(statToItem(user, fullPath));
        if (entry.isDirectory()) visit(fullPath, depth + 1);
      } catch (err) {}
    }
  };

  const stat = fs.statSync(startPath);
  if (stat.isDirectory()) visit(startPath);
  else if (path.basename(startPath).toLocaleLowerCase('ko-KR').includes(needle)) {
    results.push(statToItem(user, startPath));
  }
  return results;
};

const readTextFile = (user, requestedPath) => {
  const fullPath = getSafePath(user, requestedPath);
  if (!fs.existsSync(fullPath)) {
    const err = new Error('파일이 존재하지 않습니다.');
    err.status = 404;
    throw err;
  }
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) {
    const err = new Error('파일만 읽을 수 있습니다.');
    err.status = 400;
    throw err;
  }
  const ext = path.extname(fullPath).toLowerCase();
  if (!TEXT_EXTS.has(ext)) {
    return {
      item: statToItem(user, fullPath),
      text: '',
      readable: false,
      message: '현재 1차 AI 에이전트는 텍스트 파일만 직접 읽습니다. DOCX/HWP/PDF 추출기는 다음 단계에서 연결할 수 있습니다.',
    };
  }

  const fd = fs.openSync(fullPath, 'r');
  const buffer = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
  fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);

  return {
    item: statToItem(user, fullPath),
    text: buffer.toString('utf8'),
    truncated: stat.size > MAX_READ_BYTES,
    readable: true,
  };
};

const createWriteAction = (user, body = {}) => {
  const actionType = body.actionType || 'write_text_file';
  if (!['write_text_file', 'append_text_file', 'create_folder'].includes(actionType)) {
    const err = new Error('지원하지 않는 AI 작업입니다.');
    err.status = 400;
    throw err;
  }

  const targetPath = String(body.path || '').trim();
  if (!targetPath || targetPath === '/') {
    const err = new Error('대상 경로가 필요합니다.');
    err.status = 400;
    throw err;
  }

  const fullPath = getSafePath(user, targetPath);
  return createAction(user, {
    actionType,
    title: body.title || (
      actionType === 'create_folder' ? '폴더 생성' :
      actionType === 'append_text_file' ? '텍스트 추가' :
      '텍스트 파일 저장'
    ),
    description: body.description || '',
    targetPath,
    resolvedTargetPath: fullPath,
    content: actionType === 'create_folder' ? '' : String(body.content || ''),
  });
};

const backupExistingFile = (user, fullPath) => {
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) return null;
  const basePath = getAccessBasePath(user);
  const backupRoot = path.join(basePath, '.ai_backups');
  if (!fs.existsSync(backupRoot)) fs.mkdirSync(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `${path.basename(fullPath)}.${stamp}.bak`;
  const backupPath = path.join(backupRoot, backupName);
  fs.copyFileSync(fullPath, backupPath);
  return toRelativePath(user, backupPath);
};

const executeAction = (user, actionId) => {
  const action = listActions(user).find((item) => item.actionId === actionId);
  if (!action) {
    const err = new Error('AI 작업을 찾을 수 없습니다.');
    err.status = 404;
    throw err;
  }
  if (action.status !== 'pending') {
    const err = new Error('이미 처리된 AI 작업입니다.');
    err.status = 409;
    throw err;
  }

  const fullPath = getSafePath(user, action.targetPath);
  let backupPath = null;

  if (action.actionType === 'create_folder') {
    fs.mkdirSync(fullPath, { recursive: true });
  } else if (action.actionType === 'append_text_file') {
    const parent = path.dirname(fullPath);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(fullPath)) backupPath = backupExistingFile(user, fullPath);
    fs.appendFileSync(fullPath, String(action.content || ''), 'utf8');
  } else if (action.actionType === 'write_text_file') {
    const parent = path.dirname(fullPath);
    if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
    if (fs.existsSync(fullPath)) backupPath = backupExistingFile(user, fullPath);
    fs.writeFileSync(fullPath, String(action.content || ''), 'utf8');
  } else {
    const err = new Error('지원하지 않는 AI 작업입니다.');
    err.status = 400;
    throw err;
  }

  invalidateUsageCache(fullPath);
  return updateAction(user, actionId, {
    status: 'completed',
    executedAt: new Date().toISOString(),
    backupPath,
  });
};

const buildAgentSystemPrompt = (user, preferences = {}) => {
  const role = user.role || (user.Masters ? 'MASTER' : (user.Managers ? 'MANAGER' : 'USER'));
  return [
    '너는 개인 NAS 웹서비스 안에서 동작하는 계정별 AI 에이전트다.',
    '항상 한국어로 답한다.',
    `현재 사용자: ${user.nickname || user.displayName || user.loginId || user.id}`,
    `현재 권한: ${role}`,
    '너는 서버가 제공한 컨텍스트와 사용자가 접근 가능한 자료만 근거로 답한다.',
    '파일 생성/수정/삭제/이동은 직접 수행했다고 말하지 말고, 승인 가능한 작업 계획이 필요하다고 안내한다.',
    '위험하거나 범위가 큰 작업은 단계별로 나누고 먼저 확인을 받는다.',
    preferences.tone ? `사용자 선호 말투: ${preferences.tone}` : '',
  ].filter(Boolean).join('\n');
};

router.get('/ai/status', (req, res) => {
  const status = getAiStatus();
  res.json({
    provider: status.provider,
    model: status.model,
    enabled: status.enabled,
    configured: status.configured,
  });
});

router.get('/ai/history', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    res.json({
      messages: listMessages(user, Number(req.query.limit) || 80),
      actions: listActions(user).slice(0, 50),
      preferences: getPreferences(user),
    });
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
  }
});

router.patch('/ai/preferences', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    res.json({ preferences: setPreferences(user, req.body || {}) });
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
  }
});

router.get('/ai/files/search', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const results = searchFiles(user, req.query.q, req.query.path || '/');
    res.json({ results });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/ai/files/read', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    res.json(readTextFile(user, req.query.path));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/ai/actions', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const action = createWriteAction(user, req.body || {});
    res.json({ action });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/ai/actions/:actionId/execute', (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const action = executeAction(user, req.params.actionId);
    res.json({ action });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/ai/chat', async (req, res) => {
  try {
    const user = getUserFromRequest(req);
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: '메시지를 입력해주세요.' });

    const context = req.body?.context || {};
    const contextLines = [];

    if (context.currentPath) {
      contextLines.push(`현재 파일 위치: ${context.currentPath}`);
    }
    if (context.searchQuery) {
      const results = searchFiles(user, context.searchQuery, context.currentPath || '/').slice(0, 20);
      contextLines.push(`파일 검색 결과(${context.searchQuery}):\n${JSON.stringify(results, null, 2)}`);
    }
    if (context.readPath) {
      const fileContext = readTextFile(user, context.readPath);
      contextLines.push(`파일 읽기 결과(${context.readPath}):\n${JSON.stringify(fileContext, null, 2)}`);
    }
    if (Array.isArray(context.meetingMessages) && context.meetingMessages.length > 0) {
      const summary = await summarizeMeetingMessages(context.meetingMessages);
      contextLines.push(`회의 메시지 요약:\n${summary}`);
    }

    const preferences = getPreferences(user);
    const history = listMessages(user, 20).map((item) => `${item.role}: ${item.content}`).join('\n');
    const prompt = [
      history ? `최근 대화:\n${history}` : '',
      contextLines.length ? `서버 컨텍스트:\n${contextLines.join('\n\n')}` : '',
      `사용자 요청:\n${message}`,
    ].filter(Boolean).join('\n\n');

    const { callOpenAIResponses } = require('./services/aiService');
    const answer = await callOpenAIResponses({
      systemPrompt: buildAgentSystemPrompt(user, preferences),
      userPrompt: prompt,
    });

    const saved = appendMessages(user, [
      { role: 'user', content: message, createdAt: new Date().toISOString(), context },
      { role: 'assistant', content: answer, createdAt: new Date().toISOString() },
    ]);

    res.json({
      answer,
      messages: saved.slice(-80),
      actions: listActions(user).slice(0, 50),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'AI 요청에 실패했습니다.' });
  }
});

module.exports = router;
