const FALSE_APPROVAL_CLAIM = /(?:승인이 필요한 작업이\s*\d+개|승인\s*카드.{0,12}(?:승인|실행)|승인\s*대기\s*중)/i;
const UNSUPPORTED_COMPLETION_CLAIM = /(?:완료했|완료되었|생성했|만들었|저장했|수정했|삭제했|복사했|이동했|옮겼|전송했|보냈|실행했|처리했|추가했|차단했|복원했|변환했)(?:습니다|어요|다)/i;
const RECALL_REQUEST = /(?:과거|예전|이전|전에|맨\s*처음|기억|대화|말했던|말했|내\s*키)/i;
const NUMERIC_ONLY_REQUEST = /(?:숫자(?:로)?만|번호(?:로)?만)/i;
const PATH_ONLY_REQUEST = /(?:경로만\s*(?:답|말|알려)|(?:답|말).*(?:경로만))/i;

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
  if (agentResult.paused) return { answer: '', protocolWarning: null };
  let answer = String(agentResult.text || '').trim();
  if (FALSE_APPROVAL_CLAIM.test(answer)) {
    return {
      answer: '실제 승인 작업이 생성되지 않아 아무 작업도 실행하지 않았습니다. 대상과 원하는 작업을 구체적으로 다시 말씀해 주세요.',
      protocolWarning: 'AI_FALSE_APPROVAL_CLAIM',
    };
  }
  if (authorizedMutationTools.length > 0 && UNSUPPORTED_COMPLETION_CLAIM.test(answer)) {
    const completed = authorizedMutationTools.every((name) => (agentResult.events || []).some((event) =>
      event.name === name && event.ok === true && event.result?.status === 'completed'));
    if (!completed) {
      return {
        answer: '요청한 변경 작업 전체의 완료를 서버에서 확인하지 못했습니다. 일부 작업은 실행됐을 수 있으니 작업 내역을 확인한 뒤 재시도해 주세요.',
        protocolWarning: 'AI_UNVERIFIED_COMPLETION_CLAIM',
      };
    }
  }
  if (NUMERIC_ONLY_REQUEST.test(String(userMessage || ''))) answer = extractUniqueNumber(answer) || answer;
  if (PATH_ONLY_REQUEST.test(String(userMessage || ''))) answer = extractUniquePath(answer) || answer;
  return { answer, protocolWarning: null };
};

const finalizeContinuationAnswer = (interruptions = [], agentResult = {}) => {
  const decisions = Array.isArray(interruptions) ? interruptions.map((item) => item?.decision).filter(Boolean) : [];
  if (decisions.length > 0 && decisions.every((decision) => decision === 'rejected')) {
    return { answer: '요청한 작업을 거절해 실행하지 않았습니다.', protocolWarning: null };
  }
  return finalizeAgentAnswer('', agentResult);
};

const needsConversationSearch = (userMessage) => RECALL_REQUEST.test(String(userMessage || ''));

module.exports = {
  finalizeAgentAnswer,
  finalizeContinuationAnswer,
  needsConversationSearch,
  _test: { extractUniqueNumber, extractUniquePath, FALSE_APPROVAL_CLAIM },
};
