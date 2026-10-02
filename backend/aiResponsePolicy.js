const FALSE_APPROVAL_CLAIM = /(?:승인이 필요한 작업이\s*\d+개|승인\s*카드.{0,12}(?:승인|실행)|승인\s*대기\s*중)/i;
const UNSUPPORTED_COMPLETION_CLAIM = /(?:(?:완료|생성|저장|수정|삭제|복사|이동|전송|실행|처리|추가|차단|복원|복구|변환)(?:했|되었|됐)|만들었|옮겼|보냈|되돌렸)(?:습니다|어요|다)/i;
const RECALL_REQUEST = /(?:과거|예전|이전|전에|맨\s*처음|기억|대화|말했던|말했|내\s*키)/i;
const NUMERIC_ONLY_REQUEST = /(?:숫자(?:로)?만|번호(?:로)?만)/i;
const PATH_ONLY_REQUEST = /(?:경로만\s*(?:답|말|알려)|(?:답|말).*(?:경로만))/i;
const SELECTION_QUESTION = /(?:선택|고르|어떤|어느|무엇|뭐|번호|대상)/i;
const { buildSelectionFrame, formatSelectionText } = require('./aiSelectionFrame');

const formatTrashSelection = (items = []) => {
  const safeItems = items.slice(0, 50);
  const rows = safeItems.map((item, index) => {
    const name = String(item?.name || '이름 없는 항목').replace(/[\r\n]+/g, ' ');
    const originalPath = String(item?.originalPath || item?.originalRelativePath || '/').replace(/[\r\n]+/g, ' ');
    const deletedAt = item?.deletedAt ? new Date(item.deletedAt) : null;
    const deletedLabel = deletedAt && !Number.isNaN(deletedAt.getTime())
      ? deletedAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
      : '삭제 시간 확인 불가';
    return `${index + 1}. ${name}\n   원래 위치: ${originalPath}\n   삭제 시간: ${deletedLabel}`;
  });
  if (items.length > safeItems.length) rows.push(`…외 ${items.length - safeItems.length}개`);
  return `복구할 항목을 번호로 선택해 주세요. 여러 개면 \`1, 3, 4\`, 전부면 \`전부\`라고 입력할 수 있습니다.\n\n${rows.join('\n')}`;
};

const extractUniqueNumber = (answer) => {
  const matches = String(answer || '').match(/\d+(?:[.,]\d+)*/g) || [];
  const unique = [...new Set(matches)];
  return unique.length === 1 ? unique[0] : null;
};

const extractUniquePath = (answer) => {
  const text = String(answer || '');
  const candidates = [
    ...(text.match(/(?:[A-Za-z]:\\[^\r\n`"']+|\/(?:[^\s`"'.,:;!?()\[\]{}]|\.(?!\s))+)/g) || []),
    ...Array.from(text.matchAll(/`([^`]+)`/g), (match) => match[1]).filter((value) => /^(?:\/|[A-Za-z]:\\)/.test(value)),
  ].map((value) => value.trim());
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0] : null;
};

const finalizeAgentAnswer = (userMessage, agentResult = {}, authorizedMutationTools = []) => {
  if (agentResult.paused) return { answer: '', protocolWarning: null, selectionFrame: null };
  let answer = String(agentResult.text || '').trim();
  if (FALSE_APPROVAL_CLAIM.test(answer)) {
    return {
      answer: '실제 승인 작업이 생성되지 않아 아무 작업도 실행하지 않았습니다. 대상과 원하는 작업을 구체적으로 다시 말씀해 주세요.',
      protocolWarning: 'AI_FALSE_APPROVAL_CLAIM',
      selectionFrame: null,
    };
  }
  if (authorizedMutationTools.length > 0 && UNSUPPORTED_COMPLETION_CLAIM.test(answer)) {
    const completed = authorizedMutationTools.every((name) => (agentResult.events || []).some((event) =>
      event.name === name && event.ok === true && event.result?.status === 'completed'));
    if (!completed) {
      return {
        answer: '요청한 변경 작업 전체의 완료를 서버에서 확인하지 못했습니다. 일부 작업은 실행됐을 수 있으니 작업 내역을 확인한 뒤 재시도해 주세요.',
        protocolWarning: 'AI_UNVERIFIED_COMPLETION_CLAIM',
        selectionFrame: null,
      };
    }
  }
  const selectionFrame = buildSelectionFrame(agentResult.events || []);
  if (authorizedMutationTools.includes('restore_trash_item')) {
    const restoreEvent = (agentResult.events || []).some((event) => event.name === 'restore_trash_item' && event.ok === true);
    const trashEvent = [...(agentResult.events || [])].reverse().find((event) => event.name === 'list_trash' && event.ok === true);
    const items = Array.isArray(trashEvent?.result?.items) ? trashEvent.result.items : [];
    if (!restoreEvent && items.length > 0 && /(?:어떤|어느|무엇|뭐|선택|번호|복구|복원|되돌)/i.test(answer)) {
      answer = selectionFrame ? formatSelectionText(selectionFrame) : formatTrashSelection(items);
    }
  }
  if (selectionFrame && SELECTION_QUESTION.test(answer) && !authorizedMutationTools.includes('restore_trash_item')) {
    answer = `${answer}\n\n${formatSelectionText(selectionFrame)}`.trim();
  }
  if (NUMERIC_ONLY_REQUEST.test(String(userMessage || ''))) answer = extractUniqueNumber(answer) || answer;
  if (PATH_ONLY_REQUEST.test(String(userMessage || ''))) answer = extractUniquePath(answer) || answer;
  return { answer, protocolWarning: null, selectionFrame };
};

const finalizeContinuationAnswer = (interruptions = [], agentResult = {}) => {
  const decisions = Array.isArray(interruptions) ? interruptions.map((item) => item?.decision).filter(Boolean) : [];
  if (decisions.length > 0 && decisions.every((decision) => decision === 'rejected')) {
    return { answer: '요청한 작업을 거절해 실행하지 않았습니다.', protocolWarning: null, selectionFrame: null };
  }
  return finalizeAgentAnswer('', agentResult);
};

const needsConversationSearch = (userMessage) => RECALL_REQUEST.test(String(userMessage || ''));

module.exports = {
  finalizeAgentAnswer,
  finalizeContinuationAnswer,
  needsConversationSearch,
  _test: { extractUniqueNumber, extractUniquePath, formatTrashSelection, FALSE_APPROVAL_CLAIM },
};
