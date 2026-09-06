const FALSE_APPROVAL_CLAIM = /(?:승인이 필요한 작업이\s*\d+개|승인\s*카드에서\s*(?:승인|실행)|승인\s*대기\s*중)/i;
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

const finalizeAgentAnswer = (userMessage, agentResult = {}) => {
  if (agentResult.paused) return { answer: '', protocolWarning: null };
  let answer = String(agentResult.text || '').trim();
  if (FALSE_APPROVAL_CLAIM.test(answer)) {
    return {
      answer: '실제 승인 작업이 생성되지 않아 아무 작업도 실행하지 않았습니다. 대상과 원하는 작업을 구체적으로 다시 말씀해 주세요.',
      protocolWarning: 'AI_FALSE_APPROVAL_CLAIM',
    };
  }
  if (NUMERIC_ONLY_REQUEST.test(String(userMessage || ''))) answer = extractUniqueNumber(answer) || answer;
  if (PATH_ONLY_REQUEST.test(String(userMessage || ''))) answer = extractUniquePath(answer) || answer;
  return { answer, protocolWarning: null };
};

const needsConversationSearch = (userMessage) => RECALL_REQUEST.test(String(userMessage || ''));

module.exports = {
  finalizeAgentAnswer,
  needsConversationSearch,
  _test: { extractUniqueNumber, extractUniquePath, FALSE_APPROVAL_CLAIM },
};
