# 2026-09-06 최종 교차 검증

## 판정 기준

이번 점검은 구현 코드만 보고 완료라고 판단하지 않았다. 실제 제품의 공식 동작을 기준점으로 삼고 NAS의 계정 경계, 저사양 서버, Files On-Demand, 기존 파일·채팅·문서 API에 맞게 변형해 비교했다.

- Notion: caret 위치의 비모달 slash 메뉴, 페이지/하위 페이지, Markdown·목록 입력 규칙
- JupyterLab: 메뉴·우클릭·단축키가 공유하는 command registry, 문서와 별도 kernel, 실행/중단/재시작 수명주기
- OpenAI Agents SDK: 파싱된 인자, 도구별 guardrail, exact-call 승인, 중단된 run 저장과 동일 run 재개, 실행 직전 재검사
- Nextcloud/OneDrive: 다중 계정 분리, tray와 Explorer 상태, 계정별 동기화 루트, 오류·활동 표시

## 오늘 작업 판정표

| 영역 | 현재 판정 | 확인된 구현 | 아직 필요한 것 |
|---|---|---|---|
| NAS Drive 다중 계정·공유 | 기능 구현·운영 배포 완료, 다중 PC 최종 검증 필요 | 계정별 DPAPI profile/root, 1:1 반복 공유, 읽기 전용 목록과 hydration, 개별 로그아웃 | 신규 PC·재설치·업데이트·NAS 재부팅·두 계정 이상을 묶은 Windows 실장비 장시간 E2E, Explorer overlay/tooltip의 OS별 체감 확인, 공인 코드 서명 |
| 계정 전환 경계 | 서버·자동 회귀 완료, 실사용 체감 확인 필요 | A→로그아웃→K에서 창·경로·포커스·저장 키 초기화 | 실제 두 계정 로그인으로 브라우저 back/history와 여러 열린 창까지 확인 |
| 저장공간·20GiB | 진단과 관리자 원장 UI 완료, 정책 변경 미구현 | 실제 디스크·계정 root 조사, 전체/할당/실사용/추가 할당 가능 표시, 관리자 개인 root | 신규 기본 20GiB와 기존 22계정 migration은 아직 50GiB 상태. 운영 백업+dry-run 뒤 일괄 변경 필요 |
| 시스템 디스크 1TiB 확장 | 설계만 완료 | 물리 디스크와 역할·용량 기록, project quota+volume registry 방향 | ext4 project quota, 보조 volume registry, 배치·장애·백업 정책, 관리자 확장 UI, 재부팅 검증 |
| 서버 설정·자원 보호 | 모니터링과 문서 작업 admission 완료 | CPU/RAM/swap/load/온도/디스크, 자동/수동 안전선, 30초 이력, 사용자별 예약량, 문서 작업 queue/block | 전력·팬은 센서가 없어 표시하지 않음. Python/AI 실제 CPU/RAM/PID 강제는 cgroup worker 전까지 미구현 |
| Note Studio 물리 기반 | 1차 기반 완료 | NOTE MANAGER, 노트북·페이지·하위 페이지 실제 폴더, 4종 편집, 버전·휴지통·첨부·검색, 계정 경계 | slash는 아직 중앙 Dialog이며 Notion형 caret dropdown이 아님. Tab/목록 종료/Markdown input rule, 댓글, 링크·mention, drag, breadcrumb, rich media/database, 협업/offline, Office 참조 블록은 미구현 |
| Python 혼합 페이지 | 설계만 완료 | `.py`+`.md` 로컬 투영과 rich block 보존 원칙, 자원/권한 정책 문서 | kernel worker, 실행/중단/재시작, network none, cgroup, 출력 제한, ipynb round-trip, master 권한 부여 UI 모두 미구현 |
| 프로젝트 경로 이동 보조 | 2차 구현·자동 검증 완료, 새 Windows E2E 필요 | VS Code/JetBrains portable adapter, 사전검증, transaction rollback/undo, BOM·placeholder·비밀 경계 | 완전 hydration marker와 자동 알림, 새 PC의 CFAPI/파일 선택/UI/단축키 실제 시험 |
| 문서 변환·작업대 연동 | 기존 핵심 구현 유지 | 형식 선택, 변환/합치기/일괄 생성, 문서 작업대와 기본 저장 흐름 | Note Studio에서 Office 생성→기본 위치 저장→다른 NAS 위치로 이동해도 stable reference 유지하는 통합은 설계만 완료. 이번 로컬 변환 2건은 LibreOffice 부재로 skip |
| 실행형 AI 에이전트 | 1차 실행 도구 완료, 제품 수준은 아직 아님 | 15개 조회/파일/친구/채팅 도구, strict schema, 4단계 승인, action 원장, 대화 검색, 일일 token cap | 승인 후 같은 AI run 재개, crash recovery, prompt-injection guardrail, immutable recipient UID, streaming, 관리자/노트/문서 도구, 의미 검색, Python 진단·실행이 남음 |

## 이번 최종 점검에서 발견해 즉시 보강한 AI 결함

1. `.env`, `.git`, `.ssh`, private key/certificate, 내부 휴지통·백업 경로를 모델이 직접 지정해 읽거나 변경할 수 있던 범위를 서버에서 차단했다.
2. 모델이 깨진 JSON 도구 인자를 반환하면 빈 객체로 실행될 수 있던 경로를 fail-closed로 바꿨다. 이제 도구는 호출되지 않고 모델에 오류 결과만 돌아간다.
3. 날짜별 정리는 승인 화면을 띄운 뒤 파일이 바뀌거나 새 대상이 생길 수 있었다. 승인 시 source/destination/size/mtime을 최대 500개 snapshot하고 실행 직전 전부 재검사하며 한 건이라도 다르면 0건 실행한다.
4. AI·내부 NAS API에 timeout을 추가했다. 시간 초과 요청은 자동 재전송하지 않아 중복 작업과 불필요한 과금을 피한다.
5. action JSON은 0600 임시 파일에 기록한 뒤 rename하는 원자 교체로 바꿨다.
6. 회의 대화 요약을 위해 별도 OpenAI 요청을 보내면서 사용량 원장에 빠지던 경로를 제거했다. 필요한 회의 문맥은 같은 계산 요청 안에서 제한된 길이로만 보낸다.
7. 승인 카드에 대상 사용자·원본·목적지·메시지·내용·날짜 정리 preview를 표시해 사용자가 무엇을 승인하는지 볼 수 있게 했다.

## AI에서 아직 반드시 해결할 위험

- 현재 승인은 action만 실행하고 중단된 모델 run을 이어서 최종 답변까지 갱신하지 않는다. exact tool call과 run state를 저장하고 승인/거절 후 같은 run을 재개해야 한다.
- 파일 본문에 포함된 악성 지시가 `auto_all`에서 외부 전송을 유도할 수 있다. 사용자 최신 요청과 side effect를 결속하는 deterministic guardrail과 외부 작업의 추가 승인 정책이 필요하다.
- `executing` 중 서버가 재시작되면 자동 복구 journal이 없다. 재시작 시 상태 판정, idempotent resume/rollback, orphan attachment 취소가 필요하다.
- 사용자 이름은 실행 시 다시 찾지만 승인 카드가 불변 userUid에 묶이지 않는다. 승인 전에 정확한 UID·표시명·로그인 ID를 확정하고 실행 시 같은 UID인지 재검사해야 한다.
- 일일 token 제한은 마지막 요청과 동시 요청에서 소폭 초과할 수 있다. 요청 전 reservation과 완료 후 정산이 필요하다.
- AI 대화 원장은 최대 보존량이 있으며 플랫폼 일반 채팅과 별도다. “모든 과거 대화”라고 표현하면 안 되고 보존 범위를 UI에 명시해야 한다.
- 파일 이름 검색만 가능하며 내용 의미 검색/RAG와 결과 citation은 없다.

## 검증 결과

- 로컬 backend: 54 tests, 52 pass, 2 document integration skip, 0 fail
- AI 보강 단위: sensitive path 차단, 승인 후 파일 변경 거부, malformed arguments fail-closed 포함 7/7 pass
- 실제 OpenAI 과금 호출: 0회. 모든 agent loop 시험은 mock fetch 사용
- 운영 화면: 로그인된 Chrome에서 AI 패널, 과거 대화, 대화/파일/읽기/작업 UI를 직접 확인했다. 배포 뒤 새 bundle로 다시 로드해 설정/승인 상세를 재확인한다.
- Windows 로컬 production build: 소스 오류가 아니라 현재 작업 폴더의 npm/pnpm 중복 eslint plugin 때문에 실패. 운영 NAS의 Linux 의존성으로 build/PDF.js 검증을 다시 수행한다.

## 다음 구현 권장 순서

1. AI durable approval/resume + prompt-injection/recipient binding + crash recovery
2. Note Studio caret slash dropdown + command registry + IME/Tab/input-rule E2E
3. 신규/기존 계정 20GiB quota migration
4. Note Studio Office stable reference 통합
5. cgroup worker를 만든 뒤 Python 정적 진단, 마지막에 격리 실행
6. 전용 테스트 계정/복제 데이터로 Windows 신규 PC·업데이트·재부팅·다중 계정 장시간 E2E

