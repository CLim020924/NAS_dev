const fs = require('fs');
const path = require('path');
const config = require('./config/env');
const {
  createAction,
  listActions,
  updateAction,
  searchMessages,
  getPreferences,
} = require('./aiAgentStore');
const {
  getAccessBasePath,
  resolveInside,
  isSameOrChild,
  assertQuotaAvailable,
  invalidateUsageCache,
} = require('./storageQuota');

const APPROVAL_MODES = new Set(['ask_each', 'auto_safe', 'auto_reversible', 'auto_all']);
const TEXT_EXTS = new Set(['.txt', '.md', '.json', '.csv', '.tsv', '.log', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.xml', '.yml', '.yaml', '.env', '.ini', '.conf', '.py', '.sql', '.sh']);
const MAX_READ_BYTES = 180 * 1024;

const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const stringProp = (description) => ({ type: 'string', description });

const TOOL_DEFINITIONS = [
  { type: 'function', name: 'list_files', description: '로그인 사용자가 접근 가능한 NAS 폴더의 파일과 하위 폴더를 조회한다.', strict: true, parameters: schema({ path: stringProp('조회할 NAS 경로. 루트는 /.') }, ['path']) },
  { type: 'function', name: 'search_files', description: '로그인 사용자의 NAS 범위에서 이름으로 파일과 폴더를 검색한다.', strict: true, parameters: schema({ query: stringProp('검색어'), path: stringProp('검색 시작 경로') }, ['query', 'path']) },
  { type: 'function', name: 'read_text_file', description: '권한 범위의 텍스트 또는 코드 파일을 읽는다.', strict: true, parameters: schema({ path: stringProp('읽을 파일 경로') }, ['path']) },
  { type: 'function', name: 'search_conversation_history', description: '이 AI 대화창에 실제 저장된 이전 대화를 정확한 키워드로 검색한다. 기억을 추측하지 않는다.', strict: true, parameters: schema({ query: stringProp('찾을 문장 또는 키워드') }, ['query']) },
  { type: 'function', name: 'create_folder', description: 'NAS에 폴더를 만든다. 승인 정책에 따라 즉시 실행하거나 승인 대기한다.', strict: true, parameters: schema({ path: stringProp('생성할 폴더 경로') }, ['path']) },
  { type: 'function', name: 'write_text_file', description: '텍스트 파일을 새로 만들거나 안전 백업 후 덮어쓴다.', strict: true, parameters: schema({ path: stringProp('저장 경로'), content: stringProp('UTF-8 내용') }, ['path', 'content']) },
  { type: 'function', name: 'append_text_file', description: '텍스트 파일 끝에 내용을 추가한다.', strict: true, parameters: schema({ path: stringProp('대상 경로'), content: stringProp('추가할 UTF-8 내용') }, ['path', 'content']) },
  { type: 'function', name: 'copy_item', description: '파일 또는 폴더를 다른 NAS 폴더로 복사한다.', strict: true, parameters: schema({ source_path: stringProp('원본 경로'), destination_folder: stringProp('복사할 폴더 경로') }, ['source_path', 'destination_folder']) },
  { type: 'function', name: 'move_item', description: '파일 또는 폴더를 이동하거나 이름을 변경한다.', strict: true, parameters: schema({ source_path: stringProp('원본 경로'), destination_path: stringProp('최종 경로') }, ['source_path', 'destination_path']) },
  { type: 'function', name: 'trash_item', description: '파일 또는 폴더를 영구 삭제하지 않고 복구 가능한 NAS 휴지통으로 옮긴다.', strict: true, parameters: schema({ path: stringProp('휴지통으로 옮길 경로') }, ['path']) },
  { type: 'function', name: 'organize_files_by_modified_date', description: '선택한 폴더 바로 아래 파일을 마지막 수정일의 날짜 또는 월 폴더로 안전하게 정리한다. 하위 폴더는 이동하지 않는다.', strict: true, parameters: schema({ folder_path: stringProp('정리할 원본 폴더'), destination_folder: stringProp('날짜 폴더를 만들 기준 폴더'), granularity: { type: 'string', enum: ['day', 'month'], description: 'day는 YYYY-MM-DD, month는 YYYY-MM' } }, ['folder_path', 'destination_folder', 'granularity']) },
  { type: 'function', name: 'send_friend_request', description: '정확히 식별된 다른 사용자에게 친구 요청을 보낸다.', strict: true, parameters: schema({ user: stringProp('로그인 ID 또는 표시 이름') }, ['user']) },
  { type: 'function', name: 'set_user_blocked', description: '정확히 식별된 다른 사용자를 차단하거나 차단 해제한다.', strict: true, parameters: schema({ user: stringProp('로그인 ID 또는 표시 이름'), blocked: { type: 'boolean', description: 'true면 차단, false면 해제' } }, ['user', 'blocked']) },
  { type: 'function', name: 'send_chat_message', description: '친구인 정확한 사용자에게 NAS 채팅 메시지를 보낸다.', strict: true, parameters: schema({ user: stringProp('로그인 ID 또는 표시 이름'), text: stringProp('보낼 메시지') }, ['user', 'text']) },
  { type: 'function', name: 'send_file_to_user', description: '권한 범위의 NAS 파일 또는 폴더를 친구인 정확한 사용자에게 채팅 첨부로 보낸다.', strict: true, parameters: schema({ user: stringProp('로그인 ID 또는 표시 이름'), path: stringProp('보낼 NAS 파일 또는 폴더 경로'), message: stringProp('첨부와 함께 보낼 메시지. 없으면 빈 문자열') }, ['user', 'path', 'message']) },
];

const defaults = () => ({ approvalMode: 'ask_each', dailyTokenLimit: config.AI_DEFAULT_DAILY_TOKEN_LIMIT });
const normalizePreferences = (value = {}) => ({
  ...value,
  approvalMode: APPROVAL_MODES.has(value.approvalMode) ? value.approvalMode : 'ask_each',
  dailyTokenLimit: Math.max(1000, Math.min(Number(value.dailyTokenLimit) || config.AI_DEFAULT_DAILY_TOKEN_LIMIT, 1000000)),
});

const getSafePath = (user, requested = '/') => resolveInside(getAccessBasePath(user), requested || '/');
const toRelative = (user, fullPath) => {
  const rel = path.relative(getAccessBasePath(user), fullPath).replace(/\\/g, '/');
  return rel ? `/${rel}` : '/';
};

const assertExistingPathSafe = (user, requested) => {
  const base = getAccessBasePath(user);
  const full = resolveInside(base, requested || '/');
  if (!fs.existsSync(full)) { const err = new Error('대상 경로가 존재하지 않습니다.'); err.status = 404; throw err; }
  const realBase = fs.realpathSync(base);
  const realTarget = fs.realpathSync(full);
  if (!isSameOrChild(realBase, realTarget)) { const err = new Error('심볼릭 링크가 계정 접근 범위를 벗어납니다.'); err.status = 403; throw err; }
  return full;
};

const assertWritablePathSafe = (user, requested) => {
  const base = getAccessBasePath(user);
  const full = resolveInside(base, requested || '/');
  let cursor = fs.existsSync(full) ? full : path.dirname(full);
  while (!fs.existsSync(cursor) && cursor !== path.dirname(cursor)) cursor = path.dirname(cursor);
  const realBase = fs.realpathSync(base);
  const realParent = fs.realpathSync(cursor);
  if (!isSameOrChild(realBase, realParent)) { const err = new Error('심볼릭 링크가 계정 접근 범위를 벗어납니다.'); err.status = 403; throw err; }
  return full;
};

const itemFor = (user, full) => {
  const stat = fs.statSync(full);
  return { name: path.basename(full), path: toRelative(user, full), type: stat.isDirectory() ? 'folder' : 'file', size: stat.isFile() ? stat.size : null, modifiedAt: stat.mtime.toISOString() };
};

const listFiles = (user, requested = '/') => {
  const full = assertExistingPathSafe(user, requested);
  if (!fs.statSync(full).isDirectory()) throw new Error('폴더만 조회할 수 있습니다.');
  return fs.readdirSync(full, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && !['backup', 'chat_tmp'].includes(entry.name))
    .slice(0, 200)
    .map((entry) => itemFor(user, path.join(full, entry.name)));
};

const searchFiles = (user, query, requested = '/') => {
  const needle = String(query || '').trim().toLocaleLowerCase('ko-KR');
  if (!needle) return [];
  const root = assertExistingPathSafe(user, requested);
  const results = [];
  const visit = (dir, depth) => {
    if (depth > 8 || results.length >= 80) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['backup', 'chat_tmp'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      try {
        const safe = fs.realpathSync(full);
        if (!isSameOrChild(fs.realpathSync(getAccessBasePath(user)), safe)) continue;
        if (entry.name.toLocaleLowerCase('ko-KR').includes(needle)) results.push(itemFor(user, full));
        if (entry.isDirectory()) visit(full, depth + 1);
      } catch (err) {}
      if (results.length >= 80) return;
    }
  };
  if (fs.statSync(root).isDirectory()) visit(root, 0);
  return results;
};

const readTextFile = (user, requested) => {
  const full = assertExistingPathSafe(user, requested);
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new Error('파일만 읽을 수 있습니다.');
  if (!TEXT_EXTS.has(path.extname(full).toLowerCase())) throw new Error('현재는 텍스트·코드 파일만 읽을 수 있습니다.');
  const buffer = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
  const fd = fs.openSync(full, 'r');
  try { fs.readSync(fd, buffer, 0, buffer.length, 0); } finally { fs.closeSync(fd); }
  return { item: itemFor(user, full), text: buffer.toString('utf8'), truncated: stat.size > MAX_READ_BYTES };
};

const actionSpec = (name, args) => {
  const map = {
    create_folder: { title: '폴더 생성', risk: 'safe', actionType: name, targetPath: args.path },
    write_text_file: { title: '텍스트 파일 저장', risk: 'safe', actionType: name, targetPath: args.path, content: args.content },
    append_text_file: { title: '텍스트 추가', risk: 'safe', actionType: name, targetPath: args.path, content: args.content },
    copy_item: { title: '파일/폴더 복사', risk: 'reversible', actionType: name, sourcePath: args.source_path, destinationFolder: args.destination_folder },
    move_item: { title: '파일/폴더 이동', risk: 'reversible', actionType: name, sourcePath: args.source_path, destinationPath: args.destination_path },
    trash_item: { title: '휴지통으로 이동', risk: 'reversible', actionType: name, targetPath: args.path },
    organize_files_by_modified_date: { title: '수정일 기준 파일 정리', risk: 'reversible', actionType: name, sourcePath: args.folder_path, destinationFolder: args.destination_folder, granularity: args.granularity },
    send_friend_request: { title: '친구 요청 보내기', risk: 'external', actionType: name, targetUser: args.user },
    set_user_blocked: { title: args.blocked ? '사용자 차단' : '차단 해제', risk: 'external', actionType: name, targetUser: args.user, blocked: args.blocked },
    send_chat_message: { title: '채팅 메시지 보내기', risk: 'external', actionType: name, targetUser: args.user, text: args.text },
    send_file_to_user: { title: '파일/폴더 전송', risk: 'external', actionType: name, targetUser: args.user, targetPath: args.path, text: args.message },
  };
  return map[name];
};

const mayAutoExecute = (risk, mode) => (
  (risk === 'safe' && ['auto_safe', 'auto_reversible', 'auto_all'].includes(mode)) ||
  (risk === 'reversible' && ['auto_reversible', 'auto_all'].includes(mode)) ||
  (risk === 'external' && mode === 'auto_all')
);

const createPlatformCaller = (token, fetchImpl = fetch) => async (method, apiPath, body) => {
  const response = await fetchImpl(`http://127.0.0.1:${config.BACKEND_PORT}/api${apiPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: `token=${encodeURIComponent(token)}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const err = new Error(data.error || 'NAS 작업 API가 거부했습니다.'); err.status = response.status; throw err; }
  return data;
};

const resolveExactUser = async (platformCall, text) => {
  const result = await platformCall('GET', `/friends/search?q=${encodeURIComponent(text)}`);
  const needle = String(text || '').trim().toLocaleLowerCase('ko-KR');
  const exact = (result.results || []).filter((user) => [user.loginId, user.username, user.displayName, user.nickname]
    .some((value) => String(value || '').toLocaleLowerCase('ko-KR') === needle));
  if (exact.length !== 1) throw new Error(exact.length ? '같은 이름의 사용자가 여러 명입니다. 로그인 ID로 다시 지정해주세요.' : '정확히 일치하는 사용자를 찾지 못했습니다.');
  return exact[0];
};

const executeAction = async (user, actionId, { platformCall }) => {
  const action = listActions(user).find((item) => item.actionId === actionId);
  if (!action) { const err = new Error('AI 작업을 찾을 수 없습니다.'); err.status = 404; throw err; }
  if (action.status !== 'pending') { const err = new Error('이미 처리된 AI 작업입니다.'); err.status = 409; throw err; }
  updateAction(user, actionId, { status: 'executing', startedAt: new Date().toISOString() });
  try {
    let result = {};
    let backupPath = null;
    if (['create_folder', 'write_text_file', 'append_text_file'].includes(action.actionType)) {
      const full = assertWritablePathSafe(user, action.targetPath);
      const parent = action.actionType === 'create_folder' ? path.dirname(full) : path.dirname(full);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      if (action.actionType === 'create_folder') {
        fs.mkdirSync(full, { recursive: true, mode: 0o700 });
      } else {
        const content = Buffer.from(String(action.content || ''), 'utf8');
        await assertQuotaAvailable(user, content.length + (action.actionType === 'append_text_file' && fs.existsSync(full) ? fs.statSync(full).size : 0), full);
        if (fs.existsSync(full)) {
          const backupRoot = path.join(getAccessBasePath(user), '.ai_backups');
          fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
          const backup = path.join(backupRoot, `${path.basename(full)}.${Date.now()}.bak`);
          fs.copyFileSync(full, backup);
          backupPath = toRelative(user, backup);
        }
        if (action.actionType === 'append_text_file') fs.appendFileSync(full, content);
        else {
          const temp = path.join(parent, `.${path.basename(full)}.${process.pid}.${Date.now()}.tmp`);
          fs.writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
          fs.renameSync(temp, full);
        }
      }
      invalidateUsageCache(full);
      result = { path: action.targetPath, backupPath };
    } else if (action.actionType === 'copy_item') {
      assertExistingPathSafe(user, action.sourcePath);
      assertExistingPathSafe(user, action.destinationFolder);
      result = await platformCall('POST', '/file/copy', { sourcePaths: [action.sourcePath], destinationFolder: action.destinationFolder });
    } else if (action.actionType === 'move_item') {
      assertExistingPathSafe(user, action.sourcePath);
      assertWritablePathSafe(user, action.destinationPath);
      result = await platformCall('PUT', '/file', { oldPath: action.sourcePath, newPath: action.destinationPath });
    } else if (action.actionType === 'trash_item') {
      assertExistingPathSafe(user, action.targetPath);
      result = await platformCall('DELETE', `/file?path=${encodeURIComponent(action.targetPath)}`);
    } else if (action.actionType === 'organize_files_by_modified_date') {
      const source = assertExistingPathSafe(user, action.sourcePath);
      const destination = assertWritablePathSafe(user, action.destinationFolder);
      if (!fs.statSync(source).isDirectory()) throw new Error('정리 원본은 폴더여야 합니다.');
      fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
      const plannedTargets = new Set();
      const plans = fs.readdirSync(source, { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .map((entry) => {
          const from = path.join(source, entry.name);
          const date = fs.statSync(from).mtime.toISOString().slice(0, action.granularity === 'month' ? 7 : 10);
          const folder = path.join(destination, date);
          let to = path.join(folder, entry.name);
          let suffix = 2;
          while (fs.existsSync(to) || plannedTargets.has(to)) {
            const ext = path.extname(entry.name);
            const stem = path.basename(entry.name, ext);
            to = path.join(folder, `${stem} (${suffix})${ext}`);
            suffix += 1;
          }
          plannedTargets.add(to);
          return { from, folder, to };
        });
      const moved = [];
      try {
        plans.forEach((plan) => {
          fs.mkdirSync(plan.folder, { recursive: true, mode: 0o700 });
          fs.renameSync(plan.from, plan.to);
          moved.push(plan);
        });
      } catch (err) {
        moved.reverse().forEach((plan) => { try { if (fs.existsSync(plan.to) && !fs.existsSync(plan.from)) fs.renameSync(plan.to, plan.from); } catch (rollbackErr) {} });
        throw err;
      }
      moved.forEach((plan) => { invalidateUsageCache(plan.from); invalidateUsageCache(plan.to); });
      result = { movedCount: moved.length, destinationFolder: action.destinationFolder, granularity: action.granularity };
    } else {
      const target = await resolveExactUser(platformCall, action.targetUser);
      if (action.actionType === 'send_friend_request') result = await platformCall('POST', '/friends/request', { targetUserUid: target.userUid });
      else if (action.actionType === 'set_user_blocked') result = await platformCall('POST', '/friends/block', { targetUserUid: target.userUid, blocked: !!action.blocked });
      else if (action.actionType === 'send_chat_message') {
        const direct = await platformCall('POST', '/chat/direct', { targetUserUid: target.userUid });
        result = await platformCall('POST', '/chat/messages', { conversationId: direct.conversation.conversationId, text: action.text, attachmentBundleIds: [] });
      } else if (action.actionType === 'send_file_to_user') {
        assertExistingPathSafe(user, action.targetPath);
        const direct = await platformCall('POST', '/chat/direct', { targetUserUid: target.userUid });
        const attachment = await platformCall('POST', '/chat/attachments/from-nas', { paths: [action.targetPath] });
        result = await platformCall('POST', '/chat/messages', {
          conversationId: direct.conversation.conversationId,
          text: action.text || '',
          attachmentBundleIds: [attachment.bundle.bundleId],
        });
      } else throw new Error('지원하지 않는 AI 작업입니다.');
    }
    return updateAction(user, actionId, { status: 'completed', executedAt: new Date().toISOString(), result, backupPath });
  } catch (err) {
    updateAction(user, actionId, { status: 'failed', failedAt: new Date().toISOString(), error: err.message });
    throw err;
  }
};

const runTool = async (user, name, args, context) => {
  if (name === 'list_files') return listFiles(user, args.path);
  if (name === 'search_files') return searchFiles(user, args.query, args.path);
  if (name === 'read_text_file') return readTextFile(user, args.path);
  if (name === 'search_conversation_history') return searchMessages(user, args.query, 20);
  const spec = actionSpec(name, args);
  if (!spec) throw new Error('허용되지 않은 도구입니다.');
  if (name === 'move_item' && String(args.source_path || '').trim() === '/') throw new Error('계정 루트 자체는 이동할 수 없습니다.');
  if (name === 'organize_files_by_modified_date' && !['day', 'month'].includes(args.granularity)) throw new Error('정리 단위는 day 또는 month여야 합니다.');
  const preferences = normalizePreferences(getPreferences(user));
  const action = createAction(user, { ...spec, idempotencyKey: context.idempotencyKey || context.callId, requestedByAgent: true });
  if (!mayAutoExecute(spec.risk, preferences.approvalMode)) return { status: 'pending_approval', actionId: action.actionId, title: action.title, risk: action.risk };
  const completed = await executeAction(user, action.actionId, context);
  return { status: 'completed', actionId: completed.actionId, title: completed.title, result: completed.result };
};

module.exports = {
  TOOL_DEFINITIONS,
  APPROVAL_MODES,
  defaults,
  normalizePreferences,
  createPlatformCaller,
  executeAction,
  runTool,
  listFiles,
  searchFiles,
  readTextFile,
  _test: { mayAutoExecute, actionSpec },
};
