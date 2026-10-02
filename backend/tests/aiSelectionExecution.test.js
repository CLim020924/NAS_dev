const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSelectionFrame } = require('../aiSelectionFrame');
const { resolveTrashSelection, summarizeTrashRestoreAction } = require('../aiSelectionExecution');

const trash = {
  items: [
    { trashId: 'trash-a', name: '보고서.pdf', originalPath: '/문서/보고서.pdf', deletedAt: '2026-10-02T01:02:03.000Z' },
    { trashId: 'trash-b', name: '사진.png', originalPath: '/사진/사진.png', deletedAt: '2026-10-02T02:03:04.000Z' },
  ],
};
const frame = buildSelectionFrame([{ name: 'list_trash', ok: true, result: trash }]);
const messages = [{ role: 'assistant', messageId: 'aimsg-source', createdAt: '2026-10-02T03:00:00.000Z', selectionFrame: frame }];

test('저장된 선택 프레임과 최신 휴지통을 대조해 실제 trash ID를 서버에서 복원한다', () => {
  const resolved = resolveTrashSelection({
    messages,
    selection: { sourceMessageId: 'aimsg-source', selectedKeys: ['2', '1'] },
    trashResult: trash,
  });
  assert.deepEqual(resolved.items.map((item) => item.trashId), ['trash-b', 'trash-a']);
  assert.match(resolved.idempotencyKey, /^trash-selection:[a-f0-9]{64}$/);
});

test('선택 뒤 휴지통 순서나 내용이 바뀌면 실행 전에 중단한다', () => {
  assert.throws(() => resolveTrashSelection({
    messages,
    selection: { sourceMessageId: 'aimsg-source', selectedKeys: ['1'] },
    trashResult: { items: [trash.items[1], trash.items[0]] },
  }), (error) => error.code === 'AI_TRASH_SELECTION_STALE');
});

test('클라이언트가 저장 목록에 없는 번호나 다른 선택 종류를 보내면 거절한다', () => {
  assert.throws(() => resolveTrashSelection({
    messages,
    selection: { sourceMessageId: 'aimsg-source', selectedKeys: ['99'] },
    trashResult: trash,
  }), (error) => error.code === 'AI_SELECTION_MISMATCH');
  const wrongFrame = buildSelectionFrame([{ name: 'search_files', ok: true, result: [{ name: 'a.txt', path: '/a.txt' }] }]);
  assert.throws(() => resolveTrashSelection({
    messages: [{ role: 'assistant', messageId: 'wrong', selectionFrame: wrongFrame }],
    selection: { sourceMessageId: 'wrong', selectedKeys: ['1'] },
    trashResult: trash,
  }), (error) => error.code === 'AI_SELECTION_WRONG_SOURCE');
});

test('복구 답변은 실제 action 상태만 설명한다', () => {
  assert.match(summarizeTrashRestoreAction({ status: 'pending', trashItems: trash.items }), /승인·실행/);
  assert.equal(summarizeTrashRestoreAction({ status: 'completed', result: { restoredCount: 2 } }), '선택한 2개 항목을 원래 위치로 실제 복구했습니다.');
  assert.match(summarizeTrashRestoreAction({ status: 'partial', result: { restoredCount: 1, failedCount: 1 } }), /1개는 실제 복구했고 1개는 복구하지 못했습니다/);
});
