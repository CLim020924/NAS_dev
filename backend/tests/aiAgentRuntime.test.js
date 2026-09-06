const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { TOOL_DEFINITIONS, normalizePreferences, assertToolPathAllowed, _test } = require('../aiAgentRuntime');

test('AI 도구 스키마는 strict이며 임의 속성을 허용하지 않는다', () => {
  assert.ok(TOOL_DEFINITIONS.length >= 10);
  TOOL_DEFINITIONS.forEach((tool) => {
    assert.equal(tool.strict, true);
    assert.equal(tool.parameters.additionalProperties, false);
  });
});

test('승인 모드는 위험 등급에 따라 자동 실행 범위를 제한한다', () => {
  assert.equal(_test.mayAutoExecute('safe', 'ask_each'), false);
  assert.equal(_test.mayAutoExecute('safe', 'auto_safe'), true);
  assert.equal(_test.mayAutoExecute('reversible', 'auto_safe'), false);
  assert.equal(_test.mayAutoExecute('reversible', 'auto_reversible'), true);
  assert.equal(_test.mayAutoExecute('external', 'auto_reversible'), false);
  assert.equal(_test.mayAutoExecute('external', 'auto_all'), true);
  assert.equal(_test.mayAutoExecute('permanent', 'auto_all'), false);
});

test('잘못된 승인 모드와 토큰 상한을 안전한 값으로 정규화한다', () => {
  const prefs = normalizePreferences({ approvalMode: 'anything', dailyTokenLimit: 99 });
  assert.equal(prefs.approvalMode, 'ask_each');
  assert.equal(prefs.dailyTokenLimit, 1000);
});

test('AI는 숨김 경로와 인증정보 가능성이 있는 파일을 직접 다루지 못한다', () => {
  assert.equal(assertToolPathAllowed('/문서/보고서.md'), '/문서/보고서.md');
  ['/.env', '/project/.git/config', '/.ssh/id_ed25519', '/keys/server.pem', '/.ai_backups/report.bak', '/credentials.json']
    .forEach((candidate) => assert.throws(() => assertToolPathAllowed(candidate), { code: 'AI_SENSITIVE_PATH_BLOCKED' }));
});

test('조회한 파일의 지시만으로 변경 도구를 실행할 수 없고 최신 사용자 의도를 요구한다', () => {
  assert.deepEqual(_test.deriveAuthorizedMutationTools('이 파일을 읽고 내용만 알려줘'), []);
  assert.ok(_test.deriveAuthorizedMutationTools('보고서를 날짜별로 정리해줘').includes('organize_files_by_modified_date'));
  assert.ok(_test.deriveAuthorizedMutationTools('민수에게 보고서 파일을 보내줘').includes('send_file_to_user'));
  assert.ok(_test.deriveAuthorizedMutationTools('오래된 파일을 휴지통으로 삭제해줘').includes('trash_item'));
});

test('날짜별 정리는 승인 후 원본이 바뀌면 실행 계획을 거부한다', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-ai-organize-'));
  const runtimePath = path.resolve(__dirname, '..', 'aiAgentRuntime.js');
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const runtime = require(${JSON.stringify(runtimePath)});
    const user = { loginId: 'tester', role: 'USER' };
    const root = path.join(process.env.NAS_ROOT, 'users', 'tester');
    fs.mkdirSync(path.join(root, 'source'), { recursive: true });
    fs.mkdirSync(path.join(root, 'sorted'), { recursive: true });
    const target = path.join(root, 'source', 'report.txt');
    fs.writeFileSync(target, 'before');
    const plan = runtime._test.buildOrganizationPlan(user, '/source', '/sorted', 'day');
    fs.writeFileSync(target, 'changed-after-approval');
    try { runtime._test.resolveOrganizationPlans(user, plan); process.exit(2); }
    catch (err) { if (!String(err.message).includes('승인 후 파일 상태가 변경')) process.exit(3); }
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=must-not-leak');
    try {
      fs.symlinkSync(path.join(root, '.env'), path.join(root, 'source', 'visible.txt'));
      try { runtime.readTextFile(user, '/source/visible.txt'); process.exit(4); }
      catch (err) { if (err.code !== 'AI_SENSITIVE_PATH_BLOCKED') process.exit(5); }
    } catch (err) {
      if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(err.code)) process.exit(6);
    }
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, NAS_ROOT: tempRoot }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('외부 사용자 작업은 승인 전에 UID를 고정하고 실행 때 달라지면 중단한다', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-ai-target-binding-'));
  const runtimePath = path.resolve(__dirname, '..', 'aiAgentRuntime.js');
  const storePath = path.resolve(__dirname, '..', 'aiAgentStore.js');
  const script = `
    const runtime = require(${JSON.stringify(runtimePath)});
    const store = require(${JSON.stringify(storePath)});
    const user = { loginId: 'target-binding-test', userUid: 'target-binding-test', role: 'USER' };
    const firstTarget = { userUid: 'uid-original', loginId: 'recipient', displayName: '받는 사람' };
    (async () => {
      store.setPreferences(user, { approvalMode: 'auto_all' });
      const pending = await runtime.runTool(user, 'send_chat_message', { user: 'recipient', text: '안녕하세요' }, {
        callId: 'bound-call', idempotencyKey: 'target-binding-test:bound-call', forceApproval: true,
        authorizedMutationTools: ['send_chat_message'],
        platformCall: async (method, apiPath) => {
          if (method !== 'GET' || !apiPath.includes('/friends/search')) process.exit(2);
          return { results: [firstTarget] };
        },
      });
      if (pending.status !== 'pending_approval') process.exit(3);
      const stored = store.listActions(user).find((item) => item.actionId === pending.actionId);
      if (stored.targetUserUid !== 'uid-original' || stored.targetUserLoginId !== 'recipient') process.exit(4);
      try {
        await runtime.executeAction(user, pending.actionId, { platformCall: async () => ({ results: [{ ...firstTarget, userUid: 'uid-changed' }] }) });
        process.exit(5);
      } catch (err) {
        if (err.code !== 'AI_TARGET_IDENTITY_CHANGED') process.exit(6);
      }
      if (store.listActions(user).find((item) => item.actionId === pending.actionId).status !== 'failed') process.exit(7);
    })().catch((err) => { console.error(err); process.exit(8); });
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', script], {
      env: { ...process.env, AI_AGENT_DATA_ROOT: tempRoot }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
