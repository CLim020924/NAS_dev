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

test('미완성 작업 중 금지·조회·새 명령은 이전 변경 권한을 이어받지 않는다', () => {
  const pending = {
    status: 'collecting',
    updatedAt: new Date().toISOString(),
    originalRequest: '민수에게 메시지 보내줘',
    authorizedMutationTools: ['send_chat_message'],
  };
  ['메시지는 보내지 말고 초안만 써줘', '그 작업은 하지 마', '메시지 보내는 방법 알려줘',
    '어제 보냈는지 알려줘', '오늘 날씨 알려줘', '서버 재부팅해줘']
    .forEach((message) => assert.deepEqual(
      deriveAuthorizedMutationToolsFromConversation(message, [], pending).tools, [], message,
    ));
  assert.deepEqual(deriveAuthorizedMutationToolsFromConversation('민수', [], pending).tools, ['send_chat_message']);
  assert.deepEqual(deriveAuthorizedMutationToolsFromConversation('응 보내줘', [], pending).tools, ['send_chat_message']);
  assert.deepEqual(deriveAuthorizedMutationToolsFromConversation('영희에게 보내줘', [], pending).tools, []);
  assert.deepEqual(deriveAuthorizedMutationToolsFromConversation('영희에게 보내줘', [], {
    ...pending, originalRequest: '메시지 보내줘',
  }).tools, ['send_chat_message']);
});

test('과거 삭제 내역 질문은 이전 복구 권한을 이어받지 않는다', () => {
  const pending = {
    status: 'collecting',
    updatedAt: new Date().toISOString(),
    originalRequest: '삭제한 파일을 복원해줘',
    authorizedMutationTools: ['restore_trash_item'],
  };
  for (const message of ['나 오늘 뭐 삭제했어?', '아까 복구됐어?', '어떤 파일이 지워졌나요?']) {
    const result = deriveAuthorizedMutationToolsFromConversation(message, [], pending);
    assert.deepEqual(result, { tools: [], cancelled: false, carried: false }, message);
  }
});

test('변경 단어가 포함된 전 영역 조회는 실행 권한을 만들거나 이전 작업을 승계하지 않는다', () => {
  const prompts = [
    '차단된 사용자 알려줘',
    '친구 추가된 사용자 목록 알려줘',
    '읽음 처리된 알림 알려줘',
    '연결 해제된 PC 알려줘',
    '가입 승인된 계정 알려줘',
    '삭제된 노트 알려줘',
    '이동한 파일 내역 알려줘',
    '공유한 파일 목록 알려줘',
    '변경된 사용자 역할 현황 알려줘',
  ];
  const pending = {
    status: 'collecting',
    updatedAt: new Date().toISOString(),
    originalRequest: '민수를 차단해줘',
    authorizedMutationTools: ['set_user_blocked'],
  };
  prompts.forEach((message) => {
    assert.deepEqual(deriveAuthorizedMutationTools(message), [], message);
    assert.deepEqual(
      deriveAuthorizedMutationToolsFromConversation(message, [], pending),
      { tools: [], cancelled: false, carried: false },
      message,
    );
  });
});

test('상대에게 알려달라는 명시적 전송 요청은 조회가 아니라 채팅 실행으로 유지한다', () => {
  assert.deepEqual(deriveAuthorizedMutationTools('민수에게 회의가 취소됐다고 알려줘'), ['send_chat_message']);
});

test('실행되지 않은 보충 질문만 미완성 작업으로 유지한다', () => {
  assert.equal(shouldKeepPendingTask('누구에게 보낼까요?', [], ['send_chat_message']), true);
  assert.equal(shouldKeepPendingTask('완료했습니다.', [{ name: 'send_chat_message', ok: true }], ['send_chat_message']), false);
});

test('일반 문서는 파일 형식과 저장 위치를 사용자가 정하기 전 실행하지 않는다', () => {
  assert.deepEqual(_test.getMissingDocumentSlots('간증문 파일로 만들어줘\n테스트용 한 문장으로 알아서 써줘'), ['파일 형식', '저장 위치']);
  assert.deepEqual(_test.getMissingDocumentSlots('간증문을 HWPX 한글파일로 만들어줘'), ['저장 위치']);
  assert.deepEqual(_test.getMissingDocumentSlots('간증문을 HWPX로 /문서 경로에 만들어줘'), []);
  const pending = { status: 'collecting', updatedAt: new Date().toISOString(), originalRequest: '간증문 만들어줘', authorizedMutationTools: ['create_document'] };
  assert.deepEqual(deriveAuthorizedMutationToolsFromConversation('HWPX로 만들어줘', [], pending).tools, ['create_document']);
  assert.deepEqual(deriveAuthorizedMutationToolsFromConversation('현재 폴더에 저장해줘', [], pending).tools, ['create_document']);
  assert.throws(
    () => _test.assertDocumentRequestSlots('보고서 파일을 만들어줘'),
    (error) => error.code === 'AI_DOCUMENT_SLOT_REQUIRED' && error.missingSlots.length === 2,
  );
});
