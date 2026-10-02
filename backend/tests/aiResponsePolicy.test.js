const test = require('node:test');
const assert = require('node:assert/strict');
const { finalizeAgentAnswer, finalizeContinuationAnswer, needsConversationSearch } = require('../aiResponsePolicy');

test('실제 action 없는 승인 카드 문구를 완료 응답으로 노출하지 않는다', () => {
  const result = finalizeAgentAnswer('파일 만들어줘', {
    paused: false,
    text: '승인이 필요한 작업이 1개 있습니다. 승인 카드에서 승인해 주세요.',
  });
  assert.equal(result.protocolWarning, 'AI_FALSE_APPROVAL_CLAIM');
  assert.match(result.answer, /아무 작업도 실행하지 않았습니다/);
});

test('실제로 pause된 요청은 route의 승인 응답 생성을 방해하지 않는다', () => {
  assert.deepEqual(finalizeAgentAnswer('파일 만들어줘', { paused: true, text: '' }), { answer: '', protocolWarning: null, selectionFrame: null });
});

test('모든 승인 작업을 거절하면 모델 문구와 무관하게 미실행을 확정한다', () => {
  const result = finalizeContinuationAnswer([{ decision: 'rejected' }], {
    paused: false,
    text: '아직 승인 대기 중입니다. 승인 카드에서 승인해 주세요.',
  });
  assert.equal(result.answer, '요청한 작업을 거절해 실행하지 않았습니다.');
});

test('승인 후 후속 응답도 실제 action 없는 승인 문구를 차단한다', () => {
  const result = finalizeContinuationAnswer([{ decision: 'approved' }], {
    paused: false,
    text: '승인 카드에서 다시 승인해 주세요.',
  });
  assert.equal(result.protocolWarning, 'AI_FALSE_APPROVAL_CLAIM');
});

test('모델의 완료 문장은 실제 변경 도구 성공 기록이 있을 때만 신뢰한다', () => {
  const expected = ['create_folder', 'write_text_file'];
  for (const events of [[], [{ name: 'create_folder', ok: false }],
    [{ name: 'create_folder', ok: true, result: { status: 'completed' } }]]) {
    const result = finalizeAgentAnswer('폴더와 파일 만들어줘', { text: '모두 만들었습니다.', events }, expected);
    assert.equal(result.protocolWarning, 'AI_UNVERIFIED_COMPLETION_CLAIM');
    assert.match(result.answer, /확인하지 못했습니다/);
  }
  const result = finalizeAgentAnswer('폴더와 파일 만들어줘', {
    text: '모두 만들었습니다.',
    events: expected.map((name) => ({ name, ok: true, result: { status: 'completed' } })),
  }, expected);
  assert.equal(result.protocolWarning, null);
  assert.equal(result.answer, '모두 만들었습니다.');
});

test('복원되었습니다 문구도 실제 복구 실행 기록이 없으면 차단한다', () => {
  ['요청한 파일이 모두 복원되었습니다.', '삭제 파일을 복구했습니다.', '원래 위치로 되돌렸습니다.'].forEach((text) => {
    const result = finalizeAgentAnswer('오늘 삭제한거 전부 되돌려줄래', { text, events: [] }, ['restore_trash_item']);
    assert.equal(result.protocolWarning, 'AI_UNVERIFIED_COMPLETION_CLAIM');
    assert.match(result.answer, /확인하지 못했습니다/);
  });
});

test('복원 대상을 다시 물을 때 휴지통 결과를 번호 목록으로 고정한다', () => {
  const result = finalizeAgentAnswer('삭제한 파일 복원해줄래', {
    text: '어떤 파일을 복원할까요?',
    events: [{
      name: 'list_trash',
      ok: true,
      result: { items: [
        { trashId: 'secret-a', name: '보고서.pdf', originalPath: '/문서/보고서.pdf', deletedAt: '2026-10-02T01:02:03.000Z' },
        { trashId: 'secret-b', name: '사진.png', originalPath: '/사진/사진.png', deletedAt: '2026-10-02T02:03:04.000Z' },
      ] },
    }],
  }, ['restore_trash_item']);
  assert.match(result.answer, /^복구할 항목을 번호로 선택해 주세요/);
  assert.match(result.answer, /1\. 보고서\.pdf/);
  assert.match(result.answer, /2\. 사진\.png/);
  assert.doesNotMatch(result.answer, /secret-a|secret-b/);
  assert.equal(result.selectionFrame.title, '복구할 항목 선택');
  assert.equal(result.selectionFrame.options.length, 2);
  assert.equal(result.selectionFrame.options[0].key, '1');
  assert.equal(result.selectionFrame.options[0].label, '보고서.pdf');
  assert.equal(result.selectionFrame.options[0].details[0], '/문서/보고서.pdf');
  assert.match(result.selectionFrame.options[0].details[1], /^삭제 2026\. 10\. 2\./);
  assert.equal(result.selectionFrame.options[0].reply, '1번 · 보고서.pdf');
  assert.doesNotMatch(JSON.stringify(result.selectionFrame), /secret-a|secret-b/);
});

test('파일·사용자·노트 등 조회 결과에도 공통 선택 프레임을 만든다', () => {
  const cases = [
    ['search_files', [{ name: '시험.java', path: '/과제/시험.java', type: 'file' }], '검색 결과 선택'],
    ['search_users', { results: [{ displayName: '홍길동', username: 'hong', userUid: 'secret-uid' }] }, '사용자 선택'],
    ['list_notebooks', { notebooks: [{ title: '자바 공부', notebookId: 'secret-note' }] }, '노트북 선택'],
  ];
  cases.forEach(([name, result, title]) => {
    const finalized = finalizeAgentAnswer('목록 보여줘', { text: '확인했습니다.', events: [{ name, ok: true, result }] });
    assert.equal(finalized.selectionFrame.title, title);
    assert.equal(finalized.selectionFrame.options.length, 1);
    assert.doesNotMatch(JSON.stringify(finalized.selectionFrame), /secret-uid|secret-note/);
  });
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
