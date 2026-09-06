const test = require('node:test');
const assert = require('node:assert/strict');
const { TOOL_DEFINITIONS, normalizePreferences, _test } = require('../aiAgentRuntime');

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

