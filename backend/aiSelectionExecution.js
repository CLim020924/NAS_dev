const crypto = require('crypto');
const { buildSelectionFrame } = require('./aiSelectionFrame');

const MAX_SELECTIONS = 50;

const normalizeKeys = (selection, frame) => {
  const allowed = new Set((frame.options || []).map((option) => String(option.key)));
  const requested = selection?.selectAll === true
    ? (frame.options || []).map((option) => String(option.key))
    : (Array.isArray(selection?.selectedKeys) ? selection.selectedKeys : []).map((key) => String(key));
  const unique = [...new Set(requested)];
  if (!unique.length || unique.length > MAX_SELECTIONS || unique.some((key) => !allowed.has(key))) {
    const err = new Error('선택한 항목이 저장된 목록과 일치하지 않습니다. 목록을 새로 불러온 뒤 다시 선택해 주세요.');
    err.status = 409;
    err.code = 'AI_SELECTION_MISMATCH';
    throw err;
  }
  return unique;
};

const findSourceMessage = (messages, selection) => {
  const sourceMessageId = String(selection?.sourceMessageId || '').trim();
  const sourceCreatedAt = String(selection?.sourceCreatedAt || '').trim();
  const matches = [...(messages || [])].reverse().filter((message) => message?.role === 'assistant' && message?.selectionFrame);
  const source = matches.find((message) => sourceMessageId && message.messageId === sourceMessageId)
    || matches.find((message) => !sourceMessageId && sourceCreatedAt && message.createdAt === sourceCreatedAt);
  if (!source) {
    const err = new Error('선택 원본 대화를 찾지 못했습니다. 휴지통 목록을 다시 요청해 주세요.');
    err.status = 409;
    err.code = 'AI_SELECTION_SOURCE_MISSING';
    throw err;
  }
  return source;
};

const comparableOption = (option) => JSON.stringify({
  key: String(option?.key || ''),
  label: String(option?.label || ''),
  details: Array.isArray(option?.details) ? option.details.map(String) : [],
});

const resolveTrashSelection = ({ messages, selection, trashResult }) => {
  const source = findSourceMessage(messages, selection);
  const savedFrame = source.selectionFrame;
  if (savedFrame?.sourceTool !== 'list_trash') {
    const err = new Error('이 선택 목록은 휴지통 복구 목록이 아닙니다.');
    err.status = 409;
    err.code = 'AI_SELECTION_WRONG_SOURCE';
    throw err;
  }
  const keys = normalizeKeys(selection, savedFrame);
  const currentFrame = buildSelectionFrame([{ name: 'list_trash', ok: true, result: trashResult }]);
  const items = Array.isArray(trashResult?.items) ? trashResult.items : [];
  if (!currentFrame) {
    const err = new Error('현재 복구 가능한 휴지통 항목이 없습니다.');
    err.status = 409;
    err.code = 'AI_TRASH_EMPTY';
    throw err;
  }
  const resolved = keys.map((key) => {
    const savedOption = savedFrame.options.find((option) => String(option.key) === key);
    const currentOption = currentFrame.options.find((option) => String(option.key) === key);
    if (!savedOption || !currentOption || comparableOption(savedOption) !== comparableOption(currentOption)) {
      const err = new Error('휴지통 목록이 선택 이후 변경되었습니다. 최신 목록에서 다시 선택해 주세요.');
      err.status = 409;
      err.code = 'AI_TRASH_SELECTION_STALE';
      throw err;
    }
    const item = items[Number(key) - 1];
    if (!item?.trashId) {
      const err = new Error('선택한 휴지통 항목의 복구 ID를 확인할 수 없습니다.');
      err.status = 409;
      err.code = 'AI_TRASH_ID_MISSING';
      throw err;
    }
    return {
      trashId: String(item.trashId),
      name: String(item.name || savedOption.label || '이름 없는 항목').slice(0, 240),
      originalPath: String(item.originalPath || item.originalRelativePath || '/').slice(0, 1000),
      deletedAt: item.deletedAt || null,
    };
  });
  const sourceKey = source.messageId || source.createdAt;
  return {
    sourceMessageId: source.messageId || null,
    items: resolved,
    idempotencyKey: `trash-selection:${crypto.createHash('sha256').update(`${sourceKey}:${resolved.map((item) => item.trashId).join(',')}`).digest('hex')}`,
  };
};

const summarizeTrashRestoreAction = (action) => {
  const count = Array.isArray(action?.trashItems) ? action.trashItems.length : Number(action?.preview?.itemCount || 0);
  if (action?.status === 'pending') return `선택한 ${count}개 항목의 복구 작업을 준비했습니다. 아래 승인 카드에서 승인·실행하면 실제 복구합니다.`;
  const restored = Number(action?.result?.restoredCount || 0);
  const failed = Number(action?.result?.failedCount || 0);
  if (action?.status === 'completed') return `선택한 ${restored}개 항목을 원래 위치로 실제 복구했습니다.`;
  if (action?.status === 'partial') return `${restored}개는 실제 복구했고 ${failed}개는 복구하지 못했습니다. 실패 항목과 오류를 작업 결과에서 확인해 주세요.`;
  if (action?.status === 'rejected') return `선택한 ${count}개 항목의 복구를 거절해 실행하지 않았습니다.`;
  return `선택한 ${count}개 항목의 복구 결과를 확정하지 못했습니다. 작업 상태를 확인해 주세요.`;
};

module.exports = { resolveTrashSelection, summarizeTrashRestoreAction, _test: { normalizeKeys, findSourceMessage, comparableOption } };
