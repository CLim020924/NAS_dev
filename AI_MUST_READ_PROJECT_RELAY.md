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
