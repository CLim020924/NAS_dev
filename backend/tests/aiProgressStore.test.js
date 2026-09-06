const test = require('node:test');
const assert = require('node:assert/strict');
const {
  startProgress,
  updateProgress,
  getProgress,
  finishProgress,
  _test,
} = require('../aiProgressStore');

test('AI 진행 상태는 사용자와 requestId에 묶이고 단계가 누적된다', () => {
  _test.progressByRequest.clear();
  const owner = { userUid: 'user-a' };
  const other = { userUid: 'user-b' };
  const requestId = '123e4567-e89b-42d3-a456-426614174000';

  startProgress(owner, requestId);
  updateProgress(owner, requestId, {
    phase: 'tool', title: '파일을 검색하고 있습니다', detail: '안전 검사 중', progress: 55, stepTitle: '파일 검색',
  });
  finishProgress(owner, requestId);

  const result = getProgress(owner, requestId);
  assert.equal(result.state, 'completed');
  assert.equal(result.progress, 100);
  assert.deepEqual(result.steps.map((step) => step.title), ['요청 확인', '파일 검색', '완료']);
  assert.equal(getProgress(other, requestId), null);
});

test('잘못된 requestId는 진행 상태를 만들지 않는다', () => {
  _test.progressByRequest.clear();
  assert.equal(startProgress({ userUid: 'user-a' }, '../guess'), null);
  assert.equal(getProgress({ userUid: 'user-a' }, '../guess'), null);
});
