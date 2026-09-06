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
