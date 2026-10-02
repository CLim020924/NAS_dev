const MAX_OPTIONS = 50;
const MAX_TEXT = 240;

const clean = (value, max = MAX_TEXT) => String(value ?? '')
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/\s{2,}/g, ' ')
  .trim()
  .slice(0, max);

const formatDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
    : '';
};

const first = (item, keys) => {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return value;
  }
  return '';
};

const extractRows = (name, result) => {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== 'object') return [];
  if (name === 'list_friends') {
    return [
      ...(result.friends || []).map((item) => ({ ...item, _selectionGroup: '친구' })),
      ...(result.incomingRequests || []).map((item) => ({ ...item, _selectionGroup: '받은 요청' })),
      ...(result.outgoingRequests || []).map((item) => ({ ...item, _selectionGroup: '보낸 요청' })),
      ...(result.blockedUsers || []).map((item) => ({ ...item, _selectionGroup: '차단 사용자' })),
    ];
  }
  const keys = ['items', 'results', 'files', 'notes', 'notebooks', 'versions', 'restorePoints', 'activities',
    'friends', 'conversations', 'notifications', 'devices', 'users', 'shares', 'meetings', 'rooms'];
  for (const key of keys) if (Array.isArray(result[key])) return result[key];
  return [];
};

const CONFIG = {
  list_trash: { title: '복구할 항목 선택', instruction: '복구할 항목을 번호로 선택해 주세요.', allowAll: true },
  list_files: { title: '파일·폴더 선택' },
  search_files: { title: '검색 결과 선택' },
  list_image_files: { title: '사진 선택' },
  list_file_versions: { title: '파일 버전 선택' },
  list_drive_restore_points: { title: '복구 지점 선택' },
  list_activity: { title: '활동 기록 선택' },
  list_favorites: { title: '즐겨찾기 선택' },
  list_recent_files: { title: '최근 파일 선택' },
  list_friends: { title: '사용자 선택' },
  search_users: { title: '사용자 선택' },
  list_chat_conversations: { title: '대화 선택' },
  list_notifications: { title: '알림 선택' },
  list_notebooks: { title: '노트북 선택' },
  list_notes: { title: '노트 선택' },
  list_deleted_notes: { title: '삭제된 노트 선택', allowAll: true },
  list_note_versions: { title: '노트 버전 선택' },
  list_devices: { title: '연동 PC 선택' },
  list_users_admin: { title: '사용자 선택' },
  list_shares: { title: '공유 링크 선택' },
  search_public_meetings: { title: '회의 선택' },
};

const SOURCE_TO_MUTATIONS = Object.freeze({
  list_trash: ['restore_trash_item'],
  list_files: ['copy_item', 'move_item', 'trash_item', 'organize_files_by_modified_date', 'create_zip_bundle', 'send_file_to_user', 'set_file_favorite', 'create_share_link', 'attach_note_item'],
  search_files: ['copy_item', 'move_item', 'trash_item', 'organize_files_by_modified_date', 'create_zip_bundle', 'send_file_to_user', 'set_file_favorite', 'create_share_link', 'attach_note_item'],
  list_image_files: ['copy_item', 'move_item', 'trash_item', 'create_zip_bundle', 'send_file_to_user', 'set_file_favorite', 'create_share_link', 'attach_note_item'],
  list_file_versions: ['restore_file_version'],
  list_drive_restore_points: ['restore_drive_restore_point'],
  list_activity: ['copy_item', 'move_item', 'trash_item', 'create_zip_bundle', 'send_file_to_user', 'set_file_favorite', 'create_share_link'],
  list_favorites: ['copy_item', 'move_item', 'trash_item', 'create_zip_bundle', 'send_file_to_user', 'set_file_favorite', 'create_share_link', 'attach_note_item'],
  list_recent_files: ['copy_item', 'move_item', 'trash_item', 'create_zip_bundle', 'send_file_to_user', 'set_file_favorite', 'create_share_link', 'attach_note_item'],
  list_friends: ['send_friend_request', 'set_user_blocked', 'send_chat_message', 'send_file_to_user', 'accept_friend_request', 'reject_friend_request', 'remove_friend', 'set_friend_favorite', 'create_group_chat', 'invite_group_chat', 'transfer_group_owner', 'set_group_cohost', 'kick_group_member'],
  search_users: ['send_friend_request', 'set_user_blocked', 'send_chat_message', 'send_file_to_user', 'accept_friend_request', 'reject_friend_request', 'remove_friend', 'set_friend_favorite', 'create_group_chat', 'invite_group_chat', 'transfer_group_owner', 'set_group_cohost', 'kick_group_member'],
  list_chat_conversations: ['send_chat_message', 'create_group_chat', 'invite_group_chat', 'respond_group_invite', 'leave_group_chat', 'send_group_message', 'transfer_group_owner', 'set_group_cohost', 'kick_group_member', 'delete_group_chat', 'save_chat_attachments', 'mark_chat_read'],
  list_notifications: ['mark_notification_read', 'mark_all_notifications_read', 'respond_group_invite'],
  list_notebooks: ['create_note', 'create_office_document', 'attach_note_item'],
  list_notes: ['update_note', 'trash_note', 'run_python_note', 'run_javascript_note', 'restore_note_version', 'attach_note_item', 'remove_note_attachment', 'create_office_document'],
  list_deleted_notes: ['restore_note'],
  list_note_versions: ['restore_note_version'],
  list_devices: ['set_device_sync', 'revoke_device'],
  list_users_admin: ['update_managed_user', 'approve_signup', 'reject_signup', 'set_resource_policy'],
  list_shares: ['set_share_paused', 'revoke_share_link', 'update_share_link', 'regenerate_share_token'],
  search_public_meetings: ['configure_meeting', 'start_meeting', 'save_meeting'],
});

const getSelectionSourcesForMutationTools = (mutationTools = []) => {
  const requested = new Set(Array.isArray(mutationTools) ? mutationTools : []);
  return Object.entries(SOURCE_TO_MUTATIONS)
    .filter(([, compatible]) => compatible.some((name) => requested.has(name)))
    .map(([source]) => source);
};

const describe = (toolName, item) => {
  const parts = [];
  if (item?._selectionGroup) parts.push(clean(item._selectionGroup, 40));
  const path = first(item, ['originalPath', 'originalRelativePath', 'path', 'targetPath', 'sourceRelPath']);
  if (path) parts.push(clean(path));
  const userId = first(item, ['username', 'loginId']);
  if (userId) parts.push(`ID ${clean(userId, 80)}`);
  const status = first(item, ['status', 'relationStatus', 'onlineStatus']);
  if (status) parts.push(clean(status, 60));
  const date = first(item, toolName === 'list_trash'
    ? ['deletedAt']
    : ['modifiedAt', 'updatedAt', 'createdAt', 'timestamp', 'versionCreatedAt']);
  const dateLabel = formatDate(date);
  if (dateLabel) parts.push(toolName === 'list_trash' ? `삭제 ${dateLabel}` : dateLabel);
  const type = first(item, ['type', 'kind', 'noteType', 'sourceType']);
  if (type) parts.push(clean(type, 50));
  return parts.filter(Boolean).slice(0, 4);
};

const optionFor = (toolName, item, index) => {
  if (!item || typeof item !== 'object') return null;
  const label = clean(first(item, [
    'name', 'title', 'displayName', 'nickname', 'deviceName', 'hostname', 'fileName', 'subject', 'label',
  ]) || first(item, ['path', 'targetPath']) || `${index + 1}번 항목`, 160);
  if (!label) return null;
  return {
    key: String(index + 1),
    label,
    details: describe(toolName, item),
    reply: `${index + 1}번 · ${label}`,
  };
};

const normalizeSelectionFrame = (frame) => {
  if (!frame || typeof frame !== 'object' || !Array.isArray(frame.options)) return null;
  const options = frame.options.slice(0, MAX_OPTIONS).map((item, index) => {
    if (!item || typeof item !== 'object') return null;
    const label = clean(item.label, 160);
    if (!label) return null;
    return {
      key: clean(item.key || index + 1, 12),
      label,
      details: Array.isArray(item.details) ? item.details.map((value) => clean(value)).filter(Boolean).slice(0, 4) : [],
      reply: clean(item.reply || `${index + 1}번 · ${label}`, 220),
    };
  }).filter(Boolean);
  if (!options.length) return null;
  return {
    version: 1,
    sourceTool: CONFIG[clean(frame.sourceTool, 60)] ? clean(frame.sourceTool, 60) : undefined,
    title: clean(frame.title || '항목 선택', 80),
    instruction: clean(frame.instruction || '후속 작업할 항목을 고른 뒤 선택 내용을 보내세요.', 160),
    multiple: frame.multiple !== false,
    allowAll: frame.allowAll === true,
    totalCount: Math.max(options.length, Math.min(100000, Number(frame.totalCount) || options.length)),
    options,
  };
};

const buildSelectionFrame = (events = [], { allowedSourceTools = null } = {}) => {
  const allowed = Array.isArray(allowedSourceTools) ? new Set(allowedSourceTools) : null;
  const event = [...events].reverse().find((candidate) => candidate?.ok === true
    && CONFIG[candidate.name]
    && (!allowed || allowed.has(candidate.name)));
  if (!event) return null;
  const rows = extractRows(event.name, event.result);
  if (!rows.length) return null;
  const config = CONFIG[event.name];
  return normalizeSelectionFrame({
    sourceTool: event.name,
    title: config.title,
    instruction: config.instruction,
    multiple: true,
    allowAll: config.allowAll === true,
    totalCount: rows.length,
    options: rows.slice(0, MAX_OPTIONS).map((item, index) => optionFor(event.name, item, index)).filter(Boolean),
  });
};

const formatSelectionText = (frame) => {
  const normalized = normalizeSelectionFrame(frame);
  if (!normalized) return '';
  const rows = normalized.options.map((option) => [
    `${option.key}. ${option.label}`,
    ...option.details.map((detail) => `   ${detail}`),
  ].join('\n'));
  if (normalized.totalCount > normalized.options.length) rows.push(`…외 ${normalized.totalCount - normalized.options.length}개`);
  const allHint = normalized.allowAll ? ', 전부면 `전부`' : '';
  return `${normalized.instruction} 번호는 \`1, 3\`처럼 입력할 수 있고${allHint}라고 입력할 수 있습니다.\n\n${rows.join('\n')}`;
};

module.exports = {
  buildSelectionFrame,
  normalizeSelectionFrame,
  formatSelectionText,
  getSelectionSourcesForMutationTools,
  _test: { extractRows, optionFor, SOURCE_TO_MUTATIONS },
};
