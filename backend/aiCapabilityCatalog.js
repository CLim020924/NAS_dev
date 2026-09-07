const SURFACES = Object.freeze({
  conversation: ['get_agent_capabilities', 'search_conversation_history'],
  files: ['list_files', 'search_files', 'read_text_file', 'get_file_properties', 'list_trash', 'list_file_versions', 'list_drive_restore_points', 'list_activity', 'list_favorites', 'list_recent_files', 'restore_trash_item', 'restore_file_version', 'create_drive_restore_point', 'restore_drive_restore_point', 'set_file_favorite', 'create_folder', 'write_text_file', 'create_document', 'append_text_file', 'copy_item', 'move_item', 'trash_item', 'organize_files_by_modified_date'],
  storage: ['get_storage_summary', 'get_path_storage'],
  friends: ['list_friends', 'search_users', 'send_friend_request', 'accept_friend_request', 'reject_friend_request', 'remove_friend', 'set_friend_favorite', 'set_user_blocked'],
  chat: ['list_chat_conversations', 'list_chat_messages', 'send_chat_message', 'send_file_to_user', 'create_group_chat', 'invite_group_chat', 'respond_group_invite', 'leave_group_chat', 'send_group_message', 'transfer_group_owner', 'set_group_cohost', 'kick_group_member', 'delete_group_chat', 'save_chat_attachments', 'mark_chat_read'],
  notifications: ['list_notifications', 'get_unread_notification_count', 'mark_notification_read', 'mark_all_notifications_read'],
  notes: ['list_notebooks', 'list_notes', 'read_note', 'list_deleted_notes', 'list_note_versions', 'create_notebook', 'create_note', 'update_note', 'trash_note', 'restore_note', 'restore_note_version', 'attach_note_item', 'remove_note_attachment', 'create_office_document', 'run_python_note', 'run_javascript_note'],
  documents: ['get_document_studio_capabilities', 'get_document_job', 'create_document_job', 'cancel_document_job', 'retry_document_job'],
  devices: ['list_devices', 'set_device_sync', 'revoke_device'],
  shares: ['list_shares', 'get_share_logs', 'create_share_link', 'update_share_link', 'set_share_paused', 'regenerate_share_token', 'revoke_share_link'],
  meetings: ['get_meeting_status', 'get_current_meeting_overview', 'search_public_meetings', 'configure_meeting', 'start_meeting', 'save_meeting'],
  account: ['get_user_preferences', 'set_login_persistence', 'update_profile'],
  administration: ['get_server_metrics', 'get_resource_history', 'list_users_admin', 'update_managed_user', 'approve_signup', 'reject_signup', 'set_resource_policy'],
});

const INTENTIONALLY_RESTRICTED = Object.freeze([
  { capability: 'secrets-and-credentials', reason: '비밀번호, 토큰, 개인키와 인증 비밀은 AI 입력·출력·기록 대상이 아니다.' },
  { capability: 'permanent-delete', reason: '파일·노트·휴지통·공유 기록의 영구 삭제는 AI에 위임하지 않고 화면에서 사용자가 직접 수행한다.' },
  { capability: 'account-security', reason: '비밀번호, 로그인 보안 비밀과 계정 생성·삭제는 인증 경계를 바꾸므로 AI가 처리하지 않는다.' },
  { capability: 'binary-transfer', reason: '브라우저 다운로드·업로드와 미리보기 스트림은 UI가 처리하며 AI는 경로 탐색과 서버 내부 작업만 담당한다.' },
  { capability: 'driver-internal-protocol', reason: '에이전트 heartbeat, chunk sync, web-session과 공급자 업데이트 API는 NAS Driver 전용 프로토콜이다.' },
  { capability: 'live-media-plane', reason: '카메라·마이크·화면공유와 WebRTC/Socket 이벤트는 사용자 장치의 실시간 동의가 필요한 UI 기능이다.' },
  { capability: 'public-guest-session', reason: '공유 토큰의 게스트 인증과 다운로드는 링크 방문자가 직접 수행한다.' },
]);

const classifyPlatformRoute = (routePath, method = 'GET') => {
  const route = String(routePath || '').replace(/^\/api/, '') || '/';
  const verb = String(method || 'GET').toUpperCase();
  if (route.startsWith('/ai/')) return 'ai-control-plane';
  if (route.startsWith('/devices/agent/')) return 'driver-internal';
  if (route.startsWith('/public-shares/')) return 'public-guest';
  if (route.startsWith('/auth/') || ['/login', '/logout', '/signup-request', '/signup-capacity', '/users/check-identity'].includes(route)) return 'authentication-ui';
  if (route.startsWith('/onlyoffice/') || route.startsWith('/hwp/') || route.startsWith('/document-workspace/')) return 'editor-ui';
  if (route.startsWith('/file/pdf-annotations') || route.startsWith('/file/pdf-ocr-region')) return 'editor-ui';
  if (route.startsWith('/workspace/view-state')) return 'editor-ui';
  if (route === '/icons' || route === '/check-access') return 'file-ui';
  if (route.startsWith('/file/chunk/') || route === '/file' && verb === 'POST' || route === '/file/cancel-session' || route === '/file/download' || route === '/file/download-folder') return 'transfer-ui';
  if (route.startsWith('/chat/attachments/')) return 'attachment-transport';
  if (route.startsWith('/devices/pair/')) return 'pairing-ui';
  if (route === '/users/delete' || route === '/users/password' || route === '/users/security-settings') return 'restricted-security';
  if (/\/permanent$/.test(route) || /\/purge$/.test(route) || verb === 'DELETE' && route.startsWith('/trash/')) return 'restricted-permanent-delete';
  if (route.startsWith('/note-studio/') || route.startsWith('/document-studio/') || route.startsWith('/files') || route.startsWith('/file') || route.startsWith('/trash') || route.startsWith('/drive/') || ['/activity', '/favorites', '/recent', '/storage/me', '/storage/path'].includes(route)) return 'ai-integrated-files';
  if (route.startsWith('/friends/') || route.startsWith('/chat/') || route.startsWith('/notifications')) return 'ai-integrated-social';
  if (route.startsWith('/shares')) return 'ai-integrated-shares';
  if (route.startsWith('/devices')) return 'ai-integrated-devices';
  if (route.startsWith('/meetings/')) return 'ai-integrated-meetings';
  if (route.startsWith('/system/') || ['/users/data', '/users/update', '/users/approve', '/users/reject'].includes(route)) return 'ai-integrated-administration';
  if (route.startsWith('/user/preferences') || route === '/users/profile') return 'ai-integrated-account';
  return null;
};

const buildCapabilityCatalog = (toolDefinitions = []) => {
  const definitions = new Map(toolDefinitions.map((tool) => [tool.name, tool]));
  const assigned = new Set();
  const surfaces = Object.entries(SURFACES).map(([id, names]) => ({
    id,
    tools: names.map((name) => {
      const tool = definitions.get(name);
      if (!tool) throw new Error(`AI capability catalog references missing tool: ${name}`);
      assigned.add(name);
      return { name, description: tool.description };
    }),
  }));
  const unassigned = [...definitions.keys()].filter((name) => !assigned.has(name));
  if (unassigned.length) throw new Error(`AI tools missing capability surface: ${unassigned.join(', ')}`);
  return {
    generatedAt: new Date().toISOString(),
    toolCount: definitions.size,
    surfaceCount: surfaces.length,
    surfaces,
    intentionallyRestricted: INTENTIONALLY_RESTRICTED,
  };
};

module.exports = { SURFACES, INTENTIONALLY_RESTRICTED, buildCapabilityCatalog, classifyPlatformRoute };
