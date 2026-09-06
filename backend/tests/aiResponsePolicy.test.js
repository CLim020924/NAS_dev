const test = require('node:test');
const assert = require('node:assert/strict');
const { finalizeAgentAnswer, needsConversationSearch } = require('../aiResponsePolicy');

test('실제 action 없는 승인 카드 문구를 완료 응답으로 노출하지 않는다', () => {
  const result = finalizeAgentAnswer('파일 만들어줘', {
    paused: false,
    text: '승인이 필요한 작업이 1개 있습니다. 승인 카드에서 승인해 주세요.',
  });
  assert.equal(result.protocolWarning, 'AI_FALSE_APPROVAL_CLAIM');
  assert.match(result.answer, /아무 작업도 실행하지 않았습니다/);
});

test('실제로 pause된 요청은 route의 승인 응답 생성을 방해하지 않는다', () => {
  assert.deepEqual(finalizeAgentAnswer('파일 만들어줘', { paused: true, text: '' }), { answer: '', protocolWarning: null });
});

test('숫자만 요청은 답에 숫자가 하나일 때 군더더기를 제거한다', () => {
  assert.equal(finalizeAgentAnswer('내 키를 숫자로만 답해', { text: '내 키는 177입니다.' }).answer, '177');
  assert.equal(finalizeAgentAnswer('숫자만 답해', { text: '후보는 177과 6810입니다.' }).answer, '후보는 177과 6810입니다.');
});

test('경로만 요청은 답에 경로가 하나일 때 경로만 남긴다', () => {
  assert.equal(finalizeAgentAnswer('NAS 루트 경로만 답해', { text: '현재 NAS 루트 경로는 `/`입니다.' }).answer, '/');
});

test('과거 대화와 기억 질문은 결정적으로 대화 검색 대상으로 분류한다', () => {
  ['내 키가 뭐였지?', '예전에 내가 뭐라고 말했어?', '이전 대화를 찾아줘', '맨 처음 질문이 뭐야?']
    .forEach((prompt) => assert.equal(needsConversationSearch(prompt), true, prompt));
  ['파일을 찾아줘', '서버 용량 알려줘'].forEach((prompt) => assert.equal(needsConversationSearch(prompt), false, prompt));
});
