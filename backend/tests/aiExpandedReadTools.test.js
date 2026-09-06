const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('확장 조회 도구는 현재 세션으로 정확한 기존 API만 호출한다', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-ai-expanded-read-'));
  const runtimePath = path.resolve(__dirname, '..', 'aiAgentRuntime.js');
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const runtime = require(${JSON.stringify(runtimePath)});
    const user = { loginId: 'reader', userUid: 'reader-uid', role: 'USER', globalAccess: false };
    const root = path.join(process.env.NAS_ROOT, 'users', 'reader');
    fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs', 'a.txt'), 'a');
    const calls = [];
    const context = { authorizedMutationTools: [], platformCall: async (method, apiPath, body) => { calls.push({ method, apiPath, body }); return { ok: true }; } };
    const rows = [
      ['get_storage_summary', {}], ['get_path_storage', { path: '/docs' }], ['get_file_properties', { path: '/docs/a.txt' }],
      ['list_trash', {}], ['list_file_versions', { path: '/docs/a.txt' }], ['list_drive_restore_points', {}],
      ['list_activity', { limit: 10 }], ['list_favorites', {}], ['list_recent_files', { limit: 10 }],
      ['list_friends', {}], ['search_users', { query: 'kim' }], ['list_chat_conversations', {}],
      ['list_chat_messages', { conversation_id: 'conversation-1' }], ['list_notifications', {}], ['get_unread_notification_count', {}],
      ['list_notebooks', {}], ['list_deleted_notes', { query: '' }], ['list_note_versions', { note_id: 'note-1' }],
      ['list_devices', {}], ['get_document_studio_capabilities', {}], ['get_document_job', { job_id: 'job-1' }],
      ['get_server_metrics', {}], ['get_resource_history', { hours: 24 }], ['list_users_admin', {}],
      ['get_user_preferences', {}], ['list_shares', {}], ['get_share_logs', { share_id: 'share-1' }],
      ['get_meeting_status', { room_id: 'room-1' }], ['get_current_meeting_overview', {}], ['search_public_meetings', { query: '주간' }],
    ];
    (async () => {
      for (const [name, args] of rows) await runtime.runTool(user, name, args, context);
      if (calls.length !== rows.length) process.exit(2);
      if (!calls.every((call) => call.method === 'GET')) process.exit(3);
      if (!calls.some((call) => call.apiPath === '/storage/me')) process.exit(4);
      if (!calls.some((call) => call.apiPath.includes('/system/resource-history?from='))) process.exit(5);
      if (!calls.some((call) => call.apiPath === '/meetings/overview/current')) process.exit(6);
    })().catch((error) => { console.error(error); process.exit(7); });
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, NAS_ROOT: tempRoot, AI_AGENT_DATA_ROOT: path.join(tempRoot, 'ai') }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
