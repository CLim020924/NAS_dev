const lastUsefulLine = (value) => String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || '';

const classifyCodeExecutionError = ({ language, error } = {}) => {
  const normalizedLanguage = String(language || '').toLowerCase();
  const stderr = String(error?.result?.stderr || '');
  const combined = `${error?.code || ''}\n${error?.message || ''}\n${stderr}`;
  const result = { category: 'runtime', errorType: lastUsefulLine(stderr).split(':')[0] || 'RuntimeError' };

  if (/TIMEOUT/.test(combined)) return { category: 'timeout', errorType: 'Timeout', userMessage: `${normalizedLanguage === 'python' ? 'Python' : 'JavaScript'} 실행이 15초를 넘어 안전하게 중단되었습니다.` };
  if (/OUTPUT_LIMIT/.test(combined)) return { category: 'output-limit', errorType: 'OutputLimit', userMessage: '출력이 64KB를 넘어 안전하게 중단되었습니다. 반복 출력이나 큰 결과를 줄여 주세요.' };
  if (/EMPTY_CODE/.test(combined) || /실행할 .* 코드가 없습니다/.test(combined)) return { category: 'empty-code', errorType: 'EmptyCode', userMessage: '실행할 코드가 없습니다. 코드를 입력하고 저장한 뒤 다시 실행해 주세요.' };
  if (/WORKER_UNAVAILABLE|WORKER_START_FAILED/.test(combined)) return { category: 'infrastructure', errorType: 'WorkerUnavailable', userMessage: '코드 실행 환경을 시작하지 못했습니다. NAS 관리자에게 실행기 상태 확인이 필요합니다.' };
  if (/docker:\s*Error|Unable to find image|pull access denied|Cannot connect to the Docker daemon|permission denied.*docker\.sock/i.test(combined)) return { category: 'infrastructure', errorType: 'ContainerRuntimeError', userMessage: '코드 실행 이미지를 시작하지 못했습니다. NAS 관리자에게 런타임 이미지와 Docker 상태 확인이 필요합니다.' };
  if (/SyntaxError|invalid syntax|IndentationError|TabError/.test(combined)) return { category: 'syntax', errorType: /(?:SyntaxError|IndentationError|TabError)/.exec(combined)?.[0] || 'SyntaxError', userMessage: '코드 문법 오류입니다. 아래 오류 위치와 메시지를 확인해 주세요.' };
  if (/ModuleNotFoundError|ImportError|Cannot find module|ERR_MODULE_NOT_FOUND/.test(combined)) return { category: 'missing-module', errorType: /(?:ModuleNotFoundError|ImportError|ERR_MODULE_NOT_FOUND)/.exec(combined)?.[0] || 'ModuleNotFound', userMessage: '현재 격리 실행기에 없는 모듈을 불러왔습니다. 기본 제공 모듈만 사용할 수 있습니다.' };
  if (/NameError/.test(combined)) return { category: 'undefined-name', errorType: 'NameError', userMessage: /name ['"]console['"] is not defined/.test(combined) ? 'Python에서는 console.log(...) 대신 print(...)를 사용해 주세요.' : '정의되지 않은 이름을 사용했습니다. 변수명과 선언 순서를 확인해 주세요.' };
  if (/ReferenceError/.test(combined)) return { category: 'undefined-name', errorType: 'ReferenceError', userMessage: /print is not defined/.test(combined) ? 'JavaScript에서는 print(...) 대신 console.log(...)를 사용해 주세요.' : '정의되지 않은 이름을 사용했습니다. 변수명과 선언 순서를 확인해 주세요.' };

  return { ...result, userMessage: `${normalizedLanguage === 'python' ? 'Python' : 'JavaScript'} 코드에서 실행 오류가 발생했습니다. 서버 연결 문제는 아니며 아래 오류 내용을 확인해 주세요.` };
};

module.exports = { classifyCodeExecutionError, lastUsefulLine };
