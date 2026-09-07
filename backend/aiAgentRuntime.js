const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const config = require('./config/env');
const { createDocxWithText, createRhwpWithText } = require('./blankDocumentService');
const { SURFACES, buildCapabilityCatalog } = require('./aiCapabilityCatalog');
const {
  createAction,
  listActions,
  updateAction,
  searchMessages,
  getPreferences,
} = require('./aiAgentStore');
const {
  getAccessBasePath,
  resolveInside,
  isSameOrChild,
  assertQuotaAvailable,
  invalidateUsageCache,
} = require('./storageQuota');

const APPROVAL_MODES = new Set(['ask_each', 'auto_safe', 'auto_reversible', 'auto_all']);
const TEXT_EXTS = new Set(['.txt', '.md', '.json', '.csv', '.tsv', '.log', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.xml', '.yml', '.yaml', '.env', '.ini', '.conf', '.py', '.sql', '.sh']);
const MAX_READ_BYTES = 180 * 1024;
const MAX_ORGANIZE_ITEMS = 500;
const INTERNAL_PATH_PARTS = new Set(['.nas_trash', '.agent_trash', '.agent_versions', '.ai_backups', '.note_studio', '.agent_incoming', 'chat_tmp']);
const SENSITIVE_NAMES = /^(?:\.env(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials?(?:\.[^.]+)?|secrets?(?:\.[^.]+)?|.*\.(?:pem|key|pfx|p12))$/i;
let serverRhwpPromise = null;

const getMissingDocumentSlots = (intentText = '') => {
  const text = String(intentText || '');
  const hasFormat = /(?:^|[^a-z0-9])(txt|text|텍스트|md|markdown|마크다운|docx|word|워드|hwp|hwpx|한글)(?![a-z0-9])/i.test(text);
  const hasLocation = /(?:^|\s)\/(?:[^\s]*)|(?:루트|현재|이곳|여기|선택한)\s*(?:폴더|경로|위치)?|(?:폴더|경로|위치)\s*(?:에|로|에서|:)/i.test(text);
  return [!hasFormat && '파일 형식', !hasLocation && '저장 위치'].filter(Boolean);
};

const assertDocumentRequestSlots = (intentText) => {
  const missing = getMissingDocumentSlots(intentText);
  if (missing.length === 0) return;
  const err = new Error(`문서 생성에 필요한 ${missing.join('과 ')}를 사용자가 아직 정하지 않았습니다. 임의 기본값으로 도구를 호출하지 말고 두 항목을 한 번에 물어보세요.`);
  err.status = 409;
  err.code = 'AI_DOCUMENT_SLOT_REQUIRED';
  err.missingSlots = missing;
  throw err;
};

const ensureServerRhwp = async () => {
  if (!serverRhwpPromise) {
    serverRhwpPromise = (async () => {
      const coreDir = path.join(__dirname, '..', 'frontend', 'node_modules', '@rhwp', 'core');
      const mod = await import(pathToFileURL(path.join(coreDir, 'rhwp.js')).href);
      globalThis.measureTextWidth = globalThis.measureTextWidth || ((font, text) => String(text || '').length * 10);
      await mod.default({ module_or_path: fs.readFileSync(path.join(coreDir, 'rhwp_bg.wasm')) });
      return mod;
    })();
  }
  return serverRhwpPromise;
};
const MUTATION_INTENT_RULES = {
  create_folder: /(?:폴더|디렉터리).*(?:생성|만들)|(?:생성|만들).*(?:폴더|디렉터리)/i,
  write_text_file: /(?:파일|문서|메모|내용).*(?:생성|만들|작성|저장|수정|기록)/i,
  create_document: /(?:간증문|보고서|기획서|계획서|제안서|신청서|공문|편지|과제|문서).*(?:파일.*)?(?:생성|만들|작성)|(?:생성|만들|작성).*(?:간증문|보고서|기획서|계획서|제안서|신청서|공문|편지|과제)/i,
  append_text_file: /(?:파일|문서|메모|내용).*(?:추가|이어|덧붙)|(?:추가|이어|덧붙).*(?:파일|문서|메모|내용)/i,
  copy_item: /복사|복제|사본/i,
  move_item: /이동|옮기|옮겨|이름.*(?:변경|바꾸|바꿔)|(?:변경|바꾸|바꿔).*이름/i,
  trash_item: /삭제|지우|지워|휴지통/i,
  organize_files_by_modified_date: /정리|분류|날짜별|월별/i,
  send_friend_request: /친구.*(?:추가|요청)|(?:추가|요청).*친구/i,
  set_user_blocked: /차단|차단.*해제|차단해제/i,
  send_chat_message: /(?:채팅|메시지|말).*(?:보내|전송)|(?:보내|전송).*(?:채팅|메시지|말)|에게.*(?:알려|말해)/i,
  send_file_to_user: /(?:파일|폴더|문서).*(?:보내|전송|공유)|(?:보내|전송|공유).*(?:파일|폴더|문서)/i,
  create_note: /(?:노트|페이지|코드|코딩|프로그램|스크립트).*(?:생성|만들|작성)|(?:생성|만들|작성).*(?:노트|페이지|코드|코딩|프로그램|스크립트)/i,
  update_note: /(?:노트|페이지).*(?:수정|편집|저장|바꿔)|(?:수정|편집|저장|바꿔).*(?:노트|페이지)/i,
  trash_note: /(?:노트|페이지).*(?:삭제|지우|지워|휴지통)|(?:삭제|지우|지워|휴지통).*(?:노트|페이지)/i,
  create_office_document: /(?:문서|워드|엑셀|파워포인트|한글|docx|xlsx|pptx|hwpx).*(?:생성|만들)|(?:생성|만들).*(?:문서|워드|엑셀|파워포인트|한글|docx|xlsx|pptx|hwpx)/i,
  run_python_note: /(?:파이썬|python).*(?:실행|돌려)|(?:실행|돌려).*(?:파이썬|python)/i,
  run_javascript_note: /(?:자바스크립트|javascript|js).*(?:실행|돌려)|(?:실행|돌려).*(?:자바스크립트|javascript|js)/i,
  restore_trash_item: /(?:휴지통|삭제한).*(?:복원|되돌)|(?:복원|되돌).*(?:휴지통|삭제한)/i,
  restore_file_version: /(?:파일|문서).*(?:이전|과거|버전).*(?:복원|되돌)|(?:이전|과거|버전).*(?:파일|문서).*(?:복원|되돌)/i,
  create_drive_restore_point: /(?:드라이브|전체).*(?:복구\s*지점|스냅샷).*(?:생성|만들)|(?:복구\s*지점|스냅샷).*(?:생성|만들)/i,
  restore_drive_restore_point: /(?:드라이브|전체).*(?:복구\s*지점|스냅샷).*(?:복원|되돌)|(?:복구\s*지점|스냅샷).*(?:복원|되돌)/i,
  set_file_favorite: /(?:파일|폴더|항목|경로).*(?:즐겨찾기|별표)|(?:즐겨찾기|별표).*(?:파일|폴더|항목|경로)/i,
  accept_friend_request: /친구\s*요청.*수락|받은\s*요청.*수락/i,
  reject_friend_request: /친구\s*요청.*(?:거절|거부)|받은\s*요청.*(?:거절|거부)/i,
  remove_friend: /친구.*(?:삭제|제거|끊)|(?:삭제|제거|끊).*친구/i,
  set_friend_favorite: /친구.*즐겨찾기|즐겨찾기.*친구/i,
  mark_notification_read: /알림.*(?:읽음|확인\s*처리)|(?:읽음|확인\s*처리).*알림/i,
  mark_all_notifications_read: /(?:모든|전체).*알림.*(?:읽음|확인\s*처리)|알림.*(?:모두|전체).*(?:읽음|확인\s*처리)/i,
  create_notebook: /노트북.*(?:생성|만들)|(?:생성|만들).*노트북/i,
  restore_note: /(?:삭제한|휴지통).*노트.*(?:복원|되돌)|노트.*(?:복원|되돌)/i,
  restore_note_version: /노트.*(?:이전|과거|버전).*(?:복원|되돌)|(?:이전|과거|버전).*노트.*(?:복원|되돌)/i,
  attach_note_item: /노트.*(?:파일|폴더|항목).*(?:첨부|연결)|(?:파일|폴더|항목).*(?:노트).*(?:첨부|연결)/i,
  remove_note_attachment: /노트.*첨부.*(?:제거|삭제|해제)|첨부.*(?:제거|삭제|해제)/i,
  cancel_document_job: /(?:문서|변환).*작업.*(?:취소|중단)|(?:취소|중단).*(?:문서|변환).*작업/i,
  retry_document_job: /(?:문서|변환).*작업.*(?:재시도|다시\s*실행)|(?:재시도|다시\s*실행).*(?:문서|변환).*작업/i,
  create_document_job: /(?:문서|파일).*(?:변환|합치|병합|일괄\s*만들).*(?:실행|시작|해\s*줘)|(?:변환|합치|병합|일괄\s*만들).*(?:실행|시작|해\s*줘)/i,
  set_device_sync: /(?:PC|피시|컴퓨터|장치|드라이버).*(?:동기화).*(?:일시\s*정지|중지|재개)|(?:동기화).*(?:일시\s*정지|중지|재개).*(?:PC|피시|컴퓨터|장치|드라이버)/i,
  revoke_device: /(?:PC|피시|컴퓨터|장치|드라이버).*(?:연결|등록)(?:을|를)?\s*해제|(?:연결|등록)(?:을|를)?\s*해제.*(?:PC|피시|컴퓨터|장치|드라이버)/i,
  create_share_link: /(?:파일|폴더|경로|항목).*(?:공유\s*링크|링크\s*공유).*(?:생성|만들)|(?:공유\s*링크|링크\s*공유).*(?:생성|만들)/i,
  set_share_paused: /공유\s*링크.*(?:일시\s*정지|중지|재개)|(?:일시\s*정지|중지|재개).*공유\s*링크/i,
  revoke_share_link: /공유\s*링크.*(?:삭제|폐기|해제|비활성)|(?:삭제|폐기|해제|비활성).*공유\s*링크/i,
  create_group_chat: /(?:그룹\s*채팅|단체\s*채팅|채팅방).*(?:생성|만들)|(?:생성|만들).*(?:그룹\s*채팅|단체\s*채팅|채팅방)/i,
  invite_group_chat: /(?:그룹\s*채팅|단체\s*채팅|채팅방).*(?:초대)|(?:초대).*(?:그룹\s*채팅|단체\s*채팅|채팅방)/i,
  respond_group_invite: /(?:채팅방|그룹\s*채팅).*초대.*(?:수락|거절|거부)|초대.*(?:수락|거절|거부)/i,
  leave_group_chat: /(?:그룹\s*채팅|단체\s*채팅|채팅방).*(?:나가|퇴장)|(?:나가|퇴장).*(?:그룹\s*채팅|단체\s*채팅|채팅방)/i,
  send_group_message: /(?:그룹\s*채팅|단체\s*채팅|채팅방).*(?:메시지|채팅).*(?:보내|전송)|(?:메시지|채팅).*(?:그룹\s*채팅|단체\s*채팅|채팅방).*(?:보내|전송)/i,
  transfer_group_owner: /(?:그룹\s*채팅|채팅방).*(?:방장|소유자).*(?:위임|변경)|(?:방장|소유자).*(?:위임|변경)/i,
  set_group_cohost: /(?:그룹\s*채팅|채팅방).*(?:부방장).*(?:지정|해제|설정)|(?:부방장).*(?:지정|해제|설정)/i,
  kick_group_member: /(?:그룹\s*채팅|채팅방).*(?:내보내|강퇴)|(?:내보내|강퇴).*(?:그룹\s*채팅|채팅방)/i,
  delete_group_chat: /(?:그룹\s*채팅|채팅방).*(?:파기|방\s*삭제)|(?:파기|방\s*삭제).*(?:그룹\s*채팅|채팅방)/i,
  update_managed_user: /(?:사용자|계정).*(?:용량|할당량|역할|권한|닉네임|표시\s*이름).*(?:변경|수정|부여|설정)|(?:용량|할당량|역할|권한).*(?:사용자|계정).*(?:변경|수정|부여|설정)/i,
  approve_signup: /(?:가입|신규\s*계정).*(?:승인|허가)|(?:승인|허가).*(?:가입|신규\s*계정)/i,
  reject_signup: /(?:가입|신규\s*계정).*(?:거절|거부)|(?:거절|거부).*(?:가입|신규\s*계정)/i,
  set_resource_policy: /(?:서버|사용자).*(?:자원|CPU|RAM|메모리).*(?:정책|제한|임계값).*(?:변경|설정|적용)|(?:자원|CPU|RAM|메모리).*(?:정책|제한|임계값).*(?:변경|설정|적용)/i,
  set_login_persistence: /(?:로그인|세션).*(?:유지|자동\s*로그인).*(?:켜|끄|설정|변경)|(?:자동\s*로그인).*(?:켜|끄|설정|변경)/i,
  update_profile: /(?:내|계정|프로필).*(?:닉네임|표시\s*이름).*(?:변경|수정|바꿔)|(?:닉네임|표시\s*이름).*(?:변경|수정|바꿔)/i,
  configure_meeting: /(?:회의|화상회의).*(?:설정|공개|비공개|입장\s*방식).*(?:변경|저장|설정)|(?:회의\s*설정).*(?:변경|저장)/i,
  start_meeting: /(?:회의|화상회의).*(?:시작|열어|개설)|(?:시작|열어|개설).*(?:회의|화상회의)/i,
  save_meeting: /(?:회의|화상회의).*(?:정규|고정).*(?:저장|전환)|(?:임시\s*회의).*(?:저장|정규)/i,
  save_chat_attachments: /(?:채팅|메시지).*(?:첨부|받은\s*파일).*(?:저장|받아)|(?:첨부|받은\s*파일).*(?:저장|받아)/i,
  mark_chat_read: /(?:채팅|대화방|메시지).*(?:읽음|확인\s*처리)|(?:읽음|확인\s*처리).*(?:채팅|대화방|메시지)/i,
  update_share_link: /공유\s*링크.*(?:만료|다운로드|미리보기|설명|이름|권한).*(?:변경|수정|설정)|(?:만료|다운로드|미리보기).*(?:공유\s*링크).*(?:변경|수정|설정)/i,
  regenerate_share_token: /공유\s*링크.*(?:재발급|새\s*주소)|(?:재발급|새\s*주소).*공유\s*링크/i,
};
const MUTATION_TOOL_NAMES = Object.freeze(Object.keys(MUTATION_INTENT_RULES));

const schema = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const stringProp = (description) => ({ type: 'string', description });

const TOOL_DEFINITIONS = [
  { type: 'function', name: 'get_agent_capabilities', description: '현재 배포된 NAS AI가 실제로 지원하는 제품 영역·도구 수와 보안상 위임하지 않는 경계를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'list_files', description: '로그인 사용자가 접근 가능한 NAS 폴더의 파일과 하위 폴더를 조회한다.', strict: true, parameters: schema({ path: stringProp('조회할 NAS 경로. 루트는 /.') }, ['path']) },
  { type: 'function', name: 'search_files', description: '로그인 사용자의 NAS 범위에서 이름으로 파일과 폴더를 검색한다.', strict: true, parameters: schema({ query: stringProp('검색어'), path: stringProp('검색 시작 경로') }, ['query', 'path']) },
  { type: 'function', name: 'read_text_file', description: '권한 범위의 텍스트 또는 코드 파일을 읽는다.', strict: true, parameters: schema({ path: stringProp('읽을 파일 경로') }, ['path']) },
  { type: 'function', name: 'search_conversation_history', description: '이 AI 대화창에 실제 저장된 이전 대화를 정확한 키워드로 검색한다. 기억을 추측하지 않는다.', strict: true, parameters: schema({ query: stringProp('찾을 문장 또는 키워드') }, ['query']) },
  { type: 'function', name: 'list_notes', description: '현재 계정의 Note Studio 노트를 제목과 내용 검색어로 조회한다. 전체 목록은 빈 문자열을 사용한다.', strict: true, parameters: schema({ query: stringProp('검색어. 전체 목록은 빈 문자열') }, ['query']) },
  { type: 'function', name: 'read_note', description: 'Note Studio 노트 ID로 저장된 최신 제목, 형식, 내용, revision을 읽는다.', strict: true, parameters: schema({ note_id: stringProp('조회할 노트 ID') }, ['note_id']) },
  { type: 'function', name: 'get_storage_summary', description: '현재 계정의 할당량, 사용량, 남은 저장공간을 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'get_path_storage', description: '현재 계정 권한 안의 파일 또는 폴더가 차지하는 용량과 항목 수를 계산한다.', strict: true, parameters: schema({ path: stringProp('용량을 확인할 NAS 경로') }, ['path']) },
  { type: 'function', name: 'get_file_properties', description: '현재 계정 권한 안의 파일 또는 폴더 속성을 조회한다.', strict: true, parameters: schema({ path: stringProp('속성을 확인할 NAS 경로') }, ['path']) },
  { type: 'function', name: 'list_trash', description: '현재 계정의 복구 가능한 휴지통 항목을 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'list_file_versions', description: '파일의 복구 가능한 이전 버전 목록을 조회한다.', strict: true, parameters: schema({ path: stringProp('버전 기록을 확인할 파일 경로') }, ['path']) },
  { type: 'function', name: 'list_drive_restore_points', description: '현재 계정 드라이브의 복구 지점 목록을 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'list_activity', description: '현재 계정 NAS의 최근 파일 활동 기록을 조회한다.', strict: true, parameters: schema({ limit: { type: 'integer', minimum: 1, maximum: 200, description: '가져올 최대 기록 수' } }, ['limit']) },
  { type: 'function', name: 'list_favorites', description: '현재 계정의 즐겨찾기 파일과 폴더를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'list_recent_files', description: '현재 계정에서 최근 사용한 파일을 조회한다.', strict: true, parameters: schema({ limit: { type: 'integer', minimum: 1, maximum: 200, description: '가져올 최대 파일 수' } }, ['limit']) },
  { type: 'function', name: 'list_friends', description: '친구, 받은 요청, 보낸 요청, 차단 사용자와 온라인 상태를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'search_users', description: '친구 추가나 메시지 대상 후보를 로그인 ID 또는 표시 이름으로 검색한다.', strict: true, parameters: schema({ query: stringProp('사용자 검색어') }, ['query']) },
  { type: 'function', name: 'list_chat_conversations', description: '현재 계정이 참여한 1:1 및 그룹 채팅방을 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'list_chat_messages', description: '현재 계정이 참여한 정확한 채팅방의 메시지를 조회한다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 식별자') }, ['conversation_id']) },
  { type: 'function', name: 'list_notifications', description: '현재 계정의 알림 목록과 읽음 상태를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'get_unread_notification_count', description: '현재 계정의 읽지 않은 알림 개수를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'list_notebooks', description: 'Note Studio의 노트북 목록을 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'list_deleted_notes', description: 'Note Studio 휴지통에 있는 복구 가능한 노트를 조회한다.', strict: true, parameters: schema({ query: stringProp('검색어. 전체 목록은 빈 문자열') }, ['query']) },
  { type: 'function', name: 'list_note_versions', description: '정확한 Note Studio 노트의 저장 버전 목록을 조회한다.', strict: true, parameters: schema({ note_id: stringProp('노트 ID') }, ['note_id']) },
  { type: 'function', name: 'list_devices', description: '현재 계정에 연동된 NAS Driver PC와 연결·동기화 상태를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'get_document_studio_capabilities', description: '문서 변환에서 지원하는 원본·결과 형식과 현재 변환 엔진 상태를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'get_document_job', description: '정확한 문서 변환 작업의 진행률, 결과 또는 오류를 조회한다.', strict: true, parameters: schema({ job_id: stringProp('문서 작업 ID') }, ['job_id']) },
  { type: 'function', name: 'get_server_metrics', description: '관리자 또는 마스터 계정에서 CPU, RAM, 디스크, 온도와 자원 보호 상태를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'get_resource_history', description: '관리자 또는 마스터 계정에서 서버 및 사용자별 자원 사용 기록을 조회한다.', strict: true, parameters: schema({ hours: { type: 'integer', minimum: 1, maximum: 168, description: '조회할 최근 시간 수' } }, ['hours']) },
  { type: 'function', name: 'list_users_admin', description: '관리자 또는 마스터 계정에서 사용자, 역할, 승인 상태와 저장공간 할당 정보를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'get_user_preferences', description: '현재 계정의 플랫폼 환경설정과 표시 설정을 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'list_shares', description: '현재 계정이 만든 NAS 공유 링크와 만료·보안 상태를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'get_share_logs', description: '현재 계정이 만든 정확한 공유 링크의 접근 기록을 조회한다.', strict: true, parameters: schema({ share_id: stringProp('공유 ID') }, ['share_id']) },
  { type: 'function', name: 'get_meeting_status', description: '현재 계정이 접근 가능한 정확한 회의방의 현재 상태를 조회한다.', strict: true, parameters: schema({ room_id: stringProp('회의방 ID') }, ['room_id']) },
  { type: 'function', name: 'get_current_meeting_overview', description: '현재 계정과 관련된 진행 중 회의 상태를 조회한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'search_public_meetings', description: '참여 가능한 공개 회의를 제목 또는 참가자 이름으로 검색한다.', strict: true, parameters: schema({ query: stringProp('회의 검색어') }, ['query']) },
  { type: 'function', name: 'restore_trash_item', description: '정확한 휴지통 ID의 파일 또는 폴더를 원래 위치로 복원한다.', strict: true, parameters: schema({ trash_id: stringProp('휴지통 항목 ID') }, ['trash_id']) },
  { type: 'function', name: 'restore_file_version', description: '정확한 파일의 선택한 이전 버전을 복원한다.', strict: true, parameters: schema({ path: stringProp('대상 파일 경로'), version_id: stringProp('복원할 버전 ID') }, ['path', 'version_id']) },
  { type: 'function', name: 'create_drive_restore_point', description: '현재 계정 전체 드라이브의 복구 지점을 만든다.', strict: true, parameters: schema({ label: stringProp('복구 지점 이름') }, ['label']) },
  { type: 'function', name: 'restore_drive_restore_point', description: '현재 계정 전체 드라이브를 선택한 복구 지점으로 되돌린다. 광범위한 변경이므로 항상 개별 승인이 필요하다.', strict: true, parameters: schema({ restore_point_id: stringProp('복구 지점 ID') }, ['restore_point_id']) },
  { type: 'function', name: 'set_file_favorite', description: '현재 계정의 정확한 파일 또는 폴더를 즐겨찾기에 추가하거나 해제한다.', strict: true, parameters: schema({ path: stringProp('대상 경로'), favorite: { type: 'boolean' } }, ['path', 'favorite']) },
  { type: 'function', name: 'accept_friend_request', description: '받은 친구 요청을 관계 ID로 수락한다.', strict: true, parameters: schema({ relation_id: stringProp('받은 친구 요청 관계 ID') }, ['relation_id']) },
  { type: 'function', name: 'reject_friend_request', description: '받은 친구 요청을 관계 ID로 거절한다.', strict: true, parameters: schema({ relation_id: stringProp('받은 친구 요청 관계 ID') }, ['relation_id']) },
  { type: 'function', name: 'remove_friend', description: '정확히 식별한 사용자와 친구 관계를 해제한다.', strict: true, parameters: schema({ user: stringProp('로그인 ID 또는 표시 이름') }, ['user']) },
  { type: 'function', name: 'set_friend_favorite', description: '정확히 식별한 친구를 즐겨찾기에 추가하거나 해제한다.', strict: true, parameters: schema({ user: stringProp('로그인 ID 또는 표시 이름'), favorite: { type: 'boolean' } }, ['user', 'favorite']) },
  { type: 'function', name: 'mark_notification_read', description: '정확한 알림 하나를 읽음 처리한다.', strict: true, parameters: schema({ notification_id: stringProp('알림 ID') }, ['notification_id']) },
  { type: 'function', name: 'mark_all_notifications_read', description: '현재 계정의 모든 알림을 읽음 처리한다.', strict: true, parameters: schema({}) },
  { type: 'function', name: 'create_notebook', description: 'Note Studio에 새 노트북을 만든다.', strict: true, parameters: schema({ title: stringProp('노트북 이름') }, ['title']) },
  { type: 'function', name: 'restore_note', description: 'Note Studio 휴지통의 정확한 노트를 복원한다.', strict: true, parameters: schema({ note_id: stringProp('노트 ID') }, ['note_id']) },
  { type: 'function', name: 'restore_note_version', description: '노트를 선택한 과거 버전으로 복원한다.', strict: true, parameters: schema({ note_id: stringProp('노트 ID'), version_id: stringProp('버전 ID'), expected_revision: { type: 'integer' } }, ['note_id', 'version_id', 'expected_revision']) },
  { type: 'function', name: 'attach_note_item', description: '현재 계정 NAS의 파일 또는 폴더를 정확한 노트에 연결한다.', strict: true, parameters: schema({ note_id: stringProp('노트 ID'), path: stringProp('첨부할 NAS 경로'), expected_revision: { type: 'integer' } }, ['note_id', 'path', 'expected_revision']) },
  { type: 'function', name: 'remove_note_attachment', description: '정확한 노트의 첨부 연결을 제거한다. 원본 NAS 파일은 삭제하지 않는다.', strict: true, parameters: schema({ note_id: stringProp('노트 ID'), attachment_id: stringProp('첨부 ID'), expected_revision: { type: 'integer' } }, ['note_id', 'attachment_id', 'expected_revision']) },
  { type: 'function', name: 'cancel_document_job', description: '실행 중이거나 대기 중인 문서 변환 작업을 취소한다.', strict: true, parameters: schema({ job_id: stringProp('문서 작업 ID') }, ['job_id']) },
  { type: 'function', name: 'retry_document_job', description: '실패하거나 취소된 문서 변환 작업을 새 작업으로 재시도한다.', strict: true, parameters: schema({ job_id: stringProp('문서 작업 ID') }, ['job_id']) },
  { type: 'function', name: 'create_document_job', description: '문서 변환·PDF/PPTX 합치기·혼합 PDF·PPTX 템플릿 일괄 생성을 작업 큐에서 시작한다. 실제 지원 형식은 먼저 get_document_studio_capabilities로 확인한다.', strict: true, parameters: schema({ mode: { type: 'string', enum: ['convert-pdf', 'merge-pdf', 'merge-mixed-pdf', 'merge-pptx', 'template-pptx'] }, sources: { type: 'array', items: { type: 'object', properties: { full_path: stringProp('원본 NAS 경로'), name: stringProp('표시 파일명') }, required: ['full_path', 'name'], additionalProperties: false }, minItems: 1, maxItems: 100 }, output_path: stringProp('완료 파일을 저장할 NAS 폴더'), output_name: stringProp('합치기 결과 파일명. 개별 변환이면 빈 문자열'), source_format: stringProp('원본 형식 또는 auto'), output_format: stringProp('결과 형식'), template_rows_json: stringProp('템플릿 모드 치환 행 JSON 배열. 다른 모드는 []') , file_name_template: stringProp('템플릿 결과 파일명 규칙. 다른 모드는 빈 문자열') }, ['mode', 'sources', 'output_path', 'output_name', 'source_format', 'output_format', 'template_rows_json', 'file_name_template']) },
  { type: 'function', name: 'set_device_sync', description: '정확한 연동 PC의 동기화를 일시 정지하거나 재개한다.', strict: true, parameters: schema({ device_id: stringProp('연동 장치 ID'), action: { type: 'string', enum: ['pause', 'resume'] } }, ['device_id', 'action']) },
  { type: 'function', name: 'revoke_device', description: '현재 계정의 정확한 연동 PC 등록을 해제한다. 항상 개별 승인이 필요하다.', strict: true, parameters: schema({ device_id: stringProp('연동 장치 ID') }, ['device_id']) },
  { type: 'function', name: 'create_share_link', description: '현재 계정의 NAS 파일 또는 폴더 하나 이상에 만료되는 공개 공유 링크를 만든다. 비밀번호는 채팅으로 받거나 저장하지 않는다.', strict: true, parameters: schema({ paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 }, display_name: stringProp('공유 표시 이름'), expire_days: { type: 'integer', minimum: 1, maximum: 365 }, allow_preview: { type: 'boolean' }, allow_download: { type: 'boolean' }, include_subfolders: { type: 'boolean' }, allow_folder_download: { type: 'boolean' }, note: stringProp('공유 설명. 없으면 빈 문자열') }, ['paths', 'display_name', 'expire_days', 'allow_preview', 'allow_download', 'include_subfolders', 'allow_folder_download', 'note']) },
  { type: 'function', name: 'set_share_paused', description: '정확한 공유 링크를 일시 정지하거나 재개한다.', strict: true, parameters: schema({ share_id: stringProp('공유 ID'), paused: { type: 'boolean' } }, ['share_id', 'paused']) },
  { type: 'function', name: 'revoke_share_link', description: '정확한 공유 링크를 비활성화한다. 원본 파일은 삭제하지 않는다.', strict: true, parameters: schema({ share_id: stringProp('공유 ID') }, ['share_id']) },
  { type: 'function', name: 'create_group_chat', description: '정확히 식별한 사용자들을 초대하는 그룹 채팅방을 만든다.', strict: true, parameters: schema({ title: stringProp('채팅방 이름'), users: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50, description: '초대할 로그인 ID 또는 표시 이름' } }, ['title', 'users']) },
  { type: 'function', name: 'invite_group_chat', description: '참여 중인 정확한 그룹 채팅방에 사용자들을 초대한다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID'), users: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 } }, ['conversation_id', 'users']) },
  { type: 'function', name: 'respond_group_invite', description: '정확한 그룹 채팅 초대를 수락하거나 거절한다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID'), accept: { type: 'boolean' } }, ['conversation_id', 'accept']) },
  { type: 'function', name: 'leave_group_chat', description: '정확한 그룹 채팅방에서 나간다. 방장 위임이 필요한 경우 먼저 사용자를 지정해야 한다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID') }, ['conversation_id']) },
  { type: 'function', name: 'send_group_message', description: '현재 참여 중인 정확한 채팅방에 메시지를 보낸다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID'), text: stringProp('보낼 메시지') }, ['conversation_id', 'text']) },
  { type: 'function', name: 'transfer_group_owner', description: '방장이 정확한 그룹 채팅 참가자에게 방장을 위임한다. 항상 개별 승인이 필요하다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID'), user: stringProp('새 방장의 로그인 ID 또는 표시 이름') }, ['conversation_id', 'user']) },
  { type: 'function', name: 'set_group_cohost', description: '방장이 정확한 그룹 채팅 참가자를 부방장으로 지정하거나 해제한다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID'), user: stringProp('대상 로그인 ID 또는 표시 이름'), enabled: { type: 'boolean' } }, ['conversation_id', 'user', 'enabled']) },
  { type: 'function', name: 'kick_group_member', description: '방장 또는 부방장이 정확한 참가자를 그룹 채팅방에서 내보낸다. 항상 개별 승인이 필요하다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID'), user: stringProp('대상 로그인 ID 또는 표시 이름') }, ['conversation_id', 'user']) },
  { type: 'function', name: 'delete_group_chat', description: '방장이 정확한 그룹 채팅방을 파기한다. 항상 개별 승인이 필요하다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID') }, ['conversation_id']) },
  { type: 'function', name: 'update_managed_user', description: '관리자 또는 마스터가 정확한 사용자의 용량·역할·전체 NAS 접근·표시 이름을 변경한다. 기존 사용자 조회 결과를 바탕으로 모든 값을 명시해야 하며 항상 개별 승인이 필요하다.', strict: true, parameters: schema({ user_uid: stringProp('사용자 고정 UID'), login_id: stringProp('검증용 로그인 ID'), role: { type: 'string', enum: ['MASTER', 'MANAGER', 'USER'] }, global_access: { type: 'boolean' }, storage_quota_gb: { type: 'number', minimum: 1 }, display_name: stringProp('표시 이름'), nickname: stringProp('닉네임') }, ['user_uid', 'login_id', 'role', 'global_access', 'storage_quota_gb', 'display_name', 'nickname']) },
  { type: 'function', name: 'approve_signup', description: '관리자 또는 마스터가 정확한 대기 계정의 가입을 승인한다. 기본 저장공간 예약 가능 여부는 서버가 다시 검증하며 항상 개별 승인이 필요하다.', strict: true, parameters: schema({ user_uid: stringProp('가입 대기 사용자 UID'), login_id: stringProp('검증용 로그인 ID') }, ['user_uid', 'login_id']) },
  { type: 'function', name: 'reject_signup', description: '관리자 또는 마스터가 정확한 대기 계정의 가입 요청을 거절한다. 항상 개별 승인이 필요하다.', strict: true, parameters: schema({ user_uid: stringProp('가입 대기 사용자 UID'), login_id: stringProp('검증용 로그인 ID') }, ['user_uid', 'login_id']) },
  { type: 'function', name: 'set_resource_policy', description: '관리자 또는 마스터가 서버 자원 보호를 자동 또는 수동 모드로 설정한다. 수동값은 get_server_metrics의 현재 effective 정책을 바탕으로 모두 명시하며 항상 개별 승인이 필요하다.', strict: true, parameters: schema({ mode: { type: 'string', enum: ['auto', 'manual'] }, enforcement_enabled: { type: 'boolean' }, retention_days: { type: 'integer', minimum: 1, maximum: 365 }, manual: { type: 'object', properties: { cpu_soft_percent: { type: 'number' }, cpu_hard_percent: { type: 'number' }, load_soft: { type: 'number' }, load_hard: { type: 'number' }, min_available_memory_mb: { type: 'number' }, hard_min_available_memory_mb: { type: 'number' }, swap_soft_percent: { type: 'number' }, swap_hard_percent: { type: 'number' }, temperature_soft_c: { type: 'number' }, temperature_hard_c: { type: 'number' }, min_nas_free_gb: { type: 'number' }, default_user_cpu_percent: { type: 'number' }, default_user_memory_mb: { type: 'number' }, default_user_max_concurrent_jobs: { type: 'integer' } }, required: ['cpu_soft_percent', 'cpu_hard_percent', 'load_soft', 'load_hard', 'min_available_memory_mb', 'hard_min_available_memory_mb', 'swap_soft_percent', 'swap_hard_percent', 'temperature_soft_c', 'temperature_hard_c', 'min_nas_free_gb', 'default_user_cpu_percent', 'default_user_memory_mb', 'default_user_max_concurrent_jobs'], additionalProperties: false } }, ['mode', 'enforcement_enabled', 'retention_days', 'manual']) },
  { type: 'function', name: 'set_login_persistence', description: '현재 계정의 로그인 유지 설정을 켜거나 끈다.', strict: true, parameters: schema({ enabled: { type: 'boolean' } }, ['enabled']) },
  { type: 'function', name: 'update_profile', description: '현재 로그인한 본인 계정의 닉네임과 표시 이름을 변경한다.', strict: true, parameters: schema({ nickname: stringProp('새 닉네임. 2자 이상') }, ['nickname']) },
  { type: 'function', name: 'configure_meeting', description: '관리 권한이 있는 채팅방의 정규 회의 제목·공개 범위·검색·입장 방식을 설정한다. 회의 비밀번호는 AI가 취급하지 않는다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID'), title: stringProp('회의 제목'), room_code: stringProp('회의 코드. 기존 코드를 유지하려면 현재 값'), access_mode: { type: 'string', enum: ['members', 'private', 'link', 'public'] }, searchable: { type: 'boolean' }, entry_mode: { type: 'string', enum: ['open', 'approval'] } }, ['conversation_id', 'title', 'room_code', 'access_mode', 'searchable', 'entry_mode']) },
  { type: 'function', name: 'start_meeting', description: '현재 계정이 참여할 수 있는 정확한 채팅방 회의를 시작하거나 기존 회의 상태를 가져온다. 카메라·마이크 사용은 화면에서 사용자가 직접 허용한다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID') }, ['conversation_id']) },
  { type: 'function', name: 'save_meeting', description: '현재 계정이 방장인 임시 회의를 정규 회의방으로 저장한다. 비밀번호 없는 접근 정책만 설정한다.', strict: true, parameters: schema({ room_id: stringProp('현재 회의방 ID'), title: stringProp('저장할 회의 제목'), access_mode: { type: 'string', enum: ['members', 'private', 'link', 'public'] }, searchable: { type: 'boolean' }, entry_mode: { type: 'string', enum: ['open', 'approval'] } }, ['room_id', 'title', 'access_mode', 'searchable', 'entry_mode']) },
  { type: 'function', name: 'save_chat_attachments', description: '정확한 채팅 메시지의 첨부 파일을 현재 계정의 받은 파일 폴더에 저장한다.', strict: true, parameters: schema({ message_id: stringProp('첨부가 있는 메시지 ID') }, ['message_id']) },
  { type: 'function', name: 'mark_chat_read', description: '정확한 채팅방의 메시지와 관련 알림을 읽음 처리한다.', strict: true, parameters: schema({ conversation_id: stringProp('채팅방 ID') }, ['conversation_id']) },
  { type: 'function', name: 'update_share_link', description: '정확한 공유 링크의 이름·만료일·설명·조회/다운로드 한도와 허용 기능을 변경한다. 비밀번호는 AI가 취급하지 않는다.', strict: true, parameters: schema({ share_id: stringProp('공유 ID'), display_name: stringProp('표시 이름'), expire_days: { type: 'integer', minimum: 1, maximum: 365 }, note: stringProp('설명'), max_views: { type: 'integer', minimum: 0 }, max_downloads: { type: 'integer', minimum: 0 }, allow_preview: { type: 'boolean' }, allow_download: { type: 'boolean' }, include_subfolders: { type: 'boolean' }, allow_folder_download: { type: 'boolean' } }, ['share_id', 'display_name', 'expire_days', 'note', 'max_views', 'max_downloads', 'allow_preview', 'allow_download', 'include_subfolders', 'allow_folder_download']) },
  { type: 'function', name: 'regenerate_share_token', description: '정확한 공유 링크의 주소 토큰을 재발급해 기존 주소를 무효화한다. 항상 개별 승인이 필요하다.', strict: true, parameters: schema({ share_id: stringProp('공유 ID') }, ['share_id']) },
  { type: 'function', name: 'create_folder', description: 'NAS에 폴더를 만든다. 승인 정책에 따라 즉시 실행하거나 승인 대기한다.', strict: true, parameters: schema({ path: stringProp('생성할 폴더 경로') }, ['path']) },
  { type: 'function', name: 'write_text_file', description: '텍스트 파일을 새로 만들거나 안전 백업 후 덮어쓴다.', strict: true, parameters: schema({ path: stringProp('저장 경로'), content: stringProp('UTF-8 내용') }, ['path', 'content']) },
  { type: 'function', name: 'create_document', description: 'AI가 작성한 본문을 현재 계정 NAS의 TXT, Markdown, DOCX, HWP 또는 HWPX 문서로 저장한다. 형식이나 저장 위치가 정해지지 않았으면 추측해 호출하지 말고 사용자에게 필요한 값만 묻는다.', strict: true, parameters: schema({ path: stringProp('확장자를 포함한 저장 경로'), format: { type: 'string', enum: ['txt', 'md', 'docx', 'hwp', 'hwpx'] }, content: stringProp('문서에 저장할 전체 본문') }, ['path', 'format', 'content']) },
  { type: 'function', name: 'append_text_file', description: '텍스트 파일 끝에 내용을 추가한다.', strict: true, parameters: schema({ path: stringProp('대상 경로'), content: stringProp('추가할 UTF-8 내용') }, ['path', 'content']) },
  { type: 'function', name: 'copy_item', description: '파일 또는 폴더를 다른 NAS 폴더로 복사한다.', strict: true, parameters: schema({ source_path: stringProp('원본 경로'), destination_folder: stringProp('복사할 폴더 경로') }, ['source_path', 'destination_folder']) },
  { type: 'function', name: 'move_item', description: '파일 또는 폴더를 이동하거나 이름을 변경한다.', strict: true, parameters: schema({ source_path: stringProp('원본 경로'), destination_path: stringProp('최종 경로') }, ['source_path', 'destination_path']) },
  { type: 'function', name: 'trash_item', description: '파일 또는 폴더를 영구 삭제하지 않고 복구 가능한 NAS 휴지통으로 옮긴다.', strict: true, parameters: schema({ path: stringProp('휴지통으로 옮길 경로') }, ['path']) },
  { type: 'function', name: 'organize_files_by_modified_date', description: '선택한 폴더 바로 아래 파일을 마지막 수정일의 날짜 또는 월 폴더로 안전하게 정리한다. 하위 폴더는 이동하지 않는다.', strict: true, parameters: schema({ folder_path: stringProp('정리할 원본 폴더'), destination_folder: stringProp('날짜 폴더를 만들 기준 폴더'), granularity: { type: 'string', enum: ['day', 'month'], description: 'day는 YYYY-MM-DD, month는 YYYY-MM' } }, ['folder_path', 'destination_folder', 'granularity']) },
  { type: 'function', name: 'send_friend_request', description: '정확히 식별된 다른 사용자에게 친구 요청을 보낸다.', strict: true, parameters: schema({ user: stringProp('로그인 ID 또는 표시 이름') }, ['user']) },
  { type: 'function', name: 'set_user_blocked', description: '정확히 식별된 다른 사용자를 차단하거나 차단 해제한다.', strict: true, parameters: schema({ user: stringProp('로그인 ID 또는 표시 이름'), blocked: { type: 'boolean', description: 'true면 차단, false면 해제' } }, ['user', 'blocked']) },
  { type: 'function', name: 'send_chat_message', description: '친구인 정확한 사용자에게 NAS 채팅 메시지를 보낸다.', strict: true, parameters: schema({ user: stringProp('로그인 ID 또는 표시 이름'), text: stringProp('보낼 메시지') }, ['user', 'text']) },
  { type: 'function', name: 'send_file_to_user', description: '권한 범위의 NAS 파일 또는 폴더를 친구인 정확한 사용자에게 채팅 첨부로 보낸다.', strict: true, parameters: schema({ user: stringProp('로그인 ID 또는 표시 이름'), path: stringProp('보낼 NAS 파일 또는 폴더 경로'), message: stringProp('첨부와 함께 보낼 메시지. 없으면 빈 문자열') }, ['user', 'path', 'message']) },
  { type: 'function', name: 'create_note', description: '현재 계정 Note Studio에 Markdown, TXT 또는 코드 노트를 만든다.', strict: true, parameters: schema({ title: stringProp('노트 제목'), type: { type: 'string', enum: ['markdown', 'text', 'code'] }, content: stringProp('노트 내용'), language: stringProp('코드 언어. 코드가 아니면 plaintext'), notebook_id: { type: ['string', 'null'] }, parent_id: { type: ['string', 'null'] } }, ['title', 'type', 'content', 'language', 'notebook_id', 'parent_id']) },
  { type: 'function', name: 'update_note', description: '최신 revision과 정확히 일치할 때 Note Studio 노트 제목이나 내용을 새 버전으로 저장한다.', strict: true, parameters: schema({ note_id: stringProp('수정할 노트 ID'), expected_revision: { type: 'integer' }, title: stringProp('새 제목'), content: stringProp('새 내용') }, ['note_id', 'expected_revision', 'title', 'content']) },
  { type: 'function', name: 'trash_note', description: 'Note Studio 노트를 복구 가능한 휴지통으로 이동한다.', strict: true, parameters: schema({ note_id: stringProp('휴지통으로 옮길 노트 ID'), expected_revision: { type: 'integer' } }, ['note_id', 'expected_revision']) },
  { type: 'function', name: 'create_office_document', description: '실제 노트북 페이지 폴더에 빈 Office 또는 HWPX 문서를 만들고 해당 노트에 연결한다.', strict: true, parameters: schema({ note_id: stringProp('문서를 연결할 노트 ID'), expected_revision: { type: 'integer' }, format: { type: 'string', enum: ['docx', 'xlsx', 'pptx', 'hwpx'] }, file_name: stringProp('확장자를 제외한 파일 이름') }, ['note_id', 'expected_revision', 'format', 'file_name']) },
  { type: 'function', name: 'run_python_note', description: '저장된 Python 코드 노트를 네트워크 없는 제한 컨테이너에서 실행한다.', strict: true, parameters: schema({ note_id: stringProp('Python 코드 노트 ID'), expected_revision: { type: 'integer' } }, ['note_id', 'expected_revision']) },
  { type: 'function', name: 'run_javascript_note', description: '저장된 JavaScript 코드 노트를 네트워크 없는 제한 컨테이너에서 실행한다.', strict: true, parameters: schema({ note_id: stringProp('JavaScript 코드 노트 ID'), expected_revision: { type: 'integer' } }, ['note_id', 'expected_revision']) },
];

const TOOL_DEFINITION_BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
const READ_TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((tool) => tool.name).filter((name) => !MUTATION_TOOL_NAMES.includes(name)));
const SURFACE_HINTS = Object.freeze({
  conversation: /(?:대화|기억|전에|예전|말했|요청했|내\s*키)/i,
  files: /(?:파일|폴더|경로|디렉터리|휴지통|복사|이동|삭제|정리|버전|복구\s*지점|즐겨찾기|최근|활동)/i,
  storage: /(?:저장공간|저장\s*공간|용량|할당량|디스크)/i,
  friends: /(?:친구|사용자\s*검색|차단)/i,
  chat: /(?:채팅|메시지|대화방|받은\s*파일|방장|부방장|강퇴)/i,
  notifications: /(?:알림|읽지\s*않은)/i,
  notes: /(?:노트|노트북|페이지|마크다운|코드|파이썬|python)/i,
  documents: /(?:문서\s*변환|PDF|PPTX|DOCX|HWPX?|XLSX|합치|병합|템플릿)/i,
  devices: /(?:연동\s*PC|NAS\s*Driver|나스\s*드라이버|장치|동기화|컴퓨터\s*연결)/i,
  shares: /(?:공유\s*링크|공개\s*링크)/i,
  meetings: /(?:회의|화상회의|미팅|카메라|마이크)/i,
  account: /(?:로그인\s*유지|자동\s*로그인|프로필|닉네임|표시\s*이름)/i,
  administration: /(?:관리자|마스터|서버|CPU|RAM|메모리|온도|가입\s*승인|가입\s*거절|자원\s*정책|사용자\s*관리|역할)/i,
});

const selectToolDefinitions = (message = '', authorizedMutationTools = []) => {
  const text = String(message || '');
  const selected = new Set(['get_agent_capabilities']);
  const matchedSurfaces = new Set();
  Object.entries(SURFACE_HINTS).forEach(([surface, pattern]) => { if (pattern.test(text)) matchedSurfaces.add(surface); });
  for (const mutationName of authorizedMutationTools || []) {
    selected.add(mutationName);
    Object.entries(SURFACES).forEach(([surface, names]) => { if (names.includes(mutationName)) matchedSurfaces.add(surface); });
  }
  matchedSurfaces.forEach((surface) => {
    (SURFACES[surface] || []).forEach((name) => { if (READ_TOOL_NAMES.has(name)) selected.add(name); });
  });
  if (matchedSurfaces.size === 0 && /(?:찾|보여|확인|읽|조회|알려)/i.test(text)) {
    ['list_files', 'search_files', 'read_text_file'].forEach((name) => selected.add(name));
  }
  return [...selected].map((name) => TOOL_DEFINITION_BY_NAME.get(name)).filter(Boolean);
};
const isReadOnlyTool = (name) => READ_TOOL_NAMES.has(name);

const defaults = () => ({ approvalMode: 'ask_each', dailyTokenLimit: config.AI_DEFAULT_DAILY_TOKEN_LIMIT });
const normalizePreferences = (value = {}) => ({
  ...value,
  approvalMode: APPROVAL_MODES.has(value.approvalMode) ? value.approvalMode : 'ask_each',
  dailyTokenLimit: Math.max(1000, Math.min(Number(value.dailyTokenLimit) || config.AI_DEFAULT_DAILY_TOKEN_LIMIT, 1000000)),
});

const NON_EXECUTION_QUESTION = /(?:방법(?:만)?(?:을)?\s*(?:알려|설명)|어떻게\s*(?:해|하|쓰|사용)|가능한지|(?:할|해\s*줄)\s*수\s*(?:있|없)\s*(?:는지)?|해도\s*(?:돼|되|될)|하면\s*될까|뭐야|무엇이야|차이(?:가|는)?|버튼.*어디|어디.*버튼|여부(?:를)?\s*(?:알려|확인)|기능(?:을)?\s*(?:설명|알려)|안전해\??)/i;
const RECALL_OR_PAST_QUESTION = /(?:했었|한\s*적|했는지|했지\??|했나\??|말했|요청했|기록.*찾아|대화.*찾아)/i;
const PROHIBITED_REQUEST = /(?:하지\s*마|하지마|하지\s*말|하지말|하지\s*않|하지않|보내지\s*마|삭제하지|지우지|옮기지|복사하지|실행하지|만들지|생성하지|수정하지|저장하지|추가하지|차단하지|말고)/i;
const EXPLICIT_EXECUTION_REQUEST = /(?:해\s*줘|해주세요|해\s*주세요|해라|해봐|부탁해|부탁합니다|시작해|실행해|돌려줘|돌려\s*줘|만들어|생성해|작성해|저장해|수정해|편집해|추가해|덧붙여|복사해|복제해|옮겨|이동해|바꿔|변경해|삭제해|지워|정리해|분류해|보내줘|보내\s*줘|전송해|공유해|차단해|해제해|알려줘|나가줘|퇴장해|수락해|거절해|거부해|재개해|중단해|켜\s*줘|꺼\s*줘|켜줘|꺼줘)/i;
const FORBIDDEN_ACCOUNT_OR_SECURITY_MUTATION = /(?:영구\s*삭제|(?:계정|사용자).*(?:영구\s*)?(?:삭제|지우|생성|만들)|(?:비밀번호|암호|보안\s*설정|API\s*키|개인키).*(?:조회|보여|변경|바꿔|수정|설정))/i;
const CANCEL_PENDING_REQUEST = /^(?:아니|아니야|취소|취소해|그만|그만해|됐어|하지\s*마|하지마|중단|중단해)[.!?\s]*$/i;

const deriveAuthorizedMutationTools = (userRequest = '') => {
  const text = String(userRequest || '').trim();
  if (!text || !EXPLICIT_EXECUTION_REQUEST.test(text)) return [];
  if (NON_EXECUTION_QUESTION.test(text) || RECALL_OR_PAST_QUESTION.test(text) || PROHIBITED_REQUEST.test(text)) return [];
  if (FORBIDDEN_ACCOUNT_OR_SECURITY_MUTATION.test(text)) return [];

  let candidates = Object.entries(MUTATION_INTENT_RULES)
    .filter(([, pattern]) => pattern.test(text))
    .map(([name]) => name);

  // More specific note and Office operations must not inherit broad file-operation permission.
  if (candidates.includes('create_office_document')) {
    const separatelyCreatesNote = /(?:노트|페이지)(?:를|을).*(?:생성해|만들어)/i.test(text);
    const attachesToNote = /(?:노트|페이지).*(?:안|내부|첨부|연결|에)/i.test(text);
    candidates = candidates.filter((name) => name !== 'write_text_file' && (name !== 'create_note' || separatelyCreatesNote) && (name !== 'create_document' || !attachesToNote));
    if (candidates.includes('create_document') && !attachesToNote) candidates = candidates.filter((name) => name !== 'create_office_document');
  }
  if (candidates.includes('create_document') && !candidates.includes('create_office_document')) {
    if (/\.(?:txt|md|json|csv|tsv|log|js|jsx|ts|tsx|css|html|xml|ya?ml|ini|conf|py|sql|sh)\b/i.test(text)) {
      candidates = candidates.filter((name) => name !== 'create_document');
    } else {
      candidates = candidates.filter((name) => !['create_folder', 'write_text_file', 'create_office_document'].includes(name));
    }
  }
  if (candidates.includes('update_note')) candidates = candidates.filter((name) => name !== 'write_text_file');
  if (candidates.includes('append_text_file')) candidates = candidates.filter((name) => name !== 'write_text_file');
  if (candidates.includes('trash_note')) candidates = candidates.filter((name) => name !== 'trash_item');
  if (candidates.some((name) => ['run_python_note', 'run_javascript_note'].includes(name))) {
    const separatelyUpdatesNote = /(?:노트|페이지).*(?:수정|편집|저장|바꾸|바꿔)/i.test(text);
    if (!separatelyUpdatesNote) candidates = candidates.filter((name) => name !== 'update_note');
  }
  if (candidates.includes('restore_note_version')) candidates = candidates.filter((name) => !['restore_note', 'restore_file_version'].includes(name));
  if (candidates.includes('restore_note')) candidates = candidates.filter((name) => !['restore_trash_item', 'trash_note'].includes(name));
  if (candidates.includes('restore_trash_item')) candidates = candidates.filter((name) => name !== 'trash_item');
  if (candidates.includes('mark_all_notifications_read')) candidates = candidates.filter((name) => name !== 'mark_notification_read');
  if (candidates.includes('restore_drive_restore_point')) candidates = candidates.filter((name) => name !== 'restore_file_version');
  if (candidates.includes('set_file_favorite')) candidates = candidates.filter((name) => !['append_text_file', 'write_text_file'].includes(name));
  if (candidates.includes('set_friend_favorite')) candidates = candidates.filter((name) => !['append_text_file', 'set_file_favorite', 'send_friend_request'].includes(name));
  if (candidates.includes('accept_friend_request') || candidates.includes('reject_friend_request')) candidates = candidates.filter((name) => name !== 'send_friend_request');
  if (candidates.includes('create_notebook')) candidates = candidates.filter((name) => name !== 'create_note');
  if (candidates.includes('create_share_link')) candidates = candidates.filter((name) => !['create_folder', 'send_file_to_user'].includes(name));
  if (candidates.includes('create_group_chat')) candidates = candidates.filter((name) => name !== 'invite_group_chat');
  if (candidates.includes('send_group_message')) candidates = candidates.filter((name) => name !== 'send_chat_message');
  if (candidates.includes('respond_group_invite')) candidates = candidates.filter((name) => name !== 'invite_group_chat');
  if (candidates.includes('cancel_document_job') || candidates.includes('retry_document_job')) candidates = candidates.filter((name) => name !== 'create_document_job');
  if (candidates.includes('kick_group_member')) candidates = candidates.filter((name) => name !== 'send_chat_message');
  if (candidates.includes('save_chat_attachments')) candidates = candidates.filter((name) => name !== 'write_text_file');
  return [...new Set(candidates)];
};

const deriveAuthorizedMutationToolsFromConversation = (message = '', history = [], pendingTask = null) => {
  const text = String(message || '').trim();
  if (CANCEL_PENDING_REQUEST.test(text)) return { tools: [], cancelled: true, carried: false };
  const direct = deriveAuthorizedMutationTools(text);
  if (direct.length > 0) return { tools: direct, cancelled: false, carried: false };

  if (pendingTask?.status === 'collecting' && Array.isArray(pendingTask.authorizedMutationTools)) {
    const age = Date.now() - Date.parse(pendingTask.updatedAt || pendingTask.createdAt || '');
    const looksLikeNewQuestion = /(?:뭐|무엇|어디|언제|왜|어떻게|알려|설명|가능|있어|없어|인가|일까|까\??)$/i.test(text);
    if (Number.isFinite(age) && age <= 30 * 60 * 1000 && text.length <= 120 && !looksLikeNewQuestion) {
      return { tools: [...new Set(pendingTask.authorizedMutationTools)], cancelled: false, carried: true };
    }
  }

  if (EXPLICIT_EXECUTION_REQUEST.test(text)) {
    const previousUser = [...history].reverse().find((item) => item.role === 'user' && String(item.content || '').trim());
    if (previousUser) {
      const combined = `${String(previousUser.content || '').slice(0, 1000)} ${text}`;
      const tools = deriveAuthorizedMutationTools(combined);
      if (tools.length > 0) return { tools, cancelled: false, carried: true };
    }
  }
  return { tools: [], cancelled: false, carried: false };
};

const shouldKeepPendingTask = (answer = '', events = [], authorizedMutationTools = []) => {
  if (!Array.isArray(authorizedMutationTools) || authorizedMutationTools.length === 0) return false;
  const mutationEvent = (events || []).some((event) => authorizedMutationTools.includes(event.name) && event.ok === true);
  if (mutationEvent) return false;
  return /\?|알려\s*주|말해\s*주|선택해\s*주|지정해\s*주|입력해\s*주|어떤|어디|필요합니다|필요해요|원하시/i.test(String(answer || ''));
};

const getSafePath = (user, requested = '/') => resolveInside(getAccessBasePath(user), requested || '/');
const assertToolPathAllowed = (requested, { allowRoot = true } = {}) => {
  const normalized = String(requested || '/').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (!allowRoot && parts.length === 0) throw new Error('계정 루트 자체에는 이 작업을 수행할 수 없습니다.');
  if (parts.some((part) => part.startsWith('.') || INTERNAL_PATH_PARTS.has(part) || SENSITIVE_NAMES.test(part))) {
    const err = new Error('AI는 내부 저장소나 인증정보 가능성이 있는 경로를 읽거나 변경할 수 없습니다.');
    err.status = 403;
    err.code = 'AI_SENSITIVE_PATH_BLOCKED';
    throw err;
  }
  return normalized;
};
const toRelative = (user, fullPath) => {
  const rel = path.relative(getAccessBasePath(user), fullPath).replace(/\\/g, '/');
  return rel ? `/${rel}` : '/';
};

const assertExistingPathSafe = (user, requested) => {
  assertToolPathAllowed(requested);
  const base = getAccessBasePath(user);
  const full = resolveInside(base, requested || '/');
  if (!fs.existsSync(full)) { const err = new Error('대상 경로가 존재하지 않습니다.'); err.status = 404; throw err; }
  const realBase = fs.realpathSync(base);
  const realTarget = fs.realpathSync(full);
  if (!isSameOrChild(realBase, realTarget)) { const err = new Error('심볼릭 링크가 계정 접근 범위를 벗어납니다.'); err.status = 403; throw err; }
  assertToolPathAllowed(toRelative(user, realTarget));
  return full;
};

const assertWritablePathSafe = (user, requested) => {
  assertToolPathAllowed(requested, { allowRoot: false });
  const base = getAccessBasePath(user);
  const full = resolveInside(base, requested || '/');
  let cursor = fs.existsSync(full) ? full : path.dirname(full);
  while (!fs.existsSync(cursor) && cursor !== path.dirname(cursor)) cursor = path.dirname(cursor);
  const realBase = fs.realpathSync(base);
  const realParent = fs.realpathSync(cursor);
  if (!isSameOrChild(realBase, realParent)) { const err = new Error('심볼릭 링크가 계정 접근 범위를 벗어납니다.'); err.status = 403; throw err; }
  assertToolPathAllowed(toRelative(user, realParent));
  return full;
};

const itemFor = (user, full) => {
  const stat = fs.statSync(full);
  return { name: path.basename(full), path: toRelative(user, full), type: stat.isDirectory() ? 'folder' : 'file', size: stat.isFile() ? stat.size : null, modifiedAt: stat.mtime.toISOString() };
};

const listFiles = (user, requested = '/') => {
  const full = assertExistingPathSafe(user, requested);
  if (!fs.statSync(full).isDirectory()) throw new Error('폴더만 조회할 수 있습니다.');
  return fs.readdirSync(full, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.') && !['backup', 'chat_tmp'].includes(entry.name))
    .slice(0, 200)
    .map((entry) => itemFor(user, path.join(full, entry.name)));
};

const searchFiles = (user, query, requested = '/') => {
  const needle = String(query || '').trim().toLocaleLowerCase('ko-KR');
  if (!needle) return [];
  const root = assertExistingPathSafe(user, requested);
  const results = [];
  const visit = (dir, depth) => {
    if (depth > 8 || results.length >= 80) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['backup', 'chat_tmp'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      try {
        const safe = fs.realpathSync(full);
        if (!isSameOrChild(fs.realpathSync(getAccessBasePath(user)), safe)) continue;
        if (entry.name.toLocaleLowerCase('ko-KR').includes(needle)) results.push(itemFor(user, full));
        if (entry.isDirectory()) visit(full, depth + 1);
      } catch (err) {}
      if (results.length >= 80) return;
    }
  };
  if (fs.statSync(root).isDirectory()) visit(root, 0);
  return results;
};

const readTextFile = (user, requested) => {
  const full = assertExistingPathSafe(user, requested);
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new Error('파일만 읽을 수 있습니다.');
  if (!TEXT_EXTS.has(path.extname(full).toLowerCase())) throw new Error('현재는 텍스트·코드 파일만 읽을 수 있습니다.');
  const buffer = Buffer.alloc(Math.min(stat.size, MAX_READ_BYTES));
  const fd = fs.openSync(full, 'r');
  try { fs.readSync(fd, buffer, 0, buffer.length, 0); } finally { fs.closeSync(fd); }
  return { item: itemFor(user, full), text: buffer.toString('utf8'), truncated: stat.size > MAX_READ_BYTES };
};

const actionSpec = (name, args) => {
  const map = {
    create_folder: { title: '폴더 생성', risk: 'safe', actionType: name, targetPath: args.path },
    write_text_file: { title: '텍스트 파일 저장', risk: 'safe', actionType: name, targetPath: args.path, content: args.content },
    create_document: { title: `${String(args.format || '').toUpperCase()} 문서 작성`, risk: 'safe', actionType: name, targetPath: args.path, format: args.format, content: args.content },
    append_text_file: { title: '텍스트 추가', risk: 'safe', actionType: name, targetPath: args.path, content: args.content },
    copy_item: { title: '파일/폴더 복사', risk: 'reversible', actionType: name, sourcePath: args.source_path, destinationFolder: args.destination_folder },
    move_item: { title: '파일/폴더 이동', risk: 'reversible', actionType: name, sourcePath: args.source_path, destinationPath: args.destination_path },
    trash_item: { title: '휴지통으로 이동', risk: 'reversible', actionType: name, targetPath: args.path },
    organize_files_by_modified_date: { title: '수정일 기준 파일 정리', risk: 'reversible', actionType: name, sourcePath: args.folder_path, destinationFolder: args.destination_folder, granularity: args.granularity },
    send_friend_request: { title: '친구 요청 보내기', risk: 'external', actionType: name, targetUser: args.user },
    set_user_blocked: { title: args.blocked ? '사용자 차단' : '차단 해제', risk: 'external', actionType: name, targetUser: args.user, blocked: args.blocked },
    send_chat_message: { title: '채팅 메시지 보내기', risk: 'external', actionType: name, targetUser: args.user, text: args.text },
    send_file_to_user: { title: '파일/폴더 전송', risk: 'external', actionType: name, targetUser: args.user, targetPath: args.path, text: args.message },
    create_note: { title: '노트 생성', risk: 'safe', actionType: name, notePayload: { title: args.title, type: args.type, content: args.content, language: args.language, notebookId: args.notebook_id, parentId: args.parent_id } },
    update_note: { title: '노트 수정', risk: 'safe', actionType: name, noteId: args.note_id, expectedRevision: args.expected_revision, notePayload: { title: args.title, content: args.content, reason: 'ai-agent' } },
    trash_note: { title: '노트를 휴지통으로 이동', risk: 'reversible', actionType: name, noteId: args.note_id, expectedRevision: args.expected_revision },
    create_office_document: { title: `${String(args.format || '').toUpperCase()} 문서 생성`, risk: 'safe', actionType: name, noteId: args.note_id, expectedRevision: args.expected_revision, format: args.format, fileName: args.file_name },
    run_python_note: { title: 'Python 노트 격리 실행', risk: 'compute', actionType: name, noteId: args.note_id, expectedRevision: args.expected_revision },
    run_javascript_note: { title: 'JavaScript 노트 격리 실행', risk: 'compute', actionType: name, noteId: args.note_id, expectedRevision: args.expected_revision },
    restore_trash_item: { title: '휴지통 항목 복원', risk: 'reversible', actionType: name, trashId: args.trash_id },
    restore_file_version: { title: '파일 이전 버전 복원', risk: 'reversible', actionType: name, targetPath: args.path, versionId: args.version_id },
    create_drive_restore_point: { title: '드라이브 복구 지점 생성', risk: 'safe', actionType: name, label: args.label },
    restore_drive_restore_point: { title: '전체 드라이브 복원', description: `복구 지점 ${args.restore_point_id} 기준으로 현재 계정 드라이브 전체를 복원합니다.`, risk: 'critical', actionType: name, restorePointId: args.restore_point_id },
    set_file_favorite: { title: args.favorite ? '파일 즐겨찾기 추가' : '파일 즐겨찾기 해제', risk: 'safe', actionType: name, targetPath: args.path, favorite: args.favorite },
    accept_friend_request: { title: '친구 요청 수락', risk: 'external', actionType: name, relationId: args.relation_id },
    reject_friend_request: { title: '친구 요청 거절', risk: 'external', actionType: name, relationId: args.relation_id },
    remove_friend: { title: '친구 관계 해제', risk: 'external', actionType: name, targetUser: args.user },
    set_friend_favorite: { title: args.favorite ? '친구 즐겨찾기 추가' : '친구 즐겨찾기 해제', risk: 'safe', actionType: name, targetUser: args.user, favorite: args.favorite },
    mark_notification_read: { title: '알림 읽음 처리', risk: 'safe', actionType: name, notificationId: args.notification_id },
    mark_all_notifications_read: { title: '모든 알림 읽음 처리', risk: 'safe', actionType: name },
    create_notebook: { title: '노트북 생성', risk: 'safe', actionType: name, notebookPayload: { title: args.title } },
    restore_note: { title: '노트 복원', risk: 'reversible', actionType: name, noteId: args.note_id },
    restore_note_version: { title: '노트 이전 버전 복원', risk: 'reversible', actionType: name, noteId: args.note_id, versionId: args.version_id, expectedRevision: args.expected_revision },
    attach_note_item: { title: '노트에 NAS 항목 연결', risk: 'safe', actionType: name, noteId: args.note_id, targetPath: args.path, expectedRevision: args.expected_revision },
    remove_note_attachment: { title: '노트 첨부 연결 제거', risk: 'reversible', actionType: name, noteId: args.note_id, attachmentId: args.attachment_id, expectedRevision: args.expected_revision },
    cancel_document_job: { title: '문서 작업 취소', risk: 'reversible', actionType: name, jobId: args.job_id },
    retry_document_job: { title: '문서 작업 재시도', risk: 'compute', actionType: name, jobId: args.job_id },
    create_document_job: { title: '문서 변환 작업 시작', risk: 'compute', actionType: name, documentJob: { mode: args.mode, sources: args.sources, outputPath: args.output_path, outputName: args.output_name, sourceFormat: args.source_format, outputFormat: args.output_format, templateRowsJson: args.template_rows_json, fileNameTemplate: args.file_name_template } },
    set_device_sync: { title: args.action === 'pause' ? '연동 PC 동기화 일시 정지' : '연동 PC 동기화 재개', risk: 'reversible', actionType: name, deviceId: args.device_id, syncAction: args.action },
    revoke_device: { title: '연동 PC 등록 해제', description: `장치 ${args.device_id}의 인증과 동기화 연결을 해제합니다.`, risk: 'critical', actionType: name, deviceId: args.device_id },
    create_share_link: { title: '공개 공유 링크 생성', risk: 'external', actionType: name, paths: args.paths, sharePayload: { displayName: args.display_name, expireDays: args.expire_days, allowPreview: args.allow_preview, allowDownload: args.allow_download, includeSubfolders: args.include_subfolders, allowFolderDownload: args.allow_folder_download, note: args.note } },
    set_share_paused: { title: args.paused ? '공유 링크 일시 정지' : '공유 링크 재개', risk: 'external', actionType: name, shareId: args.share_id, paused: args.paused },
    revoke_share_link: { title: '공유 링크 비활성화', risk: 'external', actionType: name, shareId: args.share_id },
    create_group_chat: { title: '그룹 채팅방 생성', risk: 'external', actionType: name, groupTitle: args.title, targetUsers: args.users },
    invite_group_chat: { title: '그룹 채팅방 사용자 초대', risk: 'external', actionType: name, conversationId: args.conversation_id, targetUsers: args.users },
    respond_group_invite: { title: args.accept ? '그룹 채팅 초대 수락' : '그룹 채팅 초대 거절', risk: 'external', actionType: name, conversationId: args.conversation_id, accept: args.accept },
    leave_group_chat: { title: '그룹 채팅방 나가기', risk: 'external', actionType: name, conversationId: args.conversation_id },
    send_group_message: { title: '채팅방 메시지 보내기', risk: 'external', actionType: name, conversationId: args.conversation_id, text: args.text },
    transfer_group_owner: { title: '그룹 채팅 방장 위임', description: `채팅방 ${args.conversation_id}의 방장을 ${args.user} 사용자에게 위임합니다.`, risk: 'critical', actionType: name, conversationId: args.conversation_id, targetUser: args.user },
    set_group_cohost: { title: args.enabled ? '그룹 채팅 부방장 지정' : '그룹 채팅 부방장 해제', risk: 'external', actionType: name, conversationId: args.conversation_id, targetUser: args.user, enabled: args.enabled },
    kick_group_member: { title: '그룹 채팅 참가자 내보내기', description: `채팅방 ${args.conversation_id}에서 ${args.user} 사용자를 내보냅니다.`, risk: 'critical', actionType: name, conversationId: args.conversation_id, targetUser: args.user },
    delete_group_chat: { title: '그룹 채팅방 파기', description: `채팅방 ${args.conversation_id}를 방장 권한으로 파기합니다.`, risk: 'critical', actionType: name, conversationId: args.conversation_id },
    update_managed_user: { title: '사용자 용량·역할 설정 변경', description: `${args.login_id}: ${args.role}, ${args.storage_quota_gb}GB, 전체 NAS 접근 ${args.global_access ? '허용' : '차단'}`, risk: 'critical', actionType: name, managedUser: { userUid: args.user_uid, loginId: args.login_id, role: args.role, globalAccess: args.global_access, storageQuotaGb: args.storage_quota_gb, displayName: args.display_name, nickname: args.nickname } },
    approve_signup: { title: '가입 요청 승인', description: `${args.login_id} 계정을 기본 정책으로 승인합니다.`, risk: 'critical', actionType: name, managedUser: { userUid: args.user_uid, loginId: args.login_id } },
    reject_signup: { title: '가입 요청 거절', description: `${args.login_id} 계정의 가입 요청을 거절합니다.`, risk: 'critical', actionType: name, managedUser: { userUid: args.user_uid, loginId: args.login_id } },
    set_resource_policy: { title: '서버 자원 보호 정책 변경', description: `${args.mode} 모드, 강제 보호 ${args.enforcement_enabled ? '사용' : '해제'}, 기록 ${args.retention_days}일`, risk: 'critical', actionType: name, resourcePolicy: { mode: args.mode, enforcementEnabled: args.enforcement_enabled, retentionDays: args.retention_days, manual: { cpuSoftPercent: args.manual?.cpu_soft_percent, cpuHardPercent: args.manual?.cpu_hard_percent, loadSoft: args.manual?.load_soft, loadHard: args.manual?.load_hard, minAvailableMemoryBytes: Number(args.manual?.min_available_memory_mb) * 1024 * 1024, hardMinAvailableMemoryBytes: Number(args.manual?.hard_min_available_memory_mb) * 1024 * 1024, swapSoftPercent: args.manual?.swap_soft_percent, swapHardPercent: args.manual?.swap_hard_percent, temperatureSoftC: args.manual?.temperature_soft_c, temperatureHardC: args.manual?.temperature_hard_c, minNasFreeBytes: Number(args.manual?.min_nas_free_gb) * 1024 * 1024 * 1024, defaultUserCpuPercent: args.manual?.default_user_cpu_percent, defaultUserMemoryBytes: Number(args.manual?.default_user_memory_mb) * 1024 * 1024, defaultUserMaxConcurrentJobs: args.manual?.default_user_max_concurrent_jobs } } },
    set_login_persistence: { title: args.enabled ? '로그인 유지 켜기' : '로그인 유지 끄기', risk: 'safe', actionType: name, enabled: args.enabled },
    update_profile: { title: '내 프로필 이름 변경', description: `새 닉네임: ${args.nickname}`, risk: 'external', actionType: name, nickname: args.nickname },
    configure_meeting: { title: '회의방 설정 변경', risk: 'external', actionType: name, conversationId: args.conversation_id, meetingPayload: { title: args.title, roomCode: args.room_code, accessPolicy: { mode: args.access_mode, searchable: args.searchable, entryMode: args.entry_mode, passwordEnabled: false } } },
    start_meeting: { title: '채팅방 회의 시작', risk: 'external', actionType: name, conversationId: args.conversation_id },
    save_meeting: { title: '임시 회의를 정규 회의로 저장', risk: 'external', actionType: name, roomId: args.room_id, meetingPayload: { title: args.title, accessPolicy: { mode: args.access_mode, searchable: args.searchable, entryMode: args.entry_mode, passwordEnabled: false } } },
    save_chat_attachments: { title: '채팅 첨부를 받은 파일에 저장', risk: 'safe', actionType: name, messageId: args.message_id },
    mark_chat_read: { title: '채팅방 읽음 처리', risk: 'safe', actionType: name, conversationId: args.conversation_id },
    update_share_link: { title: '공유 링크 설정 변경', risk: 'external', actionType: name, shareId: args.share_id, sharePayload: { displayName: args.display_name, expireDays: args.expire_days, note: args.note, maxViews: args.max_views, maxDownloads: args.max_downloads, allowPreview: args.allow_preview, allowDownload: args.allow_download, includeSubfolders: args.include_subfolders, allowFolderDownload: args.allow_folder_download } },
    regenerate_share_token: { title: '공유 링크 주소 재발급', description: `공유 ${args.share_id}의 기존 주소를 무효화하고 새 주소를 발급합니다.`, risk: 'critical', actionType: name, shareId: args.share_id },
  };
  return map[name];
};

const buildOrganizationPlan = (user, folderPath, destinationFolder, granularity) => {
  const source = assertExistingPathSafe(user, folderPath);
  if (!fs.statSync(source).isDirectory()) throw new Error('정리 원본은 폴더여야 합니다.');
  const destination = assertWritablePathSafe(user, destinationFolder);
  const entries = fs.readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isFile() && !entry.name.startsWith('.'));
  if (entries.length > MAX_ORGANIZE_ITEMS) throw new Error(`한 번에 정리할 수 있는 파일은 ${MAX_ORGANIZE_ITEMS}개까지입니다.`);
  const plannedTargets = new Set();
  return entries.map((entry) => {
    const from = path.join(source, entry.name);
    const stat = fs.statSync(from);
    const date = stat.mtime.toISOString().slice(0, granularity === 'month' ? 7 : 10);
    const folder = path.join(destination, date);
    let to = path.join(folder, entry.name);
    let suffix = 2;
    while (fs.existsSync(to) || plannedTargets.has(to)) {
      const ext = path.extname(entry.name);
      const stem = path.basename(entry.name, ext);
      to = path.join(folder, `${stem} (${suffix})${ext}`);
      suffix += 1;
    }
    plannedTargets.add(to);
    return { sourcePath: toRelative(user, from), destinationPath: toRelative(user, to), size: stat.size, modifiedAtMs: Math.trunc(stat.mtimeMs) };
  });
};

const resolveOrganizationPlans = (user, plannedItems) => {
  if (!Array.isArray(plannedItems) || plannedItems.length > MAX_ORGANIZE_ITEMS) {
    throw new Error('승인된 날짜별 정리 계획이 없거나 허용 개수를 초과했습니다. 새 계획을 만들어 다시 승인해주세요.');
  }
  return plannedItems.map((item) => {
    const from = assertExistingPathSafe(user, item.sourcePath);
    const to = assertWritablePathSafe(user, item.destinationPath);
    const stat = fs.statSync(from);
    if (!stat.isFile() || stat.size !== item.size || Math.trunc(stat.mtimeMs) !== item.modifiedAtMs || fs.existsSync(to)) {
      throw new Error('승인 후 파일 상태가 변경되어 날짜별 정리를 중단했습니다. 새 계획을 만들어 다시 승인해주세요.');
    }
    return { from, folder: path.dirname(to), to };
  });
};

const mayAutoExecute = (risk, mode) => (
  (risk === 'safe' && ['auto_safe', 'auto_reversible', 'auto_all'].includes(mode)) ||
  (risk === 'reversible' && ['auto_reversible', 'auto_all'].includes(mode)) ||
  (risk === 'external' && mode === 'auto_all')
);

const createPlatformCaller = (token, fetchImpl = fetch) => async (method, apiPath, body) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let response;
  try {
    response = await fetchImpl(`http://127.0.0.1:${config.BACKEND_PORT}/api${apiPath}`, {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: `token=${encodeURIComponent(token)}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const err = new Error(data.error || 'NAS 작업 API가 거부했습니다.'); err.status = response.status; throw err; }
  return data;
};

const resolveExactUser = async (platformCall, text) => {
  const result = await platformCall('GET', `/friends/search?q=${encodeURIComponent(text)}`);
  const needle = String(text || '').trim().toLocaleLowerCase('ko-KR');
  const exact = (result.results || []).filter((user) => [user.loginId, user.username, user.displayName, user.nickname]
    .some((value) => String(value || '').toLocaleLowerCase('ko-KR') === needle));
  if (exact.length !== 1) throw new Error(exact.length ? '같은 이름의 사용자가 여러 명입니다. 로그인 ID로 다시 지정해주세요.' : '정확히 일치하는 사용자를 찾지 못했습니다.');
  return exact[0];
};

const resolveExactUsers = async (platformCall, values = []) => {
  const requested = [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (requested.length === 0 || requested.length > 50) throw new Error('1명 이상 50명 이하의 정확한 사용자를 지정해주세요.');
  const resolved = [];
  for (const value of requested) resolved.push(await resolveExactUser(platformCall, value));
  const unique = new Map(resolved.map((user) => [user.userUid, user]));
  return [...unique.values()];
};

const executeAction = async (user, actionId, { platformCall }) => {
  const action = listActions(user).find((item) => item.actionId === actionId);
  if (!action) { const err = new Error('AI 작업을 찾을 수 없습니다.'); err.status = 404; throw err; }
  if (action.status !== 'pending') { const err = new Error('이미 처리된 AI 작업입니다.'); err.status = 409; throw err; }
  updateAction(user, actionId, { status: 'executing', startedAt: new Date().toISOString() });
  try {
    let result = {};
    let backupPath = null;
    if (['create_folder', 'write_text_file', 'append_text_file', 'create_document'].includes(action.actionType)) {
      const full = assertWritablePathSafe(user, action.targetPath);
      const parent = action.actionType === 'create_folder' ? path.dirname(full) : path.dirname(full);
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
      if (action.actionType === 'create_folder') {
        fs.mkdirSync(full, { recursive: true, mode: 0o700 });
      } else {
        let content = Buffer.from(String(action.content || ''), 'utf8');
        if (action.actionType === 'create_document') {
          const format = String(action.format || '').toLowerCase();
          if (!['txt', 'md', 'docx', 'hwp', 'hwpx'].includes(format)) throw new Error('지원하지 않는 문서 형식입니다.');
          if (path.extname(full).toLowerCase() !== `.${format}`) throw new Error('저장 경로의 확장자와 문서 형식이 일치하지 않습니다.');
          if (format === 'docx') content = await createDocxWithText(action.content || '');
          if (format === 'hwp' || format === 'hwpx') {
            const { HwpDocument } = await ensureServerRhwp();
            content = createRhwpWithText(format, action.content || '', HwpDocument);
          }
        }
        await assertQuotaAvailable(user, content.length + (action.actionType === 'append_text_file' && fs.existsSync(full) ? fs.statSync(full).size : 0), full);
        if (fs.existsSync(full)) {
          const backupRoot = path.join(getAccessBasePath(user), '.ai_backups');
          fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
          const backup = path.join(backupRoot, `${path.basename(full)}.${Date.now()}.bak`);
          fs.copyFileSync(full, backup);
          backupPath = toRelative(user, backup);
        }
        if (action.actionType === 'append_text_file') fs.appendFileSync(full, content);
        else {
          const temp = path.join(parent, `.${path.basename(full)}.${process.pid}.${Date.now()}.tmp`);
          fs.writeFileSync(temp, content, { mode: 0o600, flag: 'wx' });
          fs.renameSync(temp, full);
        }
      }
      invalidateUsageCache(full);
      result = { path: action.targetPath, backupPath };
    } else if (action.actionType === 'copy_item') {
      assertExistingPathSafe(user, action.sourcePath);
      assertExistingPathSafe(user, action.destinationFolder);
      result = await platformCall('POST', '/file/copy', { sourcePaths: [action.sourcePath], destinationFolder: action.destinationFolder });
    } else if (action.actionType === 'move_item') {
      assertExistingPathSafe(user, action.sourcePath);
      assertWritablePathSafe(user, action.destinationPath);
      result = await platformCall('PUT', '/file', { oldPath: action.sourcePath, newPath: action.destinationPath });
    } else if (action.actionType === 'trash_item') {
      assertExistingPathSafe(user, action.targetPath);
      result = await platformCall('DELETE', `/file?path=${encodeURIComponent(action.targetPath)}`);
    } else if (action.actionType === 'organize_files_by_modified_date') {
      const plans = resolveOrganizationPlans(user, action.plannedItems);
      const moved = [];
      try {
        for (const plan of plans) {
          fs.mkdirSync(plan.folder, { recursive: true, mode: 0o700 });
          await platformCall('PUT', '/file', {
            oldPath: toRelative(user, plan.from),
            newPath: toRelative(user, plan.to),
          });
          moved.push(plan);
        }
      } catch (err) {
        for (const plan of moved.reverse()) {
          try {
            if (fs.existsSync(plan.to) && !fs.existsSync(plan.from)) {
              await platformCall('PUT', '/file', {
                oldPath: toRelative(user, plan.to),
                newPath: toRelative(user, plan.from),
              });
            }
          } catch (rollbackErr) {}
        }
        throw err;
      }
      result = { movedCount: moved.length, destinationFolder: action.destinationFolder, granularity: action.granularity };
    } else if (action.actionType === 'create_note') {
      result = await platformCall('POST', '/note-studio/notes', action.notePayload);
    } else if (action.actionType === 'update_note') {
      result = await platformCall('PATCH', `/note-studio/notes/${encodeURIComponent(action.noteId)}`, {
        expectedRevision: action.expectedRevision,
        ...action.notePayload,
      });
    } else if (action.actionType === 'trash_note') {
      result = await platformCall('DELETE', `/note-studio/notes/${encodeURIComponent(action.noteId)}`, { expectedRevision: action.expectedRevision });
    } else if (action.actionType === 'create_office_document') {
      result = await platformCall('POST', `/note-studio/notes/${encodeURIComponent(action.noteId)}/office-documents`, {
        expectedRevision: action.expectedRevision,
        format: action.format,
        fileName: action.fileName,
      });
    } else if (action.actionType === 'run_python_note') {
      result = await platformCall('POST', `/note-studio/notes/${encodeURIComponent(action.noteId)}/python/run`, { expectedRevision: action.expectedRevision });
    } else if (action.actionType === 'run_javascript_note') {
      result = await platformCall('POST', `/note-studio/notes/${encodeURIComponent(action.noteId)}/javascript/run`, { expectedRevision: action.expectedRevision });
    } else if (action.actionType === 'restore_trash_item') {
      result = await platformCall('POST', `/trash/${encodeURIComponent(action.trashId)}/restore`, {});
    } else if (action.actionType === 'restore_file_version') {
      assertExistingPathSafe(user, action.targetPath);
      result = await platformCall('POST', `/file/versions/${encodeURIComponent(action.versionId)}/restore`, { path: action.targetPath });
    } else if (action.actionType === 'create_drive_restore_point') {
      result = await platformCall('POST', '/drive/restore-points', { label: action.label });
    } else if (action.actionType === 'restore_drive_restore_point') {
      result = await platformCall('POST', `/drive/restore-points/${encodeURIComponent(action.restorePointId)}/restore`, { confirmation: 'RESTORE_DRIVE' });
    } else if (action.actionType === 'set_file_favorite') {
      assertExistingPathSafe(user, action.targetPath);
      result = await platformCall('PUT', '/favorites', { path: action.targetPath, favorite: !!action.favorite });
    } else if (action.actionType === 'accept_friend_request') {
      result = await platformCall('POST', '/friends/accept', { relationId: action.relationId });
    } else if (action.actionType === 'reject_friend_request') {
      result = await platformCall('POST', '/friends/reject', { relationId: action.relationId });
    } else if (action.actionType === 'mark_notification_read') {
      result = await platformCall('POST', '/notifications/read', { notificationId: action.notificationId });
    } else if (action.actionType === 'mark_all_notifications_read') {
      result = await platformCall('POST', '/notifications/read-all', {});
    } else if (action.actionType === 'create_notebook') {
      result = await platformCall('POST', '/note-studio/notebooks', action.notebookPayload);
    } else if (action.actionType === 'restore_note') {
      result = await platformCall('POST', `/note-studio/notes/${encodeURIComponent(action.noteId)}/restore`, {});
    } else if (action.actionType === 'restore_note_version') {
      result = await platformCall('POST', `/note-studio/notes/${encodeURIComponent(action.noteId)}/versions/${encodeURIComponent(action.versionId)}/restore`, { expectedRevision: action.expectedRevision });
    } else if (action.actionType === 'attach_note_item') {
      assertExistingPathSafe(user, action.targetPath);
      result = await platformCall('POST', `/note-studio/notes/${encodeURIComponent(action.noteId)}/attachments`, { path: action.targetPath, expectedRevision: action.expectedRevision });
    } else if (action.actionType === 'remove_note_attachment') {
      result = await platformCall('DELETE', `/note-studio/notes/${encodeURIComponent(action.noteId)}/attachments/${encodeURIComponent(action.attachmentId)}`, { expectedRevision: action.expectedRevision });
    } else if (action.actionType === 'cancel_document_job') {
      result = await platformCall('POST', `/document-studio/jobs/${encodeURIComponent(action.jobId)}/cancel`, {});
    } else if (action.actionType === 'retry_document_job') {
      result = await platformCall('POST', `/document-studio/jobs/${encodeURIComponent(action.jobId)}/retry`, {});
    } else if (action.actionType === 'create_document_job') {
      const request = { ...action.documentJob };
      request.sources = (request.sources || []).map((source) => {
        assertExistingPathSafe(user, source.full_path);
        return { fullPath: source.full_path, name: source.name || path.basename(source.full_path) };
      });
      assertWritablePathSafe(user, `${String(request.outputPath || '/').replace(/\/$/, '')}/__ai_output_check__`);
      let templateRows = [];
      try { templateRows = JSON.parse(request.templateRowsJson || '[]'); } catch { throw new Error('템플릿 치환 행 JSON 형식이 올바르지 않습니다.'); }
      if (!Array.isArray(templateRows) || templateRows.length > 500 || templateRows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('템플릿 치환 행은 객체 배열 500개 이하여야 합니다.');
      result = await platformCall('POST', '/document-studio/jobs', {
        mode: request.mode,
        sources: request.sources,
        outputPath: request.outputPath,
        outputName: request.outputName,
        sourceFormat: request.sourceFormat,
        outputFormat: request.outputFormat,
        templateRows,
        fileNameTemplate: request.fileNameTemplate,
      });
    } else if (action.actionType === 'set_device_sync') {
      result = await platformCall('PATCH', `/devices/${encodeURIComponent(action.deviceId)}/sync`, { action: action.syncAction });
    } else if (action.actionType === 'revoke_device') {
      result = await platformCall('DELETE', `/devices/${encodeURIComponent(action.deviceId)}`);
    } else if (action.actionType === 'create_share_link') {
      for (const targetPath of action.paths || []) assertExistingPathSafe(user, targetPath);
      result = await platformCall('POST', '/shares', { paths: action.paths, ...action.sharePayload });
    } else if (action.actionType === 'set_share_paused') {
      result = await platformCall('PATCH', `/shares/${encodeURIComponent(action.shareId)}`, { paused: !!action.paused });
    } else if (action.actionType === 'revoke_share_link') {
      result = await platformCall('DELETE', `/shares/${encodeURIComponent(action.shareId)}`);
    } else if (action.actionType === 'create_group_chat') {
      result = await platformCall('POST', '/chat/group', { title: action.groupTitle, inviteeUids: action.targetUserUids });
    } else if (action.actionType === 'invite_group_chat') {
      result = await platformCall('POST', `/chat/group/${encodeURIComponent(action.conversationId)}/invite`, { inviteeUids: action.targetUserUids });
    } else if (action.actionType === 'respond_group_invite') {
      result = await platformCall('POST', `/chat/group/${encodeURIComponent(action.conversationId)}/respond`, { accept: !!action.accept });
    } else if (action.actionType === 'leave_group_chat') {
      result = await platformCall('POST', `/chat/group/${encodeURIComponent(action.conversationId)}/leave`, {});
    } else if (action.actionType === 'send_group_message') {
      result = await platformCall('POST', '/chat/messages', { conversationId: action.conversationId, text: action.text, attachmentBundleIds: [] });
    } else if (action.actionType === 'transfer_group_owner') {
      result = await platformCall('POST', `/chat/group/${encodeURIComponent(action.conversationId)}/transfer-owner`, { targetUserUid: action.targetUserUid });
    } else if (action.actionType === 'set_group_cohost') {
      result = await platformCall('POST', `/chat/group/${encodeURIComponent(action.conversationId)}/cohost`, { targetUserUid: action.targetUserUid, enabled: !!action.enabled });
    } else if (action.actionType === 'kick_group_member') {
      result = await platformCall('POST', `/chat/group/${encodeURIComponent(action.conversationId)}/kick`, { targetUserUid: action.targetUserUid });
    } else if (action.actionType === 'delete_group_chat') {
      result = await platformCall('DELETE', `/chat/group/${encodeURIComponent(action.conversationId)}`);
    } else if (['update_managed_user', 'approve_signup', 'reject_signup'].includes(action.actionType)) {
      const usersData = await platformCall('GET', '/users/data');
      const collection = action.actionType === 'update_managed_user' ? usersData.users : usersData.pendingUsers;
      const target = (collection || []).find((item) => item.userUid === action.managedUser.userUid);
      if (!target || String(target.loginId || target.id || '') !== String(action.managedUser.loginId || '')) {
        const err = new Error('승인 후 대상 계정 식별 정보가 달라져 작업을 중단했습니다. 사용자 목록을 다시 확인해주세요.');
        err.status = 409;
        err.code = 'AI_TARGET_IDENTITY_CHANGED';
        throw err;
      }
      if (action.actionType === 'update_managed_user') result = await platformCall('PUT', '/users/update', { users: [action.managedUser] });
      else if (action.actionType === 'approve_signup') result = await platformCall('POST', '/users/approve', { id: action.managedUser.userUid });
      else result = await platformCall('POST', '/users/reject', { id: action.managedUser.userUid });
    } else if (action.actionType === 'set_resource_policy') {
      result = await platformCall('PUT', '/system/resource-policy', action.resourcePolicy);
    } else if (action.actionType === 'set_login_persistence') {
      result = await platformCall('PATCH', '/user/preferences', { loginPersistenceEnabled: !!action.enabled });
    } else if (action.actionType === 'update_profile') {
      result = await platformCall('PUT', '/users/profile', { nickname: action.nickname });
    } else if (action.actionType === 'configure_meeting') {
      result = await platformCall('POST', `/meetings/conversations/${encodeURIComponent(action.conversationId)}/settings`, action.meetingPayload);
    } else if (action.actionType === 'start_meeting') {
      result = await platformCall('POST', `/meetings/conversations/${encodeURIComponent(action.conversationId)}/start`, {});
    } else if (action.actionType === 'save_meeting') {
      result = await platformCall('POST', `/meetings/${encodeURIComponent(action.roomId)}/save`, action.meetingPayload);
    } else if (action.actionType === 'save_chat_attachments') {
      result = await platformCall('POST', `/chat/messages/${encodeURIComponent(action.messageId)}/save`, {});
    } else if (action.actionType === 'mark_chat_read') {
      result = await platformCall('POST', '/chat/read', { conversationId: action.conversationId });
    } else if (action.actionType === 'update_share_link') {
      result = await platformCall('PATCH', `/shares/${encodeURIComponent(action.shareId)}`, action.sharePayload);
    } else if (action.actionType === 'regenerate_share_token') {
      result = await platformCall('POST', `/shares/${encodeURIComponent(action.shareId)}/regenerate-token`, {});
    } else {
      const target = await resolveExactUser(platformCall, action.targetUserLoginId || action.targetUser);
      if (action.targetUserUid && target.userUid !== action.targetUserUid) {
        const err = new Error('승인 후 대상 계정 식별 정보가 달라져 외부 작업을 중단했습니다. 새 작업을 만들어 다시 승인해주세요.');
        err.status = 409;
        err.code = 'AI_TARGET_IDENTITY_CHANGED';
        throw err;
      }
      if (action.actionType === 'send_friend_request') result = await platformCall('POST', '/friends/request', { targetUserUid: target.userUid });
      else if (action.actionType === 'set_user_blocked') result = await platformCall('POST', '/friends/block', { targetUserUid: target.userUid, blocked: !!action.blocked });
      else if (action.actionType === 'remove_friend') result = await platformCall('POST', '/friends/remove', { targetUserUid: target.userUid });
      else if (action.actionType === 'set_friend_favorite') result = await platformCall('POST', '/friends/favorite', { targetUserUid: target.userUid, favorite: !!action.favorite });
      else if (action.actionType === 'send_chat_message') {
        const direct = await platformCall('POST', '/chat/direct', { targetUserUid: target.userUid });
        result = await platformCall('POST', '/chat/messages', { conversationId: direct.conversation.conversationId, text: action.text, attachmentBundleIds: [] });
      } else if (action.actionType === 'send_file_to_user') {
        assertExistingPathSafe(user, action.targetPath);
        const direct = await platformCall('POST', '/chat/direct', { targetUserUid: target.userUid });
        const attachment = await platformCall('POST', '/chat/attachments/from-nas', { paths: [action.targetPath] });
        result = await platformCall('POST', '/chat/messages', {
          conversationId: direct.conversation.conversationId,
          text: action.text || '',
          attachmentBundleIds: [attachment.bundle.bundleId],
        });
      } else throw new Error('지원하지 않는 AI 작업입니다.');
    }
    return updateAction(user, actionId, { status: 'completed', executedAt: new Date().toISOString(), result, backupPath });
  } catch (err) {
    updateAction(user, actionId, { status: 'failed', failedAt: new Date().toISOString(), error: err.message });
    throw err;
  }
};

const runTool = async (user, name, args, context) => {
  if (name === 'get_agent_capabilities') return buildCapabilityCatalog(TOOL_DEFINITIONS);
  if (name === 'list_files') return listFiles(user, args.path);
  if (name === 'search_files') return searchFiles(user, args.query, args.path);
  if (name === 'read_text_file') return readTextFile(user, args.path);
  if (name === 'search_conversation_history') return searchMessages(user, args.query, 20);
  if (name === 'list_notes') return context.platformCall('GET', `/note-studio/notes?q=${encodeURIComponent(args.query || '')}`);
  if (name === 'read_note') return context.platformCall('GET', `/note-studio/notes/${encodeURIComponent(args.note_id)}`);
  if (name === 'get_storage_summary') return context.platformCall('GET', '/storage/me');
  if (name === 'get_path_storage') {
    assertExistingPathSafe(user, args.path);
    return context.platformCall('GET', `/storage/path?path=${encodeURIComponent(args.path)}`);
  }
  if (name === 'get_file_properties') {
    assertExistingPathSafe(user, args.path);
    return context.platformCall('GET', `/file/properties?path=${encodeURIComponent(args.path)}`);
  }
  if (name === 'list_trash') return context.platformCall('GET', '/trash');
  if (name === 'list_file_versions') {
    assertExistingPathSafe(user, args.path);
    return context.platformCall('GET', `/file/versions?path=${encodeURIComponent(args.path)}`);
  }
  if (name === 'list_drive_restore_points') return context.platformCall('GET', '/drive/restore-points');
  if (name === 'list_activity') return context.platformCall('GET', `/activity?limit=${Math.max(1, Math.min(200, Number(args.limit) || 50))}`);
  if (name === 'list_favorites') return context.platformCall('GET', '/favorites');
  if (name === 'list_recent_files') return context.platformCall('GET', `/recent?limit=${Math.max(1, Math.min(200, Number(args.limit) || 50))}`);
  if (name === 'list_friends') return context.platformCall('GET', '/friends/sidebar');
  if (name === 'search_users') return context.platformCall('GET', `/friends/search?q=${encodeURIComponent(args.query || '')}`);
  if (name === 'list_chat_conversations') return context.platformCall('GET', '/chat/conversations');
  if (name === 'list_chat_messages') return context.platformCall('GET', `/chat/messages?conversationId=${encodeURIComponent(args.conversation_id)}`);
  if (name === 'list_notifications') return context.platformCall('GET', '/notifications');
  if (name === 'get_unread_notification_count') return context.platformCall('GET', '/notifications/unread-count');
  if (name === 'list_notebooks') return context.platformCall('GET', '/note-studio/notebooks');
  if (name === 'list_deleted_notes') return context.platformCall('GET', `/note-studio/notes?deleted=true&q=${encodeURIComponent(args.query || '')}`);
  if (name === 'list_note_versions') return context.platformCall('GET', `/note-studio/notes/${encodeURIComponent(args.note_id)}/versions`);
  if (name === 'list_devices') return context.platformCall('GET', '/devices');
  if (name === 'get_document_studio_capabilities') return context.platformCall('GET', '/document-studio/capabilities');
  if (name === 'get_document_job') return context.platformCall('GET', `/document-studio/jobs/${encodeURIComponent(args.job_id)}`);
  if (name === 'get_server_metrics') return context.platformCall('GET', '/system/metrics');
  if (name === 'get_resource_history') {
    const hours = Math.max(1, Math.min(168, Number(args.hours) || 24));
    const from = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    return context.platformCall('GET', `/system/resource-history?from=${encodeURIComponent(from)}&limit=2000`);
  }
  if (name === 'list_users_admin') return context.platformCall('GET', '/users/data');
  if (name === 'get_user_preferences') return context.platformCall('GET', '/user/preferences');
  if (name === 'list_shares') return context.platformCall('GET', '/shares');
  if (name === 'get_share_logs') return context.platformCall('GET', `/shares/${encodeURIComponent(args.share_id)}/logs`);
  if (name === 'get_meeting_status') return context.platformCall('GET', `/meetings/${encodeURIComponent(args.room_id)}/status`);
  if (name === 'get_current_meeting_overview') return context.platformCall('GET', '/meetings/overview/current');
  if (name === 'search_public_meetings') return context.platformCall('GET', `/meetings/public/search?q=${encodeURIComponent(args.query || '')}`);
  const spec = actionSpec(name, args);
  if (!spec) throw new Error('허용되지 않은 도구입니다.');
  if (!new Set(context.authorizedMutationTools || []).has(name)) {
    const err = new Error('최신 사용자 요청에서 이 변경 작업을 명시적으로 확인할 수 없어 실행 계획을 만들지 않았습니다. 원하는 작업을 직접 문장으로 요청해주세요.');
    err.status = 409;
    err.code = 'AI_MUTATION_INTENT_REQUIRED';
    throw err;
  }
  if (name === 'create_document') assertDocumentRequestSlots(context.userIntentText);
  if (name === 'move_item' && String(args.source_path || '').trim() === '/') throw new Error('계정 루트 자체는 이동할 수 없습니다.');
  if (name === 'organize_files_by_modified_date' && !['day', 'month'].includes(args.granularity)) throw new Error('정리 단위는 day 또는 month여야 합니다.');
  if (name === 'organize_files_by_modified_date') {
    spec.plannedItems = buildOrganizationPlan(user, args.folder_path, args.destination_folder, args.granularity);
    spec.preview = { itemCount: spec.plannedItems.length, items: spec.plannedItems.slice(0, 50) };
  }
  if (name === 'create_document_job') {
    if (!Array.isArray(args.sources) || args.sources.length === 0 || args.sources.length > 100) throw new Error('문서 작업 원본은 1개 이상 100개 이하여야 합니다.');
    for (const source of args.sources) assertExistingPathSafe(user, source.full_path);
  }
  if (['send_friend_request', 'set_user_blocked', 'send_chat_message', 'send_file_to_user', 'remove_friend', 'set_friend_favorite', 'transfer_group_owner', 'set_group_cohost', 'kick_group_member'].includes(name)) {
    const target = await resolveExactUser(context.platformCall, args.user);
    spec.targetUserUid = target.userUid;
    spec.targetUserLoginId = target.loginId || target.username || '';
    spec.targetUserDisplayName = target.displayName || target.nickname || target.loginId || target.username || '';
    spec.targetUser = spec.targetUserLoginId || spec.targetUserDisplayName;
  }
  if (['create_group_chat', 'invite_group_chat'].includes(name)) {
    const targets = await resolveExactUsers(context.platformCall, args.users);
    spec.targetUserUids = targets.map((target) => target.userUid);
    spec.targetUsers = targets.map((target) => ({
      userUid: target.userUid,
      loginId: target.loginId || target.username || '',
      displayName: target.displayName || target.nickname || target.loginId || target.username || '',
    }));
  }
  const preferences = normalizePreferences(getPreferences(user));
  const action = createAction(user, { ...spec, idempotencyKey: context.idempotencyKey || context.callId, requestedByAgent: true });
  if (context.forceApproval || !mayAutoExecute(spec.risk, preferences.approvalMode)) return { status: 'pending_approval', actionId: action.actionId, title: action.title, risk: action.risk };
  const completed = await executeAction(user, action.actionId, context);
  return { status: 'completed', actionId: completed.actionId, title: completed.title, result: completed.result };
};

module.exports = {
  TOOL_DEFINITIONS,
  APPROVAL_MODES,
  defaults,
  normalizePreferences,
  selectToolDefinitions,
  isReadOnlyTool,
  deriveAuthorizedMutationTools,
  deriveAuthorizedMutationToolsFromConversation,
  shouldKeepPendingTask,
  createPlatformCaller,
  executeAction,
  runTool,
  listFiles,
  searchFiles,
  readTextFile,
  assertToolPathAllowed,
  _test: { mayAutoExecute, actionSpec, buildOrganizationPlan, resolveOrganizationPlans, deriveAuthorizedMutationTools, deriveAuthorizedMutationToolsFromConversation, shouldKeepPendingTask, getMissingDocumentSlots, assertDocumentRequestSlots, MUTATION_TOOL_NAMES },
};
