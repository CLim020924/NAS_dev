const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deriveAuthorizedMutationTools,
  deriveAuthorizedMutationToolsFromConversation,
  shouldKeepPendingTask,
  _test,
} = require('../aiAgentRuntime');

test('일반 문서와 간단한 코딩 요청을 전용 작업으로 분류한다', () => {
  assert.deepEqual(deriveAuthorizedMutationTools('간증문 만들어줘'), ['create_document']);
  assert.deepEqual(deriveAuthorizedMutationTools('현재 폴더에 간증문 만들어줘'), ['create_document']);
  assert.deepEqual(deriveAuthorizedMutationTools('간단한 코딩 만들어줘'), ['create_note']);
});

test('친구 요청의 대상 단답을 미완성 작업과 결합한다', () => {
  const pending = {
    status: 'collecting',
    updatedAt: new Date().toISOString(),
    originalRequest: '친구신청좀해줘',
    authorizedMutationTools: ['send_friend_request'],
  };
  const result = deriveAuthorizedMutationToolsFromConversation('cksdudstudy', [], pending);
  assert.deepEqual(result.tools, ['send_friend_request']);
  assert.equal(result.carried, true);
});

test('문서 형식 단답과 명시적 후속 실행을 이전 요청에 결합한다', () => {
  const pending = {
    status: 'collecting',
    updatedAt: new Date().toISOString(),
    originalRequest: '간증문 만들어줘',
    authorizedMutationTools: ['create_document'],
  };
  assert.deepEqual(
    deriveAuthorizedMutationToolsFromConversation('한글파일로', [], pending).tools,
    ['create_document'],
  );
  const history = [{ role: 'user', content: '간증문 써봐' }, { role: 'assistant', content: '간증문 예시입니다.' }];
  assert.deepEqual(
    deriveAuthorizedMutationToolsFromConversation('응 만들어줘', history, null).tools,
    ['create_document'],
  );
});

test('취소는 미완성 작업 권한을 즉시 폐기한다', () => {
  const pending = {
    status: 'collecting',
    updatedAt: new Date().toISOString(),
    authorizedMutationTools: ['send_friend_request'],
  };
  const result = deriveAuthorizedMutationToolsFromConversation('취소', [], pending);
  assert.equal(result.cancelled, true);
  assert.deepEqual(result.tools, []);
});

test('실행되지 않은 보충 질문만 미완성 작업으로 유지한다', () => {
  assert.equal(shouldKeepPendingTask('누구에게 보낼까요?', [], ['send_chat_message']), true);
  assert.equal(shouldKeepPendingTask('완료했습니다.', [{ name: 'send_chat_message', ok: true }], ['send_chat_message']), false);
});

test('일반 문서는 파일 형식과 저장 위치를 사용자가 정하기 전 실행하지 않는다', () => {
  assert.deepEqual(_test.getMissingDocumentSlots('간증문 파일로 만들어줘\n테스트용 한 문장으로 알아서 써줘'), ['파일 형식', '저장 위치']);
  assert.deepEqual(_test.getMissingDocumentSlots('간증문을 HWPX 한글파일로 만들어줘'), ['저장 위치']);
  assert.deepEqual(_test.getMissingDocumentSlots('간증문을 HWPX로 /문서 경로에 만들어줘'), []);
  assert.throws(
    () => _test.assertDocumentRequestSlots('보고서 파일을 만들어줘'),
    (error) => error.code === 'AI_DOCUMENT_SLOT_REQUIRED' && error.missingSlots.length === 2,
  );
});
