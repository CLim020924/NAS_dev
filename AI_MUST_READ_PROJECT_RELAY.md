# AI 필독 — NAS 프로젝트 작업 인계 및 시작 규칙

최종 갱신: 2026-08-28 — Windows NAS Drive 1.9.17 웹→Explorer placeholder 생성·자동 새로고침 실검증 완료

이 문서는 새 대화에서 NAS 프로젝트를 이어가는 AI가 가장 먼저 읽어야 하는 인계 진입점이다. 상세하고 최신인 단일 기억 저장소는 같은 폴더의 `NAS_PROJECT_LOG.xlsx`이며, 이 문서만 읽고 변경을 시작하면 안 된다.

## 새 작업의 의무 시작 순서

1. 사용자에게 정확히 `프로젝트 메모리 확인하고 시작할게.`라고 말한다.
2. `C:\Users\CHANYOUNG\Desktop\NAS_DEVELOP\NAS_PROJECT_LOG.xlsx` 하나만 열어 `Patch_Log`, `Do_Not_Break`, `Network_Config`, `Office_Viewers`, `Office_Final_Notes`, `Feature_Index`, `Relation_Map`, `Code_Map`, `API_Routes`, `Socket_Events`를 확인한다.
3. `ssh nas`로 접속하고 `/home/limchanyoung/my-service-platform`에서 `git status --short --branch`를 먼저 확인한다.
4. 기존 변경을 되돌리지 않고 관련 구조와 의존성을 읽은 뒤 수정한다. `git reset --hard`는 사용하지 않는다.
5. 구현 뒤 관련 테스트·frontend build·PM2 재시작/저장·실제 HTTP 동작을 범위에 맞게 검증한다.
6. 결과와 남은 위험을 기존 `NAS_PROJECT_LOG.xlsx`의 `Patch_Log`와 관련 시트에 추가한다. 중복 workbook을 만들지 않고 한국어를 UTF-8로 보존한다.

## 고정 환경

- Debian NAS, SSH alias `nas`, 계정 `limchanyoung`, Tailscale `100.80.39.112`
- 프로젝트 `/home/limchanyoung/my-service-platform`
- GitHub `git@github.com:CLim020924/NAS_dev.git`
- 현재 브랜치 `cleanup/git-tracking-2026-06-08`
- React frontend + Node/Express backend, backend `127.0.0.1:3030`
- systemd 필수: `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared` 모두 enabled+active
- PM2 root 프로세스 `msp-backend` online, 변경 뒤 `sudo pm2 save`
- `filemanager-nas.com`/`www`는 Cloudflare Tunnel, `upload.filemanager-nas.com`은 `1.234.92.152` DNS-only A 레코드다. 관련 작업이 아니면 DNS/nginx/Cloudflare를 변경하지 않는다.
- OnlyOffice는 Docker host 8080→container 80이며 backend `/onlyoffice`, `/cache` 프록시를 유지한다. HWP는 `/api/hwp/render` server-render-first이고 Viewer effect에서 parent dirty/window state를 반복 변경하지 않는다.

## NAS Drive 구현 릴레이

NAS Drive는 Windows 파일 탐색기 왼쪽에 계정별 `NAS Drive - 개인`을 제공하는 OneDrive형 서비스다. 웹 파일 관리자 API·계정 root·quota·검색·공유·알림을 재사용하고, Agent가 계정 경계를 우회하지 않게 한다.

현재까지 구현된 축:

- 웹 로그인 기반 1회용 pairing, 해시 저장과 소비 처리, 사용자/장치/경로 경계
- 계정별 DPAPI 장치 token, Windows 재부팅 자동 시작, 프로그램 내 로그인·회원가입 안내·서버 폐기 우선 로그아웃
- CFAPI Explorer namespace, placeholder/hydration, 온라인 전용 기반, 실시간 상태와 NAS offline/재연결 필요 표시
- 대용량 chunk resume, SHA-256, 시작 재조정, 충돌 복사본, 랜섬웨어성 대량 변경 중지
- 휴지통, 파일 버전, 전체 시점 복원, 최근 파일, 즐겨찾기, 활동 기록
- Agent 자동 업데이트의 해시·self-test·원자 교체·rollback 및 코드서명 스크립트

## 2026-08-28 현재 기준: Windows NAS Drive 1.8.2 실제 설치 완료

아래의 1.7.x 항목은 문제 원인과 변경 역사를 보존한 기록이다. 새 작업은 반드시 이 1.8.2 상태를 현재 기준으로 삼는다.

- 실제 사용자 노트북에서 1.8.1→1.8.2 업데이트를 실행했고 설치 진행률, 완료 화면, 기본 선택된 `설치 완료 후 NAS Drive 열기`가 정상 동작했다.
- 설치 완료 뒤 PowerShell이나 브라우저가 아닌 C# WinForms `NAS Drive 로그인` 창이 열렸다. 현재 이 창은 사용자가 직접 NAS 아이디와 비밀번호를 입력할 수 있도록 열린 상태로 두었다.
- 네이티브 창에는 아이디, 비밀번호, 회원가입, 로그인 UI가 있으며 인증정보를 명령행·로그·평문 파일에 저장하지 않는다. 비밀번호는 stdin JSON으로 Agent에 한 번 전달되고 서버는 10분짜리 개인 Drive pairing token을 발급한다.
- 설치 경로는 `%LOCALAPPDATA%\Programs\NAS Drive`이며 launcher FileVersion은 `1.8.2.0`, `agent-version.txt`는 `1.8.2`다.
- 시작프로그램과 `nas-sync://` protocol은 모두 `NAS-Drive.exe`를 직접 가리킨다. 유효한 profile이면 background Agent를 하나만 시작하고, `needs-relink`이거나 유효하지 않은 profile이면 상태센터 대신 네이티브 로그인 창을 바로 연다.
- 설치·업데이트 때 정확한 NAS Drive 구형 설치물과 다운로드 잔재를 정리하지만 profile, DPAPI token, 동기화 폴더와 사용자 파일은 보존한다. 최종 확인에서 Downloads의 Setup/구형 Agent 잔재는 0개였다.
- 사용자가 본 검은 PowerShell은 `NAS-Sync-Agent\setup-wizard.ps1`을 실행하던 구형 orphan 프로세스였다. 명령행과 PID를 확인한 뒤 종료했으며 최종 확인에서 NAS 관련 PowerShell 프로세스는 0개다.
- 로그인 후 현재 tray helper 구현이 PowerShell을 내부적으로 사용할 수 있으나 hidden으로 실행되어 콘솔 창이 보이면 안 된다. 완전한 native tray 전환은 아래 남은 제품 과제로 유지한다.
- 공개 배포 Agent SHA-256은 `27b8c2ee4bcb435fe2e2904444009383169fb7cd3729b6b3e075b0ab7f323344`, Setup SHA-256은 `87c5cad8b79424b5c5ae2815e228b61ae7cb6ce1d88e233a4d6663ad033fb90f`다.
- 최종 staging은 `C:\Users\CHANYOUNG\Desktop\NAS_DEVELOP\_remote_edit\installer_live_fix_20260828`, NAS 공개 파일은 `backend/agents/dist/NAS-Drive-Setup.exe`와 `backend/agents/dist/NAS-Sync-Agent.exe`다.
- 검증은 Agent `npm run verify`, Agent pkg build, Setup `--self-test`, backend 테스트 6/6, `git diff --check`를 통과했다.

사용자 입력이 필요한 다음 E2E 경계:

1. 사용자가 현재 열린 네이티브 창에 NAS 계정 정보를 직접 입력한다. AI는 비밀번호를 대신 입력하거나 읽지 않는다.
2. 로그인 성공 후 계정별 개인 Drive pairing, Explorer 왼쪽 `NAS Drive - 개인`, 초기 동기화와 실시간 상태 표시를 확인한다.
3. Windows 재부팅 뒤 자동 시작·재연결을 확인한다.
4. 네이티브 로그아웃의 서버 token 폐기, 로컬 인증 제거, 사용자 동기화 파일 보존을 확인한다.

이 E2E가 끝날 때까지 로그인·Explorer 동기화·재부팅 검증까지 완료됐다고 기록하지 않는다. 이 작업과 무관한 Cloudflare/DNS/nginx/OnlyOffice/HWP 설정은 변경하지 않는다.

## 2026-08-28 완료·배포: 전용 GUI 설치 관리자

사용자 문제: 기존 다운로드 EXE는 관리자 확인 뒤 창이 사라지고, 진행률·완료 여부가 없으며 재실행 때 검은 창이 여러 개 생겼다.

구현·NAS 공개 배포한 해법:

- C# WinForms `NAS Drive Setup`을 Agent와 분리
- `%LOCALAPPDATA%\Programs\NAS Drive`에 CurrentUser 설치하고 manifest는 `asInvoker`; 이 경로에서는 관리자 권한이 필요 없다.
- 첫 설치, 구버전 업데이트, 동일 버전, 같은 버전 손상 복구, 더 최신 설치본의 다운그레이드 차단을 분리한다.
- 설치/업데이트 단계별 progress bar, 상태 문구, 완료 버튼, 기본 체크된 `설치 완료 후 NAS Drive 열기`를 제공한다.
- 설치창 single-instance mutex, 정확한 설치 Agent 종료, 내장 Agent `--self-test`, SHA-256 검증, `.new`/`.previous` 교체와 실패 rollback을 사용한다.
- 기존 계정 profile, DPAPI token, 동기화 폴더와 사용자 파일을 삭제하지 않는다.
- pairing 파일명 `NAS-Drive-Setup_pair_....exe`에서 token을 읽어 설치 완료 뒤 Agent에 전달한다.
- backend `/api/devices/agent/windows`는 인증·pairing owner/만료 검사를 유지하며 `NAS-Drive-Setup.exe`를 raw Agent보다 우선 제공한다.
- Agent profile 생성의 잘못된 `getProfiles(config)` 참조를 `getProfiles(currentConfig)`로 수정했다.

최종 산출물과 검증:

- 최종 staging: `C:\Users\CHANYOUNG\Desktop\NAS_DEVELOP\_remote_edit\installer_live_fix_20260828`
- NAS Setup EXE: `/home/limchanyoung/my-service-platform/backend/agents/dist/NAS-Drive-Setup.exe`
- 버전 `1.7.1.0`, SHA-256 `97FD87083B4F96F5DDD071AC6C10BA64D4548441EF775429B47D5CFB0DF97699`
- Setup `--self-test` exit 0, Agent source/pkg self-test 통과, `asInvoker` 확인
- 실제 Windows에서 1초 내 `NAS Drive 설치` 창과 window handle을 확인했다.
- 공개 Chrome에서 `PC 연동` 첫 클릭이 PowerShell/외부 protocol을 호출하지 않고 설치 dialog를 표시하며, 실제 다운로드 파일의 ProductName=`NAS Drive`, FileDescription=`NAS Drive Setup`, FileVersion=`1.7.1.0`과 서버 SHA-256 일치를 확인했다.
- frontend `main.d44426e1.js`를 `/var/www/html`에 배포했고 backend 테스트 6/6, PM2 online/save, 필수 systemd 6개 enabled+active, 내부·공개 HTTP 200을 확인했다.
- Authenticode는 `NotSigned`다. 공인 인증서 서명 전 SmartScreen 신뢰 배포 완료라고 말하지 않는다.

과거 운영 실패의 정확한 원인과 현재 규칙:

- `PATCH-WIN-INSTALLER-012`는 로컬 완료·NAS 배포 대기였는데 플랫폼이 이를 완료 기능으로 취급했다. 운영 `dist`에는 Setup이 없어서 raw pkg Node Agent가 다운로드됐다.
- 플랫폼 첫 클릭이 즉시 `nas-sync://`를 호출했고 기존 레지스트리가 `powershell.exe Start-Process`였으므로 Windows가 PowerShell 열기 확인을 표시했다.
- 이제 첫 클릭은 Setup 안내만 연다. 사용자가 명시적으로 `이미 설치됨 · 이 계정 연결`을 눌렀을 때만 protocol을 호출한다.
- Setup은 자신을 `%LOCALAPPDATA%\Programs\NAS Drive\NAS-Drive.exe` launcher로 설치하고 protocol/startup/바로가기를 PowerShell 없이 직접 launcher에 등록한다.
- 이 1.7.1 당시 규칙은 1.8.2에서 대체됐다. 현재 Setup을 한 번 실행하면 기존 PowerShell registry가 launcher 직접 실행으로 교체되고, 업데이트는 profile, DPAPI token, sync folder와 사용자 파일을 보존한다.
- raw `NAS-Sync-Agent.exe`를 사용자 다운로드로 되돌리지 말고, 첫 클릭 protocol 자동 호출도 다시 넣지 않는다. 상세 절대 규칙은 workbook `DNB-WIN-INSTALLER-DEPLOY-PROTOCOL`을 따른다.

## 아직 남은 제품 과제

- 공인 Authenticode 인증서 서명과 SmartScreen/Defender 배포 게이트
- hidden PowerShell tray helper를 완전한 native tray 프로세스로 교체
- 실제 계정 로그인·Explorer 개인 Drive·재부팅 유지·서버 폐기 로그아웃 E2E
- 두 Windows PC 동시 편집/삭제/이동 충돌 E2E
- 100MB 이상 전송 중 NAS 전원 단절·네트워크 단절·재부팅 뒤 resume E2E
- 파일별 온라인 전용/항상 로컬/공간 확보 정책의 사용자 제어 완성
- 바탕 화면·문서·사진 Known Folder 보호는 명시적 opt-in과 원복 계획 뒤 구현
- 수십만 파일 성능·개인정보 제거 진단 내보내기
- 별도 디스크/외부 위치 서버 백업과 재해 복구 훈련

위 과제의 정확한 상태와 Do-Not-Break ID는 반드시 workbook의 최신 행을 기준으로 판단한다.

## 2026-08-28 완료: 다중 업로드·OnlyOffice 연속 열기 회귀 수정

운영 사이트에서 두 문제를 직접 재현해 수정·배포·회귀 검증까지 완료했다.

- 다중 파일 드롭: `frontend/src/components/NAS.js`의 `collectDroppedUploadItems`가 첫 엔트리 탐색을 `await`한 뒤 다음 `DataTransferItem.webkitGetAsEntry()`를 호출한다. Chrome의 drop data store 유효 구간을 벗어나 두 번째 이후가 `null`이 되므로 표시 개수와 달리 첫 파일만 업로드된다. 모든 엔트리를 첫 `await` 전에 동기식 snapshot하고, 일반 파일 드롭은 `DataTransfer.files`를 signature로 누락 보완한다.
- 프레젠테이션 A를 닫고 B 열기: `/onlyoffice/web-apps/apps/presentationeditor/main/index.html`이 `Location: /9.3.1-.../web-apps/...`로 리디렉션되고 backend proxy가 이를 그대로 전달한다. `/onlyoffice`가 빠진 경로는 React fallback이 NAS SPA HTML을 반환하므로 OnlyOffice iframe 안에 NAS 메인화면이 표시된다.
- 서버 수정 원칙: `/onlyoffice` proxy 응답의 동일 OnlyOffice origin `Location`만 `/onlyoffice/...`로 다시 쓴다. `/cache/...`는 기존 proxy를 유지하며, root version 경로 전체를 nginx에서 광범위하게 proxy하지 않는다.
- 문서 수정 충돌 방어: `/onlyoffice/access`가 경로+파일 크기+mtime 기반 `documentKey`를 반환한다. `FileViewer`는 이전 access 요청을 Abort하고, open window별 React key/editor id를 분리한다. 닫을 때 실제 dirty인 문서만 forceSave하고 editor를 파기하며, 저장은 고정 2.5초 타이머가 아니라 document clean event 또는 10초 실패 경계로 판단한다.
- 다중 드롭 로직을 `frontend/src/components/NAS/uploadDropCollector.js`로 분리하고 회귀 테스트를 추가했다. 모든 entry를 첫 await 전에 snapshot하며 일반 파일 entry 실패는 `DataTransfer.files`로 중복 없이 보완한다.

완료 검증:

1. `uploadDropCollector.test.js` 2/2 통과: 과거처럼 첫 비동기 yield 뒤 handle이 무효화되는 3파일 케이스와 개별 entry 실패 fallback.
2. backend officeAccess/fileVersioning/storageQuota 테스트 통과, frontend production build 성공(기존 lint warning만 존재), `git diff --check` 통과.
3. 공개 `/onlyoffice/web-apps/apps/presentationeditor/main/index.html`의 첫 302 Location이 `/onlyoffice/9.3.1-...`를 유지하고 최종 200 `text/html`인 것을 확인했다.
4. 로그인 브라우저에서 PPTX A→닫기→B 열기, 새로고침→C 열기 모두 OnlyOffice editor가 표시되고 iframe 내부 NAS SPA와 수정 오류가 재발하지 않았다. Add Slide 등 편집 UI도 활성 상태였다.
5. PM2 `msp-backend` online/save, 필수 systemd 6개 enabled+active, 내부 3030과 공개 도메인 200을 확인했다.

남은 권장 회귀: 실제 파일을 변경하는 PPTX/DOCX/XLSX 저장·재열기와 브라우저 picker/물리적 drag 3파일 E2E는 테스트용 파일 업로드/수정 승인을 받은 유지보수 창에서 수행한다. signed Office token, atomic callback save, `/cache` proxy, HWP dirty effect 규칙은 계속 유지한다.

### 같은 날 후속 수정: 공개 빌드 미반영과 업로드 Network Error

사용자가 `TransferContext.js 청크/순차 업로드 실패`, `/api/file net::ERR_FAILED`, `Network Error`를 보고했다. 콘솔은 예전 `main.c04be9a2.js`를 가리켰다.

- 실제 원인 1: `npm run build`는 `frontend/build`를 갱신했지만 backend 설정 `FRONTEND_BUILD_PATH=/var/www/html`을 사용한다. `/var/www/html`에 복사하지 않아 localhost 3030과 공개 도메인이 계속 구버전 bundle을 제공했다.
- 실제 원인 2: 배포 중 PM2 재시작 순간 cloudflared에 `dial tcp 127.0.0.1:3030: connect: connection refused`가 기록됐고, 이때 `/api/file`은 HTTP 상태 없이 `ERR_FAILED`가 됐다.
- 수정: 새 build를 기존 hashed asset 삭제 없이 `/var/www/html`에 반영했다. `frontend/build`, localhost 3030, 공개 도메인, 실제 Chrome이 모두 `main.c7441720.js`를 사용함을 확인했다.
- 복원력: `frontend/src/contexts/TransferContext.js`의 작은 파일 `/api/file` 업로드에 응답 없음 또는 408/425/429/502/503/504일 때 최대 4회 지수 backoff 자동 재시도와 `네트워크 재연결 중` 상태를 추가했다. 취소·일시중지·인증/권한 오류는 재시도하지 않는다.
- 검증: production build 성공(기존 lint warning만 존재), diff check 통과, PM2 online, cloudflared/nginx/pm2-root active, 내부 3030 200, 공개 index 새 hash 확인.

절대 규칙: frontend 작업은 build 성공만으로 배포 완료가 아니다. `FRONTEND_BUILD_PATH`를 확인하고 `/var/www/html` 반영 후 내부·공개 index의 main bundle hash가 같아야 완료다. 배포 중 backend 재시작은 진행 중 업로드를 끊을 수 있으므로 가능한 무중단 방식 또는 고지된 유지보수 시점을 사용한다.

## 2026-08-28 완료: Windows 탐색기 11개 드롭·업로드 연결 복구·키보드 선택

사용자가 Windows 파일 탐색기에서 11개 파일을 동시에 선택해 NAS 웹 화면에 드롭했을 때 `/api/file net::ERR_FAILED`와 WebSocket 조기 종료가 함께 나타난 사례를 실제 운영 경로 기준으로 보완했다.

- 다중 드롭 수집은 모든 `DataTransferItem.webkitGetAsEntry()` handle을 첫 `await` 전에 snapshot한다. Windows 탐색기 11파일을 모사한 회귀 테스트를 추가해 11/11개와 순서를 고정 검증한다.
- 공개 `https://filemanager-nas.com/api/file`에 격리된 UTF-8 파일 11개를 동일 업로드 세션으로 연속 전송했고 11/11 저장을 목록 API로 확인했다. 시험 파일은 검증 후 계정 휴지통으로 이동했으며 30일 내 복원 가능하다.
- 작은 파일 전송은 응답 없음·408/425/429/502/503/504에 4회 지수 backoff한다. 반복 실패 뒤 작업을 사라지는 실패로 처리하지 않고 `NAS 연결 대기 · 15초 후 자동 재시도`로 명확히 전환하며, 같은 파일 인덱스부터 자동 재개한다. 사용자의 일시정지·취소는 재연결 timer도 중지한다.
- 다중 작업의 저장된 resume percent가 파일 하나 완료 때마다 100으로 기록되던 오류를 전체 bytes/파일 수 비율로 수정했다.
- 파일 선택은 Windows Explorer 방식으로 통합했다: Shift+클릭 및 Shift+방향키 범위 선택, Ctrl+클릭 개별 토글, Ctrl+방향키는 선택을 보존한 포커스 이동, Space 토글, Ctrl+A, Home/End, Enter, F2, Delete, Esc. 키보드 포커스에는 별도 outline과 `aria-selected`를 제공한다.
- 기존 Delete 전역 처리기가 두 개라 확인창/요청이 중복될 가능성을 제거하고 단일 shortcut 경로만 사용한다. Dialog/Menu/텍스트·Monaco·Office 편집기에서는 파일 단축키가 작동하지 않는다. Escape가 MUI에서 소비되지 않도록 capture 단계에서 처리한다.

검증:

1. Jest 2 suites, 7 tests 통과. 11개 Windows Explorer drop snapshot, entry fallback, Shift/Ctrl/방향키/Space 선택 모델 포함.
2. frontend production build 성공(기존 lint warning만 존재), `git diff --check` 통과.
3. 실제 로그인 브라우저에서 13개 항목 기준 Shift 범위 5개, Shift+방향키 6개, Ctrl+A 13개, Esc 0개, Ctrl+방향키 선택 유지, Space 추가 선택을 확인했고 console error가 없었다.
4. 운영 build, localhost 3030, 공개 도메인이 모두 `main.ee54b98c.js`를 제공한다. PM2는 재시작하지 않고 계속 online이며 필수 systemd 6개는 enabled+active, 최근 cloudflared 오류 없음.

남은 정확한 한계: Chrome의 ChatGPT 브라우저 확장 프로그램에서 `Allow access to file URLs`가 꺼져 자동 file chooser의 로컬 파일 주입이 `Not allowed`로 차단됐다. 따라서 물리적 Windows Explorer 드래그 자체는 사용자가 실제 PC에서 한 번 재시험해야 한다. 이 권한을 켠 유지보수 환경에서는 동일 11개 chooser E2E를 추가할 수 있다. 이 제한과 별개로 공개 API 11/11 및 드롭 수집 11/11 회귀는 통과했다.

## 2026-08-28 완료: 업로드 중 거짓 연결 끊김·multipart boundary·409 오분류

사용자가 11파일 업로드 재시험에서 `/api/file net::ERR_FAILED`, `NAS 연결이 끊겨 업로드 자동 재연결을 대기합니다`, HTTP 409, `chrome-extension://aggiiclaiamajehmlfpkjmlbadmkledi/... direction` 오류를 함께 보고했다.

- `TransferContext.js`가 브라우저 `FormData` 요청에 `Content-Type: multipart/form-data`를 직접 지정하고 있었다. 이 방식은 브라우저/Axios가 만들어야 하는 multipart boundary를 누락·불일치시킬 수 있으므로 작은 파일 `/api/file`과 청크 `/api/file/chunk` 모두 수동 Content-Type을 제거했다. `x-upload-session`, `x-upload-id`, `x-chunk-index`, `x-start-byte` 같은 custom header만 보낸다.
- 기존 `isCanceledError`는 HTTP status가 409이면 응답 본문과 무관하게 모두 취소로 처리했다. backend에는 `UPLOAD_CANCELED` 외에도 같은 이름 폴더 등 일반 conflict 409가 있으므로 잘못된 분류다. 이제 Axios `ERR_CANCELED`/`CanceledError`, 정확한 message `UPLOAD_CANCELED`, 또는 서버 response `error`/`code`가 정확히 `UPLOAD_CANCELED`인 경우만 취소다.
- 응답 없는 Network Error와 408/425/429/502/503/504만 재연결 대상으로 유지한다. 401/403/일반 409는 자동 재연결 루프에 넣지 않고 실제 오류로 표시한다.
- `chrome-extension://...` content script의 `direction` TypeError는 NAS React bundle이 아니라 설치된 Chrome 확장 프로그램 코드다. 같은 콘솔에 표시되더라도 API 실패와 분리해서 판단한다.
- 순수 정책은 `frontend/src/contexts/uploadRequestPolicy.js`로 분리했고 `uploadRequestPolicy.test.js`에서 boundary 헤더 금지, 정확한 409 취소 판정, transient status를 회귀 고정한다.

검증:

1. uploadRequestPolicy, 11파일 drop collector, 파일 선택 모델 Jest 3 suites 10 tests 통과.
2. frontend production build 성공 후 실제 `/var/www/html`에 배포. build/local/public index와 로그인 Chrome 모두 `main.28d22a85.js`를 로드한다.
3. Windows PC에서 공개 `https://filemanager-nas.com/api/file`로 한글 시험 파일 11개를 순차 multipart 전송해 11/11 HTTP 200, 목록 11/11을 확인했다. 시험 파일은 모두 30일 휴지통으로 이동했다.
4. 로그인 Chrome의 새 운영 bundle에서 NAS 코드 console error 0, PM2 online, 필수 systemd enabled+active, 내부·공개 HTTP 200.

절대 규칙: 브라우저 FormData의 multipart `Content-Type`을 직접 지정하지 않는다. HTTP 409 자체를 취소 신호로 사용하지 않는다. 사용자가 기존 탭에서 구 bundle을 계속 쓰는 경우 한 번 새로고침한 뒤 물리 Windows Explorer 11파일 drag를 최종 확인한다.

## 2026-08-28 완료: NAS Drive 1.9.8 설치·백그라운드·탐색기 진입 안정화

Windows 노트북에 실제 설치·업데이트하고 종료/재실행/시작 프로그램 복구까지 검증했다.

- 현재 배포·설치 버전은 `NAS Drive 1.9.8.0`, Agent `1.9.8`, Provider marker `1.2.2`다.
- 설치 완료 후 열기, 버전별 설치/업데이트/동일 버전 안내, 진행률과 완료 버튼을 실제 UI로 확인했다.
- launcher는 `%LOCALAPPDATA%\Programs\NAS Drive\NAS-Drive.exe --background`로 HKCU Run에 등록된다. UI 창을 닫아도 launcher, `NAS-Sync-Agent.exe --background`, `NAS-Drive-Provider.exe serve ...`는 계속 실행되고 지속적인 PowerShell 창/프로세스는 없다.
- 시작 프로그램 명령을 재부팅 상황처럼 직접 재실행했을 때 launcher, Agent, Provider가 모두 복구되고 `agent-health.json`이 `up-to-date`, `needsRelink=false`로 돌아오는 것을 확인했다.
- `registerPersonalDrive`가 CFAPI 등록만 하고 Provider serve 프로세스를 보장하지 않던 문제를 수정해 `ensurePersonalDriveProvider(profile, root)`를 항상 호출한다. stale PID는 실제 실행 파일·명령행·root 일치를 확인한 뒤에만 유효하게 취급한다.
- Provider를 .NET 8 self-contained win-x64로 실제 재빌드했다. Explorer 등록값은 Microsoft cloud storage namespace 지침에 맞춰 `InProcServer32`, `ShellFolder`, `TargetFolderPath`, `DefaultIcon`, `Desktop\NameSpace`, `Desktop\NameSpace_41040327`를 구성하며 경로 값은 ExpandString을 사용한다.
- 현재 Windows 11 build `10.0.26200`에서는 위 공식 namespace registry를 적용해도 Gallery 아래 OneDrive와 같은 독립 최상위 항목이 나타나지 않았다. 이 상태를 완료라고 과장하지 않는다.
- 실제 동작 가능한 대안으로 개인 동기화 루트 `NAS Drive - <계정>`을 Explorer Home에 자동 pin한다. 로그인/등록 성공 때 `pintohome`, 로그아웃 때 `unpinfromhome`을 hidden STA PowerShell로 실행하며 영구 PowerShell 프로세스는 남기지 않는다. 실제 Explorer 왼쪽 목록에서 NAS Drive 항목과 클릭 가능한 실제 폴더 진입을 확인했다.
- 대시보드는 로그인 뒤 비밀번호 입력 UI를 남기지 않고 계정 표시명·ID, 최신 상태, 저장 위치, 연결 계정 수, NAS Drive 열기, 웹에서 관리, 로그아웃을 보여준다. 비밀번호는 relay/workbook/코드/자동화에 저장하지 않는다.

최종 검증:

1. 설치 후 자동 열림, 닫기 뒤 백그라운드 유지, 설치 EXE 재실행, HKCU Run 기반 복구를 실제 Windows에서 확인했다.
2. launcher/Agent/Provider 실행, Provider root·device·sync-root 명령행, `up-to-date` health, 시작 등록 경로를 확인했다.
3. backend tests 6/6, Agent/Setup self-test, provider publish, `git diff --check` 통과.
4. NAS의 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 enabled+active, `msp-backend` online, 내부 3030과 공개 도메인은 HTTP 200이다.

남은 핵심 한계와 과제:

- OneDrive처럼 Gallery 아래 독립된 최상위 Explorer namespace와 파일별 상태 아이콘/우클릭 shell command를 완성하려면 현재 Windows 11 build에서 동작하는 서명된 native shell integration을 별도로 구현·검증해야 한다. 현재 보장 범위는 Explorer Home pin + 실제 CFAPI 동기화 루트다.
- 공인 Authenticode 서명과 SmartScreen 신뢰, native tray로 PowerShell helper 완전 제거, 두 PC 충돌·대용량 단절 복구·온라인 전용/항상 로컬 정책 E2E는 계속 남아 있다.
- 사용자가 채팅에 입력한 비밀번호는 어떤 프로젝트 파일에도 기록하지 않는다. 노출된 비밀번호는 사용자가 교체해야 한다.

## 2026-08-28 완료: NAS Drive 1.9.15 브랜드 로고와 Explorer 식별성

사용자가 선택한 2번 시안(파란 구름 아래 두 개의 NAS bay, 외곽 투명)을 Windows NAS Drive의 공통 브랜드 표식으로 적용했다.

- 원본 벡터/투명 PNG/멀티사이즈 ICO는 `C:\Users\CHANYOUNG\Desktop\NAS_DEVELOP\brand-assets`에 있다. 최종 ICO SHA-256은 `3D305B889728792973C836D41D84D51231FF4E62F1771E813A295B3C96332C07`이다.
- Setup EXE는 빌드 시 ICO를 내장한다. 설치 launcher/바탕화면 바로가기, 트레이, Explorer namespace `DefaultIcon`, 실제 개인 Drive 루트가 모두 같은 표식을 사용한다.
- 개인 Drive 루트에는 마커가 있는 UTF-16LE `desktop.ini`만 생성하고 Hidden+System, 루트는 ReadOnly 속성을 적용한다. 이 파일은 로컬 Windows 표시 메타데이터이므로 root-level `desktop.ini`만 업로드·삭제·초기 scan·offline reconcile·placeholder manifest·watcher에서 제외한다. 하위 폴더나 사용자가 만든 다른 `desktop.ini`는 건드리지 않는다.
- 업데이트된 Agent가 이미 설치 경로에서 실행될 때도 내장 ICO의 고정 SHA-256을 검증해 오래된 설치 아이콘을 교체한다. 아이콘이 다른 경우 self-test가 실패하므로 잘못된 브랜드 자산을 배포하지 않는다.
- 기존 관리 `desktop.ini`를 갱신할 때 Hidden/System 속성을 먼저 해제하고, 관리 마커가 없는 사용자 파일이면 덮어쓰거나 삭제하지 않는다.
- Windows `pintohome`은 이미 고정된 항목에서 토글처럼 동작할 수 있다. Quick Access CLSID `{679F85CB-0220-4080-B29B-5540CC05AAB6}`의 실제 항목 경로를 먼저 조회해 없을 때만 고정하고, 로그아웃 때는 있을 때만 해제한다. PowerShell 변수는 읽기 전용 `$HOME`과 충돌하지 않도록 `$quickAccessFolder` 같은 전용 이름을 사용한다.
- Provider `DefaultIcon`은 `NAS-Drive-Provider.exe` 자체가 아니라 같은 설치 폴더의 `nas-drive.ico`를 우선 참조한다.

최종 배포·설치 기준:

- Setup/launcher `1.9.15.0`, Agent `1.9.15`, Provider marker `1.2.3`.
- 공개 Agent SHA-256 `29EEC387AA64350C6569C9ACEE77D4A9865FEE547DCDECB90522445099AE60AE`.
- 공개 Setup SHA-256 `9BE39D69050CB08428AC8262BC7CB284B4942990F77146DAA39CC320B62D8258`.
- 실제 노트북 설치 경로의 Agent/launcher/ICO 해시가 빌드·NAS 공개 파일과 일치한다.
- 실제 Explorer 왼쪽 `NAS Drive - cmoeoffice`가 파란 구름 NAS 아이콘으로 표시되고 클릭 가능한 실제 CFAPI 폴더로 열린다.
- Agent/Provider를 두 번 연속 종료·재시작한 뒤에도 Quick Access pinned count가 1로 유지되고 health는 `up-to-date`, launcher/Agent/Provider 세 프로세스가 복구됐다.
- HKCU Run은 `NAS-Drive.exe --background`, 바로가기는 launcher를 가리키며 Explorer namespace `DefaultIcon`은 설치된 `nas-drive.ico,0`을 가리킨다.
- backend 테스트 6/6, Agent/Setup self-test, 내부 3030·공개 HTTPS 200, `msp-backend` online/save를 최종 확인했다.

남은 제품 한계는 변하지 않는다. 현재 보장되는 왼쪽 항목은 Explorer Home/즐겨찾기 고정이며, Gallery 아래 OneDrive와 완전히 같은 독립 최상위 namespace는 서명된 native shell integration 추가 검증이 필요하다. 공인 Authenticode/SmartScreen 신뢰와 완전 native tray도 별도 과제다.

## 2026-08-28 완료: NAS Drive 1.9.17 웹 생성 폴더의 Explorer 자동 반영

사용자가 NAS 웹 파일 관리자에서 새 폴더를 만들었지만 연결된 Windows PC에 나타나지 않는 현상을 실제 계정·실제 Explorer 창으로 재현하고 수정했다.

- 서버 변경 감지는 정상이라 새 폴더 `아마나`가 Agent manifest에 있었지만 로컬에는 없었다. Agent health와 로그는 3초마다 `0x8007018B`(cloud file access denied)를 반복했다.
- 원인은 long-running `NAS-Drive-Provider.exe serve`가 sync root에 연결된 동안 별도 `sync-placeholders` helper가 `CfCreatePlaceholders`를 호출하는 구조와 등록 정책 `CF_PLACEHOLDER_MANAGEMENT_POLICY_DEFAULT`가 충돌한 것이다. 기본 정책에서는 연결된 Provider 외 프로세스의 placeholder 관리가 거부된다.
- Provider 1.2.5는 `CF_PLACEHOLDER_MANAGEMENT_POLICY_CREATE_UNRESTRICTED`만 사용한다. 현재 구조에 필요한 placeholder 생성만 helper에 허용하며 convert/update unrestricted 권한은 계속 열지 않는다. Provider `self-test`가 이 최소 권한 구성을 회귀 검증한다.
- `CfCreatePlaceholders` 성공 뒤 파일/폴더 생성 이벤트와 parent/root update 이벤트를 `SHChangeNotify(..., SHCNF_PATHW | SHCNF_FLUSH, ...)`로 Windows Shell에 전달한다. 실제 디스크에만 생성되고 이미 열린 Explorer가 F5 전까지 갱신되지 않던 두 번째 문제를 함께 해결했다.
- 배포 기준은 Setup/launcher 1.9.17.0, Agent 1.9.17, Provider 1.2.5다. 공개 SHA-256은 Provider `DE73EC50B218DFA33215A6D0E860FB55A4840E493402B4C329C4AF9369E50C2F`, Agent `AB4C37797E25F40DE5D412C7A9F507993A2DE876A7B5A0E0D3F88030519CF4F6`, Setup `B806B0B3F6D1707D8A275E1580D1118CB87B890B44A56EF5CFA31CB3C0F80CD2`다.
- 실제 PC에서 기존 누락 1개가 0개로 회복되고 `아마나`가 Directory+ReparsePoint로 생성됐다. 추가 웹 시험 폴더는 열린 Explorer에 F5 없이 약 4.2초 만에 나타났다. Agent/Provider/launcher 재시작 뒤 health `up-to-date`, manifest 51개 대비 누락 0개, 새 `0x8007018B` 0건을 확인했다.
- backend 테스트 6/6, Agent/Provider/Setup self-test, Provider publish, `git diff --check`, PM2 online/save, 내부·공개 HTTP 200을 확인했다.

절대 회귀 규칙: 현재처럼 namespace reconciliation을 별도 helper가 수행하는 동안 Provider가 sync root에 연결돼 있다면 placeholder 생성 허용 정책을 기본값으로 되돌리지 않는다. 반대로 필요하지 않은 convert/update unrestricted 권한까지 넓히지 않는다. 새 remote placeholder 생성 뒤에는 Shell create/mkdir와 parent/root update 알림을 보내고, 검증은 단순 `Test-Path`뿐 아니라 이미 열린 Explorer에서 F5 없이 항목 수와 이름이 바뀌는 것까지 확인한다.

## 2026-08-29 완료: NAS Drive 1.10.0 안전한 웹 바로가기·CFAPI 상태 기반·재부팅 유지

사용자 요청은 (1) 파일별 동기화 상태 기반, (2) 원하는 항목의 로컬 고정/공간 확보, (3) 동기화 루트 최상단에서 웹 NAS를 더블클릭해 재로그인 없이 진입, (4) 재부팅 뒤 자동 시작과 로그인 유지였다.

- 배포·설치 버전은 Setup/launcher `1.10.0.0`, Agent `1.10.0`, Provider `1.3.0`이다. Provider는 .NET 런타임 사전 설치가 필요 없는 self-contained 단일 EXE다.

- Agent는 업로드 직전에 Provider current-user named pipe로 `dirty`, 성공·충돌 처리 뒤 `commit`을 보내며, Provider는 일반 로컬 파일/폴더를 CFAPI placeholder로 전환하고 in-sync 상태를 설정한다. named pipe 이름은 syncRootId SHA-256으로 분리한다.
- Provider의 `pin`/`free-space` 명령은 CFAPI pin state와 dehydration을 사용한다. 실제 시험 파일에서 일반 `Archive(0x20)`가 업로드 후 `Archive+ReparsePoint(0x420)`, 공간 확보 후 `0x501620`, 다시 고정 후 `0x80420`으로 변하는 것을 확인했다.
- 동기화 루트의 `desktop.ini`는 `[ViewState] FolderType=StorageProviderGeneric`을 사용하고 신규 보기의 기본 열에 `System.StorageProviderUIStatus`를 포함한다. 다만 현재 Windows 11 10.0.26200 실제 Explorer에서는 CFAPI 속성 전환에도 상태 셀 아이콘과 기본 `항상 이 장치에 유지`/`공간 확보` 우클릭 항목이 표시되지 않았다. 내부 기능과 속성만 완료된 상태를 OneDrive 수준의 Explorer UI 완료라고 기록하거나 보고하지 않는다. 다음 단계는 `StorageProviderSyncRootInfo` 기반 정식 Shell 등록 또는 서명된 native shell integration으로 실제 아이콘·메뉴를 노출한 뒤 물리 UI E2E를 통과시키는 것이다.
- 루트에 `NAS Drive 웹 파일관리.url`을 생성하고 로컬 표시 메타데이터로 동기화에서 제외한다. URL에는 비밀번호·세션·장기 토큰을 넣지 않고 `nas-sync://open-web?deviceId=...`만 담는다.
- Agent는 `POST /api/devices/agent/web-session`으로 32-byte 임의 1회 토큰을 요청하고 브라우저를 `GET /api/auth/desktop-handoff`로 연다. 서버는 토큰 원문을 저장하지 않고 SHA-256만 메모리에 45초 보관하며, 1회 사용 후 즉시 소모한다. handoff 순간에도 device owner·revocation을 재검증하고 `/nas` 또는 `/platform` 외 redirect를 거부한 뒤 기존 추적형 30일 웹 세션 쿠키를 발급한다.
- 실제 노트북에서 루트 shortcut/Agent `--open-web`로 Chrome `https://filemanager-nas.com/nas`가 로그인 UI 없이 현재 `cmoeoffice` 계정의 `내 클라우드`를 여는 것을 확인했다.
- 시작 프로그램은 HKCU Run의 정확한 `"%LOCALAPPDATA%\\Programs\\NAS Drive\\NAS-Drive.exe" --background`이며 launcher/Agent/Provider 3개가 실제 실행 중이다. 로그인 토큰은 Windows CurrentUser DPAPI로 보호하고 비밀번호는 저장하지 않는다. UI를 닫아도 백그라운드 동기화는 유지되며 Windows 사용자 로그인 후 자동 복구된다.
- backend `desktopWebSession.js`와 `desktopWebSession.test.js`를 추가했다. 관련 경로는 `backend/index.js`, `backend/nasRoutes.js`, `backend/agents/windows-node/index.js`, `backend/agents/windows-cfapi/Program.cs`, `backend/agents/windows-installer/Program.cs`다.
- 최종 검증은 backend 8/8 tests, Provider self-test, Agent self-test(exit 0), 내부 3030 HTTP 200, 공개 HTTPS 200, PM2 `msp-backend` online이다.

절대 회귀 규칙: 웹 shortcut이나 custom protocol에 인증 비밀을 넣지 않는다. desktop handoff는 짧은 TTL·1회용·hash-only·owner/revocation 재검증을 유지한다. Provider helper 권한은 `CREATE_UNRESTRICTED`만 유지하고 convert/update unrestricted로 넓히지 않는다. 계정 경계는 device token의 owner와 syncRoot owner를 매 요청에서 함께 검증한다. 비밀번호는 로그·릴레이·코드·설정에 저장하지 않는다.

## 2026-08-29 부분 완료: NAS Drive 1.10.1 Windows StorageProvider Shell 통합

- 배포·현재 PC 설치 버전은 Setup/launcher·Agent `1.10.1`, Provider `1.4.0`이다. Provider는 self-contained win-x64 단일 EXE다.
- Provider 등록은 수동 Explorer CLSID/CfRegisterSyncRoot 단독 경로가 아니라 `StorageProviderSyncRootManager.Register(StorageProviderSyncRootInfo)`를 사용한다. sync root ID는 `NASDrive!<현재 Windows SID>!<accountKey>`로 계정·Windows 사용자 경계를 분리한다.
- 등록 정책은 `Full` hydration, `AlwaysFull` population, `AutoDehydrationAllowed`, `AllowPinning=true`다. 실제 Windows 11 탐색기에서 파일 우클릭 메뉴의 네이티브 `항상 이 장치에 유지`와 `공간 확보`, 상태 표시줄의 `이 장치에서 사용 가능`을 확인했다.
- placeholder manifest reconciliation은 별도 helper가 아니라 연결된 Provider 내부에서 수행한다. Agent는 `%LOCALAPPDATA%\NAS-Sync-Agent\manifest-*.json`만 current-user named pipe `sync-manifest`로 전달한다. 외부 helper/CREATE_UNRESTRICTED 방식으로 되돌리지 말고 CONVERT/UPDATE_UNRESTRICTED를 열지 않는다.
- 실제 PC에서 HKCU Run의 `NAS-Drive.exe --background`, launcher/Agent/Provider 3개 프로세스, 버전 파일 `1.10.1`/`1.4.0`, 탐색창 `NAS Drive - cmoeoffice`를 확인했다. 검증용 파일 2개는 완료 후 삭제했다.
- 중요한 미완료: 탐색기 상태 열의 OneDrive형 파일별 아이콘/텍스트는 아직 비어 있다. `StorageProviderItemProperties` best-effort만으로는 현재 PC에서 보이지 않았다. Microsoft CloudMirror 방식의 서명된 MSIX/패키지 `windows.cloudFiles` COM 확장(`IStorageProviderItemPropertySource`, StatusUI)을 추가하고 물리 UI E2E를 통과하기 전에는 이 부분을 완료라고 보고하지 않는다.
- NAS backend `node --test tests/*.test.js` 8/8, Agent/Provider self-test, PM2 online/save, 내부·공개 HTTP 200, ssh/tailscaled/nginx/docker/pm2-root/cloudflared enabled+active를 확인했다.

## 2026-08-29 완료: NAS Drive 1.10.2 Explorer 파일별 상태 열

- 배포 버전은 Setup/launcher·Agent `1.10.2`, Provider `1.4.1`이다.
- 직전 기록의 “상태 열이 비어 있으므로 즉시 MSIX COM 확장이 필요하다”는 진단은 수정한다. 파일의 `System.StorageProviderUIStatus`와 `System.StorageProviderStatus` 데이터는 이미 정상 생성됐지만, 현재 Explorer folder bag에 이름만 같은 `System.Devices.Status*` 열이 캐시되어 잘못 표시된 것이 직접 원인이었다.
- Provider에 `configure-view --root <path>`를 추가했다. 현재 열린 해당 NAS Drive Explorer 창만 찾아 `IColumnManager::SetColumns`로 `System.ItemNameDisplay`, `System.StorageProviderUIStatus`, `System.DateModified`, `System.ItemTypeText`, `System.Size`를 적용한다. Windows 전체 folder bag이나 다른 폴더 보기 설정은 삭제·초기화하지 않는다.
- .NET COM RCW 변환은 이 PC에서 등록되지 않은 TypeLib 오류 `0x80131165`를 냈으므로, Provider는 이미 QI로 확인한 Shell 인터페이스의 vtable을 직접 호출한다. 전역 레지스트리 수정, 관리자 권한, Windows SDK 설치가 필요 없다.
- Agent는 개인 Drive를 열고 700ms 뒤 `configure-view`를 hidden 실행한다. 최초 설치가 Drive를 자동으로 열기 때문에 신규 사용자도 별도 열 설정 없이 상태 열을 받으며, 이후 보기 설정은 Explorer가 해당 폴더에 보존한다.
- 기존 Agent가 만든 일반 remote 폴더는 서버 manifest에 같은 폴더가 확인된 경우에만 `CfConvertToPlaceholder(...MARK_IN_SYNC)`로 승격한다. 일반 파일은 로컬 충돌 가능성 때문에 manifest만 보고 임의 승격하지 않으며, 정상 업로드 commit 뒤에만 전환한다.
- 업로드 중에는 custom item property로 동기화 상태를 표시하고, commit 뒤에는 custom property를 비워 표준 CFAPI 상태(파란 구름/로컬 사용 가능/고정)를 다시 노출한다. 완료 뒤에도 임의의 “동기화 중” 아이콘이 남지 않게 한다.
- 실제 Windows 11 Explorer에서 올바른 `상태` 열이 이름 다음에 나타났고, 온라인 전용 파일과 manifest-confirmed 폴더가 파란 구름, 아직 처리 중인 로컬 항목은 순환 화살표로 표시되는 것을 화면으로 확인했다. 선택 항목 상태 표시줄도 `온라인에서 사용 가능`으로 일치했다.
- 검증: Provider publish/self-contained 성공, Agent self-test 성공, backend tests 8/8, PM2 restart/save 후 `msp-backend` online, 내부 3030과 공개 HTTPS 200.

절대 회귀 규칙: 상태 열 문제를 곧바로 MSIX 부재로 단정하지 말고 먼저 실제 `System.StorageProviderUIStatus` 값과 현재 `IColumnManager` 열 PROPERTYKEY를 각각 확인한다. NAS Drive 창만 수정하며 사용자의 전체 Explorer Bags/BagMRU를 삭제하지 않는다. 서버 manifest로 확인되지 않은 기존 일반 파일을 자동 placeholder 전환하거나 in-sync 처리하지 않는다.

## 2026-08-29 완료: NAS Drive 1.10.3 자동 시작·트레이 재실행 복구

- 사용자 증상은 Windows 재로그인/재부팅 뒤 또는 트레이의 `NAS Drive 종료` 뒤 다시 실행해도 알림 영역 아이콘과 동기화 연결이 복구되지 않는 것이었다.
- 실제 설치 폴더에서 `NAS-Drive.exe`와 `NAS-Sync-Agent.exe`의 SHA-256이 같았다. 네이티브 WinForms 런처가 Node Agent 바이너리로 덮여 있었고, Agent는 파일명만 보고 네이티브 런처가 존재한다고 오인해 legacy tray fallback도 생략했다.
- 기존 Setup의 같은 버전 경로는 Agent 버전/hash만 보고 `이미 설치됨`으로 끝나 손상된 런처를 복구하지 못했다. 또한 launcher `--open`은 Agent만 시작해 사용자가 종료한 native tray를 다시 만들지 않았다.
- Setup/launcher와 Agent를 `1.10.3`으로 올렸다. 같은 버전 실행에서도 런처와 Agent가 동일 hash이거나 런처 버전이 맞지 않으면 런처를 복구 설치하고 다시 검증한다. 정상 설치 후에도 두 실행 파일이 서로 다른지 검증한다.
- launcher `--open`은 유효 프로필이 있을 때 별도 `--background` launcher를 먼저 시작하므로 설정 창을 닫아도 native NotifyIcon과 Agent가 유지된다. HKCU Run은 계속 현재 사용자 경계의 `NAS-Drive.exe --background`를 사용한다.
- Agent는 런처 파일 존재 여부가 아니라 launcher/Agent hash가 다른지를 확인한다. 잘못된 동일 바이너리 설치에서는 Agent 자신을 시작 앱/프로토콜 handler로 사용하고 hidden legacy tray fallback을 켜 최소한 트레이와 연결이 사라지지 않게 한다.
- stale `agent.pid`는 PID 존재만 믿지 않고 실제 실행 파일이 `NAS-Sync-Agent.exe`인지 확인한다. Windows PID 재사용으로 무관한 프로세스를 Agent로 오인하지 않는다.
- 현재 Windows PC에서 런처 `1.10.3.0`과 Agent `1.10.3`을 서로 다른 hash로 복구했고 `NAS Drive 종료` 동작을 재현한 뒤 `--open`으로 native tray launcher·Agent·Provider가 다시 살아나고 health가 `up-to-date`가 되는 것을 확인했다. 설정 창 프로세스를 닫은 뒤에도 세 백그라운드 프로세스가 유지됐다.
- 회귀 금지: 설치/수동 갱신 시 Agent 바이너리를 `NAS-Drive.exe`에 복사하지 않는다. 같은 버전 설치에서도 런처 무결성 검사를 건너뛰지 않는다. `--open`에서 Agent만 시작하고 native tray 복구를 생략하지 않는다.

## 2026-08-29 완료: NAS Drive 1.10.5 완전 초기화 설치·로그아웃·재연결 E2E

- 실제 Windows PC에서 기존 Agent/launcher/Provider를 종료하고 설치 폴더, Agent 상태, HKCU Run, `nas-sync` 프로토콜, 바탕화면 바로가기를 모두 격리 백업한 뒤 최종 Setup `1.10.5.0`을 처음 설치 상태로 실행했다. 개인 동기화 루트 `NAS Drive - <계정>`은 삭제하지 않았고, 설치 전후 사용자 파일 11개·폴더 11개·188,986,092 bytes가 유지됐다.
- 첫 초기화 시험에서 로그아웃했던 동일 `clientDeviceKey`를 재사용하면 서버가 새 Agent token을 발급하면서도 기존 `revokedAt`과 `signed-out` 상태를 남겨 Provider 다운로드가 403이 되는 결함을 실제로 발견했다. `backend/nasRoutes.js`의 정식 `/devices/agent/register` 성공 경로가 새 token hash와 함께 `revokedAt=null`, `syncState=connecting`, `lastError=''`, `status=connected`를 원자적으로 기록하도록 수정했다.
- 계정 경계는 완화하지 않았다. 재활성화 대상은 pairing token의 owner와 같은 ownerKey이면서 같은 current-user machine key를 가진 기존 장치뿐이다. 로그아웃 시 token hash 제거·revoked 상태 전환, 모든 Agent API의 deviceId+token hash 검증은 그대로 유지한다.
- 로그인 전부터 native tray가 실행 중인 첫 설치에서는 로그인 완료 뒤 새 프로필을 즉시 다시 읽지 않아 Provider만 뜨고 Agent가 시작되지 않는 두 번째 결함을 발견했다. Agent `restartBackground()`는 native tray와 별개로 설치된 Agent `--background`도 직접 기동한다. native tray는 2.5초 상태 갱신마다 구성된 계정이 있는데 Agent 프로세스가 없으면 8초 throttle로 Agent를 복구하는 supervisor를 가진다.
- 최종 실제 시험은 완전 초기화→Setup 진행률/완료/설치 후 열기→로그인 연결→로그아웃→서버 token 폐기 확인→같은 계정·같은 폴더 재연결→시작 프로그램 명령을 재부팅처럼 재실행 순서로 통과했다. 각 연결·재연결·부팅 복구 뒤 launcher, Agent, Provider 3개가 실행되고 `agent-health.json`은 `up-to-date`, `needsRelink=false`였다.
- HKCU Run은 정확히 `"%LOCALAPPDATA%\\Programs\\NAS Drive\\NAS-Drive.exe" --background`, custom protocol과 바탕화면 바로가기도 launcher를 가리킨다. 비밀번호는 설정·로그·릴레이·엑셀에 저장하지 않고 Agent token은 Windows CurrentUser DPAPI 파일로만 보관한다.
- 최종 배포 hash: Agent `EF7E400C243364691443170843F88C3D4832AA1D82EABC5BF57DA5DE0D339E84`, Setup `CF20447E56E1E93144C42B464428B4214E3B10B9B60DC96F108932CE811AAA65`.
- 검증: Agent self-test, backend tests 8/8, `node --check`, `git diff --check`, PM2 restart/save 및 `msp-backend online`, 내부 3030·공개 HTTPS 200. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 enabled+active다.

절대 회귀 규칙: 로그아웃된 장치를 정식 pairing으로 재등록할 때 새 token을 저장하면서 오래된 `revokedAt`을 남기지 않는다. 반대로 pairing/owner/machine 경계 없이 임의 장치를 재활성화하지 않는다. 로그인 완료 뒤 native tray가 이미 존재한다는 이유로 Agent 시작을 생략하지 않으며, 트레이 supervisor의 단일 Agent 복구와 8초 재시도 제한을 유지한다. 초기화·재설치 시험에서 사용자 동기화 루트는 삭제하지 않는다.

## 2026-08-29 완료: NAS Drive 1.10.6 웹 바로가기 오프라인 안내·프로세스 누수 방지

- 사용자가 Drive 루트의 `NAS Drive 웹 파일관리.url`을 눌렀지만 아무 반응이 없었다. 바로가기와 `nas-sync` 등록은 정상이었고 실제 원인은 NAS 전원/Cloudflare tunnel 중단으로 공개 주소가 HTTP 530, Cloudflare error 1033을 반환한 것이었다.
- 숨김 protocol Agent는 오류를 기록한 뒤 `waitIfConsole()`에서 stdin을 기다렸다. `--hidden-bootstrap`을 console 실행으로 잘못 취급해 클릭할 때마다 `NAS-Sync-Agent.exe nas-sync://open-web ...`가 종료되지 않고 누적됐다.
- `waitIfConsole()`은 `--hidden-bootstrap`에서도 즉시 반환한다. `open-web`은 offline, needs-relink, 기타 오류를 분류하고 health를 갱신한 뒤 정상 return한다. 서버 오프라인 메시지는 서버 전원과 Cloudflare 연결을 확인하라고 안내하며, 인증 만료는 NAS Drive에서 다시 로그인하라고 안내한다.
- 오류창은 hidden PowerShell에 의존하지 않는다. Agent가 제목/메시지만 UTF-8 JSON→Base64로 전달하고 설치된 native `NAS-Drive.exe --notify-base64`가 topmost WinForms MessageBox를 표시한다. 인증 token·device secret은 payload에 넣지 않는다.
- 현재 PC를 Setup/Agent/launcher `1.10.6`으로 실제 업데이트했다. 네이티브 오프라인 경고창을 띄우고 닫힌 뒤 launcher 프로세스가 종료되는 것을 확인했다. 서버 복구 상태에서 실제 `.url`을 실행해 Chrome desktop handoff 호출, open-web Agent 잔여 0개, launcher/Agent/Provider 유지, health `up-to-date`를 확인했다.
- 서버에는 1.10.6 Agent/Setup과 update metadata를 배포했다. Agent self-test, backend tests 8/8, `node --check`, `git diff --check`, PM2 restart/save online을 통과했다.

절대 회귀 규칙: custom protocol·웹 shortcut 오류 처리에서 `--hidden-bootstrap` 프로세스를 stdin 대기로 남기지 않는다. 사용자가 여러 번 눌러도 open-web Agent가 누적되어서는 안 된다. 오프라인/재로그인 안내는 native UI로 명확히 표시하되 notification payload에 token, password, handoff URL 같은 인증 비밀을 넣지 않는다. 성공 경로는 1회용 desktop handoff를 계속 사용한다.

## 2026-08-29 완료: NAS Drive 1.10.7 웹 바로가기 간헐 실패 자동 복구·진단

- 실제 Windows Explorer에서 사용자가 `NAS Drive 웹 파일관리.url`을 더블클릭했을 때 native `NAS 웹을 열 수 없음` 창이 재현됐다. 앞선 정상 판정은 이미 열려 있던 Chrome 창을 새 실행 결과로 잘못 연결한 것이므로 정정한다.
- 클릭은 launcher와 Agent까지 전달됐지만 기존 1.10.6은 인식하지 못한 통신 예외를 모두 일반 오류로 축약했고, 해당 실행의 상세 진단도 남기지 않아 사후 원인 구분이 불가능했다. 같은 DPAPI 장치 token으로 `/api/devices/agent/web-session`을 즉시 호출하면 HTTP 200과 신뢰된 handoff URL이 반환되어 계정·장치·바로가기 파일 손상은 아니었다.
- Agent 1.10.7은 web-session 발급을 0/0.8/2/4초 간격으로 최대 4회 재시도한다. 401/403 needs-relink와 신뢰되지 않은 URL은 재시도하지 않는다. `EHOSTUNREACH`, `ENETDOWN`, TLS/인증서 계열, 기존 timeout/reset/5xx를 offline으로 분류한다.
- `%LOCALAPPDATA%\NAS-Sync-Agent\open-web-last.json`에 버전, 시각, stage, attempt, 안전한 code/message를 기록한다. `desktop_*` 1회 token, query token, Agent token header, 전체 URL은 기록 전에 제거한다. 일반 오류창에도 비밀 없는 오류 코드만 표시한다.
- 현재 PC와 NAS 배포 버전은 Agent/Setup/launcher 1.10.7이다. 설치 파일 hash는 Agent `590090D02F7D9752B285E9289264EF533F42B38D7721E199E2E8DEA6B702C75F`, Setup `40358DEA1F228699F73F7E785FD3FC9B57EB9A03E32A785543F0740F83640138`이다.
- 동일 `.url`을 현재 PC에서 연속 3회 실제 실행해 모두 `state=opened`, `stage=launch`, `attempt=1`, notify/open-web 잔여 프로세스 0, Chrome `filemanager-nas.com/nas`를 확인했다. 계정 cmoeoffice, deviceId, DPAPI token, sync root는 보존됐다.
- 검증: Agent/Setup self-test, backend tests 8/8, `node --check`, `git diff --check`, PM2 restart/save online, 내부 3030·공개 HTTPS 200, ssh/tailscaled/nginx/docker/pm2-root/cloudflared enabled+active.

절대 회귀 규칙: open-web 실패를 상세 원인 없이 일반 문구로만 버리지 않는다. 일시 네트워크 오류는 bounded retry 후 판단하고, 인증 실패나 신뢰되지 않은 URL은 반복하지 않는다. 진단 파일과 알림에는 비밀번호, DPAPI 원문, Agent token, desktop handoff token/URL을 절대 기록하지 않는다.

## 2026-08-29 완료: NAS Drive 1.10.8 WEB_PROFILE_MISSING·DPAPI 단발 실행 복구

- 1.10.7 배포 뒤 사용자의 실제 Explorer 더블클릭에서 `WEB_PROFILE_MISSING`이 재현됐다. config에는 cmoeoffice deviceId가 있고 계정별 DPAPI token 파일도 보존돼 있었으므로 실제 profile 삭제가 아니었다.
- 원인은 custom protocol이 만든 단발 hidden Agent에서 PowerShell DPAPI helper가 간헐적으로 빈 결과를 반환할 때 `deviceId 또는 agentToken 없음`을 하나의 `WEB_PROFILE_MISSING`으로 처리한 것이었다. 백그라운드 Agent와 직접 DPAPI/API 검사는 정상이어서 재로그인·token 삭제로 처리하면 안 되는 일시 credential-read 실패였다.
- Agent 1.10.8은 DPAPI 복호화를 0/0.15/0.45/0.9초 간격으로 최대 4회 재시도한다. 성공한 token만 메모리에서 사용하며 원문은 설정·로그·진단에 쓰지 않는다. 최종 실패 시 accountKey, 시도 수, process status와 비밀 없는 error code만 로그에 남긴다.
- deviceId 부재는 `WEB_PROFILE_MISSING`, token 파일이 있으나 복호화가 끝내 실패한 경우는 `WEB_PROFILE_TOKEN_UNAVAILABLE`로 분리한다. 후자는 로그인 정보를 삭제하거나 needs-relink로 바꾸지 않고, 진단 `stage=profile-token`과 tokenFileExists만 기록한다.
- NAS와 현재 PC를 Agent/Setup/launcher 1.10.8로 배포했다. hash는 Agent `1D9141D539478B9722F6B28C69BE7D28B362BED5F7DF5E4A5DD94704B931D1FB`, Setup `9560EBF61C0C7DBB5F8F9406B340CD6FC551E0755E7FD59D1AC6D194374DA092`다.
- Windows Shell `InvokeVerb(open)`으로 동일 `.url`을 5회 연속 실행해 모두 `opened/launch/attempt1/v1.10.8`, native 오류창 0, 8초 뒤 open-web Agent 잔여 0, Chrome `filemanager-nas.com/nas`, health up-to-date/needsRelink=false를 확인했다.

## 2026-08-30 완료: NAS Drive 1.10.9 웹 바로가기와 네이티브 버튼 실행 경로 통합

- 사용자는 트레이/상태 창의 `웹에서 관리` 버튼은 정상인데 동기화 루트의 `NAS Drive 웹 파일관리.url`은 여전히 체감상 열리지 않는다고 확인했다. 해당 클릭의 Agent 진단은 이미 `opened/launch`였으므로 서버 handoff나 계정 profile 문제가 아니라 `.url -> nas-sync:// protocol -> launcher -> Agent` 전달 경로와 실제 버튼의 직접 실행 경로 차이가 남아 있었다.
- 동기화 루트의 관리 바로가기를 인터넷 `.url`에서 Windows 네이티브 `.lnk`로 변경했다. 새 `NAS Drive 웹 파일관리.lnk`는 설치된 `NAS-Drive.exe --open-web`을 직접 호출하며, 이는 정상 동작하는 `웹에서 관리` 버튼과 같은 installed Agent `--open-web --hidden-bootstrap` 경로로 이어진다. 바로가기에는 deviceId나 token을 넣지 않고 현재 로컬 profile을 사용한다.
- Agent는 기존 managed `.url`만 marker를 확인해 제거하고 새 `.lnk`를 생성한다. `desktop.ini`, 새 `.lnk`, legacy `.url` 모두 동기화 대상에서 제외해 서버 파일 목록에 섞이지 않게 유지한다. 로그아웃/비활성화에서는 managed shell shortcut만 정리한다.
- NAS와 현재 Windows PC를 Agent/Setup/launcher 1.10.9로 배포했다. Agent SHA-256은 `DB5647085FDB077E7E8477922C10A1AEA3DD3FA2959D9CAA29198A45566618B2`, Setup/launcher SHA-256은 `B49DF1610FA770B1EBCB5D05E0ACA4BFF315BA4A208FDAA25FC5A37AB12FCFDE`다.
- 현재 PC에서 legacy `.url` 제거, 새 `.lnk`의 Target=`NAS-Drive.exe`, Arguments=`--open-web`, icon/working directory를 확인했다. Windows Explorer Shell의 `InvokeVerb(open)`으로 새 `.lnk`를 실행해 진단이 v1.10.9 `opened/launch/attempt1`로 새로 갱신됐고 native 오류창 0, 종료 대기 뒤 open-web 잔여 0, launcher/Agent/Provider 3개 유지, Chrome 창 제목 `NAS - Chrome`을 확인했다.
- 회귀 금지: 동기화 루트 웹 진입을 다시 `.url` 또는 `nas-sync://` 중간 전달에 의존시키지 않는다. 정상 동작하는 native `웹에서 관리` 버튼과 파일 탐색기 바로가기는 동일한 launcher/Agent 경로를 사용한다. 바로가기 파일에 인증 정보나 장치 식별자를 저장하지 않는다.
- 후속 사용자 확인에서 파일 탐색기 바로가기는 여전히 열리지 않는다고 보고됐다. 따라서 1.10.9 웹 바로가기 항목은 해결 완료가 아니라 **미해결·추가 실제 사용자 클릭 재현 필요** 상태다. 자동 진단의 `opened`와 Chrome 창 제목만으로 사용자 체감 성공을 확정하지 않는다.

## 2026-08-30 완료: NAS Drive 1.10.10 다중 파일 폴더 실시간 업로드 누락 복구

- 사용자가 파일 탐색기에서 `성세실` 폴더를 NAS Drive 루트에 복사했을 때 서버에는 폴더만 생기고 내부 파일은 모두 `동기화 보류 중`으로 남았다. 실제 로컬에는 파일 9개·19,492,519 bytes가 있었으나 Agent state/서버 manifest에는 `성세실` folder 1개만 있었다. Agent health는 잘못 `up-to-date`였다.
- 원인은 root당 하나뿐인 debounce가 `fs.watch({recursive:true})`의 다중 파일 이벤트를 서로 취소한 것이다. 마지막 folder 이벤트만 남으면 `syncFolder`가 빈 폴더만 만들고 내부 파일 이벤트가 사라졌다. 주기 tick은 remote pull만 수행해 누락된 local 파일을 다시 찾지 않았다.
- Agent 1.10.10은 watcher 이벤트 경로를 Set으로 누적하고 0.9초 안정 구간 뒤 root 전체 local/remote 대조를 실행한다. root별 Promise queue로 watcher/startup/periodic 작업을 직렬화하고, 매 15초 local audit를 fallback으로 수행한다. previous state가 비어도 current remote와 비교해 새 local 파일만 올리며 동일 remote 파일은 재업로드하지 않는다.
- 현재 PC를 1.10.10으로 보존 업데이트한 뒤 `성세실`의 내부 파일 9개가 모두 NAS manifest에 올라갔고 총 size 19,492,519 bytes, health up-to-date를 확인했다.
- 별도 `__NAS_Drive_동기화_검증_20260830` 폴더와 동시 생성 파일 A/B/C 3개로 실시간 재현했다. 재시작 없이 약 12초 안에 remote folder 1 + files 3이 모두 등록됐고, 테스트 파일/폴더 삭제도 remote match 0으로 반영됐다. 테스트 자료는 로컬과 NAS에서 모두 정리됐다.
- self-test에 신규 local file/동일 remote/변경 local 판정을 추가했고 source/packaged Agent self-test와 Setup self-test를 통과했다. Agent SHA-256은 `3F3326DD04C872DAD29437341509A82E6FD22C319259FA83FEE098A4D5BA4B08`, Setup/launcher SHA-256은 `C5FF7109F65332DBE8D7B577E0E9AB6343584981C453F4EFC9CF269C259410B7`다.
- Tailscale SSH가 복구된 뒤 branch `cleanup/git-tracking-2026-06-08`와 기존 dirty worktree를 다시 확인하고 1.10.10 source/dist/nasRoutes/relay를 NAS에 배포했다. source Agent self-test, backend node tests 2/2, node check, diff check를 통과했다. PM2 restart/save 후 `msp-backend` online, ssh/tailscaled/nginx/docker/pm2-root/cloudflared 모두 enabled+active, 내부 3030·공개 HTTPS 200을 확인했다. 서버 dist hash도 위 Agent/Setup hash와 일치하며 공개 update version은 1.10.10이다.
- 회귀 금지: 다중 이벤트를 단일 마지막 path로 축약하지 않는다. watcher 작업과 periodic pull을 같은 root에서 병렬 실행하지 않는다. periodic local audit를 제거하지 않으며 서버 manifest 확인 전 `up-to-date`를 표시하지 않는다.
- 검증: Agent/Setup self-test, backend tests 8/8, node/diff check, PM2 restart/save online, 내부·공개 HTTP 200.

절대 회귀 규칙: token 파일이 존재하는 일시 DPAPI read 실패를 profile 삭제나 인증 만료로 취급하지 않는다. 재로그인을 강제하거나 기존 DPAPI 파일을 지우지 말고 bounded credential retry 후 별도 진단한다. token 원문과 복호화된 값은 어떤 로그·오류창·릴레이에도 기록하지 않는다.

## 2026-08-30 완료: NAS Drive 1.10.11 파일별 저장 상태 의미 분리

- 사용자에게 `동기화 완료`가 곧 `이 PC에 다운로드됨`처럼 보이지 않도록 계정 전체 상태와 파일별 로컬 보관 상태를 분리했다. 트레이·상태 창의 정상 문구는 `모든 파일이 최신 상태`가 아니라 `NAS와 동기화됨`이다.
- 파일별 실제 상태는 Windows CFAPI 표준을 계속 사용한다. 파란 구름은 `온라인 전용`으로 NAS에만 원본이 있고 열 때 hydration한다. 초록 체크는 현재 PC에서 사용 가능, 진한 초록 체크는 `이 장치에 항상 유지`다. 우클릭 `공간 확보`는 로컬 내용만 dehydrate하며 서버 원본을 삭제하지 않는다.
- Provider 1.4.2의 Explorer 상태 열 적용 범위를 NAS Drive 루트 하나에서 그 아래 열린 모든 하위 폴더 창으로 확장했다. 문자열 prefix가 비슷한 형제 경로에는 적용하지 않으며 self-test로 경계를 검증한다.
- 연결된 Provider의 current-user named pipe에 `configure-view`를 추가했다. Agent는 15초 간격으로 현재 열린 NAS Drive 보기를 갱신하되 별도 helper 권한이나 전역 Explorer Bags/BagMRU 초기화를 사용하지 않는다.
- 네이티브 상태 창에는 `온라인 전용 / 이 PC에서 사용 가능 / 항상 유지` 설명을 상시 표시한다. 웹이나 다른 장치에서 새로 생긴 파일은 기존대로 allocation 0 placeholder로 시작하고, 사용자가 열거나 고정한 경우에만 로컬 내용을 내려받는다.

절대 회귀 규칙: 계정 전체 `NAS와 동기화됨`과 파일별 로컬 다운로드 여부를 같은 의미로 표시하지 않는다. `온라인 전용`을 오류·보류로 취급하지 않는다. 상태 열 보정은 현재 사용자의 해당 NAS Drive 루트와 하위 Explorer 창에만 적용하며 Windows 전체 보기 설정을 삭제하지 않는다. `공간 확보`나 온라인 전용 전환으로 NAS 서버 원본을 삭제하지 않는다.

## 2026-08-30 요청·진행 릴레이 및 Git 기록 의무화

- 사용자 요청: 진행 중이던 작업을 중단하고 지금까지의 작업을 모두 기록해 GitHub에 업로드한다. 앞으로 모든 GPT 요청 내용과 실제 진행 내용을 릴레이와 Git에 함께 남긴다.
- 보안 처리: 과거 대화에 포함된 계정 비밀번호, DPAPI Agent token, pairing/handoff token, 개인 키와 세션 URL은 릴레이·Excel·Git에 기록하지 않는다. 요청 원문은 의미가 유지되는 비밀 제거 요약으로 남긴다.
- 이번 완료 범위: Agent/Setup/launcher 1.10.11과 Provider 1.4.2를 NAS와 현재 PC에 반영했다. 전역 문구를 `NAS와 동기화됨`으로 분리하고 상태 창에 온라인 전용·이 PC에서 사용 가능·항상 유지 의미를 표시했다. Explorer 상태 열을 정확한 root와 하위 창에 current-user pipe로 갱신한다.
- 실제 검증: 서버에만 임시 파일을 생성해 Windows placeholder 생성, 열기 hydration, pin, 공간 확보 dehydration, 재열기, 서버 삭제의 로컬 반영을 순서대로 확인했다. 테스트 자료는 사용자 루트에서 제거됐고 Agent health는 `up-to-date`로 복귀했다. 현재 PC 계정 설정 해시는 업데이트 전후 동일하며 HKCU 시작 프로그램과 launcher/Agent/Provider가 유지된다.
- NAS 검증: Agent/Setup/Provider self-test, backend tests 8/8, node/diff check, PM2 restart/save, 내부 3030·공개 HTTPS 200, 필수 systemd 6개 enabled+active를 확인했다. Cloudflare/DNS/nginx/OnlyOffice/HWP 설정은 변경하지 않았다.
- 프로젝트 메모리: `Patch_Log`, `Request_Archive`, `Do_Not_Break`, `Feature_Index`, `Relation_Map`, `Code_Map`에 1.10.11 작업과 재발 방지 규칙을 기록했고 수식 오류 0 및 한글 렌더를 재검수했다.
- 앞으로의 규칙: 매 요청마다 이 문서에 날짜, 요청 요지, 진행 내용, 검증, 미완료 항목, 다음 안전 조치를 누적한다. 구현·수정·설정 작업은 Excel 관련 시트도 함께 갱신한다. 매 요청 종료 시 사용자가 명시적으로 금지하지 않는 한 활성 브랜치에 커밋·푸시하며, 코드 변경이 없으면 릴레이 전용 커밋을 만든다. 코드/워크북 변경이 있으면 관련 기록을 같은 커밋에 포함한다. 중단된 작업도 완료로 과장하지 않고 정확한 중단 경계를 기록·푸시한다.

## 2026-08-30 Git 전체 커밋 여부 재확인

- 사용자 요청: 앞서 말한 변경이 일부가 아니라 전체 커밋된 것이 맞는지 확인해 달라.
- 확인 결과: NAS 작업 트리는 변경·미추적 파일이 없는 clean 상태이며 현재 HEAD와 GitHub 원격 `cleanup/git-tracking-2026-06-08`가 `db3c165f39fa292d279057f59b7b597830a6596c`로 일치했다.
- 전체 작업 커밋 `8eb6534`에는 당시 작업 트리의 수정·신규 파일 49개, 10,039 insertions, 727 deletions가 포함됐다. 후속 기록 의무화는 `db3c165`에 포함됐다.
- 남은 항목: 로컬 PC의 빌드용 임시 폴더·렌더 이미지·도구 캐시는 NAS 서비스 저장소 바깥의 작업 산출물이므로 Git 커밋 대상이 아니다. 실제 프로젝트 코드, 배포 바이너리, 테스트, 문서, 릴레이, 프로젝트 Excel은 커밋됐다.

## 2026-08-30 다른 PC ChatGPT/Codex용 Tailscale 인수인계

- 사용자 요청: 다른 컴퓨터의 ChatGPT 앱이 현재 노트북과 NAS의 Tailscale 연결 구조를 즉시 이해하고 프로젝트를 이어갈 수 있도록 릴레이와 별도 문서를 만들고 Git에 올린다.
- 확인된 구조: 현재 Windows 노트북 `limchanyoung`은 Tailscale `100.72.86.10`, Debian NAS `chanyoung`은 `100.80.39.112`다. NAS SSH 사용자는 `limchanyoung`, alias는 `nas`, live 경로는 `/home/limchanyoung/my-service-platform`이다.
- 보안 경계: 문서를 읽는 것만으로 새 PC가 접속 권한을 얻지는 않는다. 새 PC는 같은 Tailnet에 로그인하고 새 PC 전용 SSH 공개키를 NAS에 등록해야 한다. Tailscale auth key, SSH 개인키, 비밀번호, Agent token은 문서·Git·Excel에 기록하지 않는다.
- 새 문서: `docs/AI_MUST_READ_OTHER_PC_TAILSCALE_HANDOFF.md`에 초기 설정, ChatGPT/Codex 시작 프롬프트, 작업 순서, 금지사항, 상태 점검, 장애 분류를 기록했다. 사용자가 직접 받을 수 있도록 Windows 작업 폴더에도 같은 이름의 문서를 유지한다.
- 다음 단계: 이 문서와 릴레이를 먼저 별도 Git 커밋으로 푸시한 뒤, NAS Drive 1.10.11 파일별 상태 표시 작업의 중단 지점을 다시 감사하고 남은 결함을 별도 커밋으로 처리한다.

## 2026-08-30 완료: NAS Drive 1.10.12 오래된 다른 경로 Agent 오인 방지

- 중단 작업 재감사에서 설치 버전 1.10.11, HKCU Run, health 파일은 정상처럼 보였지만 실제 프로세스는 native launcher 하나뿐이고 설치 Agent/Provider가 사라진 상태를 발견했다. 수동으로 정확한 설치 Agent를 시작하면 즉시 Agent/Provider와 동기화가 복구됐다.
- native tray의 `EnsureAgentRunning`은 `Process.GetProcessesByName("NAS-Sync-Agent")` 결과 중 하나라도 살아 있으면 실행 경로를 확인하지 않고 정상으로 간주했다. 과거 다운로드·이전 설치 폴더에 같은 이름의 EXE가 남거나 실행 중이면 정식 `%LOCALAPPDATA%\Programs\NAS Drive\NAS-Sync-Agent.exe`가 없어도 복구를 생략할 수 있었다.
- Setup/launcher/Agent 1.10.12는 Agent 프로세스의 `MainModule.FileName`을 정식 설치 경로와 full-path·대소문자 무시 비교한다. 이름만 같은 다른 경로 프로세스는 건드리거나 종료하지 않고 무시하며, 정식 설치 Agent를 별도로 시작한다. self-test에 동일 경로 허용·다른 경로 거부 회귀 검사를 추가했다.
- 실제 PC 보존 업데이트에서 account config SHA-256을 유지한 채 Agent/launcher를 1.10.12로 교체했다. 다른 임시 폴더의 더미 `NAS-Sync-Agent.exe`를 실행하고 정식 Agent/Provider를 강제 종료한 뒤에도 14초 안에 정식 설치 Agent와 Provider가 자동 복구됐고 health가 `up-to-date`로 돌아왔다. 더미는 시험 후 종료했다.
- 배포 hash: Agent `8FA9593B33A639BE63727CE9721C3E8E730682A60F952441299D4B99F2AB254A`, Setup/launcher `F08FE26B547C92CDE7197D0386F169DA8F82CC191026702E9DACD83168625F0C`, Provider 1.4.2 `417B13A3EDE23BD07CCF76BFA46A58E05A698198AB742442E45E917C966DEAC5`.
- 검증: source/packaged Agent self-test, Setup self-test, backend tests 8/8, node/diff check 통과. NAS PM2 restart/save 후 online, 내부 3030·공개 HTTPS 200. 현재 PC launcher/Agent/Provider 3개, 시작 프로그램, 계정/동기화 루트 보존, health `up-to-date`를 확인했다.

절대 회귀 규칙: Agent supervisor는 프로세스 이름만으로 정상 설치본을 판단하지 않는다. 정식 설치 경로의 실행 파일만 정상 Agent로 인정한다. 다른 경로의 동명 프로세스를 자동 종료하거나 사용자 파일로 오인하지 말고, 정식 Agent를 독립적으로 복구한다. health 파일이 `up-to-date`여도 updatedAt이 오래됐으면 실제 Agent/Provider 프로세스와 heartbeat를 함께 확인한다.

## 2026-08-30 새 PC 자동 구성용 ChatGPT/Codex 시작 프롬프트

- 사용자 요청: 다른 ChatGPT/Codex에 붙여 넣으면 Tailscale 설치부터 SSH와 프로젝트 메모리 확인까지 최대한 스스로 처리하는 프롬프트를 제공한다.
- 문서 갱신: `docs/AI_MUST_READ_OTHER_PC_TAILSCALE_HANDOFF.md` 9절에 winget 설치 확인, Tailscale 공식 설치·로그인, NAS ping, OpenSSH/Git 설치, 장치별 ed25519 키, 안전한 SSH config 병합, host fingerprint, NAS 프로젝트/메모리/서비스 검증, 릴레이·Git 기록 순서를 포함한 복사용 프롬프트를 추가했다.
- 사용자 개입 경계: Windows UAC, Tailscale 웹 로그인, 새 SSH 공개키 최초 등록, host fingerprint 승인은 보안상 사용자가 확인한다. 프롬프트는 이를 우회하거나 비밀값을 요구하지 않고 필요한 순간 한 번만 명확히 요청한 뒤 계속 진행한다.
- 회귀 금지: Tailscale auth key나 SSH 개인키를 프롬프트·Git·릴레이에 넣어 무인 설치를 가장하지 않는다. 공개 사이트 200을 Tailscale/SSH 성공으로 간주하지 않고 각각 실제 명령으로 확인한다.

## 2026-08-30 새 PC GPT의 Git 필독 문서 자동 인식 조건 확인

- 사용자 질문: 새 PC의 GPT가 GitHub에 올라간 내용을 알아서 확인하고 작업하는 구조인지 확인했다.
- 답변/조건: 시작 프롬프트를 새 GPT 대화에 붙여 넣고, 해당 GPT가 터미널·GitHub/SSH 접근 권한을 가진 Codex 작업 환경이면 저장소를 clone 또는 NAS SSH로 연 뒤 AGENTS.md의 필독 순서에 따라 릴레이·Tailscale handoff·Excel을 읽는다.
- 한계: 일반 채팅만 가능한 GPT는 로컬 프로그램 설치, Git clone, SSH 실행을 직접 할 수 없다. 또한 private GitHub 저장소 인증과 Tailscale 로그인/UAC/SSH 공개키 최초 등록은 새 PC 또는 사용자의 승인이 필요하다.
- 안전 원칙: Git 문서는 연결 정보를 설명하지만 Git 접근 권한·Tailnet 가입·SSH 권한을 자동 부여하지 않는다. 권한이 갖춰진 뒤에는 프롬프트가 설치·검증·메모리 확인 순서를 자동으로 이어가게 한다.

## 2026-08-30 새 Windows PC NAS 개발 환경 연결

- 사용자 요청: 새 Windows PC에서 Tailscale 설치, NAS SSH 연결, 프로젝트 메모리 확인과 서비스 검증까지 진행해 이 대화에서 NAS 개발을 이어갈 수 있게 구성한다.
- 로컬 준비: Windows 11에서 Git과 OpenSSH Client를 확인하고 Tailscale 1.102.3을 공식 winget 패키지로 설치했다. 사용자가 Tailscale 계정 로그인을 완료했으며 새 장치 `chan`의 Tailscale IP는 `100.88.246.29`다.
- 네트워크 검증: NAS `chanyoung`(`100.80.39.112`)에 Tailscale ping 2ms와 TCP 22 연결 성공을 확인했다. 공개 `https://filemanager-nas.com`도 HTTP 200이다.
- SSH 구성: 이 PC 전용 ed25519 키와 `%USERPROFILE%/.ssh/config`의 `nas` alias를 구성하고 NAS `authorized_keys`에 공개키만 등록했다. 최초 키 생성 인수 오류로 서명이 거부된 중간 상태는 기존 키 전용 drop-in을 즉시 롤백해 복구했고, 실제 서명이 검증된 키의 로컬 암호를 정상화한 뒤 `limchanyoung`에만 `AuthenticationMethods publickey`를 적용했다. 비밀번호는 Windows 일회 입력창에서 SSH 프로세스에만 전달했으며 파일·로그·Git에 저장하지 않았다.
- NAS 실제 검증: `whoami=limchanyoung`, `hostname=chanyoung`, 브랜치 `cleanup/git-tracking-2026-06-08`, clean worktree를 확인했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 enabled+active, `msp-backend`는 online, 내부 `127.0.0.1:3030`은 HTTP 200이었다.
- 프로젝트 메모리: `AGENTS.md`, 이 릴레이, 다른 PC Tailscale handoff, 메모리 정책과 workbook의 `README`, `Memory_Process`, `Do_Not_Break`, `Feature_Index`, `Relation_Map`, `Network_Config`를 확인했다. Cloudflare/DNS/nginx/OnlyOffice/HWP 설정은 변경하지 않았다.
- 최종 SSH 검증: 새 프로세스에서 `ssh -o BatchMode=yes nas`가 비밀번호 없이 성공했다. 해당 사용자에 대한 유효 정책은 `pubkeyauthentication yes`, `passwordauthentication no`, `kbdinteractiveauthentication no`, `authenticationmethods publickey`다. 실제 코드 변경 요청은 NAS worktree 상태를 다시 확인한 뒤 진행한다.

## 2026-08-30 프로젝트 전체 구성 파악 및 수정 요청 라우팅 준비

- 사용자 요청: 이후 수정 요청의 요점을 즉시 파악할 수 있도록 현재 NAS 프로젝트의 전체 구성을 미리 이해하고 정리한다.
- 확인 범위: 실제 PM2 실행 진입점과 패키지 manifest, backend API·Socket.IO·보안 모듈, React 진입점·Context·핵심 화면, Windows Agent·native installer/launcher·CFAPI Provider, 프로젝트 workbook의 `Feature_Index`, `Relation_Map`, `Code_Map`, `API_Routes`, `Socket_Events`, `Data_Files`, `Network_Config`, `Office_Viewers`를 교차 확인했다.
- 현재 구조: `backend/index.js`가 Express/HTTP/Socket.IO와 서비스 라우터를 결합하고, `backend/nasRoutes.js`가 파일·검색·업로드·버전·휴지통·장치 동기화의 중심이다. frontend는 `App.js`와 Window/Transfer/Chat/Meeting Context를 중심으로 구성되며, Windows 측은 `windows-node/index.js` Agent, `windows-installer/Program.cs` installer/launcher, `windows-cfapi/Program.cs` placeholder·hydration Provider로 분리된다.
- 배포·보안 경계: PM2 live cwd는 `/home/limchanyoung/my-service-platform/backend`다. frontend 변경은 build와 `/var/www/html` 배포 및 bundle hash 검증이 필요하다. 사용자 root 밖 접근과 `.nas_trash`, `.agent_versions`, `.agent_incoming` 노출을 금지하며, token·개인키·비밀번호는 기록하지 않는다.
- 향후 라우팅: 웹 파일 기능은 `nasRoutes.js`와 NAS/FileViewer/Transfer Context부터, 로그인·권한은 `index.js`와 보안 모듈부터, 채팅·회의는 해당 router/Context부터, Windows 동기화는 Agent와 device API부터, Explorer 상태·온라인 전용은 CFAPI Provider부터, 설치·자동복구는 installer/launcher부터 추적한다. 관련 workbook 행과 회귀 규칙을 함께 확인한 뒤 최소 범위로 수정한다.
- 미완료·주의 항목: Explorer 웹 바로가기의 사용자 클릭 의존, Authenticode/SmartScreen, 숨은 PowerShell tray helper의 완전 native 대체, 다중 PC 충돌, 대용량 전송 장애·재개, 규모 진단과 DR E2E는 아직 별도 검증·완료가 필요하다. 과거 patch/fix 스크립트는 현재 진입점으로 오인하지 않는다.
- 로컬 작업 메모리: 새 PC의 Git 저장소 밖 `outputs/NAS_PROJECT_ARCHITECTURE_MEMORY.md`에 구성도, 요청 유형별 최초 확인 파일, 데이터 경계, 회귀 규칙과 기본 작업 절차를 정리했다. 이번 요청은 코드·설정·workbook을 변경하지 않은 구조 감사이므로 이 릴레이만 Git에 기록한다.

## 2026-08-30 진단: Windows NAS Drive 연결 중 고착 및 종료 후 실행 중 오인

- 사용자 보고: 알림 영역의 NAS Drive 창이 간헐적으로 `계정 연결 중`에 고착되고, 웹 PC 연동 또는 설치 파일 실행 시 이미 실행 중이라는 안내가 반복된다. 트레이 메뉴에서 종료해도 같은 안내가 남으며 재부팅 없이 복구되어야 한다. 요청에 따라 이번에는 수정하지 않고 원인만 조사했다.
- 실제 PC 확인: 정식 설치 경로의 native launcher, Node Agent, CFAPI Provider 세 프로세스가 launcher→Agent→Provider 관계로 실행 중이었다. 로컬 health는 `needs-relink`이고 최근 오류는 HTTP 403 `Agent 인증 실패`였다. 로컬 설정에는 두 계정 profile이 남아 있으나 서버의 해당 두 장치 레코드는 모두 revoked이며 token hash가 제거되어 있어 현재 token으로는 재연결될 수 없다.
- 주원인: 폐기된 profile을 로컬 구성에서 격리하거나 유효한 재연동으로 교체하지 않은 채 background Agent가 계속 재시도한다. 시작 시 health를 먼저 `connecting`으로 기록한 뒤 403을 받는 흐름 때문에 사용자에게 연결 시도처럼 보이지만 인증상 성공 가능성이 없는 상태다.
- 종료 결함: native tray의 `NAS Drive 종료`는 `agent.exit` 파일을 쓰고 tray UI만 즉시 종료한다. Agent와 Provider를 직접 종료하거나 종료 완료를 기다리지 않는다. Agent는 최대 약 3초 뒤 exit 파일을 보고 종료하지만 그 경로에는 Provider 정리 보장이 없어, 트레이 아이콘이 사라진 뒤에도 자식 구성요소가 남아 `실행 중` 판정과 충돌할 수 있다.
- 단일 인스턴스 결함: foreground lock은 `foreground.pid`의 PID가 살아 있는지만 확인하고 그 PID가 실제 NAS Agent인지 실행 경로를 검증하지 않는다. 현재도 종료된 PID를 담은 stale lock 파일이 남아 있었다. 다음 실행에서 죽은 PID면 정리되지만 Windows가 같은 PID를 다른 프로세스에 재사용하면 설정창이 없는데도 `이미 열려 있습니다`로 오인할 수 있다. installer mutex, native control-center mutex, Agent PID lock이 서로 다른 방식으로 분리되어 웹 protocol 요청을 기존 인스턴스에 전달하는 통합 IPC도 없다.
- 구분해야 할 메시지: 설치기 mutex의 `NAS Drive 설치 창이 이미 열려 있습니다`, native UI mutex의 `NAS Drive 창이 이미 열려 있습니다`, Agent foreground lock의 `NAS Drive 설정 창이 이미 열려 있습니다`는 서로 다른 잠금이다. 현재 구현은 이 상태들을 사용자에게 하나의 실제 실행 상태처럼 일관되게 설명하거나 자동 복구하지 않는다.
- 다음 안전 조치: 수정 요청이 오면 revoked profile 복구 흐름, 경로 검증된 단일 인스턴스/IPC, tray 종료 시 launcher·Agent·Provider의 bounded graceful shutdown 및 잔존 프로세스 정리, stale lock 회수, 웹 protocol 재연동 E2E를 하나의 수명주기 수정으로 다뤄야 한다. 재부팅을 복구 절차로 요구하지 않으며 계정 설정·DPAPI token 원문·로컬 파일은 보존한다.
- 검증 경계: 이번 요청에서는 프로세스 종료, 재로그인, 재설치, token 삭제, 코드·설정·workbook 변경을 수행하지 않았다. 진단용 읽기와 이 릴레이 기록만 수행했다.

## 2026-08-30 요구사항 확정: 계정 삭제·오류 상황의 무재부팅 안전 복구

- 사용자 요구: 사용자가 계정을 삭제하거나 인증·연결 오류가 발생하더라도 NAS Drive가 고착·오인·무한 연결 상태에 빠지지 않고, 어떠한 일반 장애 상황에서도 일관되게 처리되어야 한다. 오류 복구를 위해 Windows를 재부팅하게 해서는 안 된다.
- 구현 원칙: 계정/장치 revoked·삭제·token 불일치는 정상적인 수명주기 사건으로 분류해 해당 profile만 `needs-relink` 또는 안전한 연결 해제 상태로 전환한다. 다른 정상 profile과 로컬 파일은 보존하며, 성공 가능성이 없는 인증 재시도와 `connecting` 표시를 무한 반복하지 않는다.
- 종료 원칙: 사용자 종료 요청은 launcher·Agent·Provider 전체에 전달하고 bounded graceful shutdown을 기다린 뒤 잔존하는 정식 설치 경로 프로세스만 안전하게 정리한다. stale lock/PID는 실행 경로·프로세스 생성 정보까지 검증해 회수하고, 다른 프로그램이나 다른 경로의 동명 프로세스는 종료하지 않는다.
- 복구 원칙: 웹 protocol, native 로그인, 설치/복구 실행은 하나의 instance coordinator/IPC로 직렬화하고 기존 인스턴스에 요청을 전달한다. 중복 실행이면 막연히 `이미 실행 중`이라고 끝내지 않고 기존 작업 표시, 포커스, 재시도 또는 안전한 stale-state 복구 중 하나로 결정한다.
- 검증 기준: 계정 정상 삭제, 서버측 강제 revoke, token 불일치, 서버/네트워크 중단, tray 종료 직후 재실행, Agent/Provider 강제 종료, stale PID와 PID 재사용, 웹 연동 연속 클릭, installer 동시 실행, 다중 계정 중 한 계정만 폐기된 경우를 E2E 장애 주입으로 검증한다. 모든 경우 재부팅 없이 정상·로그인 필요·오프라인 중 하나의 명확한 상태로 수렴해야 한다.
- 현재 경계: 이번 응답은 이 요구사항과 수용 기준을 확정한 것이며 아직 코드·설정·workbook을 변경하지 않았다. 사용자가 구현 진행을 요청하면 앞선 진단을 기반으로 수명주기 전반을 하나의 수정 단위로 처리한다.

## 2026-08-30 구현: 연결 중 로그아웃·PC 연동 진행·연결 PC 상태 분리

- 사용자 요청: `계정 연결 중` 상태에서도 로그아웃하여 기존 관계를 완전히 끊거나 즉시 다시 연결할 수 있게 한다. 웹 메인 플랫폼의 PC 연동 버튼에는 실제 연동 진행 상태를 확실히 표시하고, 연결된 PC 관리에서는 현재 PC 접속 여부를 명확히 보여준다.
- Agent/launcher 1.10.13: `--open`은 health가 `needs-relink`여도 저장된 profile이 있으면 native control center를 열어 `연결 해제 후 다시 로그인` 버튼에 접근시킨다. 로그아웃은 서버 revoke를 먼저 시도하지만 token이 이미 폐기됐거나 서버가 오프라인이어도 로컬 profile, 계정별 DPAPI credential, personal-drive Provider 등록과 shell metadata를 정리하고 로그인창으로 전환한다. 다른 profile과 사용자 파일은 보존한다.
- pairing 상태: Agent가 유효한 연동 URL을 실제 조회하면 서버 pairing을 `pending`에서 `agent-detected`로 바꾸고 감지 시각을 기록한다. status API는 만료도 `expired`로 명시한다. frontend는 이 상태를 받아 `PC 연동 중`으로 전환한다.
- 웹 UI: PC 연동 dialog를 닫아도 최대 5분 동안 상태 polling을 유지한다. desktop/side 아이콘은 연동 준비, 프로그램 실행 대기, 설치·연동 대기, PC 연동 요청, PC 연동 중을 문구와 pulse dot으로 표시한다. 연결된 PC 관리에서는 heartbeat 기반 `현재 PC 연결됨/현재 연결 끊김/연결 해제됨`과 파일 `연결 중/동기화 중/최신/오류/중지`를 별도 badge로 표시한다.
- 빌드·검증: Agent source self-test, 새 packaged Agent self-test, Setup self-test, Node syntax, C# compile, frontend production build를 통과했다. 로컬 backend 테스트는 desktop handoff 2개와 file trash/version, Office access, password, quota 테스트가 통과했다. `deviceSyncSecurity`의 symlink test는 Windows 개발자 권한 부재로 EPERM이어서 NAS에서 재검증한다. workbook의 `Request_Archive`, `Patch_Log`, `Do_Not_Break`, `Feature_Index`, `Relation_Map`, `Code_Map`을 기존 형식으로 갱신하고 수식 오류 0·관련 시트 렌더를 확인했다.
- 배포 경계: 이 기록 시점에는 source와 Agent/Setup binary 빌드가 완료됐고 실제 NAS pull, backend restart, frontend `/var/www/html` 반영, 현재 Windows PC 보존 업데이트와 재부팅 없는 로그아웃·재연결 E2E가 남아 있다. 완료로 과장하지 않으며 다음 단계에서 NAS clean 확인 후 배포한다.
- 회귀 금지: pairing session, PC heartbeat connection, file sync state를 다시 하나의 모호한 `연결 중`으로 합치지 않는다. 서버 응답 실패를 이유로 로컬 로그아웃을 막지 않으며, 로그아웃 과정에서 다른 계정·사용자 파일·다른 경로의 동명 프로세스를 삭제하거나 종료하지 않는다.

## 2026-08-30 확인: 작업 화면의 대규모 줄 삭제 표시

- 사용자 질문: 작업 화면에 약 20,000줄이 제거된 것처럼 보이는 이유와 프로젝트 손상 여부를 확인해 달라.
- 확인 결과: 기능 커밋 `0d319dd`의 실제 text 변경은 91 insertions, 35 deletions이며 삭제된 프로젝트 파일은 없다. binary 2개와 workbook 1개는 교체된 산출물이라 Git numstat가 줄 수를 표시하지 않는다.
- 표시 원인: 로컬 검증 중 pnpm이 새로 만든 미추적 `pnpm-lock.yaml`/workspace 보조 파일과 artifact-tool이 만든 약 2MB의 미추적 inspect 결과를 저장소에 남기지 않기 위해 제거했다. 기존 Git 추적 파일을 삭제한 것이 아니며 해당 임시 파일은 커밋·push되지 않았다.
- 안전 경계: 사용자 우려를 확인하는 동안 현재 Windows PC의 1.10.13 보존 업데이트는 시작하지 않고 중단했다. NAS source/backend/frontend 배포와 HTTP 200 검증까지 완료된 상태이며, 로컬 PC 설치본 교체·로그아웃 E2E는 사용자 확인 후 이어간다.

## 2026-08-30 구현 계속: 트레이 완전 종료·stale foreground 잠금 복구·현재 PC 1.10.14

- 사용자 요청: 대규모 삭제가 아니라는 확인 후 중단했던 NAS Drive 수명주기 작업을 계속한다. 트레이에서 종료했는데도 Agent/Provider가 남거나 다음 실행이 `이미 실행 중`으로 막히는 경우까지 재부팅 없이 처리한다.
- 종료 보강: native tray의 `NAS Drive 종료`와 새 숨김 `--shutdown-background` 명령이 같은 종료 루틴을 사용한다. `agent.exit`을 보낸 뒤 최대 5초 기다리고, 남은 정식 설치 경로의 launcher·Agent·Provider만 종료한다. `agent.pid`와 exit marker는 정리하지만 account config, 계정별 CurrentUser DPAPI credential, 개인 Drive 및 사용자 파일은 삭제하지 않는다. 다른 경로의 동명 프로세스도 건드리지 않는다.
- 잠금 보강: Agent `foreground.pid`는 PID 생존만 보지 않고 해당 PID의 실행 파일이 현재 Agent 실행 파일과 정확히 같은지도 확인한다. Windows PID가 다른 프로그램에 재사용됐거나 stale 파일만 남은 경우 잠금을 회수해 설정·로그인 흐름을 다시 열 수 있다.
- 버전·현재 PC: Agent/Setup/launcher와 공개 update metadata를 1.10.14로 올렸다. 현재 PC는 설정 SHA-256 `A9EF3F15406401F377D4B1FEF310E067184808B3263F14288E0CA8A0B5B9A4B3`을 전후 동일하게 보존한 채 업데이트했다. Agent hash는 `6243338F3E11D816E247DB02725F9F7B4DCAF32899DCF7D98D36C77141FD1B18`, Setup/launcher hash는 `92BD9326F7B3B99A1C5908DBF8BBB283DDC409CE0DF6249C6DA399618D0BE5D5`다.
- 실제 종료/재시작 검증: 설치 launcher의 `--shutdown-background`가 exit code 0으로 끝난 뒤 정식 설치 launcher·Agent·Provider 잔여가 0이고 `agent.exit`·`agent.pid`가 제거됐으며 설정 hash가 유지됨을 확인했다. 이어 `--background`를 실행해 launcher·Agent·Provider 3개가 다시 시작됐다. 현재 profile은 서버에서 이미 revoked되어 health가 정상적으로 `needs-relink`로 수렴한다.
- 자동 검증: Agent source/packaged self-test, Node syntax, C# compile, Setup self-test를 통과했다. Windows 로컬 backend suite는 symlink 생성 권한이 필요한 `deviceSyncSecurity` 1개만 EPERM이고 나머지 7개가 통과했으며 NAS에서 다시 검증한다. workbook의 관련 6개 시트를 갱신하고 formula error 0, 렌더 확인, 의도된 과거 `??` 사고 기록 외 한글 손상 없음도 확인했다.
- 남은 단계: 이 1.10.14 변경을 GitHub에 push하고 NAS에서 pull한 뒤 backend 테스트, PM2 restart/save, 내부·공개 HTTP, 필수 서비스를 검증한다. 실제 profile 로그아웃은 로컬 연결과 DPAPI credential을 제거하는 사용자 의도 확인이 필요한 동작이므로 별도 확인 전에는 실행하지 않는다.

### 1.10.14 GitHub·NAS 배포 검증

- GitHub commit `1d2b591`로 source, Agent/Setup binary, 공개 update version, workbook, relay를 push했다. NAS live worktree가 이 commit으로 fast-forward했고 clean 상태다.
- NAS에서 Agent source self-test와 backend tests 8/8을 통과했다. Windows에서 권한 때문에 EPERM이었던 symlink 경계 보안 테스트도 NAS에서는 정상 통과했다.
- `msp-backend`를 restart/save한 뒤 online을 확인했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이고 내부 `http://127.0.0.1:3030`과 공개 `https://filemanager-nas.com`은 HTTP 200이다.
- NAS 배포 binary hash는 현재 PC 설치본과 일치한다: Agent `6243338F3E11D816E247DB02725F9F7B4DCAF32899DCF7D98D36C77141FD1B18`, Setup/launcher `92BD9326F7B3B99A1C5908DBF8BBB283DDC409CE0DF6249C6DA399618D0BE5D5`.
- 완료 경계: 종료·재시작·stale lock 복구와 서버 배포는 검증됐다. 현재 활성 로컬 profile은 이미 서버에서 revoked되어 `needs-relink`가 정상이다. 실제 `연결 해제 후 다시 로그인` 실행은 해당 profile과 DPAPI credential을 제거하므로 사용자에게 대상 동작을 다시 알리고 확인을 받은 뒤 진행한다.

## 2026-08-30 상태 일관성 교정: PC 앱과 NAS 웹 PC 연동 상태

- 사용자 질문/교정: PC에 설치된 NAS Drive가 표시하는 상태와 NAS 서버의 PC 연동 상태는 항상 같아야 하는 것 아닌지 확인했다.
- 확인 결과: 같은 실제 관계를 가리켜야 한다는 요구는 맞지만 현재 1.10.14가 매 순간 동일 상태를 보장한다고 말할 수는 없다. 로컬 앱은 `agent-health.json`을 즉시 읽고 인증 403을 `needs-relink`로 바꾸며, 서버는 Agent heartbeat의 `lastSeenAt`과 `syncState`를 저장한다. 웹은 9초 heartbeat timeout과 15초 API polling을 사용하므로 정상 전이에도 짧은 시간차가 있다.
- 네트워크 경계: NAS/네트워크가 끊긴 상태에서 사용자가 로컬 관계를 해제하면 서버는 그 사건을 즉시 받을 수 없다. 따라서 물리적으로 항상 동시 갱신은 불가능하지만, 웹이 오래된 상태를 `연결됨`으로 단정하지 않고 마지막 확인 시각·오프라인·로컬 해제 미반영을 명확히 구분하고 재연결 시 수렴시켜야 한다.
- 상태 축: 계정 관계(`linked/revoked/needs-relink`), PC 접속(`online/offline`), 파일 동기화(`connecting/syncing/up-to-date/error/paused`), 신규 pairing(`pending/agent-detected/connected/expired`)은 서로 다른 축이다. 양쪽에서 같은 축의 의미는 일치해야 하지만 이 네 축을 한 문구로 합치면 안 된다.
- 미완료: 서버 권위의 관계 상태와 로컬 상태를 공통 revision/event로 조정하고, 웹의 polling 지연과 오프라인 로컬 로그아웃 pending reconciliation을 표시·수렴시키는 E2E는 아직 구현되지 않았다. 이 보강 전에는 “양쪽 상태가 항상 같다”고 완료 보고하지 않는다.

## 2026-08-30 검토: Explorer 왼쪽 NAS Drive 온라인·오프라인 표시

- 사용자 질문: Windows 파일 탐색기 왼쪽 탐색창의 NAS 저장소 항목에서도 현재 사용 가능한 온라인 상태인지, NAS/연결 경로 오프라인이나 계정 연결 불일치인지 아이콘과 마우스 hover 이유로 표현할 수 있는지 물었다. 이번 요청은 가능성 검토이며 코드는 변경하지 않는다.
- 확인 결과: Cloud Files sync root 등록은 Explorer 탐색창에 custom name/icon을 제공하고 현재 Provider도 `StorageProviderSyncRootInfo.IconResource`, root `desktop.ini` icon/InfoTip, `SHChangeNotify`를 사용한다. 따라서 온라인·연결 중·오프라인·인증 필요에 따라 별도 branded icon/badge를 선택하고 shell refresh를 요청하는 방식은 구현 가능하다.
- 정식 상세 UI: 최신 Windows 11의 `StorageProviderStatusUI`/`IStorageProviderStatusUISource`는 `InSync`, `Offline`, `Error`, `Warning`, `Syncing`, `Paused` 상태와 ProviderStateIcon/Label, MoreInfo UI·복구 command를 Explorer command bar/flyout에 제공한다. 상세 이유와 로그인/재시도 동작은 이 표면이 탐색창 hover보다 안정적이다. 현재 unpackaged Provider 구조에서 COM/manifest/MSIX 요구와 실제 Windows build 동작은 별도 prototype E2E가 필요하다.
- 한계: 탐색창 항목의 동적 hover 문구는 Microsoft가 보장하는 전용 provider status surface가 아니고 Explorer icon/InfoTip cache로 갱신이 늦거나 표시되지 않을 수 있다. 따라서 hover만 유일한 안내로 사용하지 않고 상태별 아이콘, 선택 시 공식 status flyout, tray/control center를 함께 제공해야 한다.
- 원인 정확도: HTTP timeout/530/1033만으로 NAS 전원 꺼짐과 Cloudflare tunnel/인터넷 장애를 항상 구별할 수 없다. 확정 가능한 `계정 인증 만료/연결 해제`, `동기화 일시 중지`는 구체적으로 표시하고, 구분 불가능한 경우는 `NAS 또는 연결 경로 오프라인`처럼 과장 없는 범주와 마지막 정상 확인 시각을 표시한다.
- 권장 상태: 파란/초록 정상, 노랑 연결 중·재시도, 회색 NAS 또는 연결 경로 오프라인, 빨강 계정 다시 연결 필요를 사용하고 색만 의존하지 않도록 작은 badge 형태·텍스트 상태도 병행한다. 앞선 공통 state revision 작업과 같은 원천을 사용해야 PC 앱·웹·Explorer가 서로 모순되지 않는다.

## 2026-08-30 구현·배포: 공통 장치 상태 revision과 Explorer 상태 아이콘

- 사용자 요청: PC 앱과 NAS 웹의 PC 연동 상태가 같은 기준으로 수렴하게 하고, Windows 파일 탐색기 왼쪽 NAS Drive에서도 온라인·동기화·오프라인·계정 불일치와 가능한 원인을 확인할 수 있도록 가능한 범위를 모두 구현·설치·배포·검증한다. 별도 권한 질문 없이 진행하되 사용자 파일과 계정 데이터는 보존한다.
- 서버 공통 상태 계약: `backend/nasRoutes.js`가 `relationshipState`, `connectionState`, `syncState`, `reasonCode`, `reasonLabel`, `stateRevision`, `stateChangedAt`, `lastConfirmedAt`, `offlineAfterMs`를 장치 응답에 제공한다. register, heartbeat, pause/resume, revoke, desktop logout, 대량 변경 보호 상태가 바뀔 때 revision을 단조 증가시킨다. 인증을 약화하는 무인증 상태 보고는 추가하지 않았다.
- 웹 최신성 보장: `ServicePlatform`은 Socket.IO와 15초 polling 결과를 device별 revision으로 병합하고 낮은 revision을 버린다. 서버가 마지막으로 online이라고 보낸 뒤 heartbeat가 끊겨도 1초 local clock과 서버의 9초 경계로 즉시 offline을 계산한다. 관계/접속/파일 동기화/pairing 축은 합치지 않고 연결 PC 관리에 사유·마지막 수신·revision을 함께 표시한다.
- Explorer 표시: Agent 1.10.15는 `up-to-date`, `connecting`, `syncing`, `offline`, `paused`, `needs-relink`, `updating`, `error`용 32px 상태 ICO를 설치 폴더에 생성한다. personal Drive의 `desktop.ini` IconResource와 InfoTip을 같은 상태·친화적 사유로 갱신한다. Provider 1.4.3은 HKLM SyncRoot 등록에서 NamespaceCLSID를 읽기만 하고 HKCU의 해당 DefaultIcon만 상태 아이콘으로 바꾼 뒤 Shell 갱신을 알린다. Explorer 강제 재시작·전역 Bags 삭제·사용자 pin 초기화는 하지 않았다.
- 현재 PC 실제 검증: 1.10.15/Provider 1.4.3/새 launcher를 보존 업데이트했다. 서버에서 이미 폐기된 현재 profile은 `needs-relink`로 수렴했고 health와 InfoTip은 `이 계정 연결이 더 이상 유효하지 않습니다. 로그아웃하거나 다시 연결하세요.`로 표시됐다. registry NamespaceCLSID DefaultIcon과 root desktop.ini가 `nas-drive-status-needs-relink.ico`를 가리키며 실제 Explorer 탐색창에 NAS Drive 상태 아이콘이 렌더링되는 화면을 확인했다. 로컬 파일·두 profile config·DPAPI credential은 삭제하지 않았다.
- 자동 검증: Agent source/packaged self-test, Provider publish/self-test, Setup self-test, Node syntax, `git diff --check`, frontend production build를 통과했다. Windows backend 테스트 7개가 통과했고 `deviceSyncSecurity` 전체 파일은 비관리자 symlink 생성 EPERM으로만 중단됐지만, NAS Linux에서 해당 경계 테스트를 포함한 backend 8/8과 Agent source self-test가 모두 통과했다. workbook 관련 5개 시트를 기존 스타일로 렌더하고 formula error 0을 확인했다.
- Git/NAS 배포: 기능 commit `ab4a371`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push하고 NAS live worktree를 fast-forward했다. NAS에서 frontend를 build하고 `msp-backend`를 restart/save했다. `ssh`, `tailscaled`, `nginx`, `docker`, `cloudflared`가 active, PM2 `msp-backend`가 online이며 내부 3030과 공개 HTTPS는 HTTP 200이다. 배포 SHA-256은 Agent `5629365D2771578C8B8A86726ABDBB3199F960AE694DDB92DD9523F0DA1F20BA`, Setup `D75A31C4A5A349087CDFE71C13589CD9F0E2EAF5CE853E5F6E19D1462EE3FCDA`, Provider `6AEE41722F70EE66CA071BC06A1A4AA21A453EFCE6FD744C3EC77903A9A185F4`다.
- 정확한 한계: 네트워크가 끊긴 순간 로컬 해제 사건을 서버가 즉시 알 수는 없으므로 모든 화면의 같은 millisecond 갱신을 약속하지 않는다. 대신 서버 revision, 9초 timeout, reconnect 수렴으로 오래된 online이 최신 상태를 덮지 않게 했다. Explorer 왼쪽 hover는 Windows가 보장하는 전용 상태 UI가 아니므로 InfoTip은 best-effort이고, 상태 아이콘·상태 열·tray/control center·웹 관리 화면을 함께 유지한다. timeout만으로 NAS 전원과 인터넷·터널 장애를 구분하지 않고 `NAS 또는 연결 경로 오프라인`으로 표시한다.

## 2026-08-30 수정·검증: PC 연동 클릭 오프라인 전환과 Explorer 표시 실효성

- 사용자 재현: 정상 연결 직후 NAS 웹의 `PC 연동중` 아이콘을 클릭했을 뿐인데 웹은 서버 오프라인, 트레이는 주황색 `연결 중`으로 바뀌었다. Explorer 왼쪽 NAS 항목의 상태 표시도 노트북에서 사실상 보이지 않는다고 확인했다.
- 연결 오판 원인: 서버는 Agent register만 끝나도 pairing을 connected로 바꾸고 `lastSeenAt=now`를 기록해 새 token의 heartbeat가 오기 전 약 9초를 실제 online으로 오인했다. 웹도 pairing snapshot을 live 장치 상태처럼 사용했고 active pairing 아이콘 클릭이 완료 전 드라이브 열기 흐름으로 재진입했다. Agent는 시작 시 긴 reconcile 전에 정규 heartbeat timer가 없어 서버 timeout을 넘길 수 있었다.
- 오류 루프 원인: 과거 state가 `remotePaths`만 가진 profile에서 서버가 이미 삭제한 온라인 전용 placeholder를 로컬 신규 파일로 오판했다. 원본이 없는 미수화 CFAPI 파일의 read/rename은 `UNKNOWN`으로 실패해 upload 오류와 `connecting/error` 반복을 만들었다.
- 1.10.16 수정: register는 `lastSeenAt=null`로 시작하고 새 credential heartbeat만 online을 확정한다. pairing status는 오래된 pairing snapshot 대신 현재 장치 record를 반환한다. 웹은 활성 pairing 클릭 시 진행창만 다시 열며 canonical live 장치가 확인되기 전 완료 처리하지 않는다. Agent는 시작 heartbeat watchdog, 단계별 오류 기록, legacy remotePaths 안전 이관을 적용한다. 서버 manifest가 삭제를 확정한 파일이면서 미수화 placeholder의 trash rename만 실패한 경우에만 해당 placeholder를 제거한다. hydrated/local 파일과 서버가 삭제를 확정하지 않은 경로에는 이 fallback을 적용하지 않는다.
- Explorer 표시 보강: 16px에서 거의 보이지 않던 작은 점과 브랜드와 같은 정상 파랑을 폐기했다. 전체 구름을 상태색으로 바꾸고 정상은 초록 체크, 오프라인은 주황 느낌표, 오류·재연결 필요는 빨간 X, 일시 중지는 정지 기호로 표시한다. 열린 Explorer의 고정 항목은 shell 캐시로 갱신이 지연될 수 있어 desktop.ini·InfoTip을 유지하고 탐색기 재오픈 뒤 검증한다.
- 현재 PC E2E: 설치 설정 SHA-256을 보존한 채 최종 Agent/launcher를 교체했고 health가 `up-to-date`로 유지됐다. 서버 manifest에서 이미 사라진 미수화 placeholder 14개만 정리됐으며 NAS 실제 사용자 루트의 원본을 삭제하지 않았다. Chrome의 실제 `NAS Drive 열기` 버튼을 클릭한 뒤에도 웹 `최신 상태`, Agent `up-to-date`, launcher·Agent·Provider 프로세스가 유지됐다. Explorer를 닫고 다시 열어 `NAS Drive - cmoeoffice` 제목 아이콘에 초록 구름+체크가 보이는 화면을 확인했다. 왼쪽 고정 목록의 같은 창 즉시 갱신은 Windows cache 특성상 보장하지 않는다.
- 검증: Agent source/packaged self-test, Setup self-test, backend password/Office/quota/trash/version/desktop handoff 테스트, frontend production build와 `git diff --check`를 통과했다. `deviceSyncSecurity` 전체 실행은 Windows 비관리자 symlink 생성 EPERM에서만 중단됐다. NAS는 기능 commit `1c1c5d7`을 받아 필수 서비스 active, PM2 online, 내부 3030·공개 HTTPS 200을 확인했다.
- 회귀 금지: 장치 등록을 연결 완료로 취급하지 않고 반드시 새 token heartbeat로 online을 확정한다. active pairing 아이콘 클릭으로 새 pairing을 만들거나 완료 전 open-drive를 호출하지 않는다. 서버 삭제가 확인되지 않은 사용자 파일이나 hydrated/local content를 placeholder fallback으로 제거하지 않는다. Explorer의 best-effort 아이콘만 유일한 상태 근거로 사용하지 않고 tray/control center·웹 canonical 상태를 함께 제공한다.

## 2026-08-30 NAS Drive 1.10.17 전면 장애 주입·실화면 검증

- 사용자 요청: 연결 중 고착, 웹 PC 연동 재클릭, 종료 뒤 `이미 실행 중` 오판, 계정 삭제·인증 불일치, Explorer 왼쪽 상태 표시와 가능한 일반 장애를 모두 고려해 재부팅 없이 수렴시키고, 코드만 보고 끝내지 말고 실제 화면으로 확인한다.
- 고DPI/제어창: 이 PC의 300% DPI에서 installer/control center가 자동 배율과 명시 좌표를 이중 적용해 하단 동작과 일부 버튼 문구가 잘렸다. manifest를 PerMonitorV2로 명시하고 폼을 `AutoScaleMode.None`, 모든 label/button을 픽셀 환산 `Program.UiFont`로 통일했다. 최종 PrintWindow에서 계정·동기화 상태·저장 위치·파일 상태 안내와 `NAS Drive 열기/웹에서 관리/로그아웃/창 닫기`가 모두 보이는 것을 확인했다.
- 경로/중복 창: Windows 인자 quoting이 모든 역슬래시를 이중화해 `NAS Drive 열기`가 문서 폴더로 갈 수 있었다. 정식 Windows argv quoting으로 교정하고 실제 버튼 클릭 뒤 Explorer COM 경로가 `C:\Users\peter\NAS Drive - cmoeoffice`인지 확인했다. desktop shortcut을 연속 실행해도 더 이상 `이미 열려 있습니다` 모달을 띄우지 않고 기존 제어창 하나를 복원한다.
- 종료-재실행 경쟁: `--shutdown-background` 실행 250ms 뒤 바로 desktop shortcut을 열면 종료 cleanup이 새 launcher/Agent까지 죽여 연결 중에 고착되는 사용자 증상을 실제 재현했다. `Local\NAS-Drive-Background-Shutdown` mutex와 종료 시작 시점 exact-path PID snapshot을 도입해 이후 시작된 PID를 보호한다. 재시험에서 background launcher+제어창, Agent 1개, Provider 2개, visible window 1개와 health `up-to-date`가 유지됐다. `창 닫기`는 제어창만 닫고 background 구성요소를 유지한다.
- Agent/Provider 장애: 정식 Agent를 강제 종료하자 native supervisor가 새 exact-path Agent를 복구했고 약 13초 안에 `up-to-date`로 수렴했다. 활성 Provider를 강제 종료한 경우에는 이전 구현이 복구하지 못해 Provider 생존 감시, syncRootId 기반 orphan PID 재발견, sync root `register` 재확인 후 `serve` 재시작을 추가했다. 재시험에서 새 Provider PID와 pidfile이 일치하고 health가 복구됐다.
- 서버/인증 장애: PM2의 `msp-backend`만 중단해 로컬 health와 실제 control center가 `NAS 서버가 꺼져 있거나 인터넷에 연결할 수 없습니다`로 바뀌는 것을 확인했고 즉시 restart/save 후 내부·공개 HTTP 200과 `up-to-date` 복구를 확인했다. 폐기된 DPAPI token 복사본으로 인증 불일치를 주입해 16초 뒤에도 `계정 다시 연결 필요`와 `연결 해제` 동작이 유지되는 화면을 확인했다. stale health 판정은 이제 `needs-relink/error/paused`를 임의로 offline으로 덮지 않는다. 원래 활성 credential은 SHA-256 동일성을 확인해 복구했고 임시 token backup은 제거했다.
- 웹 PC 연동 실제 클릭: Chrome의 `NAS Drive 열기 · 우클릭: 연결 관리`를 실제 클릭해 외부 앱 확인창의 `NAS Drive Setup 열기`를 승인했다. local control center가 열리고 health `up-to-date`, launcher·Agent·Provider가 유지됐다. 클릭 자체가 새 pairing이나 offline 전환을 만들지 않았다.
- Explorer 실제 화면: 정상 재개방 화면에서 제목과 왼쪽 고정 NAS 항목이 초록 구름+체크, PM2 중단 뒤 재개방 화면에서 주황 구름+느낌표로 보이는 것을 확인했다. `desktop.ini` InfoTip과 SyncRoot namespace registry는 상태에 맞게 즉시 바뀐다. 다만 이미 열린 Explorer 탭·빠른 액세스 항목은 Windows Shell이 icon/InfoTip을 캐시해 알림과 refresh 후에도 이전 색을 유지하거나 한 전이 늦을 수 있다. Explorer 프로세스 강제 종료나 재부팅을 복구 방법으로 사용하지 않고 2단계 Shell refresh를 best effort로 수행한다. 실시간 권위 UI는 tray/control center/web이며 Explorer 표시는 재개방 시 정확함을 수용 경계로 기록한다.
- 검증: Agent source/package self-test와 Setup self-test, backend password/Office/quota/version/trash/desktop handoff 7개가 통과했다. `deviceSyncSecurity`는 Windows 비관리자 symlink 생성 EPERM에서만 중단돼 NAS Linux에서 재실행한다. frontend 개별 10 tests는 통과했지만 로컬 전체 App suite와 production build는 현재 설치된 pnpm 의존성의 `react-router/dom` 및 eslint `react-app` 해석 오류로 중단돼 NAS의 clean 의존성 환경에서 재검증한다. `git diff --check`는 통과했다.
- 데이터 보존/미실행 경계: 활성 profile 실제 `로그아웃` 클릭은 서버 relation과 로컬 DPAPI credential 제거 후 재로그인 자격 증명이 필요하므로 실행하지 않았다. 대신 폐기 token 격리 주입으로 needs-relink 화면과 연결 해제 버튼 활성 상태를 실제 확인했다. 사용자 파일, active config/token, Cloudflare/DNS/nginx/OnlyOffice/HWP 설정은 변경하지 않았다. 이전 폐기 profile `chanchanchan`은 현재 config와 Explorer에 남아 있으나 사용자 확인 없이 삭제하지 않았다.
- 기록: workbook `Request_Archive`, `Patch_Log`, `Feature_Index`, `Do_Not_Break`를 기존 형식으로 갱신하고 관련 범위를 렌더했으며 formula error 0을 확인했다. 다음 단계는 GitHub push, NAS fast-forward, Linux 전체 보안 테스트, PM2 restart/save, 필수 서비스와 내부·공개 HTTP, 배포 binary hash를 검증하는 것이다.

### 1.10.17 GitHub·NAS 최종 배포 검증

- 기능·binary·workbook·relay commit `b793a21`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다.
- NAS에서 Agent source self-test와 backend tests 8/8을 통과했다. Windows에서 symlink 권한 EPERM이었던 `deviceSyncSecurity` 경계도 Linux에서 정상 통과했다. frontend clean build는 기존 eslint warning만 남기고 성공했으며 `main.18c5b581.js`를 생성했다.
- `msp-backend`를 restart/save한 뒤 online을 확인했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이고 내부 `http://127.0.0.1:3030`과 공개 `https://filemanager-nas.com`은 HTTP 200이다.
- NAS 배포 binary와 현재 PC 설치본 hash가 일치한다. Agent SHA-256은 `7D6821CBBC376A448A43B1070F0865140EF1FD22759E77421521EF21AA2C1717`, Setup/launcher SHA-256은 `C0D2DBC9BA45706AE65016C924F5760E138243491C82863C75C3383E485740F2`다.
- 최종 정상 상태: 현재 PC health는 `up-to-date`, 제어창은 닫혀 있고 background launcher·Agent·계정별 Provider가 실행 중이다. PM2 backend와 공개 사이트가 정상이다. 사용자 파일·활성 계정 credential은 보존됐다. 실제 활성 로그아웃과 폐기 legacy profile 삭제는 자격 증명/관계 제거 동작이므로 자동 실행하지 않았다.
## 2026-08-30 NAS Drive 1.10.18 웹 브라우저·Chrome 프로필 선택 및 자동 로그인

- 사용자 요청: NAS Drive의 웹 바로가기/웹에서 관리 버튼이 기본 브라우저를 즉시 열지 않고 브라우저와 Chrome/Edge 사용자 프로필을 선택하게 하며, 선택한 프로필에서 현재 NAS Drive 계정으로 웹 NAS에 자동 로그인하고, 새 PC의 개인 Drive 루트에 관리 바로가기를 자동 생성·삭제 후 복구하게 한다.
- 확인: 기존 `/api/devices/agent/web-session`과 `/api/auth/desktop-handoff`는 장치 소유자에 결합된 45초·1회용 token을 발급·소비한 뒤 선택된 브라우저에 30일 세션 쿠키를 설정한다. NAS 로그인은 Google OAuth가 아니므로 Google 쿠키/비밀번호를 읽거나 별도 OAuth 앱을 추가하지 않는다.
- 구현: `backend/agents/windows-node/web-browser.js`에 표준 설치 경로 Chrome/Edge 탐지, 8MB 제한 `Local State`의 `profile.info_cache` 읽기, 숨김·비표준 프로필 제외, HMAC 임시 프로필 token과 `shell:false` 실행을 추가했다. 설치 launcher는 Chrome/Edge와 대표 Google 계정을 보여 주는 native picker를 소유한다. Explorer 바로가기, control center, tray가 같은 `--open-web` 경로를 사용하고 Agent가 브라우저 executable realpath와 `Default`/`Profile N` 실제 디렉터리를 재검증한다. 선택을 취소하면 handoff를 만들지 않고 선택을 완료한 뒤에만 45초·1회용 NAS handoff를 요청한다.
- 바로가기 수명주기: 개인 Drive 루트의 `NAS Drive 웹 파일관리.lnk`는 설치 launcher와 `--open-web`를 가리킨다. background tick에서 누락을 다시 만들며 `WindowStyle=1`로 변경해 선택창이 최소화되지 않고 일반 창으로 표시된다.
- 현재 PC 실검증: 1.10.18 Agent/Setup을 빌드·설치하고 실제 Explorer 바로가기를 열어 `NAS 웹에서 열기` native 창이 앞에 표시되는 화면, Chrome 6개 프로필과 대표 계정, 최근 프로필 선택을 확인했다. `선택한 브라우저로 열기` 뒤 로컬 진단은 `state=opened`, `browser=chrome`이고 서버의 persistent device-bound handoff가 즉시 소비됐다. 선택된 Chrome은 로그인 화면 없이 `filemanager-nas.com/nas`의 `내 클라우드` 파일 목록을 표시했다. 바로가기를 복구 가능한 위치로 옮기자 약 3초 안에 같은 target/argument와 `WindowStyle=1`로 재생성됐다.
- 검증: desktop handoff/browser 단위 테스트 4/4, source/packaged Agent self-test, Setup self-test, C# compile, `git diff --check`를 통과했다. workbook의 `Request_Archive`, `Patch_Log`, `Feature_Index`, `Relation_Map`, `Do_Not_Break`, `Code_Map`을 갱신하고 각 범위를 렌더했으며 새 formula error와 한글 깨짐이 없음을 확인했다. 배포 version은 1.10.18이다.
- 안전 경계: Chrome 쿠키·비밀번호·로그인 token을 읽지 않는다. 표시 이메일은 `Local State`의 대표 프로필 계정일 뿐이며 NAS 인증은 기존 장치 소유자에 결합된 handoff만 사용한다. Portable/회사 정책형 별도 User Data는 자동 감지하지 않고 시스템 기본 브라우저 fallback을 유지한다. 사용자 파일과 활성 DPAPI credential은 보존했다.

### 1.10.18 GitHub·NAS 최종 배포 검증

- 기능·binary·workbook·relay commit `22228ef`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다.
- NAS에서 Agent source self-test와 backend tests 10/10을 통과했다. Windows 비관리자 환경에서 symlink 생성 EPERM이었던 `deviceSyncSecurity` 경계도 Linux에서 정상 통과했다.
- `msp-backend`를 restart/save한 뒤 online을 확인했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이고 내부 `http://127.0.0.1:3030`과 공개 `https://filemanager-nas.com`은 HTTP 200이다.
- NAS 배포 binary와 현재 PC 설치본 hash가 일치한다. Agent SHA-256은 `900209166764DCC4421525C391BB4F3CF6FD99FB54D62B87D564E9D69731A8EB`, Setup/launcher SHA-256은 `D586E4099A31593B5C16FCA36CC6A70E67809FF94EECE0AAA8886B710C419931`이다.
- 최종 현재 PC 상태는 health `up-to-date`, `needsRelink=false`이고 설치 launcher·Agent·계정별 Provider가 실행 중이다. 웹 바로가기는 target `NAS-Drive.exe`, argument `--open-web`, `WindowStyle=1`이다. 사용자 파일·활성 계정 credential·Cloudflare/DNS/nginx/OnlyOffice/HWP 설정은 변경하지 않았다.

## 2026-08-30 NAS Drive 1.10.19 Chrome형 2단계 브라우저·사용자 카드 UI

- 사용자 요청: 브라우저와 Chrome 계정을 한 화면의 콤보박스·긴 목록으로 보여 주지 않는다. 처음에는 브라우저 로고 버튼만 표시하고, 선택 뒤 해당 브라우저에 로그인된 사용자의 계정 이미지 아래 이름이 보이는 Chrome 사용자 선택기형 화면으로 바꾼다.
- 구현: `NAS-Drive.exe` native picker를 두 페이지로 재구성했다. 첫 화면에는 설치된 Google Chrome·Microsoft Edge의 실제 exe icon과 Windows 기본 브라우저 로고 카드만 표시한다. Chrome/Edge를 선택하면 두 번째 화면에서 검증된 `Default`/`Profile N`별 `Google Profile Picture.png`, 표시 이름, 대표 이메일, 최근 사용 badge를 카드로 보여 준다. 이미지가 없으면 이름 첫 글자의 로컬 원형 avatar를 사용한다. `브라우저 다시 선택`과 취소를 제공하고 시스템 기본 브라우저는 첫 화면에서 바로 연다.
- 보안 경계: 프로필 이미지는 표준 User Data 하위의 검증된 프로필 폴더에 있는 4MB 이하 고정 파일만 읽는다. `Local State`의 제한된 공개 표시 메타데이터 외 Chrome 쿠키·비밀번호·인증 token·임의 avatar URL은 읽지 않는다. 브라우저를 선택하기 전에는 handoff를 만들지 않고, 프로필 선택 뒤에도 Agent가 executable realpath와 profile directory를 다시 확인한 후 기존 45초·1회용 device-bound handoff를 사용한다.
- 현재 PC 실화면 E2E: 실제 Explorer 웹 바로가기를 열어 첫 화면에 Chrome·Edge·Windows 기본 브라우저 로고 카드 3개만 표시되는 화면을 확인했다. Chrome 로고 클릭 뒤 6개 실제 프로필 이미지/이름/대표 이메일 카드와 최근 사용 표시를 확인했다. 최근 사용 프로필 선택 경로는 1.10.19 `open-web-last.json`에서 `state=opened`, `browser=chrome`이고 Agent health는 `up-to-date`, `needsRelink=false`다.
- 검증: C# compile, source/packaged Agent self-test, Setup self-test, desktop handoff/browser tests 4/4, `git diff --check`를 통과했다. workbook은 기존 `WIN-WEB-BROWSER-PROFILE-HANDOFF`를 1.10.19로 갱신하고 Request/Patch/Do_Not_Break/Code_Map만 보수적으로 추가했으며 관련 범위 렌더와 formula error 0을 확인했다.

### 1.10.19 GitHub·NAS 최종 배포 검증

- 기능·binary·workbook·relay commit `64ab208`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다.
- NAS에서 Agent source self-test와 backend tests 10/10을 통과했다. Windows 비관리자 환경에서 symlink 생성 EPERM이었던 `deviceSyncSecurity` 경계도 Linux에서 정상 통과했다.
- `msp-backend`를 restart/save했다. 재시작 직후 0초 probe는 기동 전이라 한 번 HTTP 000이었지만 4초 뒤 PM2 online, 내부 3030·공개 HTTPS 모두 200으로 수렴했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active다.
- NAS 배포 binary와 현재 PC 설치본 hash가 일치한다. Agent SHA-256은 `20A11BF86EA9AAD3A615E81530207FD160166B186A82C3C20CF1F083B711DDB7`, Setup/launcher SHA-256은 `8508181B5C2245B46AC69BA381F9FCA750C2702460B905B94AAB660FE3DFBAA1`이다.
- 최종 현재 PC 상태는 1.10.19 open-web 진단 `opened/chrome`, health `up-to-date`, `needsRelink=false`이고 launcher·Agent·Provider가 실행 중이다. 사용자 파일·활성 DPAPI credential과 이번 UI 외 Cloudflare/DNS/nginx/OnlyOffice/HWP 설정은 변경하지 않았다.

## 2026-08-30 NAS Drive 1.10.20 브라우저 picker 카드 hover 깜빡임 제거

- 사용자 요청: 브라우저·프로필 선택 기능은 정상이나 카드 위에서 마우스를 움직일 때 선택 블록이 깜빡이므로 버튼을 더 세심하게 다듬는다.
- 원인: 1.10.19 카드는 `Panel` 안에 `PictureBox`와 여러 `Label`을 중첩하고 각 자식에 click을 전달했다. 커서가 부모 카드와 이미지·텍스트 경계를 오갈 때 부모 `MouseLeave/MouseEnter`가 반복되어 배경색과 border가 짧게 원복·재적용됐다.
- 구현: 카드 전체를 자식 컨트롤이 없는 단일 `WebPickerCardButton` owner-draw Button으로 교체했다. `OptimizedDoubleBuffer`, `AllPaintingInWmPaint`, `UserPaint`를 사용해 배경·hover/pressed/focus border·이미지·이름·이메일·badge를 한 프레임에 그린다. hover 상태는 버튼 자체 진입/이탈에서만 바뀌며 키보드 Enter/Space, focus cue, `AccessibleName`을 제공한다. paint Font는 즉시 dispose하고 카드 소유 Image는 Button dispose에서 해제한다.
- 현재 PC 실화면 E2E: 실제 Explorer 웹 바로가기로 첫 화면과 Chrome 프로필 화면을 열었다. Windows 접근성 tree에서 브라우저 3개와 Chrome 프로필 6개가 각각 일반 창/자식 Label이 아닌 단일 `Button`으로 노출되고 이미지·이름·대표 이메일 화면도 유지됨을 확인했다. 1.10.20 open-web 진단은 `opened/chrome`, health는 `up-to-date`, `needsRelink=false`다.
- 검증: C# compile, source/packaged Agent self-test, Setup self-test, desktop handoff/browser tests 4/4와 `git diff --check`를 통과했다. workbook은 기존 feature를 1.10.20으로 갱신하고 Request/Patch/Do_Not_Break/Code_Map을 보수적으로 추가했으며 관련 범위 렌더와 formula error 0을 확인했다. 인증·프로필 탐지·avatar·handoff 로직과 사용자 파일은 변경하지 않았다.

### 1.10.20 GitHub·NAS 최종 배포 검증

- 기능·binary·workbook·relay commit `91c9bac`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다.
- NAS에서 Agent source self-test와 backend tests 10/10을 통과했다. Windows 비관리자 환경에서 symlink 생성 EPERM이었던 `deviceSyncSecurity`도 Linux에서 정상 통과했다.
- `msp-backend`를 restart/save한 뒤 online을 확인했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이고 내부 3030·공개 HTTPS는 모두 HTTP 200이다.
- NAS 배포 binary와 현재 PC 설치본 hash가 일치한다. Agent SHA-256은 `DAA7266B90FDC59E304638C174C6230FC5B85C7A57977747D4F32F14F5615888`, Setup/launcher SHA-256은 `B65C7F6F2565A692CEEA3BA6C0872EBB07F26CB374AA62CE9C5BA03E1FF07915`다.
- 최종 현재 PC 상태는 launcher 1.10.20, open-web 진단 `opened/chrome`, health `up-to-date`, `needsRelink=false`다. launcher·Agent·Provider가 정상 실행 중이고 사용자 파일·활성 credential은 보존됐다.

## 2026-08-30 NAS Drive 1.10.21 picker 전체 버튼·뒤로가기 정돈

- 사용자 요청: 프로필 카드뿐 아니라 picker의 다른 버튼도 같은 완성도로 점검하고, 특히 기존 `브라우저 다시 선택` 뒤로가기 버튼의 조악한 모양과 배치를 개선한다.
- 구현: 브라우저·프로필 카드는 12px 둥근 외곽선, 부드러운 hover/pressed/focus 상태와 둥근 최근 사용 badge를 단일 double-buffered owner-draw 버튼에서 그린다. 취소와 뒤로가기는 공통 `WebPickerActionButton`으로 통일해 9px 둥근 외곽선, 키보드 focus cue와 일관된 hover/pressed 상태를 제공한다. 뒤로가기는 프로필 화면 좌측 상단의 `←  브라우저` 탐색 동작으로 바꾸고 평상시에는 경계선을 숨겨 시각적 위계를 낮췄다. 접근성 이름과 키보드 동작은 유지한다.
- 추가 회귀 수정: 프로필 목록에서 세로 scrollbar가 생긴 뒤 첫 화면으로 돌아오면 남아 있던 layout 폭 때문에 기본 브라우저 카드가 다음 줄로 밀리는 문제를 실제 왕복 중 발견했다. 카드 폭·간격을 scrollbar가 있어도 3열이 유지되도록 조정하고 페이지 전환 시 scroll 위치 초기화와 즉시 layout을 수행한다.
- 현재 PC 실화면 E2E: 실제 picker 첫 화면에서 Chrome·Edge·Windows 기본 브라우저 3개가 한 줄의 둥근 카드로 보이는 것을 확인했다. Chrome 프로필 화면에서 3열 카드, 좌측 상단 뒤로가기, 우측 하단 취소 버튼을 확인했고, 뒤로가기를 실제 클릭한 뒤 첫 화면도 다시 3열을 유지했다. 최근 Chrome 프로필 직접 열기는 1.10.21 진단에서 `opened/chrome`, health는 `up-to-date`, `needsRelink=false`다.
- 기록: workbook의 `Request_Archive`, `Patch_Log`, `Feature_Index`, `Do_Not_Break`, `Code_Map`을 1.10.21 기준으로 갱신했고 formula error 0과 관련 범위 렌더를 확인했다. 사용자 파일·활성 credential·브라우저 인증 자료는 변경하지 않았다. 다음 단계는 최종 자동 테스트, GitHub push, NAS Linux 전체 테스트와 live 배포 검증이다.

### 1.10.21 GitHub·NAS 최종 배포 검증

- 기능·binary·workbook·relay commit `af9c7a5`를 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다.
- 로컬에서 desktop handoff/browser tests 4/4와 packaged Agent·Setup self-test를 통과했다. NAS에서는 Agent source self-test와 symlink 경계 보안을 포함한 backend tests 10/10을 통과했다.
- `msp-backend`를 restart/save한 뒤 online을 확인했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이고 내부 3030과 공개 HTTPS는 HTTP 200이다.
- NAS 배포 binary와 현재 PC 설치본 hash가 일치한다. Agent SHA-256은 `478C5CFD89F8DF38D1925E3C7DF8A67138888FC44E20DA011F661A5C0A3FCA1C`, Setup/launcher SHA-256은 `2C412B82F7C268A1965E45FA7ACF6C9C16D48DF0816A5E1E8314F47D55ECB491`이다.
- 최종 현재 PC 상태는 picker 실화면 왕복 검증 완료, 1.10.21 open-web 진단 `opened/chrome`, health `up-to-date`, `needsRelink=false`다. 사용자 파일·활성 DPAPI credential은 보존됐다.

## 2026-08-30 NAS Drive 1.10.22 picker 뒤로가기 `BACK` 단순화

- 사용자 교정: 프로필 선택 화면의 `← 브라우저`가 여전히 마음에 들지 않으므로 화살표를 제거하고 `BACK`이라고만 심플하게 표시한다.
- 구현: `WebPickerActionButton`의 표시 문자열만 `BACK`으로 교체했다. 기존 라운드 외형, hover/pressed/focus, Click의 `ShowBrowserPage`, 한국어 접근성 이름 `브라우저 선택으로 돌아가기`는 그대로 유지한다. Agent/Setup과 서버 공개 version을 1.10.22로 올렸다.
- 현재 PC 실화면 E2E: 최종 Agent/launcher를 보존 업데이트하고 실제 `NAS 웹에서 열기`의 Chrome 프로필 선택 화면에서 좌측 상단에 화살표 없는 `BACK`이 표시되는 것을 확인했다. 프로필 카드·취소 버튼과 3열 layout은 유지됐고 접근성 tree에서는 뒤로가기 단추가 한국어 AccessibleName으로 노출된다. 검증용 picker만 닫고 background launcher·Agent·Provider와 사용자 계정 자료는 유지했다.
- 기록: workbook `Request_Archive`, `Patch_Log`, `Feature_Index`, `Do_Not_Break`, `Code_Map`을 1.10.22 기준으로 갱신하고 관련 범위 렌더와 formula error 0을 확인했다. 다음 단계는 자동 테스트, GitHub push, NAS 전체 테스트와 live 배포 검증이다.

### 1.10.22 GitHub·NAS 최종 배포 검증

- 기능·binary·workbook·relay commit `27e44c7`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다.
- 로컬 desktop handoff/browser tests 4/4와 packaged Agent·Setup self-test를 통과했다. NAS에서는 Agent source self-test와 symlink 보안 경계를 포함한 backend tests 10/10을 통과했다.
- `msp-backend`를 restart/save한 뒤 online을 확인했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이고 내부 3030·공개 HTTPS는 HTTP 200이다.
- NAS 배포 binary와 현재 PC 설치본 hash가 일치한다. Agent SHA-256은 `5D2095DAED0E7593B2AED249BBFB8FDB657704DBEEED75A6C1359F8F3D0297A5`, Setup/launcher SHA-256은 `3A88FC4E79C6FE703DD6B4D00584BA354B0B3AB824331DE53260C35E5FEC1EDB`다.
- 최종 현재 PC는 launcher 1.10.22, health `up-to-date`, `needsRelink=false`이고 background launcher·Agent·Provider가 정상 실행 중이다. 사용자 파일·활성 credential은 보존됐다.

## 2026-08-30 PDF.js API·Worker 버전 불일치 수정

- 사용자 보고/실재현: NAS에서 `합친 PDF.pdf`를 열면 `The API version "4.8.69" does not match the Worker version "5.6.205".`가 표시되고 PDF가 렌더되지 않았다. 로그인된 공개 Chrome DOM에서 같은 문구를 직접 확인했다.
- 원인 확정: 공개 backend가 제공하는 `/var/www/html/static/js/main.3e6c7157.js`에는 PDF.js API 4.8.69가 포함됐지만 그 index가 가리키는 `pdf.worker.min.e45a4926ca74ae14adf7.mjs`는 5.6.205였다. repo의 현재 lock과 `frontend/build` Worker는 4.8.69였다. 즉 PDF 파일 자체나 OnlyOffice 문제가 아니라, 직접 고정되지 않은 Worker dependency가 오염된 frontend build로 live 정적 경로에 들어간 문제다.
- 재발 방지 구현: `frontend/package.json`에서 `react-pdf`를 9.2.1, `pdfjs-dist`를 4.8.69 exact dependency로 고정하고 lock root도 동일하게 맞췄다. 새 `frontend/scripts/verify-pdfjs-compat.mjs`는 package/lock의 직접 버전, react-pdf가 요구하는 pdfjs-dist, 실제 production `pdf.worker*.mjs` 내부 버전을 모두 대조한다. `npm run build` 마지막에 이 검사를 강제해 API와 Worker가 다르면 build가 실패한다.
- 범위: NAS 작업공간 `FileViewer`와 공유 링크 `FilePreviewSurface`가 같은 react-pdf global Worker 설정을 사용하므로 같은 exact pin과 build gate로 함께 보호한다. OnlyOffice Docker/proxy, HWP, 사용자 PDF 원본은 변경하지 않았다.
- 기록/사전 검증: dependency 검사 단독 실행은 react-pdf 9.2.1 / PDF.js 4.8.69 일치를 통과했다. workbook의 Request/Patch/Feature/Office_Viewers/Do_Not_Break/Code_Map을 갱신하고 formula error 0과 관련 렌더를 확인했다. 다음 단계는 GitHub push, NAS clean `npm ci`·production build gate, live index-last 배포, 공개 Worker와 실제 PDF 렌더 E2E다.

### PDF.js 호환성 GitHub·NAS 배포 및 실화면 검증

- 기능·검사기·workbook·relay commit `5b38298`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다.
- NAS에서 `npm ci`로 1,585 packages를 lock 그대로 재구성했다. production build는 기존 eslint warning만 남기고 성공했고 새 배포 gate가 `react-pdf 9.2.1 / PDF.js API+Worker 4.8.69`를 확인했다. build는 `main.18c5b581.js`와 `pdf.worker.min.48ec784a5edb8e2894b8.mjs`를 만들었다.
- live `/var/www/html`에는 hashed asset을 먼저 복사하고 `index.html`을 마지막에 원자 교체했다. 내부·공개 index는 모두 `main.18c5b581.js`를 가리키며 공개 Worker 응답은 4.8.69를 포함하고 5.6.205를 포함하지 않는다. index는 no-store/no-cache이고 Worker는 max-age=0이라 오래된 혼합 cache를 지속시키지 않는다.
- 실제 로그인 Chrome을 새로고침한 뒤 같은 `합친 PDF.pdf`를 다시 열었다. API/Worker 오류와 PDF 로드 실패 문구는 0건이고 PDF page canvas 11개와 text layer 내용이 렌더됐다. PDF 원본은 변경하지 않았다.
- NAS backend tests 10/10을 통과했다. `msp-backend`는 변경이 없어 불필요한 재시작을 하지 않았고 계속 online이다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 active, 내부 3030·공개 HTTPS는 HTTP 200이며 NAS worktree는 clean이다.

## 2026-08-30 PDF 창 내부 확대/축소 격리

- 사용자 보고: NAS 작업공간에서 PDF 파일 창을 연 뒤 `Ctrl+마우스 휠` 또는 `+`를 사용하면 PDF 문서만 확대되어야 하지만 브라우저 페이지 전체 배율이 바뀌는 문제가 남아 있었다.
- 원인: `FileViewer`의 PDF 렌더러에는 창 인스턴스별 배율 상태와 확대 UI가 없었고, 브라우저 기본 `Ctrl+휠`·`Ctrl++/-` 동작을 취소하는 경계도 없었다. 따라서 입력이 PDF canvas가 아니라 최상위 웹페이지 확대에 전달됐다.
- 구현: 각 PDF `FileViewer` 인스턴스에 독립적인 50~300% 배율 상태를 추가했다. PDF 창에 포커스가 있을 때 `Ctrl/Cmd++`, `Ctrl/Cmd+-`, `Ctrl/Cmd+0`을 가로채고, PDF scroll container의 `Ctrl/Cmd+휠`은 non-passive listener에서 기본 페이지 확대와 상위 전파를 막은 뒤 해당 PDF만 15% 단위로 조절한다. 상단에는 축소, 현재 백분율, 확대, 원래 크기 버튼을 제공한다. 100% 초과 canvas는 컨테이너를 넓혀 창 내부 스크롤로 탐색하고, 파일이나 창이 바뀌면 100%로 초기화한다.
- 회귀 경계: 일반 휠 스크롤, PDF 이외 파일의 기존 저장 단축키, 공유 링크 미리보기, 브라우저 전역 배율은 변경하지 않는다. 배율 계산·키 식별·상하한 단위 테스트 2/2를 통과했고 workbook의 Request/Patch/Feature/Office_Viewers/Do_Not_Break/Code_Map을 갱신해 formula error 0과 관련 범위 렌더를 확인했다. 다음 단계는 GitHub push, NAS production build·정적 배포, 실제 Chrome에서 버튼·키보드·Ctrl+휠과 페이지 배율 불변을 검증하는 것이다.

### PDF 창 확대 GitHub·NAS 배포 및 실화면 검증

- 기능·테스트·workbook·relay commit `e4830ed`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다. NAS production build는 기존 unrelated eslint warning만 남기고 성공했으며 PDF.js 호환성 gate도 `react-pdf 9.2.1 / PDF.js API+Worker 4.8.69` 일치를 재확인했다.
- hashed asset을 먼저 복사하고 index를 마지막에 원자 교체했다. live와 build index는 모두 `main.d79b1b60.js`를 가리킨다. backend 변경은 없어 `msp-backend`를 불필요하게 재시작하지 않았다.
- 로그인된 실제 Chrome에서 `합친 PDF.pdf` 11개 canvas를 다시 열어 검증했다. 상단 확대 버튼은 100→115%, `Ctrl++`는 115→130%, PDF canvas 위 실제 `Ctrl+휠`은 100→115%로 해당 PDF만 변경했다. 기준 canvas 폭 755.80px은 각 880.99px·995.99px으로 커졌지만 브라우저 `devicePixelRatio=0.9`, `visualViewport.scale=1`, 문서 clientWidth=2133px은 모든 입력 전후 동일했다. 즉 웹페이지 전체 확대는 발생하지 않았다.
- NAS backend tests 10/10을 통과했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 active, `msp-backend`는 online, 내부 3030·공개 HTTPS는 HTTP 200이다. PDF 원본과 사용자 파일, Cloudflare/DNS/nginx/OnlyOffice/HWP 설정은 변경하지 않았다.

## 2026-08-31 신규 `문서 스튜디오` 기획 검토

- 사용자 요청: NAS 플랫폼 화면에 여러 문서 변환, PDF/PPTX/혼합 문서 합치기, PPTX 템플릿 대량 생성, 결과 미리보기, 글꼴·형식 보호를 제공하는 새 프로그램을 기획하고 입력 파일을 NAS 내부 또는 현재 기기 저장소에서 불러오고 싶다.
- 검토 결론: 현재 `ServicePlatform`의 앱 목록, `WindowContext.openAppWindow`, `GlobalAppWindowLayer`에 독립 앱 `문서 스튜디오`를 추가하는 구조가 적합하다. 기존 파일관리자 화면에 기능을 직접 섞지 않고 변환/합치기/일괄 만들기 3개 모드를 가진 별도 작업공간으로 둔다.
- 입력 구조: 첫 단계에서 `NAS에서 선택`과 `이 기기에서 선택`을 함께 제공한다. NAS 파일은 로그인 계정의 상대경로·stable file reference로 서버 작업에 직접 연결해 불필요한 재업로드를 피한다. 기기 파일은 브라우저의 사용자 승인 파일/폴더 선택으로 가져와 기존 resumable upload를 통해 계정별 임시 작업공간에 올린다. NAS Drive가 설치된 PC에서는 동기화 루트도 일반 파일 선택기로 선택할 수 있다. 웹페이지가 사용자 승인 없이 PC 임의 경로를 읽게 하지 않는다.
- 처리 구조 제안: 서버 job queue와 격리 worker에서 LibreOffice/PDF 도구 기반 호환 처리를 수행하고, Microsoft Office·한컴·유료 글꼴이 필요한 고정밀 변환은 향후 장치 Agent의 명시적 로컬 작업 capability로 분리한다. 매크로 실행 금지, 입력 크기·페이지·시간 제한, temp TTL 정리, quota, realpath 계정 경계, 결과 원자 저장, 작업 취소·재시도를 기본 규칙으로 둔다.
- 출력 구조: 기본은 사용자가 고른 NAS 폴더에 결과를 저장하고 파일관리자에서 즉시 열며, 필요하면 이 기기로 다운로드한다. 로컬 네이티브 작업을 추가할 때만 사용자가 고른 PC 폴더 저장을 지원한다. 원본은 수정하지 않고 결과와 작업 manifest를 별도로 만든다.
- 현재 상태: 기획 검토만 완료했으며 코드·서비스·네트워크·Office/HWP 설정은 변경하지 않았다. 다음 안전한 단계는 1차 범위를 `PDF 합치기 + Office/PPTX→PDF 변환 + NAS/기기 이중 선택 + NAS 결과 저장`으로 정하고 UI·job API·worker·보안 테스트를 구현하는 것이다.

### 기기 파일 불러오기 한계 표현 교정

- 사용자 교정: `웹페이지가 사용자 허락 없이 PC 임의 경로를 읽을 수 없다`는 일반 보안 설명을 이번 기능의 중요한 한계처럼 강조할 필요가 없다. NAS 플랫폼에는 이미 업로드 버튼의 다중 `<input type="file">`, `handleFileUpload`, `TransferContext.startUpload` 기반 파일 불러오기와 재개 가능한 업로드가 구현돼 있다.
- 정정된 기획: `문서 스튜디오`의 `이 기기에서 불러오기`는 기존 파일 선택·업로드 흐름을 그대로 재사용하면 된다. 사용자가 기대한 일반적인 파일 불러오기는 현재 기술 구조에서 바로 가능하며, 별도 NAS Drive Agent나 신규 로컬 파일 접근 권한은 필요하지 않다. Agent 검토는 향후 Microsoft Office/한컴 원본 프로그램을 직접 실행하는 고정밀 변환에만 해당하고 파일 선택 자체의 조건이 아니다.
- 현재 상태: 설명과 기획 경계만 교정했으며 기능 코드는 변경하지 않았다. 다음 구현에서는 `NAS에서 선택`과 기존 `이 기기에서 불러오기`를 같은 입력 목록으로 합치는 것으로 시작한다.

## 2026-08-31 `문서 스튜디오` 1차 기능 구현

- 사용자 요청: 기획이나 한계 설명에서 멈추지 말고, NAS 내부 파일과 현재 기기 파일을 실제로 불러와 문서 작업을 수행하는 기능을 구현한다.
- 구현 범위: 플랫폼 독립 창 `문서 스튜디오`에 `PDF로 변환`, `PDF 합치기`, `혼합 문서 합치기` 모드를 추가했다. NAS 선택기는 로그인 계정의 파일 목록을 사용하고, `이 기기에서 불러오기`는 기존 `TransferContext.startUpload`의 재개 가능한 업로드를 그대로 재사용해 두 출처를 하나의 순서 목록으로 합친다. 목록은 끌어놓기·위/아래 이동·순서 반전·제거를 지원한다.
- 서버 처리: 인증된 사용자 저장소 내부의 일반 파일만 입력으로 허용하고 symlink·미지원 확장자·40개 초과·합계 4GB 초과를 거부한다. LibreOffice와 `pdfunite`는 `shell: false` 및 작업별 격리 profile/HOME에서 실행하며, 원본을 변경하지 않고 계정별 완료 폴더에 quota 확인 후 고유 이름으로 원자 이동한다.
- 검증 상태: 로컬 정책·서비스 단위 테스트 5개가 통과했고 Linux 도구가 필요한 실변환 통합 테스트는 NAS에서 실행하도록 추가했다. 다음 단계는 기능 commit을 push하고 NAS에서 실제 LibreOffice 변환·PDF 결합, production build, 공개 화면 입력·결과 열기까지 검증하는 것이다.

### `문서 스튜디오` GitHub·NAS 배포 및 실화면 검증

- 기능 commit `dd4b58f`와 warning 정리 commit `74064a3`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 fast-forward로 받았다.
- NAS에서 실제 ODT 두 개를 LibreOffice로 PDF 변환하고 `pdfunite`로 결합하는 Linux 통합 테스트를 통과했다. 전체 backend tests는 14/14, frontend 문서 선택 정책은 2/2를 통과했다. production build와 PDF.js 호환 gate는 `react-pdf 9.2.1 / PDF.js API+Worker 4.8.69` 일치를 확인했고 live/build index는 모두 `main.fc9c82b0.js`다.
- 실제 로그인 Chrome의 공개 `ServicePlatform`에서 `문서 스튜디오` 아이콘과 독립 창, 세 가지 mode, `NAS에서 불러오기`, `이 기기에서 불러오기`, 순서 편집, 완료 경로 UI를 확인했다. NAS picker로 `제인 진 대화.docx`, `제인 진 코칭대화(영문).docx`를 선택해 혼합 결합을 실행했고 `/문서 스튜디오/완료 파일/문서 스튜디오 실화면 검증.pdf`가 생성됐다. 결과 열기에서 PDF canvas 20개와 본문 text layer가 정상 렌더됐다. 현재 기기 버튼은 Chrome native file chooser를 실제 호출하며 기존 `TransferContext.startUpload` 경로에 연결된다.
- `msp-backend`를 restart/save한 뒤 online을 확인했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이고 내부 3030·공개 HTTPS는 HTTP 200이다. 원본 DOCX와 Cloudflare/DNS/nginx/OnlyOffice/HWP 설정은 변경하지 않았다.
- workbook의 `Request_Archive`, `Patch_Log`, `Feature_Index`, `Relation_Map`, `Do_Not_Break`, `Code_Map`, `Office_Viewers`, `API_Routes`를 갱신했다. formula error 0, 관련 범위 렌더와 API route 열 구조를 확인했다. 1차 범위 밖인 PPTX 원본 합치기, 템플릿 일괄 만들기, Microsoft Office·한컴 네이티브 고정밀 변환은 후속 기능으로 명시했다.

## 2026-08-31 문서 스튜디오 결과 창 전면 활성화·원본→결과 형식 선택 확장

- 사용자 요청: 문서 스튜디오에서 결과 `열기`를 눌렀을 때 새 파일 창이 작업 창 뒤에 숨지 않고 즉시 가장 앞으로 와야 한다. 변환 모드는 파일보다 먼저 `원본 형식 → 결과 형식`을 명시적으로 고르고, 자동 감지·원본 직접 선택·실제 가능한 결과만 표시·선택 형식별 파일 필터·`PPTX 12개를 PDF로 변환` 형태의 실행 문구를 제공한다. 1차 미구현 범위와 겹치는 다중 결과 형식도 함께 구현한다.
- 원인: 각 결과 파일 창은 새 z-index와 focus를 받았지만 `GlobalAppWindowLayer` 부모가 z-index 80 stacking context로 고정돼 NAS 파일 창 부모 z-index 30보다 항상 위였다. 변환 서비스도 출력 형식을 PDF로 하드코딩해 UI만으로는 DOCX·PPTX·XLSX 등 결과를 만들 수 없었다.
- 구현: 포커스가 앱 창이면 앱 layer 80, 파일·폴더 창이면 앱 layer 20으로 전환해 기존 단일 WindowContext의 focus/z-index를 실제 화면 순서에 반영한다. 변환 화면에 원본/결과 selector를 파일 선택보다 앞에 두고, 원본 직접 선택 시 NAS picker와 native file input accept를 같은 확장자로 제한한다. 자동 감지는 선택 파일들의 output 교집합만 표시하고 실행 버튼에 원본·수량·결과를 명시한다.
- 서버 확장: presentation은 PDF/PPTX/ODP, text document는 PDF/DOCX/ODT/RTF, spreadsheet는 PDF/XLSX/ODS/CSV를 지원한다. 동일 형식은 원본을 변경하지 않고 결과 폴더에 복사하며 다른 형식은 작업별 격리 LibreOffice profile에서 변환한다. PDF 합치기 흐름은 유지한다. 현재 NAS에 입력 filter가 없는 HWP/HWPX/CELL/NXL은 거짓 성공 옵션을 표시하지 않고 `변환 도구 준비 필요`로 비활성화한다.
- 사전 검증: backend 정책 3/3, frontend 형식·layer 정책 4/4가 통과했다. Linux LibreOffice 실변환 통합 테스트, production build, 공개 UI의 형식 필터·버튼 문구·결과 창 전면 활성화는 NAS 배포 후 확인한다.

### 형식 변환·결과 창 GitHub·NAS 배포 및 실화면 검증

- 기능 commit `c90148e`와 결과 뷰어 확장 commit `a1bfb83`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push하고 NAS live worktree가 fast-forward로 받았다.
- NAS Linux에서 기존 ODT 두 개→PDF 결합, ODT→DOCX 실제 변환, ODT→ODT 바이트 동일 결과 복사를 모두 통과했다. backend 문서 스튜디오 tests 5/5, frontend 형식·창 layer·Office 결과 routing tests 6/6이 통과했다. production build와 PDF.js 호환 gate도 통과했고 최종 live bundle은 `main.6d69cb07.js`다.
- 공개 로그인 Chrome에서 변환 모드 첫 단계에 `원본 형식 → 결과 형식`이 파일 선택보다 먼저 표시되는 것을 확인했다. DOCX 직접 선택 시 결과는 PDF/DOCX/ODT/RTF만 표시됐고 NAS picker에는 DOCX만 남았다. 파일 두 개 선택 후 실행 버튼은 `DOCX 2개를 DOCX로 변환`으로 표시됐다.
- 동일 형식 결과 두 개를 실제 저장했고 `원본 형식 유지 복사`로 표시됐다. 이어 DOCX→ODT를 공개 UI에서 실행해 `제인 진 대화.odt`를 만들고 결과 `열기`를 눌렀다. 새 ODT 파일 창이 문서 스튜디오보다 앞에 즉시 활성화됐고 OnlyOffice iframe에서 실제 본문이 렌더됐다.
- 검증 중 ODT/ODS/ODP/RTF가 생성돼도 기존 WindowContext가 일부를 text로 오인할 수 있는 추가 회귀를 발견해 공통 `officeFormats` 정책으로 보강했다. 지원 결과는 모두 binary viewer 경로를 타며 ODT/RTF→word, ODS/CSV→cell, ODP→slide editor로 분기한다.
- 현재 NAS에 서버 입력 filter가 없는 HWP/HWPX/CELL/NXL은 source 목록에 `변환 도구 준비 필요`로 비활성 표시한다. 겉보기 선택지만 만들고 실행 시 실패시키지 않는다. PPTX 원본 슬라이드 합치기와 템플릿 일괄 만들기는 이번 형식 변환·창 순서 요청과 직접 겹치지 않아 후속 독립 기능으로 남긴다.

## 2026-08-31 문서 스튜디오 남은 기능 전체 구현

- 사용자 요청: 직전 답변에서 미완료라고 밝힌 문서 스튜디오 기능을 전부 구현한다. 범위는 PPTX 슬라이드 합치기, PPTX 템플릿 일괄 생성, 진행률·취소·재시도, 오류·새로고침·서비스 재시작 복구, 원본/결과 미리보기, 글꼴 진단, HWP/HWPX/CELL/NXL의 안전한 실제 변환 엔진 연결이다.
- 비동기 작업 수명: `POST /api/document-studio/jobs`로 작업을 시작하고 status/cancel/retry API로 제어한다. 작업은 로그인 계정 owner key로 격리되고 입력·출력은 계정 root realpath 안에서 다시 검증한다. 외부 프로세스에는 AbortSignal을 전달해 취소 시 종료하며, 전 결과가 격리 workspace에서 완성되고 quota를 통과한 뒤에만 완료 폴더로 원자 publish한다. 취소·실패 때 부분 결과는 남지 않는다.
- 복구: job 상태는 비밀값 없이 NAS incoming 영역에 권한 600 JSON으로 저장한다. 브라우저는 active job ID를 localStorage에 기억해 새로고침 후 polling을 재연결한다. PM2 재시작으로 queued/running 작업이 끊기면 `failed`와 `canRetry=true`로 복구하며 같은 입력으로 재시도할 수 있다. 성공·실패·취소 기록은 6시간 뒤 정리한다.
- PPTX 병합: `pptxPackageService`가 첫 deck을 기준으로 추가 slide와 연결된 media, chart, embedding, notes, layout, master, theme 관계를 재귀 복사·재명명하고 presentation relationship/id와 `[Content_Types].xml`을 함께 갱신한다. 단순 slide XML 연결로 디자인 관계가 깨지는 방식을 사용하지 않는다.
- PPTX 템플릿: 첫 행 열 이름과 1~200개 데이터 행을 탭 또는 CSV로 입력하고 `{열 이름}` 기반 파일명과 본문을 바꿔 PPTX 또는 PDF를 만든다. PowerPoint가 placeholder를 여러 `<a:t>` style run으로 나눈 경우도 하나의 placeholder로 인식해 치환한다. 원본 package와 디자인 요소는 그대로 유지한다.
- 미리보기·글꼴: 각 입력에 `원본 미리보기`, 각 결과에 기존 PDF/OnlyOffice `열기`를 제공한다. OOXML 내부 글꼴을 추출해 NAS fontconfig의 실제 family 일치 여부를 검사하고 누락 글꼴을 결과에 경고한다. 라이선스가 확인되지 않은 글꼴을 자동 다운로드하거나 조용히 다른 글꼴로 대체했다고 표시하지 않는다.
- 한컴·한셀 경계: NAS LibreOffice에는 HWP/HWPX/CELL/NXL 입력 filter가 없다. `DOCUMENT_STUDIO_NATIVE_CONVERTER`가 신뢰된 절대경로 실행 가능 파일로 연결된 경우에만 HWP/HWPX→PDF/DOCX/ODT, CELL/NXL→PDF/XLSX/ODS 조합을 capabilities에 동적으로 노출한다. 실행은 `spawn(shell:false)`의 분리 인자 프로토콜을 사용하고 실행 파일 경로는 클라이언트에 노출하지 않는다. 현재 live NAS에는 해당 native engine이 설치되지 않아 이 네 형식은 계속 비활성 상태이며 가짜 성공을 만들지 않는다.

### 최종 GitHub·NAS 배포 및 실제 화면 검증

- 기능 commit `d35fa05`와 템플릿 결과 형식 유지 수정 commit `eae96ef`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 fast-forward로 받았다. backend `npm ci`, frontend `npm ci`, production build와 PDF.js API/Worker 4.8.69 gate가 통과했다. 최종 live bundle은 `main.5e18785b.js`다.
- NAS 전체 backend tests 18/18과 frontend 관련 tests 6/6이 통과했다. backend에는 기존 Linux LibreOffice ODT→PDF/DOCX·PDF 결합 테스트와 새 PPTX package merge, 단일·run 교차 template 치환 테스트가 모두 포함된다.
- 공개 로그인 Chrome에서 다섯 모드와 PPTX 템플릿 UI를 확인했다. 실제 PPTX template의 `{이름} {수료과정}`을 `홍길동 NAS 기초`로 바꿔 `/문서 스튜디오/완료 파일/홍길동.pptx`를 생성했고 archive 내부 문자열과 OnlyOffice 전면 창 열기를 확인했다.
- 공개 UI에서 PPTX 두 개를 병합해 `합친 프레젠테이션.pptx`를 생성했다. 결과 package에 slide XML 2개가 있으며 OnlyOffice가 실제로 열고 `Slide 1 of 2`를 표시했다.
- 80행 템플릿 작업을 시작 즉시 취소해 진행 상태가 `cancelled`, 재시도 가능으로 바뀌고 `취소검증-*` 결과가 0건임을 확인했다. 새로고침 뒤 cancelled/retry가 복구됐고 재시도 후 다시 취소할 수 있었다. 이어 실행 중 PM2를 재시작해 `NAS 서비스가 다시 시작되어 작업이 중단됨`과 재시도 버튼이 복구되는 것을 실제 화면에서 확인했다.
- 최종 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active, `msp-backend`는 online, 내부 `127.0.0.1:3030`과 공개 `https://filemanager-nas.com`은 HTTP 200이다. Cloudflare/DNS/nginx/OnlyOffice/HWP 설정은 변경하지 않았다.
## 2026-08-31 `문서 변환` 이름 분리·새 `문서 스튜디오` 개인 작업대 구현

- 사용자 요청: 기존 플랫폼 앱 `문서 스튜디오`의 이름을 `문서 변환`으로 바꾸고, RHWP 한글 편집기와 OnlyOffice 편집기를 한곳에서 사용하는 폴라리스오피스형 개인 문서 작업대를 새 `문서 스튜디오` 앱으로 만든다.
- 이름·호환성: 기존 변환 기능의 내부 `document-studio` ID, job localStorage key, `/api/document-studio`, `/문서 스튜디오/작업 파일·완료 파일`은 기존 작업 복구와 저장 경로 호환성을 위해 유지하고 화면 표시명과 제목만 `문서 변환`으로 바꿨다. 새 작업대는 별도 `document-workspace` ID와 `문서 스튜디오` 이름으로 플랫폼·전역 앱 창에 등록했다.
- 작업대 1차 기능: DOCX/XLSX/PPTX/HWP/HWPX 새 문서 카드, 편집 가능한 NAS 문서 선택, 최근 수정 문서 12개, 최근 목록 새로고침, 기존 `문서 변환` 앱 바로가기를 제공한다. 새 파일과 선택 파일은 `WindowContext.openFileWindowByPath(..., true)`로 열어 OnlyOffice 또는 RHWP 편집기가 작업대보다 앞에 즉시 활성화된다. HWP/HWPX에는 `preferEditMode`를 전달해 뷰어가 아니라 편집 탭으로 진입한다.
- 새 문서 API: `POST /api/document-workspace/documents`는 로그인 계정 root 안의 폴더만 사용하고 지원 형식 allowlist, 정리된 파일명, realpath, quota, 기존 이름 충돌 시 고유 이름, 권한 600 임시파일과 원자 rename을 적용한다. DOCX/XLSX/PPTX는 필수 OOXML package를 만들고 HWP/HWPX는 RHWP `HwpDocument.createEmpty()`의 실제 export를 사용한다. 기존 파일을 덮어쓰지 않는다.
- 사전 검증: backend 문법 검사와 blank OOXML package 단위 테스트를 통과했다. RHWP WASM에서 빈 문서를 실제 생성해 HWP OLE signature와 HWPX ZIP signature를 확인했다. 로컬 frontend production build는 이번 변경과 무관한 기존 eslint warning만 남기고 성공했다. Windows 로컬 전체 Jest는 기존 `canvas.node` native binding 부재 때문에 시작 전 실패해 NAS Linux에서 다시 실행한다.
- 다음 안전한 단계: 기능·워크북·릴레이를 활성 브랜치에 push하고 NAS에서 backend/frontend tests, 실제 DOCX/XLSX/PPTX/HWP/HWPX 생성·편집기 열기, 공개 플랫폼의 두 앱 이름과 최근 문서 화면을 확인한 뒤 최종 검증 내용을 같은 기록에 추가한다.

### GitHub·NAS 배포 및 검증 경계

- 기능·워크북·릴레이 commit `d1482ff`를 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다. NAS frontend `npm ci`와 production/PDF.js gate가 통과했으며 live `/var/www/html`은 hashed asset을 먼저 복사하고 index를 마지막에 원자 교체해 `main.dd0a4a9b.js`를 제공한다.
- NAS backend 전체 test file은 모두 통과했다. 문서 스튜디오 관련 Linux 통합 테스트는 ODT→PDF/DOCX·PDF 결합을 포함한다. 새 빈 DOCX/XLSX/PPTX는 NAS LibreOffice에서 각각 1페이지 PDF로 실제 열기·변환되어 package 유효성을 확인했다. RHWP `createEmpty`는 HWP OLE·HWPX ZIP 파일을 실제 export했다.
- frontend 기능·정책 테스트 18개는 통과했다. 기본 `App.test.js` 하나는 이번 기능이 아니라 기존 Node 18/Jest resolver가 설치된 React Router 7 package를 찾지 못해 suite 시작 전에 실패했다. production build는 기존 unrelated eslint warning만 남기고 성공했고 PDF.js API/Worker 4.8.69 일치를 확인했다.
- `msp-backend`는 restart/save 후 online이고 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 active다. 내부 3030과 공개 HTTPS는 HTTP 200, 새 문서 API의 비로그인 요청은 401로 차단된다.
- NAS Drive는 일회용 웹 세션을 정상 발급해 Chrome을 열었지만, 열린 프로필 창이 기존 Browser 연결 밖에 있었고 Windows 화면 제어는 현재 Chrome URL을 충분히 확정하지 못해 안전상 자동 중단됐다. 따라서 공개 화면의 두 앱 이름·생성 버튼·OnlyOffice/RHWP 전면 창은 이번 배포에서 `확인 필요`로 남긴다. 다음 안전한 단계는 사용자가 로그인된 Chrome 탭을 열어 둔 상태에서 해당 세 항목만 실화면 회귀 확인하는 것이다.
## 2026-08-31 NAS 채팅 전송 지연·중복 전송 원인 진단

- 사용자 요청: NAS 채팅에서 메시지를 입력하고 전송할 때 체감 지연과 문제가 있는데 어느 구간이 원인인지 확인한다. 이번 요청은 바로 수정하지 않고 원인부터 특정한다.
- 확인한 경로: 공개 Chrome의 실제 사이드 채팅, `DockedChatPanel.handleSend` → `ChatContext.sendMessage` → `POST /api/chat/messages` → `chatStore.createMessage` → `notificationStore.createNotification` → 수신자 `chat:message` Socket.IO 순서를 확인했다.
- 주 원인: 발신 화면은 HTTP 응답이 돌아온 뒤에야 메시지를 append하고 draft를 지운다. 그동안 전송 버튼과 Enter가 잠기지 않으며 clientMessageId·낙관 메시지·서버 idempotency가 없어 재클릭을 별도 메시지로 저장한다. 실제 공개 대화에서 같은 문장이 같은 분에 연속 두 번 표시된 흔적이 현재 구조와 일치한다.
- 서버 경계: 응답 전에 messages/conversations/notifications JSON 전체를 동기식으로 읽고 다시 저장한 뒤 socket을 전파한다. 그러나 현재 live 데이터는 messages 15건 약 9.5KB, conversations 15건 약 9.9KB, notifications 186건 약 113KB이고 NAS load average는 0.01/0.05/0.13, 디스크 사용률은 9%였다. 500회 읽기·parse·stringify 벤치마크도 1ms 안팎이어서 현재 체감 지연의 단독 주원인은 서버 과부하나 JSON 크기가 아니라 HTTP 완료를 기다리는 UI 계약이다. 동기식 전체 재작성은 데이터 증가 시 별도 확장 위험이다.
- 미수정·검증 경계: 사용자 계정으로 새 테스트 메시지를 전송하지 않았고 코드·서비스는 변경하지 않았다. 다음 안전한 수정은 clientMessageId 기반 낙관 표시와 즉시 draft 비우기, 전송 중 중복 방지, 실패 시 복원·재시도, 서버 idempotency를 한 묶음으로 적용하고 클릭→POST→저장→socket→상대 표시 타임라인을 계측하는 것이다.
- 기록: workbook의 `Request_Archive`, `Patch_Log`, `Feature_Index`, `Relation_Map`, `Code_Map`, `Do_Not_Break`에 진단·미수정 상태와 회귀 방지 규칙을 기록했다.

## 2026-08-31 문서 스튜디오 RHWP 커서·저장·단축키 안정화

- 사용자 요청: 새 문서 스튜디오의 한글 편집 화면에서 글자 입력 커서가 깜빡이지 않고, `Ctrl+S` 저장 시 `charPrIDRef` 계열 오류가 발생한다. 저장뿐 아니라 인쇄 등 일반 문서 작업 단축키가 문서 내부에서 정상 동작하는지도 실제 화면으로 검증한다.
- 실제 재현: 공개 로그인 Chrome에서 `/문서 스튜디오/새 한글 문서.hwpx`를 RHWP 에디터로 열었다. 편집기의 `.caret`는 `height: 0px`, `opacity: 0`이었고 `Ctrl+S` 직후 상위 창에 `렌더링 오류: XML 쓰기 실패: 미등록 ID 참조 발견: charPrIDRef: [0]`가 표시됐다.
- 근본 원인: 새 HWPX API가 `HwpDocument.createEmpty().exportHwpx()`를 그대로 저장했다. 이 결과의 `Contents/section0.xml`은 `charPrIDRef="0"`을 참조하지만 `Contents/header.xml`의 `refList`는 비어 있다. 처음 열기는 가능해도 다음 HWPX 직렬화에서 참조 무결성 검사가 실패하며, 유효한 문자 스타일과 줄 형상이 없어 빈 문서 캐럿 높이도 0으로 남았다. 같은 과정을 최신 `@rhwp/core 0.8.4`에서도 메모리 왕복으로 재현해 단순 SDK 버전 충돌이 아님을 확인했다.
- 구현: `@rhwp/core`·`@rhwp/editor`와 self-hosted rhwp-studio를 0.8.4로 맞추고 최신 편집기 캐럿·인쇄·저장 왕복 개선을 반영했다. 새 HWPX는 upstream의 실제 빈 HWPX template을 사용해 등록된 char/para/style 참조를 보장한다. 이미 생성된 불량 HWPX는 `exportHwpx()`의 미등록 스타일 참조 오류만 식별해 `exportHwp()`로 자동 복구하고 원본 HWPX를 덮어쓰지 않은 `.hwp` 파일로 NAS 저장/다운로드한다.
- 단축키 경계: 상위 NAS wrapper는 `Ctrl+S`와 `Ctrl+Shift+S`만 각각 NAS 저장·다른 이름 저장으로 가로챈다. `Ctrl+P`, 실행 취소/다시 실행, 복사/붙여넣기, 선택, 찾기, 글자 서식 등은 iframe의 rhwp-studio에 그대로 전달한다. 에디터 load 뒤 iframe과 `#scroll-container`를 focus해 키보드 입력과 캐럿 활성화가 안정적으로 시작되게 했다.
- 사전 검증: 새 blank HWPX가 등록된 `charProperties`와 `charPrIDRef=0`을 함께 가지며 RHWP parse→exportHwpx→reopen에서 1페이지로 왕복되는 backend test가 통과했다. 기존 불량 오류의 HWP fallback, 확장자 교체, `Ctrl+S`/`Ctrl+Shift+S`만 intercept하고 `Ctrl+P`/`Ctrl+Z`는 통과시키는 frontend tests 4/4가 통과했다. production build와 PDF.js API/Worker 4.8.69 gate도 성공했다. 다음 단계는 commit/push, NAS 배포, 새 문서와 기존 불량 문서에서 커서·저장·인쇄 실화면 검증이다.

### RHWP GitHub·NAS 배포 및 공개 실화면 검증

- 기능 commit `d31bf52`와 Studio 저장·인쇄 UI 정합성 commit `dbbee8a`를 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다. NAS backend 전체 test files 12/12, frontend 저장 정책 4/4, production build와 PDF.js API/Worker 4.8.69 gate가 통과했다. 최종 live bundle은 `main.fc61bdf2.js`다.
- 공개 로그인 Chrome의 새 탭에서 최신 bundle을 확인하고 `/문서 스튜디오/RHWP 단축키 검증 20260831.hwpx`를 실제 생성·편집했다. 캐럿 높이는 13.0498px이고 220ms 간격 표본에서 opacity가 1과 0으로 반복되어 실제 깜빡임을 확인했다. 입력 뒤 `Ctrl+S`는 `NAS에 저장되었습니다.`로 완료됐고 charPrIDRef·렌더링 오류는 0건이었다.
- `Ctrl+P`는 `RHWP 단축키 검증 20260831.hwpx — 1페이지` 인쇄 미리보기와 `인쇄/닫기` 버튼을 새 창에 만들었다. 실제 프린터 선택·출력은 사용자 OS 단계라 실행하지 않고 미리보기 생성 후 닫았다. `Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+F`, `Ctrl+B`는 NAS wrapper에 막히지 않고 rHWP Studio에 전달됐으며 찾기 창의 열기·Escape 닫기를 확인했다.
- Studio 메뉴의 인쇄·PDF 저장 disabled 표시는 제거하고 HWPX 상태 문구를 `HWPX 원본 형식으로 NAS에 저장합니다`로 맞췄다. rHWP 자체의 오래된 HWPX→HWP 강제 변환 toast는 NAS 저장 계약과 달라 제거했다. `Ctrl+S`/`Ctrl+Shift+S`만 NAS 저장 wrapper가 계속 처리한다.
- 과거 잘못 생성된 `/문서 스튜디오/새 한글 문서.hwpx`에서 `Ctrl+S`를 다시 실행했다. 기존 HWPX 원본은 그대로 보존됐고 `/문서 스튜디오/새 한글 문서.hwp`가 별도 복구 저장됐으며 화면에는 `기존 HWPX의 스타일 참조 오류를 복구해 NAS에 새 한글 문서.hwp 파일로 저장했습니다.`가 표시됐다. 검증용 새 HWPX와 복구 결과 HWP는 사용자 확인을 위해 삭제하지 않았다.
- 최종 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이고 `msp-backend`는 online이다. 내부 3030과 공개 HTTPS는 HTTP 200이다. workbook의 Request/Patch/Feature/Relation/Code/Do_Not_Break/Office_Viewers를 실제 검증 결과로 갱신했고 formula error 0, 전체 시트 렌더와 변경 범위 시각 검사를 통과했다.

## 2026-08-31 NAS Drive 재설치 업데이트 버튼 누락 수정

- 사용자 보고: 이미 NAS Drive가 설치된 PC에서 더 새 버전의 설치 프로그램을 다시 내려받아 실행했지만, 화면의 설치 버전과 현재 버전이 분명히 다른데도 `이미 설치되어 있습니다`라고 나오고 `업데이트` 버튼이 표시되지 않았다.
- 현재 PC 직접 확인: `%LOCALAPPDATA%\Programs\NAS Drive`의 `NAS-Drive.exe`는 FileVersion 1.10.22.0인데 `agent-version.txt`는 1.10.21로 남아 있었다. 설치된 Agent 실행 파일의 SHA는 당시 서버가 배포한 Agent와 같았다. 즉 자동 업데이트가 실행 파일만 바꾸고 표시용 버전 표식을 갱신하지 않은 상태였다.
- 근본 원인: Agent 자동 업데이트는 `NAS-Sync-Agent.exe`만 교체하고 `agent-version.txt`를 갱신하지 않았다. Setup의 `ResolveInstallState`는 의미 버전 비교 전에 Agent SHA 일치를 검사해 설치 버전 표식이 오래됐더라도 같은 파일이면 `SameVersion`으로 끝냈다. 설치 상태 판정에도 `NAS-Drive.exe` 런처 버전·존재·건강 상태가 포함되지 않아 Agent만 최신이고 런처는 구버전인 부분 업데이트 상태를 놓쳤다.
- 구현: 제품 버전을 1.10.23으로 올렸다. Setup은 의미 버전을 먼저 비교하고, 같은 버전에서만 SHA로 `SameVersion`과 `Repair`를 구분한다. Agent 상태에 런처 FileVersion·존재·건강 상태를 합성해 런처가 오래되면 `Upgrade`, 누락·손상이면 `Repair`로 표시한다. 자동 Agent 업데이트가 성공하면 서버 metadata.version을 UTF-8 BOM 없는 `agent-version.txt`에도 기록해 실행 파일과 표시 버전을 같은 릴리스로 수렴시킨다.
- 자동 검증: 설치 상태 self-test에 `구버전 표식+동일 SHA→Upgrade`, `버전 표식 누락+동일 SHA→Repair`, `Agent 최신+런처 구버전→Upgrade`, `런처 누락/손상→Repair`를 추가했다. Agent 소스/패키지 self-test와 Setup self-test가 모두 통과했다. 관련 commit은 `f9397e1`이고 branch `cleanup/git-tracking-2026-06-08`에 push했다.
- NAS 배포: NAS live worktree가 `f9397e1`로 clean fast-forward됐고 backend test files 12/12가 통과했다. `msp-backend`는 online, 내부 3030과 공개 HTTPS는 HTTP 200이다. 최종 배포 SHA256은 Agent `f504b7e4f10df2ee2042cc7ef372abaf6af3a56301af1b49c5417e596eb45ef8`, Setup `01085048759efe8ca35c679fa625d49ed3da39fffd615a539f87f42fd0d3946b`다.
- 남은 실기 검증: 현재 PC에서 새 1.10.23 Setup을 실행하는 것은 Windows의 새 소프트웨어 실행·설치 단계이므로 행동 시점 사용자 확인 후 진행한다. 그 뒤 `업데이트` 버튼 표시, 설치 완료, 런처/Agent/`agent-version.txt` 1.10.23, 기존 로그인과 연결 상태 보존을 실제 화면과 파일 상태로 최종 확인한다.

## 2026-08-31 NAS Drive 1.10.23 UI 과도 축소 실화면 진단

- 사용자 요청: NAS Driver UI가 갑자기 너무 작아졌는데 실제로 확인 가능한지 점검한다. 이번 요청은 우선 재현과 원인 진단이며 코드는 아직 바꾸지 않는다.
- 현재 PC 상태: 설치된 `NAS-Drive.exe`와 `agent-version.txt`는 1.10.23이다. Windows `AppliedDPI`는 288로 배율 300%다. 설치된 launcher를 직접 열어 Setup과 상태 창을 모두 캡처했다.
- 실제 재현: 소스 설계 크기가 `ClientSize 660×470`인 Setup은 화면 캡처에서 약 222×181, `ClientSize 620×620`인 상태 창은 약 209×231로 보였다. 접근성 tree에는 모든 문구와 버튼이 존재했으므로 콘텐츠가 빠진 것이 아니라 전체 폼과 글자가 함께 축소된 현상이다. 진단을 위해 연 창은 확인 뒤 닫았고 tray/background는 유지했다.
- 원인 확정: launcher manifest는 `PerMonitorV2`인데 `InstallerForm`, `LoginForm`, `ControlCenterForm`, 브라우저 picker가 모두 `AutoScaleMode.None`과 고정 96-DPI 픽셀 `Point/Size/ClientSize`, 96-DPI 픽셀 `UiFont`를 사용한다. 300% 환경에서 이 좌표가 물리 픽셀로 고정되면서 논리 화면 크기가 정확히 약 1/3로 축소됐다. 과거 고DPI 잘림을 막으려 AutoScale 이중 적용을 제거한 조치가 반대 방향 축소 회귀를 만든 것이다.
- 수정 경계: Windows 전역 배율을 100%로 바꾸는 우회는 사용하지 않는다. `PerMonitorV2`를 유지하면서 96-DPI 설계 좌표·폰트·owner-draw 카드를 현재 모니터 DPI로 정확히 한 번만 확대하는 공통 layout scale이 필요하다. 100%·150%·200%·300%와 서로 다른 배율 모니터 이동에서 폼 크기, 모든 버튼·문구, picker hover/focus를 실제 화면으로 확인해야 한다.
- 기록: workbook에 `WIN-UI-DPI-SCALING`, 관련 Relation/Code map, 교정된 `WIN-UI-DPI-089`, 진단 Patch와 요청을 추가했다. formula error 0과 전체 시트 렌더·변경 범위 시각 검사를 통과했다.
- 미완료/다음 조치: 1.10.24 수정, 빌드, NAS 배포, 현재 PC 설치는 아직 하지 않았다. 사용자가 수정을 요청하면 공통 단일 DPI scale을 구현하고 자동·실화면 검증까지 이어간다.
## 2026-08-31 NAS Drive 1.10.24 고DPI 실설치 확인 + 계정별 용량 원장 구현

- 사용자 요청: 이전에 수정한 NAS Drive UI 축소 문제를 실제 PC에서 마무리하고, 설정의 사용자 역할·용량 관리를 재설계한다. 모든 계정은 기본 50GB 개인 공간을 가지며 관리자/마스터도 개인 공간을 별도로 갖되 NAS 전체 루트 접근은 유지한다. 전체 NAS 용량·사용량·사용자 할당량을 표시하고 새 계정 50GB를 안전하게 제공할 수 없으면 가입을 차단한다.
- NAS Drive 실화면: 현재 Windows 300% 배율에서 1.10.23→1.10.24 Setup의 `업데이트`를 실제 실행했다. 설치 창은 약 660px 폭으로 정상 표시됐고 완료 뒤 제어센터도 약 620px 폭에서 계정 상태·저장 위치·세 버튼이 접근성 tree에 모두 노출됐다. 현재 계정은 `계정 다시 연결 필요` 상태라 웹 관리 버튼 뒤 picker가 열리지 않았으며 인증은 자동화하지 않았다. 네 폼 300% headless layout 검사는 통과한 상태다.
- 저장공간 원인: 기존 `storageQuota.js`는 MASTER/MANAGER/globalAccess를 무제한으로 보고 quota base를 NAS_ROOT 전체로 잡았다. `/api/users/data`는 실제 사용량을 null로 반환했고 가입 요청·승인 및 사용자 일괄 저장은 물리 공간, 비계정 데이터, 전체 할당, 가입 대기 예약을 검증하지 않았다. 프론트는 rootPath 문자열과 전체 접근·개인 공간을 한 필드처럼 다뤘다.
- 구현: 관리자/마스터 포함 모든 계정을 제한된 개인 quota로 정규화하고 `personalRootPath`를 NAS 전체 접근과 분리했다. 기존 정상 사용자 custom root는 보존하고 `/`였던 관리자 계정은 `/users/<loginId>` 개인 공간을 자동 준비한다. MASTER/MANAGER는 기존처럼 NAS 루트를 탐색할 수 있으나 개인 사용량·할당량은 자신의 개인 root에서만 계산한다.
- 용량 원장: statfs의 전체/여유, 실제 사용자 개인 사용량, 비계정 사용량, 안전 여유분(전체 5%와 10GiB 중 큰 값), 승인 계정 할당, 가입 대기자당 50GiB 예약을 바이트 정수로 합산한다. 추가 할당 가능 용량은 논리 quota pool과 물리 안전 여유 중 작은 값이며 50GiB 미만이면 `signup-capacity`와 `signup-request`가 신규 가입을 차단한다. quota 축소는 실제 사용량 미만, 증설은 안전 pool 초과를 거부한다. 덮어쓰기는 기존 파일 크기를 뺀 증가분만 검사하고 관리자의 개인 root 밖 관리 작업은 개인 quota와 분리하되 물리 안전 여유는 항상 검사한다.
- 권한·UI: MANAGER는 일반 사용자 quota만 관리하고 역할 변경은 MASTER만 가능하다. 기본 admin 역할·전체 접근과 마지막 MASTER는 보호한다. 설정 화면에는 전체 NAS·사용·여유, 사용자 할당, 가입 대기 예약, 개인 실사용, 추가 할당 가능, 안전 여유와 계정별 역할·개인 경로·할당/사용량이 표시된다. 가입 화면은 기본 50GB 제공 가능 여부를 안내하고 부족하면 버튼을 비활성화하되 최종 권한은 서버 재검증에 둔다.
- 로컬 검증: backend syntax, 신규 capacity ledger 3건과 기존 hardlink quota 테스트를 통과했다. 전체 backend는 22건 중 19건 통과·2건 환경 skip이며 기존 Windows 비관리자 symlink 생성 EPERM 한 건만 실패해 NAS Linux 재검증 대상으로 남았다. frontend production build와 react-pdf/PDF.js 4.8.69 검사를 통과했고 이번 변경 파일의 새 ESLint 경고는 없다. workbook은 관련 Feature/Relation/Code/API/DNB/Patch/Request를 갱신하고 formula error 0, 인코딩 의심 0, 전체 시트 렌더를 확인했다.
- 미완료/다음 조치: 이 시점에는 NAS live 배포 전이다. 같은 브랜치에 push한 뒤 NAS fast-forward, Linux 전체 테스트, PM2 재시작, 내부/공개 HTTP, 실제 계정 원장 값·개인 폴더·관리자 화면·가입 가능 API를 검증하고 결과를 다시 기록한다.

### 계정별 용량 원장 NAS 배포·실데이터·공개 화면 최종 검증

- 기능 commit `31914a6`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다. NAS Linux 전체 backend tests 22/22와 frontend production build, react-pdf/PDF.js 4.8.69 호환 gate가 통과했다. 최종 live bundle은 `main.27c89384.js`다.
- 기존 계정 20개를 실데이터로 점검했다. 전 계정이 제한된 개인 quota와 personalRootPath를 가지며 개인 폴더가 준비됐고, MASTER의 개인 root는 NAS root와 분리됐다. 관리자/마스터의 NAS 전체 루트 탐색 권한은 그대로 유지된다.
- live 원장은 전체 약 1.79TiB, 물리 사용 약 173.5GiB, 계정 개인 실사용 약 1.54GiB, 비계정 사용 약 172.0GiB, 승인 계정 할당 약 1.15TiB, 안전 여유 약 91.6GiB, 추가 할당 가능 약 419GiB로 계산됐다. 가입 대기자는 0명이며 공개 `GET /api/signup-capacity`는 기본 50GiB를 제공할 수 있어 `signupAvailable=true`를 반환했다.
- 공개 회원가입 페이지를 새 브라우저 세션에서 직접 열었다. 비동기 용량 조회 후 `승인된 계정에는 기본 개인 저장공간 50GB가 제공됩니다.` 안내가 표시됐고 현재 원장이 충분하므로 회원가입 요청 버튼이 활성 상태였다. 관리자 설정 화면은 별도 로그인 세션이 필요해 이번 새 세션에서는 로그인 화면까지 확인했으며, 운영 역할·용량 값을 임의로 저장하는 변경 검증은 하지 않았다. 관리자 표시 데이터는 인증된 NAS 내부 읽기 전용 점검으로 실원장과 대조했다.
- 실제 공간이 기본 50GiB 미만인 경계, 가입 대기 예약, 비계정 사용, quota pool 초과 거부는 자동 회귀 테스트로 확인했다. 운영 NAS를 일부러 채우거나 가짜 가입 요청을 만들지 않았다. 서버가 가입 요청 시 다시 계산하므로 화면이 오래 열려 있어도 초과 가입은 507 `SIGNUP_STORAGE_FULL`로 거부된다.
- `msp-backend`를 restart/save한 뒤 online을 확인했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이고 내부 3030·공개 HTTPS는 HTTP 200이다. 전환 전 회원 데이터 백업은 저장소 밖 `/home/limchanyoung/runtime-backups/my-service-platform/storage-ledger-20260831`에 보존했으며 Git worktree는 clean이다.

## 2026-08-31 NAS 파일 창 전체화면 상단 플랫폼 바 가림

- 사용자 요청: 파일·폴더 창에서 전체화면 크기 보기를 사용하면 NAS 상단 플랫폼 바까지 가려지고 화면 전체를 사용해야 한다. 이 작업이 끝나면 NAS 서버에서 가능한 AI 기능도 전반적으로 조사한다.
- 원인: 파일 창의 `isImmersive`는 창 크기만 부모 NAS workspace의 100%로 바꿨다. workspace 자체는 48px 전역 `TopBar` 아래의 main 영역과 낮은 stacking layer 안에 있어 브라우저 Fullscreen API가 거부되거나 지연되면 상단 바가 계속 남았다.
- 구현: 표시 중인 file/folder 창 하나라도 `isImmersive`이면 NAS workspace layer를 `position: fixed`, `100vw × 100dvh`, z-index 1600으로 승격해 TopBar·채팅 창 layer까지 덮는다. 일반 최대화와 백그라운드 NAS route의 기존 pointer/z-index 규칙은 유지한다.
- 사전 검증: 새 fullscreen layout policy tests 3/3과 frontend production build가 통과했다. 기존 unrelated ESLint warning만 남았고 이번 변경 파일에는 새 warning이 없다. 다음 단계는 기능·워크북·릴레이를 push하고 NAS에 배포한 뒤 공개 로그인 화면에서 전체화면 진입·상단 바 비표시·해제 복원을 직접 확인하는 것이다.

### NAS 배포 결과와 실화면 검증 경계

- 기능·문서 commit `d7a64f6`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다. NAS에서 fullscreen layout policy tests 3/3과 frontend production build, react-pdf/PDF.js 4.8.69 호환 gate가 통과했다.
- live `/var/www/html`에 원자 배포했고 최종 bundle은 `main.9db04e4a.js`다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 active, `msp-backend`는 online이며 내부 3030과 공개 HTTPS는 HTTP 200이다.
- 현재 자동화에 연결된 공개 브라우저에는 로그인된 NAS 세션이 없고 `/login` 탭만 있어 파일 창의 전체화면 진입·해제를 직접 클릭하지 않았다. 코드·회귀·NAS build·live asset 확인은 완료했지만 인증된 공개 실화면의 상단 바 비표시와 해제 복원은 `확인 필요`로 남긴다.

## 2026-08-31 NAS AI 기능·하드웨어 적합성 전반 조사

- 사용자 요청: 전체화면 작업 완료 후 현재 NAS 서버에서 가능한 AI 기능을 전부 공부하고 이후 AI 기능 개발의 기준을 만든다. 이번 요청은 조사·설계이며 운영 AI 기능이나 모델 설치를 임의로 변경하지 않는다.
- 실제 NAS 기준선: Debian 12, Ryzen 5 3400G 4코어/8스레드, RAM 21GiB, swap 약 1GiB, AMD Vega 내장 GPU, NVIDIA GPU 없음이다. root NVMe와 `/mnt/nas` 모두 약 1.8TiB이며 가용 공간은 각각 약 1.6TiB·1.7TiB다. Node 18.19, Python 3.11.2, Docker 20.10.24가 있고 Ollama/llama.cpp/vLLM/LocalAI 실행 항목은 없다.
- 현재 AI 기준선: `/api/ai/status`는 OpenAI `gpt-4.1-mini`가 enabled/configured라고 반환한다. `aiService.js`는 Responses API 우선과 Chat Completions fallback, 회의 메시지 요약을 제공한다. `aiAgentRoutes.js`는 계정 인증 채팅, 파일명 검색, 제한된 텍스트 파일 읽기, 폴더 생성·텍스트 쓰기/추가 action plan과 사용자 실행 승인을 제공한다. 계정별 AI JSON 메시지·action·preferences 저장과 chat/files/read/actions UI도 존재한다.
- 현재 빠진 기능: PDF·DOCX·XLSX·PPTX·HWP·HWPX 본문 추출과 인용형 RAG, embeddings/vector index, OCR·사진 의미 검색, 음성 전사·번역·TTS, realtime/streaming, 실제 job progress·취소, tool loop, 예약 자동화, usage/cost·사용자별 AI quota, local model fallback이 없다.
- 가능한 제품 영역: (1) ACL 인식 NAS 통합 의미 검색과 근거 인용 Q&A, (2) 문서 요약·비교·분류·태그·정보 추출, (3) 문서 스튜디오 Copilot과 템플릿/수식/슬라이드 생성, (4) dry-run·승인형 파일 정리·일괄 이름 변경·이동·복사, (5) 회의 전사·요약·결정·할 일·번역, (6) OCR·사진/스캔 문서 검색·중복/유사 이미지, (7) 영상 자막·장면/챕터 요약·TTS, (8) 저장공간 이상·대용량·중복·오래된 파일·백업/권한 감사 요약, (9) 새 파일·공유·회의 기반 예약 digest와 알림이다.
- 권장 구조: NAS는 인증·ACL, 문서 추출, revision 기반 증분 색인, cache, job queue, 승인·감사를 소유하고 OpenAI는 고품질 추론·vision·생성·realtime을 담당하는 하이브리드를 기본으로 한다. 사용자/폴더마다 `로컬 전용`, `선택 문맥만 클라우드`, `클라우드 강화` 모드를 둔다. 외부 전송은 자동 opt-in으로 만들지 않는다.
- 로컬 범위: CPU로 embeddings/rerank, OCR, whisper.cpp small/base급, 1~3B 양자화 LLM은 현실적인 benchmark 대상이다. 7~8B Q4는 RAM에는 들어갈 수 있으나 4코어 NAS의 대화형 다중 사용자 성능은 수치 측정 전 보장하지 않는다. Vega iGPU는 Ollama 공식 ROCm 지원 목록의 보장 대상이 아니므로 Vulkan 가속은 실험 경로로만 두고 CPU fallback을 유지한다. 대형 vision·이미지 생성·대형 LLM 다중 사용자 추론은 현재 장비보다 클라우드 또는 별도 GPU 서버가 적합하다.
- 구현 전 0단계 보안: 현재 AI 파일 경계는 문자열 경로 검사 뒤 `fs`가 symlink를 따라갈 수 있으므로 realpath/lstat 재검증이 필요하다. AI 쓰기는 quota·물리 안전 여유를 검사하지 않고 동기식 직접 저장하므로 임시 파일+원자 교체, 버전·감사 로그, quota/physical reserve, idempotency와 취소를 공통 action executor에서 강제해야 한다. MASTER/MANAGER의 전체 NAS scope는 개인 scope와 UI에서 분리하고 모든 파괴 가능 작업은 dry-run과 명시 승인을 유지한다.
- 신뢰성 0단계: `AI_ENABLED`를 실제 호출 경계에서 강제하고 timeout·retry·rate limit·사용량/비용 계측을 둔다. 검색 결과에는 파일·페이지/구간 출처와 ACL 필터를 붙이고, 파일 내부 지시문은 시스템 명령이 아닌 비신뢰 데이터로 격리한다. per-account JSON 저장은 원자 저장·크기/보존 제한으로 바꾸고 타이머 기반 가짜 진행 UI는 서버 job/stream 상태로 교체한다.
- 권장 구현 순서: 0) 위 안전 기반, 1) 문서 추출+권한 인식 RAG+인용, 2) 문서 Copilot+안전 파일 action, 3) 회의 전사·요약·할 일, 4) OCR·사진 검색, 5) llama.cpp/whisper.cpp 로컬 benchmark와 하이브리드 fallback, 6) 관리자 AI와 예약 자동화 순서다.

## 2026-08-31 NAS Drive 트레이 종료 후 재실행 불가 정확한 원인·1.10.26 수정

- 사용자 요청: 새 PC에서 연결이 끊긴 뒤 작업표시줄 NAS Drive 아이콘의 `종료`를 눌렀고 다시 Drive를 열었지만 트레이 아이콘이 돌아오지 않았다. 이전부터 반복된 문제이므로 종료 버튼 뒤 다시 열리지 않는 정확한 이유까지 찾아 해결한다.
- 별도 인증 상태: 현재 PC Agent 로그의 반복 실패는 서버 `HTTP 403 Agent 인증 실패`이고 control center는 `계정 다시 연결 필요`를 표시한다. 이는 아래 tray lifecycle 결함과 별개이며 폐기된 인증을 우회하지 않는다.
- 기존 수정이 놓친 경계: 1.10.14/1.10.17은 exact-path PID snapshot과 shutdown mutex를 추가했지만 snapshot 시점이 종료 요청 프로세스의 OS 생성 시각이 아니라 cleanup method 실행 시점이었다. 종료 요청을 먼저 시작해도 Windows가 곧바로 실행한 `--open`을 먼저 스케줄하면 새 launcher·Agent·Provider가 종료 snapshot이나 전역 `agent.exit`에 휩쓸릴 수 있었다.
- 실제 실패 재현: 설치된 1.10.25에서 `--shutdown-background`와 `--open`을 겹쳐 실행했다. 0ms와 10ms에서는 최종 launcher/Agent/Provider가 모두 0개가 됐고, 25ms 이상에서는 launcher 2·Agent 1·Provider 1로 복구됐다. 사용자가 본 “종료 뒤 다시 열어도 아무것도 뜨지 않음”과 같은 프로세스 경계다.
- 추가 tray 원인: `NativeTrayContext`는 상태 Icon이 null인 상태에서 `NotifyIcon.Visible=true`를 먼저 호출했다. 종료는 아이콘을 먼저 숨기고 Dispose한 뒤 cleanup을 수행하며 `finally`가 없어 예상 밖 예외 시 보이지 않는 tray mutex owner가 남을 수 있었다. 이후 중복 `--background`는 mutex가 있다는 이유로 기존 아이콘 재등록 요청 없이 종료했다.
- 1.10.26 구현: 상태 Icon을 먼저 만든 뒤 NotifyIcon을 표시한다. 중복 background는 named AutoResetEvent로 기존 tray에 Windows 알림 영역 재등록을 요청한다. 종료 cleanup은 먼저 실행하고 `finally`에서 아이콘 폐기와 `ExitThread`를 보장한다. shutdown 명령은 자신의 OS process StartTime을 cutoff로 전달해 그 이전 exact-path PID만 정리하고, cutoff 이후 새 launcher가 있으면 marker 제거 후 `--background`를 다시 보장한다.
- 현재 PC 적용·검증: Setup과 Agent 1.10.26을 실제 설치했다. 수정 뒤 0ms 두 번·5ms·10ms·25ms 총 5회 모두 launcher 2, Agent 1, Provider 1로 복구됐고 `agent.exit`는 남지 않았다. `--background`를 10회 연속 호출해도 background launcher 1, open launcher 1, Agent 1, Provider 1만 유지됐다. Agent self-test, Setup self-test, backend syntax가 통과했다.
- 자동 테스트 경계: 로컬 backend 전체는 22건 중 19건 통과·2건 환경 skip이며 기존 Windows 비관리자 symlink 생성 EPERM 1건만 실패했다. 이 테스트는 NAS Linux에서 다시 실행한다. 실제 tray 메뉴 클릭→바탕화면 `NAS Drive` 바로가기→아이콘 재표시의 최종 육안 확인은 공개 배포 후 남아 있다.
- 다음 안전한 단계: 같은 브랜치에 code/dist/workbook/relay를 commit·push하고 NAS가 fast-forward로 받은 뒤 Linux 전체 backend tests, PM2, 내부·공개 HTTP, 공개 Agent/Setup 1.10.26 metadata와 hash를 확인한다. 그 후 실제 tray 메뉴 종료/재실행 육안 경계를 완료 상태로 갱신한다.

### 1.10.26 GitHub·NAS 배포 결과

- 기능·배포 파일·워크북·릴레이 commit `b7ee123`을 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다.
- NAS Linux에서 Agent self-test와 전체 backend tests 22/22가 통과했다. Windows에서만 발생한 비관리자 symlink EPERM 테스트도 NAS에서는 정상 통과했다.
- `msp-backend`를 restart/save한 뒤 online을 확인했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이고 내부 `127.0.0.1:3030`과 공개 `https://filemanager-nas.com`은 HTTP 200이다.
- NAS 공개 metadata 상수는 1.10.26이며 배포 Agent SHA-256은 `bab18d7f5b051461b1291dc5ae8498e8632d9227ecee1fdec180b943246e1f90`, Setup SHA-256은 `80d58bb3106390ccd6b23eebb0f7bbf48b517dc3fb7a4b27c4d2266ac5ab87bf`로 로컬 build와 일치한다.
- 실제 tray 메뉴 클릭은 Windows 시스템 알림 영역을 현재 자동화가 안전하게 단일 대상으로 식별하지 못해 임의 아이콘을 누르지 않았다. 다만 동일 cleanup core의 0ms 경쟁 5/5와 background refresh event 중복 10회, 설치 후 실제 launcher/Agent/Provider 생존을 확인했다. 사용자가 tray `종료`→바탕화면 `NAS Drive` 바로가기를 한 번 실행하면 최종 육안 경계만 확인하면 된다.
