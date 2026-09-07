# AI 필독 — NAS 프로젝트 작업 인계 및 시작 규칙

## 2026-09-07 PDF 주석·영역 텍스트 복사 운영 배포

- 사용자 요청: 창 전환 버튼이 한 번 나타난 뒤 닫히는 문제를 고친 상태로 유지하면서, PDF 리더에 형광펜·자유 펜·텍스트 상자·영역 드래그 텍스트 복사와 필요한 저장·확대 기능을 함께 구현한다.
- 창 전환기 확인: 앞선 `3cfd835`의 빈 목록 자동 닫기 제거가 새 운영 번들에도 포함됐다. NAS에서 `verify:window-manager`의 MRU·persistent toggle·레이어·순환·전체화면 우선순위 검사가 다시 통과했다. 창이 없어도 같은 버튼 재클릭, Esc, 바깥 클릭 또는 실제 창 선택 전까지 패널과 `aria-pressed` 상태가 유지된다.
- PDF 작업공간: 기존 FileViewer의 PDF 화면을 `PdfWorkspace`로 분리했다. 선택, 형광펜, 자유 펜, 텍스트 상자, 서식 유지 복사, 일반 텍스트 복사, 주석 지우기, 실행 취소·다시 실행, 저장, 서버 주석 다시 불러오기, 인쇄, PDF 전용 확대·축소·원래 크기를 제공한다. `Ctrl+휠`, `Ctrl++/-/0`은 브라우저 페이지가 아니라 활성 PDF만 확대하고 `Ctrl+S`, `Ctrl+Z/Y`, `Ctrl+P`를 처리한다.
- 영역 복사: react-pdf 텍스트 레이어의 각 span 위치를 드래그 영역과 교차시킨 뒤 세로 위치로 줄을 묶고, 글자 폭 중앙값과 좌우 간격으로 공백과 상대 들여쓰기를 추론한다. `서식 유지 복사`는 그 간격과 들여쓰기를 보존하고 `일반 텍스트 복사`는 불필요한 들여쓰기와 연속 공백을 제거한다. 형광펜도 여러 줄을 하나의 큰 사각형으로 덮지 않고 실제 텍스트 span에 맞춘다. PDF 자체에 논리적 문단·탭 정보가 없을 수 있으므로 결과를 원문 완전 복원으로 표시하지 않는다. 스캔 PDF에서 텍스트 레이어가 없으면 OCR 필요 안내를 표시한다.
- 저장과 보안: 주석은 원본 PDF를 덮어쓰지 않는 계정별 sidecar JSON으로 저장된다. 서버는 로그인 계정의 사용자 root와 실제 `.pdf` 파일을 기존 `getValidatedPath`로 다시 검증한다. 좌표와 색·불투명도·텍스트·개수·크기를 정규화하고 파일당 5,000개, 2MB 한도를 둔다. expected revision이 다르면 409로 덮어쓰기를 중단한다. 저장 중 새 입력은 큐에 넣어 최신 변경까지 연속 저장한다. 파일 이름이 바뀌어도 같은 filesystem identity면 주석을 찾는다. 저장 디렉터리는 0700, 파일은 0600이며 임시 파일을 쓴 뒤 rename한다.
- AI 경계: 좌표 grounding이 없는 AI가 페이지 위치를 추측해 주석을 만드는 것은 안전하지 않아 `/file/pdf-annotations`는 `editor-ui` 경계로 명시했다. 생산 REST 라우트 분류 gate에서 누락으로 취급하지 않되 AI 도구로 직접 노출하지 않는다.
- 검증: 로컬 PDF 저장/충돌/이동 2개와 AI 카탈로그 6개가 통과했다. PDF 전용 verifier가 도구·텍스트 공백/들여쓰기·형광펜 clipping·역방향 드래그·확대·저장 큐를 검사했고 대상 ESLint와 production build가 성공했다. NAS Linux 전체 backend 95/95, `verify:window-manager`, `verify:pdf-editor`, production build, react-pdf 9.2.1/PDF.js API+Worker 4.8.69 검사가 통과했다.
- 배포: 코드 커밋 `5499eb5`, `93f7659`를 GitHub와 NAS 활성 브랜치에 fast-forward했다. 운영 nginx와 NAS build가 모두 `main.58dd7647.js`를 가리키며 SHA-256이 일치한다. `ssh`, `tailscaled`, `nginx`, `docker`, `cloudflared` active, PM2 `msp-backend` online/save, 내부 3030·공개 HTTPS 200, 무인증 주석 API 401, NAS checkout clean을 확인했다.
- 기록: `NAS_PROJECT_LOG.xlsx`의 Request_Archive, Patch_Log, Feature_Index, Relation_Map, Code_Map, Do_Not_Break, API_Routes, Data_Files, Generated_Check를 artifact-tool로 갱신했다. 기존 15개 시트·기존 값·수식·순서 보존과 정확한 행 증가를 baseline 비교로 확인했고 수식 오류 0건, 새 한국어 문자 깨짐 없음, 변경 범위 렌더를 확인했다.
- 남은 한계: 저장된 주석은 NAS 플랫폼에서 PDF를 다시 열 때 복원되지만 원본 PDF 바이트에 삽입되지는 않으며 현재 인쇄도 원본 PDF를 인쇄한다. 스캔 PDF OCR과 주석이 포함된 PDF 내보내기/인쇄는 별도 기능이다. 현재 브라우저에 로그인된 NAS 세션이 없어 실제 사용자 PDF에서 마우스로 주석을 그리고 저장 후 재열기까지의 인증 후 화면 검증은 이번 턴에 수행하지 못했다.

## 2026-09-07 NAS 웹 전역 UI 디자인 시스템 리팩터링

- 사용자 요청: NAS 웹의 둥근 버튼·카드 중심 표현을 줄이고, 심플하지만 기능과 상태를 분명히 구분하는 세련된 UI로 전체를 통일한다. 앞으로 추가되는 버튼과 앱도 같은 기준을 자동으로 따르게 한다.
- 확인 원인: `CustomThemeProvider`가 이미 전역 테마를 제공하는데 `AppContent`가 별도 `ThemeProvider/createTheme`를 다시 중첩해 일부 규격을 덮고 있었다. 전역은 8px인데 화면별 `sx`는 8~20px 모서리, 큰 그림자, hover `translateY`를 개별 사용해 플랫폼·문서·설정·팝업이 서로 다른 제품처럼 보였다. 설정이 제공하던 `ocean` 값도 실제 ThemeContext에 없었다.
- 구현: `ThemeContext`를 단일 전역 기준으로 만들고 라이트·다크·오션 테마에 버튼·입력·메뉴·목록 4px, 창·대화상자 6px 계열, 1px 경계, 낮은 그림자, 120ms 색/경계 변화, `focus-visible`을 적용했다. App의 중복 테마를 제거했다. 플랫폼·상단바·로그인·AI·문서 변환·문서 작업대·설정·서버 자원·NAS/전역 앱 창의 큰 모서리와 움직이는 호버를 정리했다. 상태 점·아바타·진행률·모바일 빠른 작업은 의미가 있어 원형을 유지한다.
- 새 기능 규칙: `docs/NAS_UI_DESIGN_SYSTEM.md`가 시각 원칙과 검수표를 설명하고 코드의 권위 기준은 `frontend/src/contexts/ThemeContext.js`다. 새 버튼은 기본 MUI Button을 우선하며 개별 `borderRadius`, 강한 `boxShadow`, `transform`을 다시 만들지 않는다. 선택·경고·연결 상태는 색만 쓰지 않고 테두리·텍스트를 함께 사용한다.
- 검증·배포: 로컬과 NAS production build가 성공했고 react-pdf 9.2.1/PDF.js API+Worker 4.8.69 gate를 통과했다. 커밋 `bb6fd82`를 GitHub와 NAS 활성 브랜치에 반영했으며 NAS build, `/var/www/html`, 공개 index가 모두 `main.3e5141bb.js`를 가리킨다. 공개 로그인 화면을 실제 렌더링해 버튼·입력·카드 배치와 대비를 확인했다. 내부 3030/공개 HTTPS 200, 필수 서비스 6개 active, PM2 `msp-backend` online/save, NAS checkout clean이다.
- 기록: `NAS_PROJECT_LOG.xlsx`에 `WEB-UI-DESIGN-SYSTEM`, 관계 5개, 코드 매핑 14개, `DNB-WEB-UI-SYSTEM-144`, 요청 원문과 패치 이력을 추가했다. artifact-tool 재검사에서 수식 오류 0건이며 새 행 줄바꿈·높이를 렌더 확인했다.
- 검증 경계: 만료된 웹 세션 때문에 공개 사이트의 인증 후 모든 앱 화면을 이번 턴에 순회하지는 않았다. 인증 전 로그인 화면과 로컬 빌드, 주요 화면 코드, 서버 배포본은 확인했다. 사용자 피드백에서 특정 앱의 밀도나 대비가 불편하면 전역 기준을 깨는 임시 스타일 대신 공통 토큰 또는 명시적 예외로 조정한다.

## 2026-09-07 PDF 주석과 영역 텍스트 복사 가능성 질문

- 요청: PDF만 먼저 형광펜·펜·텍스트 상자 삽입, 버튼 선택 후 영역 드래그로 띄어쓰기/들여쓰기를 분석한 복사 또는 일반 텍스트 복사가 가능한지 확인한다. 이번 요청은 가능성 질문이며 구현/배포하지 않았다.
- 확인: 현재 NAS FileViewer와 공통 FilePreviewSurface는 react-pdf/PDF.js 기반이다. Mozilla PDF.js 공식 viewer/주석 회귀 코드에는 FreeText/Ink/Highlight 편집이 있고, Tesseract 공식 문서는 단어별 bounding box/confidence/text가 있는 TSV와 hOCR 출력을 제공한다. 기존 react-pdf 페이지에 편집 도구가 자동으로 연결되는 것은 아니므로 별도 통합·저장 검증이 필요하다.
- 제안: 주석 저장과 영역 복사는 별도 기능으로 설계한다. 텍스트 PDF는 글자 위치와 줄 정보를 먼저 추출하고 스캔 PDF는 선택 영역만 OCR한다. 일반 텍스트/줄바꿈·들여쓰기 유지 복사를 나누고 복사 전 미리보기를 제공한다. PDF는 원래 탭·문단·읽기 순서가 없을 수 있고 스캔 OCR 오류도 있어 모든 문서의 원본 띄어쓰기·들여쓰기 완전 복원을 보장하지 않는다.
- 안전/후속: 좌표는 PDF 페이지 기준으로 저장해 확대/회전 시 유지하고 원본 보존·다른 이름 저장·실행 취소·계정 쓰기 권한·동시 저장 충돌을 검증한다. NAS 저사양을 고려해 OCR은 선택 영역/명시적 실행/제한 동시 작업으로 설계하며 OpenAI API는 기본 경로에 필요하지 않다. 구현 요청 후 상세 설계와 workbook 관련 행을 갱신한다.
- 참조: https://github.com/mozilla/pdf.js/blob/master/web/viewer.html ; https://github.com/mozilla/pdf.js/blob/master/test/integration/annotation_spec.mjs ; https://github.com/tesseract-ocr/tesseract/blob/main/doc/tesseract.1.asc

## 2026-09-07 NAS Drive 1.11.4 재실행 복구

- 요청: 다시 다운로드해 설치하면 로그인/웹 열기 오류와 트레이 미표시·재실행 무반응을 복구할 수 있도록 수정한다.
- 확인 원인: 기존 background는 mutex가 있으면 UI 응답 없이 refresh 신호만 보내 종료했다. foreground 복구는 같은 EXE의 트레이까지 일괄 종료했다. tray의 웹 열기는 같은 UI loop에서 picker를 띄우고 WinForms 텍스트 설정을 재초기화했다. 현재 PC launcher는 1.10.31.0, Agent는 별도 자동 업데이트 상태였다. 다른 PC의 직접 장애 원인은 아직 재현하지 않았다.
- 수정: `TrayRecovery.cs`는 직렬화된 refresh/ACK를 8초 기다리고 무응답일 때 동일 설치 경로·Windows 세션·probe 이전 시작시간·정확한 --background 역할만 교체한다. mutex 생성 여부 대신 실제 소유권을 획득해 abandoned mutex도 복구한다. UI 요청은 등록된 foreground PID만 교체하며 tray 웹 선택기는 별도 프로세스로 분리한다. 계정/네트워크 검사 전 아이콘을 게시하고 startup 예외는 최대 3회 시도 후 가시 오류를 낸다. 동기화 background 확인은 임의 동일 이름 프로세스가 아니라 agent.pid를 검증한다.
- 로그인/화면: stdout/stderr 비동기 읽기로 로그인 timeout이 실제 적용되게 했다. 로컬 초기 구성 실패를 서버 전원 문제로 오표시하지 않고 401/403/네트워크 실패를 구분한다. 고DPI 최초 HWND 생성 때 줄어든 ClientSize를 그대로 확대하던 결함을 원래 설계 크기 복원으로 교정했고 다중 계정 창 검사 기준도 실제 680x700으로 갱신했다.
- 패키지: installer/Agent/package/server 메타데이터를 1.11.4로 일치시켰다. 다운로드 응답은 private,no-store 및 X-NAS-Agent-Version을 제공한다. Agent-only 자동 업데이트는 launcher를 교체하지 않으므로 이번 수정 적용에는 새 설치기로 업데이트가 필요하다.
- 검증: 격리된 Windows 프로세스에서 healthy ACK 유지, hung owner 교체, 종료 뒤 새 mutex 획득 통과. C# compile/Setup self-test/패키지 Agent self-test/Node syntax 통과. 현재 PC 기존 실행 파일을 `.codex-backups/driver-1.11.4`에 보관하고 새 파일로 교체했다. 실제 --open 이후 tray 중복 실행에서 기존 PID 유지·ACK true, 기존 계정으로 web-session→기본 브라우저 launch는 2026-09-07 01:59:12 UTC opened/attempt1이었다. 계정 정보와 사용자 파일은 변경하지 않았다.
- 검증 경계: 실제 installer 버튼·트레이 메뉴 클릭은 Windows UI 제어 도구 부재로 직접 검증하지 못했다. 생성된 실제 WinForms 미리보기는 확인했다. 브라우저 제어 도구에도 해당 기본 브라우저 탭이 없어 웹 최종 화면 확인을 launch 성공과 구별한다. 다른 PC 재부팅, 보안 프로그램 차단, 신규 계정 로그인, 프로필 선택 전체 흐름은 확인 필요로 보류 시트에 기록한다. 서버 다운로드 배포 결과는 아래에 후속 기록한다.
- 배포 결과: `7f5860a`를 NAS clean fast-forward 후 msp-backend restart/save했다. 설치기 SHA-256 `e9495c9861150064bc156db3d66f89ada137ae2444a642a811359e6a34d457ac`, Agent `91d34e9252991a861b801de823e50bc1480dce6bb297420f326b7fa271f06986`가 로컬/서버 일치한다. NAS Agent self-test·backend syntax 성공, 6개 서비스 active, 내부 3030/공개 HTTPS 200, 무인증 설치 다운로드 401. 현재 PC 새 launcher의 shutdown 명령 뒤 설치 경로의 관련 프로세스 0개를 확인하고 --open으로 재실행했다. 실제 로그인된 웹 다운로드 버튼을 통한 재다운로드는 미검증이며, 해당 route가 읽는 서버 dist 파일의 교체와 해시를 확인한 것이다.

## 2026-09-07 다른 PC Drive 로그인/부팅 트레이 미표시 진단

- 후속 사용자 보고: 로그인 이후 웹에서 열기는 현재 개발 PC에서도 실패한다. 현재 PC에서 NAS-Drive, NAS-Sync-Agent, NAS-Drive-Provider 프로세스 실행을 직접 확인했다. launcher 파일 버전은 1.10.31.0이다. agent exe의 18.5.0 PE 표시는 Node runtime 버전이므로 제품 버전으로 판단하지 않는다.
- 현재 PC 기록 확인: agent-health의 2026-09-07 01:42:39 UTC 상태는 up-to-date다. open-web-last의 마지막 기록은 2026-09-01 00:51:48 UTC, profile 단계 WEB_PROFILE_MISSING이다. 8월 31일 Agent 인증 실패 HTTP 403도 있으나 모두 과거 기록이며 현재 증상의 직접 원인으로 사용하지 않는다.
- 웹 열기 경로는 장치 프로필/인증정보 조회, 별도 web-session 발급, 브라우저 실행 순서다. 현재 발생 오류를 기록과 대조하기 위해 사용자에게 이 PC의 NAS 웹 열기 재시도 및 오류 문구/화면을 요청했다. 아직 새 실패를 재현하지 못했으며 코드/설정/배포 변경 없이 진단 중이다.

- 요청: 다른 PC에서 NAS 정상 상태에도 서버 연결 불가 안내가 나오고 부팅 후 트레이 아이콘이 안 보이는 이유 확인.
- 확인: installer의 FriendlyError는 `연결`을 포함한 오류를 서버 전원/인터넷 확인 안내로 바꾼다. 로그인 이후 로컬 초기 구성 실패에도 이 문구가 포함되므로 안내만으로 서버 장애를 확정할 수 없다.
- 자동 시작은 사용자별 HKCU Run에 native launcher --background를 등록한다. 연결 계정이 없어도 native tray는 실행하는 코드다. Node agent와 native tray가 분리되어 있어 아이콘 부재가 프로세스 부재를 증명하지는 않는다.
- 검증: SSH 성공, nginx/cloudflared active, NAS에서 공개 HTTPS 200. 문제 PC의 버전/실행 상태/자동 시작 등록/DNS/TLS/로그인 POST는 아직 확인하지 못했다.
- 상태: 읽기 전용 원인 조사. 코드 수정이나 배포 없음. 오류 분류 결함은 확인됐지만 문제 PC의 직접 원인과 두 증상의 인과관계는 미확정이다. 다음은 문제 PC 브라우저 NAS 로그인 가능 여부와 설치 버전, 민감정보를 제거한 오류 및 프로세스/시작프로그램 상태 확인이다. 비밀번호, config.json, 장치 token은 기록하지 않는다.

최종 갱신: 2026-09-06 — 실행형 NAS AI 에이전트 1차 도구·승인·비용 경계 구현

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

## NAS 물리 디스크 인벤토리 — 필수 유지

확인 기준: 2026-09-06. 아래 두 2TB NVMe는 서로 합쳐진 4TB pool이 아니며 각각 독립된 ext4 파일시스템 역할을 가진다.

| 물리 장치 | 모델·표기 용량 | 파티션·파일시스템 | 현재 역할 | 마운트·식별자 |
|---|---|---|---|---|
| `/dev/nvme1n1` | Seagate FireCuda 520 SSD, 2,000,398,934,016 bytes(제조사 2TB) | `p1` vfat 512MiB, `p2` ext4 약 1.8TiB, `p3` swap 약 977MiB | Debian OS, NAS backend checkout, frontend 배포, Docker, PM2, 시스템 로그 | `p1` `/boot/efi` UUID `39CE-F971`; `p2` `/` UUID `62d2e08b-5847-48df-8d99-46100465605b`; `p3` swap UUID `6825d88d-23d0-40c3-8d52-995022b77c85` |
| `/dev/nvme0n1` | Crucial CT2000P3PSSD8, 2,000,398,934,016 bytes(제조사 2TB) | `p1` ext4 약 1.8TiB | 사용자 파일, 계정 root, backup, upload/Agent 임시 저장소를 포함한 NAS 데이터 전용 | `/mnt/nas`, UUID `5d6f2c61-121b-4ce1-afdb-37d0daf49941`, fstab 옵션 `defaults,nofail` |

2026-09-06 측정값:

- 시스템 `/`: filesystem 1,966,309,933,056 bytes, 사용 165,614,030,848 bytes, 가용 1,700,737,302,528 bytes, `df` 사용률 9%.
- NAS 데이터 `/mnt/nas`: filesystem 1,967,845,998,592 bytes, 사용 87,256,711,168 bytes, 가용 1,780,552,622,080 bytes, `df` 사용률 5%.
- `/etc/fstab`은 현재 UUID가 아니라 `/dev/nvme1n1p2`, `/dev/nvme1n1p1`, `/dev/nvme0n1p1` 장치명으로 기록되어 있다. 디스크 추가·슬롯 변경 시 장치명이 바뀔 위험이 있으므로 먼저 fstab/부팅 영향과 UUID 전환 필요성을 검토하고, 확인 없이 디스크 순서나 mount를 변경하지 않는다.

인수인계 규칙:

1. 물리 디스크 추가·제거·교체, 파티션 변경, filesystem 변경, mount 위치·역할 변경이 있으면 작업 전후에 `lsblk -b -o NAME,SIZE,TYPE,FSTYPE,FSAVAIL,FSUSE%,MOUNTPOINTS,MODEL`, `df -B1`, `findmnt --fstab --evaluate`, `blkid`를 확인한다.
2. 이 인벤토리 표와 측정일을 실제 상태에 맞게 갱신하고 `NAS_PROJECT_LOG.xlsx`의 `Network_Config` 및 `Do_Not_Break`에도 변경 이유·검증·rollback 정보를 기록한다.
3. 새 디스크에는 모델, 표기/실제 bytes, 파티션, filesystem, UUID, mount, 담당 데이터, backup 여부, RAID/LVM/pool 관계를 기록한다. 장치명만 신뢰하지 않는다.
4. 기존 데이터 디스크를 format·mount 변경·pool 편입하거나 데이터를 이동하기 전에는 복구 가능한 backup과 대상 UUID를 다시 확인한다. 새 디스크가 생겼다는 이유만으로 자동 format, RAID/LVM 편입, 기존 데이터 이동을 수행하지 않는다.
5. 용량 UI와 quota 계산은 사용자 파일이 실제로 있는 `/mnt/nas` filesystem 통계를 사용한다. 시스템 `/`의 남는 용량을 NAS 사용자 할당 가능량에 합산하지 않는다.

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

## 2026-08-31 NAS Drive 1.10.27 로그인·로그아웃·최신 요청 우선 처리

- 사용자 요청: 로그인 오류 상태에서도 수동 로그인과 로그아웃이 항상 동작해야 하고, 기존 Drive 창이나 요청이 열려 있다는 이유로 거부하지 말고 가장 최근 사용자의 요청을 우선 처리한다.
- 원인: launcher의 native UI mutex와 Agent의 foreground lock이 이전 숨은 창·중단된 인증 창·남은 PID를 정상 실행으로 간주해 새 요청을 거부했다. 프로필이 없거나 불완전하면 로그아웃이 조기 종료돼 로컬 토큰·상태·바로가기 정리가 보장되지 않는 경계도 있었다.
- 1.10.27 구현: `--open`·`--login` 및 protocol 요청은 등록된 이전 native UI와 같은 설치 경로의 오래된 launcher 역할을 정리한 뒤 최신 요청을 실행한다. Agent foreground lock도 검증된 동일 설치본의 이전 owner만 교체하며, 다른 프로그램이나 경로는 종료하지 않는다.
- 로그아웃 복구: 프로필이 없거나 깨졌거나 서버가 401/403·오프라인이어도 로컬 DPAPI 토큰, profile/provider/pin/icon/web shortcut, 활성 config를 멱등 정리하고 `needs-relink`로 전환한다. 따라서 로그인 오류 상태에서도 로그아웃 후 수동 재연결이 가능하다.
- 현재 PC 검증: 설치본을 1.10.27로 교체하고 hidden open→login, login→open, 오류 상태→login, 연결 중→logout, 빈 profile logout, stale foreground owner, launcher protocol logout을 실제 프로세스로 검증했다. 각 최신 요청이 이전 UI를 교체했고 logout은 exit 0과 `needs-relink`를 남겼으며 토큰 파일은 0개였다. 마지막에는 로그인 창 하나와 background tray 하나만 유지했다.
- 자동 검증: Agent verify/build, Setup compile/self-test, backend syntax가 통과했다. Windows 로컬 전체 backend tests는 22건 중 19건 통과·2건 환경 skip·기존 비관리자 symlink EPERM 1건이며 새 source regression 단언은 통과했다. NAS Linux 전체 테스트와 서비스·공개 배포 확인은 commit/push 뒤 수행한다.

### 1.10.27 GitHub·NAS 배포 결과

- 기능·배포 파일·워크북·릴레이 commit `a161c94`를 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다.
- NAS Linux에서 전체 backend tests 22/22와 backend syntax가 통과했다. `msp-backend`를 restart/save한 뒤 online을 확인했고 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active다.
- 내부 `http://127.0.0.1:3030`과 공개 `https://filemanager-nas.com`은 HTTP 200이다. NAS metadata는 1.10.27이고 배포 Agent SHA-256은 `faa230ba8235e78d4aeb387e6d91fc5b649b9faf6028952cce63be4863373547`, Setup SHA-256은 `d09ede9891e0302630dff432f0b13dadde16fae396651084e4b5c807f8e55545`로 로컬 build와 일치한다.
- 실제 계정 비밀번호를 자동 입력하지 않았으므로 정상 로그인 완료 뒤 연결된 profile에서 사용자가 체감하는 logout 1회만 최종 확인 경계다. 인증 실패·무프로필·서버 오류·stale UI/foreground lock 경로는 현재 PC에서 재부팅 없이 복구되는 것을 확인했다.

## 2026-08-31 HWP/HWPX 편집 커서·문자 입력 최종 안정화

- 사용자 요청: HWP 등 편집기 모드에서 간헐적으로 마우스 커서가 보이지 않고 문자 입력도 되지 않는 문제를 마지막으로 수정한 뒤 AI 기능 작업으로 넘어간다.
- 정확한 원인: rHWP Studio는 iframe 내부의 숨김 `[aria-label="문서 편집 입력"]` textarea에 실제 키 입력 포커스를 둔다. 기존 NAS wrapper는 attach 직후 iframe과 `#scroll-container`에 다시 포커스를 줘 Studio의 입력 포커스를 빼앗았다. 저장 성공 후에는 `setBuffer`가 `createEditor` effect를 다시 실행해 편집기 인스턴스를 destroy/recreate했으며, NAS 파일 창 활성화 상태도 rHWP wrapper에 전달되지 않았다.
- 구현: scroll container 강제 포커스를 제거하고 실제 문서 textarea를 0/80/240ms 간격으로 복구한다. 활성 editor 파일 창, 저장 완료, 브라우저 focus·visibility 복귀, 외부 저장/폴더 선택 대화상자 종료를 복구 지점으로 연결했다. 비활성 NAS 창에서는 복구하지 않으며 rHWP 내부 찾기·이름·select·dialog 입력 중에는 포커스를 빼앗지 않는다. 저장 성공 뒤 buffer 재설정도 제거해 같은 editor 인스턴스를 유지한다.
- 코드 검증: 새 `rhwpFocusPolicy.test.js`와 기존 `rhwpSavePolicy.test.js`를 NAS Linux에서 함께 실행해 7/7 통과했다. frontend production build와 react-pdf/PDF.js API·Worker 4.8.69 gate가 통과했고 live bundle은 `main.3ab2bb06.js`다. backend 전체 tests는 22/22 통과했다.
- 운영 배포: 기능 commit `8da3d5c`를 GitHub branch `cleanup/git-tracking-2026-06-08`에 push하고 NAS live worktree가 clean fast-forward로 받았다. `msp-backend`를 restart/save한 뒤 online이며 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active다. 내부 `127.0.0.1:3030`과 공개 HTTPS는 HTTP 200이다.
- 프로젝트 메모리: `RHWP-FOCUS-112`, `OFFICE-RHWP-INPUT-FOCUS`, 관련 Relation/Code/Office_Viewers/Patch/Request 항목을 `docs/NAS_PROJECT_LOG.xlsx`에 추가했다. formula error 0과 변경 시트 렌더를 확인했다.
- 남은 확인 경계: 자동 브라우저 세션은 공개 NAS의 `/login`으로 이동해 로그인된 실제 HWP 문서에서 캐럿·문자 입력을 육안 재확인하지 못했다. 코드 경로, NAS Linux 회귀, 운영 build·서비스·HTTP는 완료됐으며 다음 로그인 세션에서 편집기 클릭→입력, 저장→계속 입력, 다른 창 왕복→계속 입력을 한 번 체감 확인하면 된다.

## 2026-08-31 NAS AI 에이전트 접목 방향 재정리

- 사용자 요청: 기존 AI 조사에서 한 단계 더 생각해 NAS에 실제로 접목할 방향을 정하고 후속 작업을 이어간다.
- 운영 기준선 재확인: 공개 `/api/ai/status`는 OpenAI `gpt-4.1-mini`, enabled/configured를 반환한다. 현재 `/api/ai/chat`은 사용자가 searchQuery/readPath를 미리 지정한 경우에만 일부 컨텍스트를 붙여 한 번의 Responses API 텍스트 응답을 받는다. 모델이 NAS 도구를 스스로 호출하는 loop는 없고, 작업 화면의 진행률도 서버 job이 아닌 시간 기반 표시다.
- 제품 결정: 목표는 범용 대화형 AI나 NAS 구조를 매번 프롬프트에 넣는 방식이 아니라 계정 권한 안에서 파일 찾기·내용/메타데이터 읽기·복제·이동·날짜별 정리·공유 준비·사용자에게 요청 메시지 보내기를 수행하는 NAS 전용 도구형 에이전트다. 파인튜닝과 전면 벡터DB는 선행 조건이 아니다.
- 권장 구조: OpenAI Responses API의 custom function calling과 structured output을 orchestration에 사용하고, 실제 파일 접근·ACL·quota·symlink/realpath·버전·감사·idempotency는 NAS 서버가 결정론적으로 강제한다. 읽기 도구는 즉시 실행할 수 있지만 복제·이동·정리·공유·메시지 발송은 변경 목록과 예상 결과를 먼저 보여주고 승인 뒤 실행한다. 삭제는 휴지통과 복구 기한을 사용한다.
- 컨텍스트/비용: 정적 운영 정책과 도구 설명은 짧고 안정된 prefix로 두고, 사용자·현재 경로·검색 결과·필요한 문서 조각만 동적으로 붙인다. NAS 전체 구조나 대화 전체를 매번 보내지 않는다. 파일명·경로·mtime·size·소유자·ACL·revision의 로컬 metadata index와 activity log로 후보를 줄인 뒤 필요한 내용만 추출한다.
- 모델 판단: `gpt-4.1-mini`는 공식 OpenAI 문서상 Responses API, function calling, structured outputs를 지원하므로 1차 파일 도구 선택·계획 생성에는 유지할 수 있다. 복잡한 다단계 정리에서 평가 실패가 측정될 때만 상위 모델 routing을 추가하며, 모델 교체보다 tool schema·승인 경계·eval을 먼저 만든다.
- 첫 구현 단위: 공통 `agent tool registry`와 `safe action executor`를 만든다. 1차 도구는 `search_files`, `inspect_items`, `list_recent_activity`, `plan_copy`, `plan_move`, `plan_organize_by_date`, `create_share_plan`, `request_file_from_user`다. 계획에는 exact source/destination, 충돌 처리, 예상 증가 용량, 되돌리기 정보, 승인 필요 여부를 포함한다. 실행은 임시 경로+원자 rename, 기존 fileVersioning/trash/quota 재사용, 중복 요청 idempotency key와 audit event를 강제한다.
- 다음 행동: 구현을 시작할 때 먼저 현재 `aiAgentRoutes.js`의 직접 `fs` 쓰기와 문자열 경로 검사 경계를 공통 executor로 교체하고 read-only 도구 loop를 붙인다. 그 뒤 copy/move/date-organize를 승인형으로 추가하며, 5개 대표 문장과 경계 사례를 자동 eval로 고정한다.

## 2026-09-01 NAS Drive 1.10.28 재로그인 후 NAS 웹 열기 복구

- 사용자 요청: Drive에서 로그아웃한 뒤 다시 로그인하면 파일 탐색기 안의 NAS 웹 바로가기와 작업표시줄 NAS Drive 메뉴의 `웹에서 열기`/`NAS 웹 열기`가 무반응이 되는 원인을 찾고, PC 재부팅 없이 항상 다시 작동하게 한다. 단순 자동 새로고침으로 해결 가능한지도 판단한다.
- 정확한 원인: 세 진입점은 모두 launcher의 브라우저 선택 picker를 공유한다. 기존 `OpenWebWithBrowserPicker`는 단일 실행 mutex가 이미 존재하면 기존 창 포커스를 한 번 시도한 뒤 성공 여부와 상관없이 새 요청을 버렸다. Window handle이 없는 숨김·멈춤 picker가 mutex를 잡은 상태에서는 새 클릭이 Agent `open-web`까지 도달하지 않으므로 Agent 재시도나 자동 새로고침도 실행될 수 없었다. 재로그인 완료 직후 기존 tray에 명시적 refresh 이벤트를 보내지 않는 수렴 지연도 있었다.
- 1.10.28 구현: `web-picker.pid`에 picker 역할의 현재 PID를 기록한다. 새 요청은 보이는 picker를 복원하고, 보이지 않거나 응답 없는 경우 PID와 정확한 설치 `NAS-Drive.exe` 경로를 모두 검증한 picker 역할만 종료한 뒤 최대 4회 제한 재획득한다. background tray나 다른 경로의 동명 프로세스는 종료하지 않는다. 취소·완료·예외에서 PID 파일을 정리하고, 네이티브 로그인 성공 직후 background를 보장한 다음 tray refresh 이벤트를 전송한다.
- Windows 실화면·프로세스 검증: 새 1.10.28 Setup의 picker를 실제 화면에서 확인했다. 두 번째 `--open-web` 요청은 이전 owner PID `24208`을 `27504`로 교체하고 picker 창을 항상 1개만 유지했다. Escape 취소 뒤 `web-picker.pid`가 즉시 사라졌고 다시 실행하자 재부팅 없이 새 picker 1개가 생성됐다. Agent/Setup self-test와 C# compile이 통과했다.
- 배포·운영 검증: 코드·Agent·Setup commit `aee0012`를 GitHub branch에 push하고 NAS가 clean fast-forward로 받았다. NAS Linux 전체 backend test files 12/12, Agent self-test, 필수 서비스 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared` active, `msp-backend` online, 내부·공개 HTTP 200을 확인했다. 배포 Agent SHA-256은 `9b9fb98f5a2906253817083b7f4045ea419c0469217d093f9d91c6b65f4b5291`, Setup은 `f887e8a78ba7ed2f29794456c709231756179927de038f83ca0482f563727bc7`로 로컬 build와 일치한다.
- 프로젝트 메모리: `WIN-CONNECTION-LIFECYCLE-RESILIENCE`를 1.10.28로 갱신하고 `WIN-WEB-PICKER-LIFECYCLE-113`, Request/Patch 기록을 `docs/NAS_PROJECT_LOG.xlsx`에 추가했다. 전 시트 렌더, 변경 범위 확대 렌더, 한글 의심 문자와 수식 오류 0건을 확인했다.
- 남은 확인 경계: 현재 PC는 로그아웃 상태라 실제 계정 비밀번호를 사용한 로그아웃→재로그인 전체 인증 E2E는 자동화하지 않았다. 장애가 발생한 공통 picker mutex/PID 수명주기와 취소→재실행, 배포 경로는 실제 화면·프로세스로 검증했다. 새 1.10.28을 설치한 뒤 정상 계정에서 로그아웃→재로그인하고 폴더 바로가기와 tray 메뉴를 각각 한 번 누르는 사용자 체감 확인만 남는다.

## 2026-09-01 NAS Drive 1.10.29 완전 종료·재시작·부팅 트레이 자동 복구

- 사용자 요청: `NAS Drive 종료`는 PC를 끈 것처럼 실행 중 구성요소와 잔류 상태를 완전히 정리해야 한다. 트레이 메뉴에 재시작을 추가하고, Windows를 다시 켜도 작업표시줄 아이콘이 나타나지 않는 문제를 재부팅 없이 복구한다.
- 현재 PC 진단: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`의 `NAS Drive` 값과 설치 경로의 `NAS-Drive.exe --background` PID는 실제로 존재했다. 즉 자동 시작 자체가 빠진 것이 아니라 NotifyIcon 등록이 누락되거나 Explorer 재구성 뒤 복구되지 않은 상태였다. 기존 종료 뒤에는 소유 프로세스가 없는 `native-ui.pid=3056`도 남았다.
- 1.10.29 구현: 종료는 shutdown mutex와 생성 시각 cutoff, 정확한 설치 경로 검증을 유지하면서 launcher·Agent·Provider를 중지한다. 이후 `agent.pid`, `foreground.pid`, `native-ui.pid`, `web-picker.pid`, `provider-*.pid`, `tray.pid`, `agent.exit` 중 실행 중인 새 정식 owner가 없는 runtime 표식만 정리한다. 계정 profile, DPAPI token, 사용자 파일, 동기화 폴더, 자동 시작 설정은 보존한다.
- 재시작·트레이 복구: 트레이 메뉴에 `NAS Drive 재시작`을 추가했다. `--restart-background`는 완전 종료 cleanup이 끝난 뒤 새 background launcher를 시작한다. 별도 hidden window가 Windows의 `TaskbarCreated` broadcast를 받아 NotifyIcon을 다시 등록하고, 로그인 직후에는 2.5·7.5·15초 제한 재등록으로 Explorer 초기 준비 경쟁도 흡수한다.
- 현재 PC 실검증: 설치본을 1.10.29로 보존 교체했다. stale native-ui/web-picker/foreground PID를 주입한 뒤 종료 결과 launcher·Agent·Provider 0개, runtime marker 0개를 확인했다. 완전 종료 상태에서 재시작 명령 뒤 background launcher 정확히 1개가 생성됐다. `--open`으로 새 로그인 창을 실제 화면에서 확인하고 닫은 뒤 background 1개만 남고 native-ui/web-picker 표식이 없는 것을 확인했다.
- 자동 검증: source/packaged Agent self-test, Setup compile/self-test, Node syntax, 새 종료·재시작·TaskbarCreated regression 단언과 `git diff --check`가 통과했다. Windows 전체 backend test는 기존 비관리자 symlink 생성 EPERM 지점에서만 중단됐으며 해당 Linux 경계는 NAS 배포 후 재검증한다. workbook은 `WIN-TRAY-FULL-EXIT-RESTART-114`, `WIN-TRAY-EXIT-RESTART-RECOVERY`, Relation/Code/Patch/Request 기록을 추가하고 전 시트 렌더와 formula error 0을 확인했다.
- 완료 경계: 현재 로컬 구현·설치·프로세스/실화면 검증은 끝났다. 다음 단계는 기능 commit/push, NAS clean fast-forward, Linux 전체 테스트, PM2 restart/save, 필수 서비스·내부/공개 HTTP와 배포 binary hash 확인이다. 시스템 알림 영역 자체는 자동화 대상 창으로 노출되지 않아 실제 트레이 메뉴의 `재시작` 클릭 1회는 사용자 체감 확인 경계로 남긴다.

### 1.10.29 GitHub·NAS 배포 결과

- 기능·binary·워크북·릴레이 commit `f93c425`를 GitHub branch `cleanup/git-tracking-2026-06-08`에 push했고 NAS live worktree가 clean fast-forward로 받았다.
- NAS Linux에서 Agent self-test와 backend test files 13/13이 통과했다. `msp-backend`를 restart/save한 뒤 online이며 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active다. 내부 `http://127.0.0.1:3030`과 공개 `https://filemanager-nas.com`은 HTTP 200이다.
- NAS metadata는 1.10.29다. 배포 Agent SHA-256은 `2bf70a684871b105fa73348f456012b45b902bee91d933d65345831c1ea1f593`, Setup SHA-256은 `fa61154f25a5880e95eb3bd6c5f4f2f6d0bb5f9d8f28800ab072964d5b84e9ed`이며 현재 로컬 build와 일치한다.

## 2026-09-01 NAS Drive 1.10.30 재설치·업데이트 첫 연결/로그아웃 수렴

- 사용자 요청: 재설치·업데이트 직후 NAS 웹의 PC 상태가 `연동됨 → 연동 중 → 연결 끊김`으로 바뀌고, NAS는 온라인인데 Drive가 `서버 오프라인`으로 표시하며, 로그아웃도 `로컬 연결을 해제하지 못했습니다`로 막히는 문제를 재부팅 없이 해결한다.
- 실제 원인 확인: NAS의 신규 장치 레코드는 `status=connected`, `syncState=connecting`으로 생성됐지만 `lastSeenAt=null`이었다. 즉 서버 전원 문제가 아니라 등록 응답으로 발급된 token이 첫 background heartbeat까지 도달하지 못한 반쪽 연결이었다. 기존 Agent는 token/config 저장 뒤 Provider 등록과 초기 작업을 먼저 수행하고 마지막에 background를 시작했기 때문에 Provider 초기화가 실패하면 첫 heartbeat가 영구히 누락될 수 있었다. 서버·웹의 9초, native health의 12초 offline 판정도 설치·교체 구간에 과민했다.
- 1.10.30 연결 순서: DPAPI token과 config를 임시 파일로 저장·교체하고 즉시 재복호화해 같은 token인지 검증한다. 저장 실패 시 방금 생성한 서버 장치 관계를 revoke한다. 저장 성공 뒤 인증된 `connecting` heartbeat를 먼저 보내고 background를 시작한 후 Provider/Explorer 초기화를 진행한다. Provider 오류는 관계 등록을 취소하지 않고 background 자동 복구로 넘긴다.
- 상태 권위: 서버와 웹은 일반 heartbeat timeout을 30초로 조정하고 신규 등록의 첫 heartbeat에는 90초 grace를 둔다. 웹은 `connectionState=online`과 `lastSeenAt`을 모두 확인하기 전에는 PC 연결 성공을 확정하거나 pairing polling을 끝내지 않는다. 업데이트 시작 전에는 `updating` heartbeat를 보내며 native는 교체 구간을 최대 180초까지 업데이트 상태로 보존한다. 401/403은 서버 offline이 아니라 `needs-relink`로 유지한다.
- 로그아웃 수렴: 최신 사용자 로그아웃 요청은 서버 revoke나 Provider 종료보다 먼저 로컬 config에서 profile을 제거하고 계정 DPAPI token과 health를 정리한다. 서버 폐기와 shell cleanup은 후속 best-effort다. Agent가 시작되지 않거나 foreground lock/timeout으로 응답하지 않아도 native launcher가 profile/token을 직접 원자 정리하고 background를 재구성한 뒤 로그인 창으로 전환한다. 사용자 파일과 동기화 root는 삭제하지 않는다.
- 실제 Windows 실패 주입: 현재 PC를 Agent/launcher 1.10.30으로 올리고 실제 사용자 profile이 없는 것을 확인한 뒤, 가짜 회귀 profile만 생성했다. 제어창을 연 상태에서 Agent exe를 의도적으로 치워 `RunLogout` 시작 실패를 만들고 `연결 해제 후 다시 로그인 → 예`를 실제 화면에서 실행했다. 오류 없이 config `profiles=0`, `activeAccountKey=''`로 정리되고 `NAS Drive 로그인` 창이 나타났다. 이후 Agent exe를 복원하고 1.10.30 background를 재시작했다. 비밀번호·실제 token·사용자 파일은 사용하거나 기록하지 않았다.
- 검증: Agent self-test, installer C# build/self-test, NAS Linux `deviceSyncSecurity.test.js` 및 관련 backend tests가 통과했다. NAS frontend production build와 PDF.js API/Worker 4.8.69 검증도 통과했다. `msp-backend`는 재시작 뒤 online이며 내부 `http://127.0.0.1:3030`과 공개 `https://filemanager-nas.com`은 HTTP 200이다. 필수 systemd 서비스 6개는 active다.
- 배포 산출물: NAS metadata는 1.10.30이다. Agent SHA-256은 `376e48aeef7e8ef06de524fad500a28f440d34daf4cf7695cb8ad532d7b1dae1`, 최종 Setup/launcher SHA-256은 `a7347a03d1b0e7de50c1dfd84e2885d454ece509582ac2b4e009a7b5a02ae59e`다.
- 남은 사용자 체감 확인: 장애가 발생한 별도 PC의 기존 반쪽 장치는 새 1.10.30 설치본을 다시 받아 계정을 한 번 재연결해야 새 token과 첫 heartbeat가 생성된다. 그 PC의 실제 계정 인증은 자동화하지 않았으므로 업데이트 후 웹 상태가 `현재 PC 연결됨`, Drive가 `NAS와 동기화됨`으로 수렴하는지만 확인한다. 다시 문제가 생겨도 1.10.30에서는 로그아웃이 로컬에서 막히지 않는다.
- workbook의 Feature/Patch 상태를 운영 배포 완료로 갱신하고 formula error 0과 최종 변경 시트 렌더를 다시 확인했다. 남은 항목은 시스템 알림 영역이 자동화 대상 창으로 노출되지 않아 실제 tray 메뉴에서 `NAS Drive 재시작`을 한 번 누르는 사용자 체감 확인뿐이다. 종료·재시작 프로세스 경로와 잔류 0개는 현재 PC에서 직접 검증했다.

### 1.10.30 운영 다운로드 파일 재검증

- 사용자 의문: 반복 수정한 1.10.30이 실제 NAS 웹의 PC 연동 다운로드 파일에는 반영되지 않은 것인지 확인한다.
- 실제 다운로드 경로: 프런트의 PC 연동 버튼은 pairing 응답의 `/api/devices/agent/windows?token=...`을 사용하고, 실행 중인 backend는 `backend/agents/dist/NAS-Drive-Setup.exe`를 내려준다. 잘못된 token으로 공개 endpoint까지 요청해 HTTP 401과 `cf-cache-status: DYNAMIC`을 확인했으므로 Cloudflare의 오래된 설치 파일 cache가 개입하는 경로가 아니다.
- 파일 대조: NAS가 실제 제공하는 Setup SHA-256은 `a7347a03d1b0e7de50c1dfd84e2885d454ece509582ac2b4e009a7b5a02ae59e`, Agent SHA-256은 `376e48aeef7e8ef06de524fad500a28f440d34daf4cf7695cb8ad532d7b1dae1`이며 최종 로컬 release와 바이트 단위로 일치한다. Setup의 FileVersion/ProductVersion은 `1.10.30.0`이다.
- 결론: 서버 다운로드 산출물과 실행 backend는 최신이다. 다만 이미 반쪽 연결이 된 문제 PC는 서버 파일 교체만으로 설치 프로그램이 자동 실행되거나 유효 token이 새로 생기지 않으므로, 그 PC에서 1.10.30을 새로 내려받아 실행하고 계정을 한 번 재연결해야 한다. 다운로드 폴더에 token별 설치본과 `(1)`, `(2)` 사본이 남을 수 있으므로 실행 화면 또는 파일 속성의 1.10.30을 기준으로 구분한다. 재부팅은 필요하지 않다.

## 2026-09-01 NAS Drive 전 경우 재감사·1.10.31

- 사용자 요청: 서버 다운로드 반영 여부뿐 아니라 설치·업데이트·연결·상태·로그아웃·종료·재시작의 가능한 경우를 다시 검토하고 직접 테스트한다.
- 추가 발견: 1.10.30은 token/config 저장 뒤 foreground 첫 heartbeat를 기다린 다음 background를 시작했다. 이 단일 요청이 순간 실패하면 자동 재시도 프로세스가 생기기 전에 전체 연결 흐름이 중단될 수 있었다. 파일관리의 별도 PC 연동은 서버 등록만으로 성공을 표시했고, 플랫폼 polling 404·410은 pairing token 참조를 남겨 같은 화면의 새 요청을 막을 수 있었다.
- 1.10.31 구현: durable config/DPAPI 검증 직후 background를 먼저 보장하고 foreground heartbeat 실패는 background 재시도로 넘긴다. 플랫폼은 connecting을 online으로 축약하지 않고 만료/소실 pairing 참조를 비운다. 파일관리 연동도 `connectionState=online`과 `lastSeenAt`을 모두 확인해야 성공으로 표시한다. Windows 비관리자 symlink EPERM은 해당 테스트만 명시적으로 skip하며 NAS Linux에서는 실제 symlink 경계 검사를 유지한다.
- Windows 검증: backend test files 13/13, Agent source/package self-test, Setup build/self-test, Node syntax가 통과했다. 완전 종료 뒤 관련 프로세스 0개·runtime marker 0개, 재시작 뒤 background launcher 1개를 확인했다. 실제 화면에서 1.10.31 동일 버전은 `최신 버전`, 설치된 1.10.30 대비 1.10.31은 `업데이트` 버튼과 두 버전을 정확히 표시했고 무프로필 로그인 창이 전면에 열렸다. 현재 PC는 최종 1.10.31과 background 1개 상태다.
- 검증 경계: Windows frontend build는 코드 오류가 아니라 로컬 pnpm/node_modules의 중복 eslint plugin 경로 충돌로 중단됐다. NAS Linux의 clean dependency 환경에서 production build와 전체 테스트를 수행한 뒤 운영 배포·hash·서비스 상태를 확정한다. 실제 문제 PC의 계정 비밀번호와 token은 자동 사용하지 않으므로 새 설치본에서 정상 첫 heartbeat를 한 번 체감 확인해야 한다.

### 1.10.31 NAS 운영 배포 결과

- 서버 상태 시간 경계를 `deviceSyncSecurity.getDeviceConnectionState` 순수 함수로 분리해 revoked, 90초 최초 연결 유예, 30초 이내 online, 만료 offline을 실제 값으로 테스트했다. Windows에서는 비관리자 symlink 생성만 명시적으로 skip했고 나머지 13개 test files가 통과했다.
- commit `cade076`을 GitHub와 NAS live worktree에 반영했다. NAS Linux backend test files 13/13은 문서 변환 통합 2건과 실제 symlink 경계까지 모두 통과했다. frontend production build와 react-pdf/PDF.js API·Worker 4.8.69 gate도 통과했다. 기존 unrelated lint warning과 fileTrash test 시작 시 document-studio 상태 파일 EACCES 경고는 있었지만 test/build exit는 성공했다.
- `msp-backend`를 restart/save했고 online이다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active이며 내부 `127.0.0.1:3030`과 공개 HTTPS는 HTTP 200이다. 공개 설치 endpoint는 잘못된 token에 정상적으로 401을 반환하고 `cf-cache-status: DYNAMIC`이므로 구버전 binary cache 경로가 아니다.
- 최종 NAS·로컬 Agent SHA-256은 `2dc2609ea6a9c89a59d6a97af3eb054d2cd4809566f6ab5a396c09b3233ab17d`, Setup SHA-256은 `e65ce0131119f06ea0f397c6a4ae6567ac4a76be7d243b236af47978496e8a53`로 일치한다. Setup FileVersion/ProductVersion은 `1.10.31.0`이다.
- 남은 실제 장치 경계: 장애가 난 별도 PC의 기존 반쪽 관계는 1.10.31을 새로 내려받아 계정을 한 번 재연결해야 새 token과 첫 heartbeat가 생긴다. 그 PC의 실제 자격 증명을 자동 사용하지 않았으므로 웹과 Drive가 online으로 함께 수렴하는 최종 체감 확인만 남는다. 재부팅은 필요하지 않다.

## 2026-09-01 NAS Drive 1.10.32 설치 직후·웹에서 탐색기 전면 열기

- 사용자 요청: 설치가 끝난 직후 NAS Drive 폴더가 열린 파일 탐색기 창이 바로 눈앞에 보여야 한다. NAS 웹의 PC 연동 화면에서도 이미 설치된 NAS Drive를 직접 여는 방법을 제공한다.
- 원인: 설치 프로그램의 `설치 완료 후 NAS Drive 열기` 체크는 동일 버전·업데이트 등 일부 경로에서 launcher `--open`을 실행해 실제 탐색기 대신 제어 창을 띄웠다. pairing Agent의 Explorer 실행은 설치/진행 창과 전면 순서가 경합했다. 웹 `openLinkedDrive`는 브라우저 localStorage에 해당 계정 deviceId가 없으면 설치된 Drive 열기 대신 새 연동 흐름으로 되돌아갔다.
- 1.10.32 구현: Agent의 개인 Drive 열기는 설치된 native launcher `--open-drive-after-install`로 위임한다. launcher는 설치·pairing이 profile 경로를 기록할 때까지 최대 45초 기다리고, protocol deviceId가 있으면 그 profile의 개인 root를 선택한다. Explorer Shell의 실제 폴더 경로가 같은 창을 찾은 뒤 복원·맨 앞으로 활성화한다. 경로가 준비되지 않으면 무한 대기하지 않고 계정 연결 안내를 표시한다.
- 웹 UX: PC 연동 대화상자에는 현재 브라우저의 연결 표식과 무관하게 `설치된 NAS Drive 열기` 버튼이 보인다. 명시적으로 누르면 `nas-sync://open-drive`를 호출한다. 기존 deviceId가 있으면 해당 ID를 함께 전달하며, deviceId가 없다는 이유로 자동 재연동하지 않는다. 첫 PC 연동 아이콘 클릭 자체는 기존 보안 규칙대로 연동 시작이며 protocol 자동 실행은 하지 않는다.
- Windows 실화면 검증: 실제 사용자 파일·자격 증명을 사용하지 않고 임시 profile과 빈 안전 폴더로 새 launcher를 실행했다. `visual-open-test - 파일 탐색기` 창이 대상 주소로 실제 전면 표시된 것을 화면과 접근성 트리로 확인했다. 테스트 config를 원래 profiles 0 상태로 복원하고 임시 창·폴더·테스트 background를 정리했다.
- 자동 검증: Agent self-test, Setup C# compile/self-test, Windows `deviceSyncSecurity` 회귀 테스트, frontend production build와 PDF.js API/Worker 4.8.69 검증을 통과했다. 기능 commit은 `5a8ec46`이며 GitHub와 NAS live branch에 fast-forward됐다.
- NAS 운영 검증: Linux Agent self-test와 backend tests 22/22가 통과했다. frontend production bundle `main.3323e6e2.js`를 `/var/www/html`에 반영했다. PM2 재시작 직후 0초 probe만 기동 전 HTTP 000이었고 10초 뒤 `msp-backend=online`, 내부·공개 HTTP 200으로 수렴했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active다.
- 배포 산출물: NAS와 로컬 Agent SHA-256은 `480419249d0cef1a9e749cfc4ddb5fe2019563e23832791c406a5852c5755924`, Setup SHA-256은 `688f338244b27dcac3ea15b73952d89780e8ebdadeea018a4b4e76b0e271aff4`로 일치한다. 서버 배포 버전은 1.10.32다.
- 프로젝트 메모리: `WIN-INSTALL-WEB-OPEN-116`, `WIN-INSTALL-WEB-DRIVE-OPEN`과 Relation/Code/Patch/Request 기록을 `docs/NAS_PROJECT_LOG.xlsx`에 추가했다. formula error 0, 기존 설명용 `??` 문자열 외 신규 모지바케 없음, 전체 14개 시트 렌더와 변경 범위 시각 검사를 통과했다.
- 남은 경계: 운영 브라우저의 현재 세션은 로그인되지 않아 실제 사용자 계정의 PC 연동 대화상자 클릭은 자동화하지 않았다. production bundle과 버튼 회귀 gate, native protocol·탐색기 전면 표시를 각각 검증했다. 사용자는 새 1.10.32를 설치한 뒤 설치 직후 탐색기 전면 표시와 웹의 `설치된 NAS Drive 열기`를 한 번 체감 확인하면 된다.

## 2026-09-04 NAS 재부팅 뒤 Drive 빠른 자동 복구·1.10.33

- 사용자 요청: NAS 전원을 껐다 켠 뒤 설정과 Drive 연결이 바로 적용되어야 하며, 컴퓨터 재부팅이나 수동 로그아웃 없이 자동으로 복구되어야 한다.
- 확인한 직접 원인: Windows Agent가 시작할 때 최초 heartbeat가 실패하면 오류 종류와 무관하게 `authenticated=false`와 `nextAuthRetryAt=현재+5분`을 기록했다. NAS가 꺼져 있거나 OS·네트워크가 부팅 중인 정상적인 timeout·HTTP 503도 인증 거절처럼 처리되어, NAS가 먼저 살아나더라도 첫 자동 복구가 최대 5분 늦어질 수 있었다. 이후 background 연결 실패는 이미 3초 tick 재시도를 사용하므로 초기 경로만 계약이 달랐다.
- 1.10.33 구현: `initialConnectionRetryDelayMs`가 `HTTP 403`, `Agent 인증 실패`, `WEB_PAIRING_REQUIRED`처럼 확정된 인증 오류에만 5분 지연을 반환한다. NAS 오프라인·timeout·503은 지연 0으로 profile job에 들어가 정상 3초 background tick에서 heartbeat, watcher 준비, pull을 다시 시도한다. NAS가 실제로 네트워크에 돌아오면 Windows를 재부팅하지 않아도 자동 수렴한다.
- 검증: Agent self-test에 503은 즉시 재시도, 403은 인증 지연이라는 고장 주입을 추가했다. Agent build, Setup C# build/self-test, backend syntax, device sync 보안 회귀, 전체 backend tests 22/22가 통과했다. 문서 변환 통합 2건은 기존 Windows 환경 조건으로 skip됐으며 실패는 0이다.
- 배포물: 기능 commit은 `67fc02f`다. Agent/Setup 공개 버전은 1.10.33이며 Agent SHA-256은 `76c94c3d1a701d49d271df83df97bf4a667492035e1ff2b14fa87b24561f8855`, Setup SHA-256은 `18231e574b2f84e8dc9fe59509f6876ad07bd50f19108190f2a523044a7609eb`다. Setup FileVersion/ProductVersion은 `1.10.33.0`이다.
- 서버 부팅 원인과 수정: 실제 부팅은 04:31:45였고 enp6s0 carrier는 04:32:02에 올라왔지만 NetworkManager의 `Auto Ethernet` profile에 `permissions=user:limchanyoung:;`가 있어 사용자 GNOME 로그인 전에는 자동 활성화 대상이 아니었다. `network-online.target`은 loopback만으로 04:32:06에 성공했고 Tailscale·Cloudflare는 default route 없이 재시도했다. 사용자가 04:51:32에 로그인하자 profile과 static `192.168.45.30/24`, gateway `192.168.45.1`이 활성화됐다. profile의 permissions를 비워 system connection으로 전환했으며 autoconnect yes, priority 100, static address와 DNS는 그대로 보존했다. 변경 전 파일은 `/home/limchanyoung/runtime-backups/networkmanager-boot-20260904`에 root 전용으로 보존했다.
- 중복 터널 제거: systemd cloudflared는 `/etc/cloudflared/config.yml`의 origin `127.0.0.1:3030`으로 정상 연결됐지만, GNOME Terminal에서 사용자가 실행한 두 번째 cloudflared가 `/home/limchanyoung/.cloudflared/config.yml`의 origin `127.0.0.1:80`으로 같은 tunnel을 잡아 공개 주소가 자기 자신으로 301 반복됐다. 사용자 cloudflared PID만 종료하고 systemd 인스턴스 하나만 남겼으며 공개 HTTPS가 200으로 복구됐다. 사용자 unit·cron 자동 실행은 없었다.
- 운영 배포·검증: GitHub의 `275d53d`까지 NAS live branch를 clean fast-forward했다. NAS Linux Agent self-test와 backend 22/22가 통과했고 PM2 restart/save 후 `msp-backend` online이다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 enabled+active, Tailscale ping 1ms, gateway·DNS 정상, 내부 3030과 공개 HTTPS는 200이며 무인증 Agent 다운로드 endpoint는 401이다. NAS Agent/Setup SHA-256은 로컬 release와 일치한다.
- 프로젝트 메모리: workbook에 `WIN-NAS-REBOOT-RECOVERY-119`, `NAS-BOOT-NETWORK-SYSTEM-PROFILE-120`, `WIN-NAS-REBOOT-FAST-RECOVERY`와 Relation/Code/Patch/Request를 기록했다. formula error 0, 관련 6개 시트 렌더와 변경 범위 시각 검사를 통과했다. 다음 자연 재부팅에서 사용자 로그인 전 online 시각을 관찰하는 것 외에 미완료 작업은 없다.

## 2026-09-06 NAS Drive 다중 계정·계정 간 읽기 전용 공유 1.11.0

- 사용자 요청: 한 Windows PC의 NAS Drive에서 3개 이상 계정을 안전하게 연결·전환하고, 한 계정이 가진 파일·폴더를 같은 PC에 연결된 다른 계정으로 공유하되 파일 내용은 미리 복제하지 않고 목록만 표시한 뒤 열 때 내려받게 한다.
- 다중 계정 UX: 제어 센터에 계정 선택, 계정 추가, 선택 계정 Drive 열기, 웹 관리, 계정 간 공유, 선택 계정 로그아웃을 추가했다. 표시 이름이 같은 계정도 로그인 ID를 Drive 폴더명에 포함해 경로 충돌을 막는다. 선택 계정 전환·추가 뒤 background를 재시작해 profile job과 상태를 즉시 다시 읽는다.
- 로그아웃 안전성: 선택한 `accountKey`만 제거됐는지 확인하며 다른 profile이 남으면 전체 Agent를 미연결 상태로 만들지 않는다. 기존 emergency 정리 경로가 남은 다른 계정을 잘못 지울 수 있던 조건을 제거하고 명시적인 대상 키만 처리한다.
- 공유 계약: `다른 NAS 계정에서 공유됨`을 예약된 읽기 전용 가상 루트로 사용한다. 공유 생성 때 source와 recipient Agent 자격을 둘 다 검증하고 같은 비어 있지 않은 Windows `clientDeviceKey`, 서로 다른 owner, 개인 Drive root, 실경로 containment, 비-symlink 조건을 요구한다. 관계 기록에는 token이나 NAS 절대경로를 저장하지 않고 owner ID·상대경로·표시 메타데이터만 둔다.
- 목록·수화: recipient manifest에는 source 파일의 이름·종류·크기·수정시각만 합성한다. placeholder를 recipient 파일로 업로드하거나 삭제하지 않으며 열기 요청 때마다 현재 공유 관계, recipient 권한, source 계정/root와 containment를 다시 검증한 뒤 원본을 제공한다. source 변경·삭제·공유 해제는 composite revision으로 recipient manifest에 반영되며 오래된 로컬 사본은 기존 Drive 휴지통 정책으로 정리된다.
- 관리 기능: native 공유 창에서 source 계정, recipient 계정, source 메타데이터 트리를 단계적으로 선택해 파일·폴더·전체 root를 공유할 수 있고, 보낸 공유와 받은 공유를 조회·해제할 수 있다. 계정 수를 2개로 가정하지 않아 동일 PC에 연결된 여러 계정 사이에서 관계별로 반복해 사용할 수 있다.
- 구현 위치: `backend/accountDriveShares.js`, `backend/nasRoutes.js`, Windows Agent/Setup 1.11.0, `backend/tests/accountDriveShares.test.js`, `backend/tests/deviceSyncSecurity.test.js`에 반영했다. 실제 자격 증명이나 사용자 파일을 쓰지 않는 3계정 native 렌더 QA에서 제어 센터와 공유 창의 배치·선택 흐름을 확인했다.
- 로컬 검증: 새 공유 helper 단위 테스트, Agent self-test, Setup C# compile/self-test, 전체 backend 회귀 테스트를 통과했다. workbook에는 `WIN-ACCOUNT-SHARE-BOUNDARY`, `WIN-MULTI-ACCOUNT-ONDEMAND-SHARE`와 Relation/Code 기록을 추가했고 formula error 0 및 변경 시트 렌더 검사를 통과했다.
- 운영 배포: 기능 commit `c89fc78`을 GitHub와 NAS live branch에 clean fast-forward했다. NAS에서 Agent self-test와 backend 전체 14개 테스트 파일을 통과했으며, Linux에서만 실행되는 문서 변환 통합 2건도 실제 변환에 성공했다. `msp-backend` restart/save 뒤 online이고 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active다. 내부 3030과 공개 HTTPS는 200, 미인증 Agent 업데이트와 공유 browse는 각각 403이다.
- 배포 산출물: NAS와 로컬 Agent SHA-256은 `d9b8f934baa4698b47c99a992d28e057b541850ec80b340bc76a219874d0e606`, Setup SHA-256은 `73f4af26992b7c0acaceab1db7f75404d8da622dfa77e9d00d0c7b3f2bbdbd0e`로 일치한다. 서버 배포 버전과 workbook 상태는 1.11.0 운영 배포 완료로 맞췄다.
- 남은 체감 검증: 실제 사용자 계정 token과 파일은 테스트에 사용하지 않았다. 사용자가 1.11.0 Setup을 설치한 뒤 같은 PC에 계정 2개 이상을 연결하고 작은 테스트 파일 하나를 공유해 탐색기 목록 표시·첫 열기 hydration·공유 해제를 체감 확인하면 된다. 실패 시 기존 계정·원본 파일을 훼손하지 않도록 read-only/권한 재검증 계약은 자동 테스트와 서버에서 검증됐다.

## 2026-09-06 다중 계정 공유 2차 논리 경계 검토

- 사용자 요청: 구현이 너무 빨리 끝난 것은 아닌지, 다중 계정·공유 로직에 논리 오류가 없는지 재검토한다.
- 발견 1: recipient 공유 manifest와 composite revision이 `personal-drive`가 아닌 일반 추가 동기화 root에도 합쳐질 수 있었다. 일반 root에서는 Agent의 read-only 공유 경로 보호도 적용되지 않으므로 잘못된 placeholder가 업로드 대상으로 해석될 여지가 있었다. 서버 changes·manifest·file과 mutation 예약 경로를 syncRoot kind에 맞게 분리했다.
- 발견 2: native 공유 CLI의 deviceId 조회가 실패하면 활성 profile 또는 첫 profile로 fallback했다. 오래된 UI snapshot이나 잘못된 인자가 다른 계정의 browse/list/revoke로 이어지지 않도록 요청 deviceId exact-match만 허용하고 없으면 즉시 실패하도록 변경했다.
- 발견 3: 공유 폴더 안의 중간 symlink가 같은 source 계정 root의 공유 범위 밖을 가리킬 때, 기존 다운로드 검증은 계정 root 안이라는 사실만 확인했다. 이제 lexical path와 realpath가 모두 선택한 파일·폴더 자체의 root 안에 남는지 확인한다.
- 검증: exact profile self-test, personal-drive-only route 회귀 gate, 선택 공유 root realpath gate와 helper 단위 검사를 추가했다. Agent/Setup을 다시 빌드하고 패키지 self-test, 로컬 backend 전체 14개 테스트 파일을 통과했다. Windows 비관리자 환경의 symlink 생성 1건과 문서 변환 통합 2건만 환경 조건상 skip이며 해당 검사는 NAS Linux 배포 단계에서 실행한다.
- 프로젝트 메모리: `WIN-MULTI-ACCOUNT-ONDEMAND-SHARE` 상태와 `WIN-ACCOUNT-SHARE-BOUNDARY`에 personal-drive 전용, exact deviceId, 선택 공유 root realpath 규칙을 보강했다. formula error 0과 관련 범위 렌더를 확인했다.
- 배포 버전 보정: 첫 1.11.0과 경계 보완판이 같은 semantic version이면 이미 설치한 PC의 updater가 새 binary를 구분하지 못하므로 공개 버전을 1.11.1로 올렸다. Agent 상수, 서버 metadata, npm package/lock, Setup Assembly/File/ProductVersion을 함께 맞췄다. 1.11.1 Agent SHA-256은 `363c42f92d23c39ea3674b53cbdd07d57da86133b8a716cf82c6cb09e7a164f8`, Setup은 `70120cc2ea21e2785b366040d1e5c4be95a8cf74f49ccada1fb8627f954ddcb1`이다.
- 운영 완료: 경계 보완 `3bc145a`와 1.11.1 release `c6347ce`를 GitHub와 NAS live branch에 clean fast-forward했다. NAS Linux에서 중간 symlink 공유 범위 이탈 검사를 포함한 Agent self-test와 backend 전체 14개 테스트 파일이 통과했고 문서 변환 통합 2건도 성공했다. release 재배포 뒤 핵심 공유·보안 테스트도 다시 통과했다. PM2 restart/save 뒤 `msp-backend` online, 필수 서비스 active, 내부·공개 HTTP 200이며 1.11.1 상수와 위 두 배포 파일 SHA-256이 NAS·로컬에서 일치한다.

## 2026-09-06 NAS 디스크·계정 루트·20GiB 전환 사전 진단

- 사용자 요청: 최근 가입 계정의 실제 저장 루트와 기존 저장 방식의 문제를 확인하고, 실제 사용량이 20GiB를 넘는 계정을 제외한 기존 계정 및 신규 계정 기본 할당량을 20GiB로 낮추는 작업을 검토한다. 관리자 용량 화면에는 전체 NAS 공간, 사용자 할당, 할당량 중 실제 사용, 사용 가능한 공간을 구분해 표시할 예정이다. 이번 단계에서는 가장 먼저 실제 디스크 사용량만 확인하며 용량 값이나 경로는 변경하지 않는다.
- 물리 디스크: NAS 데이터는 `/dev/nvme0n1p1` ext4 한 개가 `/mnt/nas`에 마운트되어 있다. 총 1,967,845,998,592 bytes, 사용 87,256,711,168 bytes, 가용 1,780,552,622,080 bytes로 약 1.8TiB 중 82GiB 사용·1.7TiB 여유다. 별도 `/dev/nvme1n1p2` 약 1.8TiB는 Debian `/` 시스템 디스크이며 NAS 데이터 볼륨과 합쳐져 있지 않다.
- 주요 실제 사용처: `/mnt/nas` 82GiB 중 사용자 계정 root 합계는 약 2.441GiB다. 나머지는 주로 계정 밖의 설치 자료, 과제 자료, backup, 임시 업로드와 Agent incoming 저장소다.
- 계정 할당: 승인 계정 22개, 승인 대기 0개다. 할당량 합계는 1,401GiB지만 실제 계정 사용량은 약 2.441GiB이며 20GiB를 초과해 사용 중인 계정은 0개다. 따라서 현재 조건을 그대로 적용하면 22개 모두 20GiB로 낮출 수 있고 총 할당은 440GiB가 된다. 아직 실제 quota 변경은 하지 않았다.
- 최근 계정 루트: 최근 승인 계정들은 `members.json`의 `personalRootPath=/users/<loginId>`와 실제 `/mnt/nas/users/<loginId>`가 일치하며 폴더도 존재한다. `rootPath`가 빈 값이어도 현재 접근 코드가 같은 소문자 `users/<loginId>`를 fallback으로 사용하므로 최근 계정 자체의 저장 위치는 정상이다.
- 기존 구조 문제: 오래된 계정에는 `/mnt/nas/<loginId>`, `/mnt/nas/USERS/<loginId>`, `/mnt/nas/users/<loginId>`가 혼재한다. 일부 계정은 현재 유효 root와 별개인 과거 폴더가 동시에 남아 있고, 현재 어떤 계정에도 할당되지 않은 `users`/`USERS` 하위 폴더도 확인됐다. 합계가 수백 MiB 수준이라 디스크 부족의 주원인은 아니지만, 자동 이동·삭제 전에 소유권과 데이터 최신성을 별도로 확인해야 한다.
- 판단: 관리 화면에서 작게 보인 값은 물리 디스크 여유가 아니라 1,401GiB의 논리 할당과 5% 시스템 reserve, 비계정 사용량을 차감한 `availableForAllocation`일 가능성이 높다. 다음 구현에서는 물리 사용량과 논리 할당량을 한 막대로 혼합하지 않고 네 가지 수치를 명시적으로 구분해야 한다.

## 2026-09-06 Debian 시스템 디스크 사용량 추가 확인

- 사용자 요청: NAS 데이터 디스크와 별도로 Debian 및 NAS 서버 프로그램이 설치된 시스템 디스크의 현재 사용량을 확인한다.
- 확인 결과: 시스템 디스크는 Seagate FireCuda 520 2TB의 `/dev/nvme1n1p2` ext4이며 `/`에 마운트되어 있다. 총 1,966,309,933,056 bytes, 사용 165,613,916,160 bytes, 가용 1,700,737,417,216 bytes로 `df -h` 기준 1.8TiB 중 155GiB 사용, 1.6TiB 여유, 사용률 9%다. EFI 512MiB와 swap 977MiB 파티션이 별도로 있다.
- 확인된 구성별 사용량: 프로젝트 checkout은 2.5GiB, `/var/www/html`은 77MiB, root PM2 상태는 3.6MiB다. Docker는 image 4.731GB, active container writable layer 835.1MB, volume 66.25MB이며 journal 로그는 2.1GiB다.
- 운영 주의: `/` 전체 `du`는 장시간 디스크 순회를 유발해 수치 확인 후 중단했다. 시스템 디스크는 9% 사용으로 여유가 충분하며 현재 정리 작업은 필요하지 않다. 파일 삭제나 Docker prune은 수행하지 않았다.

## 2026-09-06 시스템 디스크 1TiB 보조 NAS 저장공간 검토

- 사용자 요청: Debian과 NAS 프로그램이 설치된 시스템 디스크의 여유 공간 중 약 1TB를 NAS 저장공간으로 추가하고, 장래에 공간이 부족하면 복잡한 파티션 작업 없이 설정 한 번으로 더 넓게 사용할 수 있는지 검토한다.
- 현재 기반: 시스템 `/dev/nvme1n1p2`는 `/`에 직접 마운트된 단일 ext4 파티션이며 LVM이나 RAID 위에 있지 않다. 확인 시점 가용 공간은 약 1.6TiB다. ext4 project quota 기능과 `prjquota` 마운트도 현재 활성 상태가 아니다. 운영 코드는 `NAS_ROOT=/mnt/nas` 단일 데이터 파일시스템을 기준으로 root 경계, `statfs`, quota, upload, backup, chat 임시 저장소를 계산한다.
- 권장 구조: 시스템 파티션을 축소해 별도 1TB 파티션을 만드는 방식은 채택하지 않는다. 대신 `/srv/nas-overflow` 같은 전용 디렉터리를 보조 NAS 볼륨으로 등록하고 초기 사용 상한을 1TiB로 둔다. 프로젝트 checkout 자체가 아니라 사용자 파일, 문서 변환 결과, AI 산출물처럼 커지는 데이터만 명시적 배치 정책에 따라 이 볼륨을 사용한다.
- 원터치 확장 원칙: 향후 관리 설정은 파티션 크기를 변경하지 않고 보조 볼륨의 논리 상한만 높인다. 확장 전 디스크 상태, 실제 여유 공간, 진행 중인 쓰기, 백업 상태를 검사하고 설정을 원자적으로 저장하며 감사 기록과 되돌리기 값을 남긴다. 시스템 디스크의 남은 공간 전부를 허용하지 않고 Debian, Docker, 로그, 업데이트를 위한 최소 300~400GiB 또는 정책상 더 큰 보호 여유 공간을 항상 남긴다.
- 강제 한도: 애플리케이션 계산만으로는 Docker·로그·관리자 직접 쓰기를 막지 못하므로 최종 구현은 ext4 project quota 같은 파일시스템 강제 한도와 애플리케이션 용량 원장을 함께 쓰는 것이 안전하다. 현재 project quota가 비활성이라 이를 도입하는 일회성 유지보수 단계와 재부팅 검증이 먼저 필요하다.
- 구현 영향: 다중 볼륨 registry, 볼륨별 전체·사용·예약·할당 가능 용량, 계정/파일별 배치 위치, 업로드·공유·검색·휴지통·버전·Agent 동기화·backup의 교차 볼륨 경계, 볼륨 장애 시 읽기/쓰기 상태를 함께 설계해야 한다. 초기에는 기존 `/mnt/nas` 데이터를 이동하지 않고 신규 계정 또는 선택한 큰 폴더만 보조 볼륨에 배치하는 방식이 가장 안전하다.
- 검증 및 상태: 파일시스템과 코드 구조를 읽기 전용으로 확인했으며 파티션, mount, quota, 사용자 데이터, 서비스 설정은 변경하지 않았다. 이 항목은 설계 검토 완료·구현 미착수 상태다. 다음 안전 조치는 보호 여유 공간과 보조 볼륨 배치 대상을 확정한 뒤 유지보수 창에서 project quota 기반을 먼저 준비하는 것이다.

## 2026-09-06 보류 작업 원장 및 계정별 파일 관리자 경로 격리

- 사용자 요청: 앞으로 미룬 문제를 계속 기록할 `보류 작업` 시트를 만들고, A 계정에서 b 폴더를 연 뒤 로그아웃해 K 계정으로 로그인했을 때 A 계정의 b 경로가 파일 관리자에 남았던 계정 경계 문제를 해결한다.
- 원인: 서버는 새 로그인 세션의 `getAccessBasePath`와 `resolveInside`로 파일 접근을 다시 제한해 A 계정 파일을 K 계정에 보내지 않았지만, 브라우저의 `WindowProvider`가 로그인 화면보다 바깥에서 계속 살아 있었다. 현재 파일 관리자 경로도 모든 계정이 공유하는 `nas_file_manager_path` 키였고 열린 창·작업표시줄 순서·포커스·z-index를 로그아웃이나 계정 전환 때 비우지 않아 이전 계정의 경로 문자열이 남았다.
- 수정: `windowWorkspaceIdentity.js`에 `userUid → loginId → id → username` 순서의 계정 식별과 계정별 현재 경로 키를 추가했다. legacy 전역 경로 키는 폐기했다. `WindowContext`는 사용자 변경 이벤트와 500ms 보조 검사를 함께 사용해 로그아웃·계정 교체를 감지하고 열린 창, 작업표시줄 순서, 포커스, z-index, 현재 경로를 목적 계정 상태 또는 루트로 함께 전환한다. 일반 로그아웃과 401 강제 로그아웃은 즉시 변경 이벤트를 발생시킨다.
- 보류 원장: `docs/NAS_PROJECT_LOG.xlsx`에 `보류 작업` 시트를 추가했다. 보류 ID, 등록일, 상태, 기능 ID, 요청·문제, 보류 이유, 현재 확인, 재개 조건, 다음 안전 작업, 관련 기록, 최근 갱신일을 기록하며 상태 선택 목록을 제공한다. 최초 항목은 20GiB quota 전환, 시스템 디스크 1TiB 보조 볼륨, AI 파일 에이전트 3건이다. 재개·완료 시 삭제하거나 새 행을 중복 생성하지 않고 같은 보류 ID의 상태와 근거를 갱신한다. `AGENTS.md`, 메모리 정책, README, Memory_Process, Do_Not_Break, Feature/Relation/Code/Patch/Request/Generated 시트에도 운영 규칙과 이번 변경을 연결했다.
- 검증: 로컬과 NAS Linux에서 legacy 전역 경로 비상속, A→K 계정 전환, A→로그아웃 루트 초기화 회귀 3/3을 통과했다. 양쪽 production build와 PDF.js API/Worker 4.8.69 검사를 통과했다. workbook은 artifact-tool로 import/edit/export했고 신규·변경 시트를 렌더해 표와 줄바꿈을 확인했으며 formula error 0, replacement character와 `????` 0건, xlsx ZIP 무결성, 상태 validation을 확인했다.
- 운영 배포: 기능 commit `b0beba1`을 GitHub와 NAS live branch에 clean fast-forward하고 NAS에서 frontend를 다시 빌드했다. PM2 restart/save 뒤 `msp-backend`는 online이며 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active다. 내부 3030과 공개 HTTPS는 200이다.
- 남은 확인: 실제 사용자 자격 증명과 파일은 테스트에 사용하지 않았다. 다음 실제 A→K 전환 때 A의 열린 창과 경로가 사라지고 K의 루트 또는 K 전용 저장 경로만 표시되는지 화면에서 한 번 체감 확인한다. 서버 경계와 자동 회귀·build·운영 배포는 완료됐다.

## 2026-09-06 관리자 서버 설정·자원 모니터링

- 사용자 요청: 관리자 또는 마스터의 시스템 설정에 `서버 설정` 페이지를 추가해 NAS 컴퓨터의 CPU, RAM, 디스크 등 자원 종류와 현재 사용량을 표시한다. 사용자 관리에 있는 NAS 저장공간 원장은 두 페이지에 모두 유지한다. 전력 등은 실제 측정 가능할 때만 표시한다.
- 실장비 확인: Ryzen 5 3400G 4코어/8스레드, 현재 인식 메모리 약 5.7GiB와 스왑 약 977MiB, 시스템 Seagate FireCuda 520 2TB NVMe와 NAS 데이터 Crucial CT2000P3PSSD8 2TB NVMe를 확인했다. `/sys/class/hwmon`에서 CPU `Tctl`, AMD GPU edge, 두 NVMe 온도는 읽을 수 있다. `fan*_input`, `power*_input`, powercap은 없어서 팬·전력은 추정하지 않고 화면에서 숨긴다.
- 구현: `backend/serverMetrics.js`가 `os`, `/proc`, `statfs`, 인수 배열 `lsblk`, hwmon을 읽어 CPU 사용률·1/5/15분 부하, 물리/논리 코어, 메모리·스왑, 시스템/NAS 볼륨, 물리 디스크와 유효 센서 값을 집계한다. 장치 일련번호, 환경 변수, 프로세스 목록, 사용자 파일은 응답하지 않는다. `GET /api/system/metrics`는 `requireManager`를 거치는 MASTER/MANAGER 전용 no-store API이며 기존 `getStorageCapacitySummary`도 같은 응답에 넣는다.
- 화면: 시스템 설정의 네 번째 관리자 전용 탭 `서버 설정`에 CPU·메모리 카드, 시스템/NAS 디스크 사용률, 물리 디스크 모델·종류·크기, 온도 센서, 지원될 때만 팬, NAS 저장공간 할당 원장을 표시한다. 5초 자동 갱신과 수동 새로고침을 제공한다. 기존 사용자 관리의 NAS 저장공간 영역은 `StorageCapacityOverview` 공용 컴포넌트로 바꿔 두 화면이 같은 계산값과 문구를 사용한다.
- 검증: `serverMetrics` 단위 테스트와 NAS 실센서 수집이 통과했다. 실서버 반복 검증에서 `fs.promises.readFile('/proc/cpuinfo')`가 pseudo-file 생성 내용의 첫 chunk만 반환해 물리 4코어를 2코어로 표시하는 경우를 발견했고, 작은 `/proc`·sysfs 입력을 동기 완전 읽기로 고정한 뒤 4코어/8스레드로 반복 일치시켰다. NAS 전체 backend 테스트 15개 파일이 통과했고 문서 변환 통합 2건도 실제 성공했다. frontend production build와 react-pdf/PDF.js API·Worker 4.8.69 gate가 통과했으며 기존 unrelated lint warning만 남았다. 무인증 `/api/system/metrics`는 403으로 차단된다.
- 운영 배포: 기능 commit `6c8d5a5`를 GitHub와 NAS live branch에 clean fast-forward했다. 새 `main.e7023c95.js`를 `/var/www/html`에 원자 반영하고 내부·공개 index bundle 일치를 확인했다. PM2 restart/save 뒤 `msp-backend`는 online, `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 enabled+active, 내부 3030과 공개 HTTPS는 HTTP 200이다.
- 프로젝트 메모리: `ADMIN-SERVER-MONITORING`, `ADMIN-METRICS-001`과 Feature/Relation/Code/API/Network/Patch/Request/Generated 기록을 `docs/NAS_PROJECT_LOG.xlsx`에 추가했다. 기존 20GiB quota 전환 보류 행에는 두 관리자 화면의 용량 원장 공용화 완료만 보강하고 quota 정책 자체는 보류로 유지했다. artifact-tool formula error 0과 변경 범위 렌더를 확인했다.
- 남은 경계: 현재 자동화 브라우저는 로그인 화면이라 실제 관리자 계정으로 탭을 클릭하지 않았다. 사용자 자격 증명을 사용하거나 임의 관리자 계정을 만들지 않았으며, 배포 bundle·실센서 응답·권한 차단·운영 서비스 검증은 완료했다. 로그인된 관리자 화면을 새로고침하면 새 탭이 표시된다.

## 2026-09-06 NAS 노트 스튜디오 사전 조사·독립 설계 메모리

- 사용자 요청: NAS 플랫폼에 Notion과 비슷한 노트 프로그램을 도입하되, 블록 문서뿐 아니라 코드 기반 TXT 편집기와 Jupyter처럼 셀 단위로 실행하는 Python 노트북 등 여러 노트 형식을 계속 추가할 수 있게 한다. 구현 전 오픈소스·다른 메모 제품·UI 요소의 배치와 순서·버튼·우클릭 메뉴·명령·단축키·편의 기능·오류 상황을 세밀하게 조사하고, 프로그램별 독립 Excel 설계 파일을 만들어 구현 중 누락과 오류 해결을 막는다. 향후 연동 PC에서 내려받는 노트 앱도 웹과 동일한 UI로 구축한다.
- 조사 범위: Notion 공식 도움말과 AFFiNE, AppFlowy, TriliumNext, SiYuan, Docmost, Outline, Logseq, Joplin, HedgeDoc의 공식 문서·공식 저장소를 비교했다. 편집 기반은 Tiptap/ProseMirror, BlockNote, Yjs/Hocuspocus, Monaco, CodeMirror 6, Jupyter nbformat/server, Docker 격리, Electron과 Tauri의 공식 자료를 검토했다. 출처 URL과 반영 근거는 전용 문서 `Source_Index`에 고정했다.
- 제품 판단: 완성된 외부 앱을 그대로 설치하거나 iframe으로 끼우지 않는다. 기존 인증, 계정별 NAS root, 파일 선택·공유·버전·쿼터, 플랫폼 창 관리자, AI 에이전트, 향후 NAS Drive와 한 권한·상태 모델로 연결해야 하기 때문이다. React/MUI 공통 셸 위에 Tiptap/ProseMirror 블록 편집, Yjs 동시 편집·오프라인, 기존 Monaco 기반 TXT/코드 노트, Jupyter 호환 `.ipynb`와 격리 커널을 note type adapter로 조합하는 방향을 권장한다.
- 라이선스 경계: Tiptap core/ProseMirror/Yjs/Monaco/CodeMirror 같은 허용적 코어를 우선한다. Tiptap Pro의 댓글·snapshot 등 유료 확장에 종속되지 않고 댓글·권한·버전은 NAS 백엔드가 소유한다. BlockNote core와 XL의 MPL/GPL·상용 경계, AppFlowy/Trilium/Docmost의 AGPL, Outline의 BSL Document Service 제한을 명시했으며 라이선스 검토 없이 해당 코드를 복사하지 않는다.
- 독립 설계 메모리: `docs/programs/NAS_NOTE_STUDIO_SPEC.xlsx`를 생성했다. 32개 시트에 README, 제품 원칙과 결정, 경쟁 제품·오픈소스·공식 출처, 정보 구조와 UI 배치, 사용자 흐름, 13개 노트 유형, 블록·slash 명령·우클릭 메뉴·단축키, 데이터베이스 보기, 코드/TXT, Python 노트북, 협업·오프라인·PC 앱, 데이터 모델, NAS 저장 연계, 보안, API 계약, 상태 머신, 오류 복구, 다른 앱 관계, 성능, 접근성, 테스트, 단계별 로드맵과 미결 결정을 기록했다. 이후 NOTE-STUDIO 구현 변경은 해당 시트와 `Change_Log`를 같은 커밋에서 갱신한다.
- Python 안전 경계: 노트북 셀을 backend나 NAS host에서 직접 실행하지 않는다. non-root 격리 컨테이너, read-only rootfs, capabilities 제거, Docker socket/device 미노출, 사용자 선택 파일만 제한된 mount/copy, 기본 network none, CPU·RAM·PID·시간·디스크·출력·활성 커널 수 제한과 interrupt→restart→kill 복구가 필수다. 현재 인식 RAM이 약 5.7GiB이므로 사용자당 active kernel 1개, 서버 전역 1~2개부터 계측하는 보수적 초안을 기록했다.
- 웹·PC 동일 UI: note adapter와 command registry를 공통 React 패키지로 두고, PC 앱은 파일 dialog, offline storage, deep link, single instance, updater만 native adapter로 분리한다. PWA 오프라인 검증 뒤 기존 NAS Drive와의 결합 비용을 포함해 Tauri/Electron을 결정하며, renderer에 전체 파일시스템이나 Node 권한을 노출하지 않는다.
- 기존 프로젝트 관계: 마스터 `docs/NAS_PROJECT_LOG.xlsx`에는 `NOTE-STUDIO` 기능, `DNB-NOTE-STUDIO-001`, 프로그램별 상세 설계 메모리 규칙과 AUTH-ROLE, FILE-MANAGER, FILE-VERSIONING, STORAGE-CAPACITY-ALLOCATION, DOCUMENT-STUDIO, DOCUMENT-WORKSPACE, AI-AGENT, Windows NAS Drive 관계만 추가했다. 세부 기능의 단일 기준은 전용 XLSX다.
- 검증: 전용 XLSX는 artifact-tool로 생성·재가져오기하고 formula error 0건을 확인했다. 32개 시트를 모두 PNG로 렌더한 뒤 4개 contact sheet로 표의 잘림·줄바꿈·한글 표시를 육안 검사했다. 마스터 workbook도 artifact-tool로 수정·렌더하고 formula error 0건을 확인했다. 이번 단계는 조사·설계 문서만 추가했으며 앱 코드, DB, 서비스, 사용자 파일, 운영 설정은 변경하지 않았다.
- 다음 안전 순서: 사용자가 구현 시작을 지시하면 M0 기술 spike로 React 19에서 Tiptap/IME·Yjs·Monaco lazy-load를 검증하고, M1에서 노트 shell·계정 경계·블록/Markdown/TXT/코드·자동 저장·버전·휴지통·NAS 파일 선택을 먼저 완성한다. 협업은 M1.5, Python/데이터베이스는 보안·부하 gate가 있는 M2, PC 앱은 PWA 결과 뒤 M3로 진행한다.

## 2026-09-06 노트 스튜디오 M1 핵심 기반 구현·로컬 검증

- 사용자 요청: 조사에서 끝내지 않고 기능을 하나씩 구현한 뒤 해당 묶음의 부족한 점과 오류를 검토·검증하고, 완료된 다음에 다음 구현으로 넘어가 전체 노트 스튜디오를 완성한다.
- 이번 구현 경계: 첫 묶음은 계정별 영속 저장과 기본 편집 흐름이다. 플랫폼 런처와 전역 앱 창에 `노트 스튜디오`를 등록하고 블록, Markdown, TXT, 코드 4종 노트를 생성·열기·편집할 수 있게 했다. 블록은 Tiptap/ProseMirror, 나머지는 기존 Monaco를 재사용한다.
- 저장·충돌·복구: 모든 역할의 노트 저장소를 관리자 NAS-root 권한과 분리된 `getQuotaBasePath(user)/.note_studio`에 둔다. JSON은 임시 파일 뒤 rename으로 교체하며 노트당 5MB, 버전 최대 100개다. PATCH는 `expectedRevision`이 현재 revision과 정확히 같을 때만 저장하고 불일치는 409 `NOTE_REVISION_CONFLICT`로 중단한다. UI는 850ms 자동 저장과 Ctrl/Cmd+S, 저장 중 추가 입력의 후속 재저장, 저장 상태·충돌·오류 문구를 제공하고 실패해도 현재 창의 입력을 버리지 않는다.
- 탐색·연계: 현재 계정 안에서 제목·본문 검색, 노트 휴지통·복원·확인 후 영구 삭제, 이전 버전을 새 revision으로 복원한다. 기존 NAS picker로 파일·폴더를 검증된 상대 경로 참조로 첨부하고 기존 파일/폴더 창으로 다시 연다. 5MB 이하 UTF-8 TXT·Markdown·일반 코드 파일 가져오기와 MD/TXT/코드/블록 JSON 내보내기를 제공한다.
- 숨김 저장소 경계: `.note_studio`는 일반 파일 목록과 전체 검색뿐 아니라 Windows Agent 동기화 경로 검증, manifest, watcher에서도 제외했다. 내부 JSON과 버전 파일을 사용자가 일반 파일처럼 수정하거나 PC 양방향 동기화로 중복 처리하지 않는다.
- 자동·운영 검증: `noteStudioService`에서 4종 생성, 계정 root 격리, revision 충돌, 버전 보존·복원, 휴지통, 내용 검색, 첨부 revision, 5MB 제한, 100개 retention을 7개 테스트로 확인했다. 저장공간 경계 4개 회귀와 Node syntax, `git diff --check`, frontend production build가 로컬·NAS에서 통과했다. NAS loopback 인증 smoke는 노트 생성→한글 저장→stale revision 409→버전→NAS root 첨부/제거→휴지통/복원→Markdown import/export→테스트 노트 영구 정리까지 통과했다. 첫 빌드 검토에서 Tiptap이 main bundle을 약 129KB 늘린 점을 발견해 노트 앱을 React lazy chunk로 분리했고 main은 약 704KB에서 590.5KB로 줄고 노트 전용 chunk 127KB로 분리됐다. 전체 frontend의 기존 `App.test.js`는 Windows 로컬 Jest가 설치된 `react-router-dom`을 해석하지 못하는 기존 환경 문제로 실패하지만 clean NAS 의존성과 production resolver/build는 성공했다.
- 메모리 갱신: 마스터 workbook의 NOTE-STUDIO Feature/Code/API/Do_Not_Break/Patch/Request를 갱신했다. 전용 `NAS_NOTE_STUDIO_SPEC.xlsx`에는 `Implementation_Status` 시트를 추가하고 Roadmap·Change_Log를 0.2-m1-core 상태로 갱신했다. 두 workbook 모두 artifact-tool 재가져오기에서 formula error 0이며 새 문자의 replacement/mojibake는 확인되지 않았다.
- 운영 배포와 남은 경계: 기능 commit `787bd18`을 GitHub와 NAS branch에 clean fast-forward하고 NAS `npm ci`, backend 회귀 11개, production/PDF.js gate, 내부·공개 HTTP 200과 필수 서비스 active를 확인했다. live bundle은 초기 `main.7baaf336.js`였고 lazy-load 보완은 다음 commit/bundle로 즉시 교체한다. 자동화 브라우저는 로그인 화면이라 인증 입력을 대신하지 않았으므로 로그인된 실제 화면의 한글 IME·커서·재로딩·첨부·휴지통·두 창 충돌 육안 E2E는 남는다. M1의 계층 트리, slash/context command registry, 오프라인 queue도 다음 세부 묶음이다. M1.5 실시간 협업, M2 데이터베이스·Python, M3 PC 앱, M4 AI는 아직 구현하지 않았으며 Python은 격리·부하 gate 전 활성화 금지다.

## 2026-09-06 노트 스튜디오 M1 계층 트리·블록 명령

- 순차 구현: M1 핵심 저장/API의 운영 smoke가 통과한 뒤에만 다음 묶음을 시작했다. 노트 `parentId`를 트리 순서와 들여쓰기로 표시하고 목록 우클릭에서 하위 노트를 만들거나 최상위로 이동할 수 있게 했다. 서버는 자기 자신뿐 아니라 모든 자손 아래로 이동하는 순환 구조를 추적해 409 `NOTE_TREE_CYCLE`로 차단한다.
- 공통 명령: 블록 편집기에서 `/` 또는 Ctrl/Cmd+K로 같은 명령 목록을 열고 본문, 제목 1/2, 글머리표·번호 목록, 인용, 코드 블록, 구분선을 실행한다. 명령 정의·검색과 트리 평탄화는 `noteStudioCommands.js`의 순수 registry로 분리해 마우스·키보드 UI가 같은 동작을 사용한다.
- 검증·배포: backend 계층/순환 회귀를 포함한 note service 8/8, command 검색·부모 우선 트리·legacy orphan/cycle 가시성 3/3, NAS frontend production/PDF.js build가 통과했다. commit `7e8caaa`를 GitHub와 NAS clean branch에 반영하고 live `main.4dc2a7ae.js`, 내부·공개 HTTP 200, 필수 서비스 6개 active, PM2 online을 확인했다. 로그인된 실화면의 우클릭·한글 IME·slash 위치 검증은 사용자의 브라우저 세션이 필요해 남은 육안 gate다.

## 2026-09-06 노트북 NAS 원격 실행의 동적 자원 제어 요구

- 사용자 요청: 성능이 높지 않은 NAS에서 여러 사용자가 동시에 Python을 실행해도 오류 없이 대기·실행되게 하고, RAM·CPU·디스크·GPU 등 장치를 업그레이드하면 운영체제가 인식한 자원을 서버 설정과 실행 허용량에 자동 반영한다. GPU/CUDA·머신러닝·임베딩 같은 고부하 권한은 관리자에게도 맡기지 않고 MASTER만 계정별로 허용한다.
- 실장비 재확인: 논리 CPU 8개, RAM 6,094,794,752 bytes, 확인 시점 MemAvailable 3,420,602,368 bytes, swap 1,024,454,656 bytes 중 1,023,729,664 bytes 사용, load average 0.04/0.04/0.00, cgroup v2의 cpu/io/memory/pids/cpuset controller, AMD Vega 내장 GPU를 확인했다. 시스템 `/` 가용 1,700,667,736,064 bytes, NAS `/mnt/nas` 가용 1,780,552,544,256 bytes다.
- 설계 결정: Python 실행은 backend 프로세스나 NAS host에서 직접 수행하지 않는다. 공통 admission controller가 현재 MemAvailable·CPU load·swap pressure·디스크 보호 여유·온도·활성 작업·예약량을 검사하고, 허용된 작업만 사용자별 non-root 격리 worker에 배정한다. 나머지는 공정한 계정별 대기열에 넣으며 자원 부족을 실패로 처리하지 않는다. 초기 안전값은 전역 active kernel 1개, 계정당 1개이며 실제 측정 뒤 가벼운 작업만 전역 2개로 확장한다.
- 업그레이드 반영: 서버 설정의 실제 장치·사용량 표시는 기존 5초 metrics 수집으로 갱신하고, 실행 scheduler는 고정 사양값이 아니라 매 admission 시 실제 OS/cgroup 값을 다시 계산한다. 자원 감소·온도·메모리 압박은 즉시 신규 배정을 줄이고 실행 중 작업을 순차 중단한다. 증설 자원은 OS가 인식하면 용량 계산에 반영하되, GPU/CUDA와 새 실행 capability는 자동 허용하지 않고 self-test·benchmark·MASTER 활성화 뒤에만 사용자에게 부여한다. 일반 RAM/CPU 교체는 대부분 재부팅이 필요한 하드웨어이므로 OS가 인식하기 전까지 실시간 반영을 보장하지 않는다.
- 상태: 이번 요청에서는 실제 자원과 기존 cgroup/metrics 기반을 읽기 전용으로 확인하고 실행 서비스는 아직 활성화하지 않았다. Python 원격 실행은 노트 스튜디오 M2에서 격리 worker, 예약형 scheduler, 취소/timeout/OOM 복구, 장치 재감지, MASTER 전용 capability 정책과 회귀·부하 테스트를 함께 구현하기 전까지 계속 차단한다.

## 2026-09-06 Python 실행 페이지의 혼합 블록 요구

- 사용자 확인사항: Python 코드를 작성하는 페이지 안에서도 Notion처럼 설명 텍스트, 제목·목록·콜아웃, 파일 참조, 다른 페이지로 이동하는 하위 페이지 블록과 여러 기능 버튼을 함께 배치하고, 이런 문서 블록이 있어도 Python 코드는 정상적으로 실행되게 한다.
- 제품 판단: 이 기능은 raw `.py` 본문에 UI용 문법을 삽입하지 않는다. 노트북 안에 `일반 페이지`, `Python 실행 페이지`, `일반 코드 파일`을 구분한다. Python 실행 페이지는 문서 블록과 실행 가능한 Python 코드 셀을 섞어 저장하고 실행기는 Python 셀만 명확한 순서로 실행한다. 일반 `.py` 파일은 VS Code·터미널·외부 도구 호환성을 위해 순수 소스 파일로 유지하며, 페이지 링크와 설명 UI는 파일 내용 밖의 page metadata 또는 주변 패널에 둔다.
- 계층 원칙: 모든 페이지 유형은 자식 페이지를 가질 수 있다. 하위 페이지는 부모 본문에 이동 블록으로 보이고 왼쪽 트리에도 동일한 계층으로 나타난다. Python 실행 페이지의 텍스트·버튼·파일 블록은 실행 대상이 아니며, 코드 셀의 실행 순서·공유 kernel state·출력·오류·중지 상태를 별도 모델로 관리한다.
- 호환 원칙: Python 실행 페이지는 Jupyter 호환 import/export를 제공할 수 있게 설계하고, `.py` 내보내기는 코드 셀만 순서대로 합치며 문서 블록을 주석으로 포함할지 제외할지 사용자가 선택하게 한다. 숨겨진 실행 상태, 셀 순서 변경, 하위 페이지 이동이 코드 의미를 바꾸는 문제를 막기 위해 `전체 순서대로 실행`, kernel 재시작, 실행 번호와 stale output 표시가 필요하다.
- 상태: 요구와 설계 경계를 기록했으며 아직 Python 실행 페이지나 원격 kernel을 활성화하지 않았다. M2 구현은 먼저 혼합 block schema와 호환 round-trip을 고정한 뒤 격리 실행 scheduler를 연결해야 한다.

## 2026-09-06 Python 실행 페이지의 서버 통합본·로컬 분리 투영

- 사용자 확인사항: NAS 웹에서는 Python 코드, 설명 글, 페이지 링크와 기타 블록을 하나의 실행 페이지처럼 작성한다. NAS Drive로 연동 PC에 보일 때는 실제 실행 가능한 Python 파일과 텍스트·기타 정보 파일로 분리해 일반 파일 도구에서도 문제없이 사용한다.
- 설계 결정: 서버의 block 문서를 단일 기준 원본으로 두고 로컬에는 `페이지명.py`, `페이지명.md`, 필요한 assets와 숨김 mapping manifest를 가진 작업 폴더를 생성한다. `.py`에는 실행 가능한 코드 셀만 넣고 UI·페이지 이동·rich block metadata는 넣지 않는다. `.md`에는 설명 블록을 순서대로 투영하며 manifest가 stable block ID, 원래 순서, 페이지 링크와 양쪽 파일의 revision/hash를 보존한다.
- round-trip 경계: 로컬 `.py`와 `.md` 수정은 cell/block marker와 마지막 revision이 일치할 때 서버 페이지로 역반영한다. 양쪽이 동시에 바뀌면 자동 덮어쓰지 않고 코드·문서별 충돌 비교와 복사본을 제공한다. rich table, database, button, attachment, output처럼 Markdown이나 Python으로 무손실 표현할 수 없는 블록은 manifest/asset에 보존하고 로컬 파일에서 임의 삭제로 간주하지 않는다.
- 실행 원칙: 로컬에서는 생성된 순수 `.py`만 일반 Python으로 실행할 수 있고, NAS 원격 실행은 서버 통합 페이지에서 Python 셀만 순서대로 실행한다. 생성물이라는 이유로 매 동기화 때 전체 파일을 다시 써서 사용자의 로컬 편집을 지우지 않으며, 원자 교체·hash·revision·base snapshot을 사용한다.

## 2026-09-06 Markdown 투영과 rich block 표현 경계

- 사용자 확인사항: 로컬에 분리되는 Markdown 파일이 NAS 웹에서는 Notion처럼 여러 이미지, 클릭 가능한 링크, 목록·구분점, emoji, 글꼴 등 풍부한 표현을 지원할 수 있는지 확인한다.
- 지원 경계: 표준 Markdown/GFM으로 제목, 문단, 굵게·기울임·취소선, 목록·번호·체크박스, 인용, 구분선, 코드, 표, 여러 이미지, 일반/NAS 페이지 링크와 Unicode emoji를 양방향 보존한다. 글꼴 family·크기·색상, 자유 배치, column, callout 세부 스타일, button/action, database view, 접기 상태, 권한, 실행 output은 표준 Markdown만으로 무손실 표현할 수 없다.
- 설계 결정: NAS 웹의 기준 원본은 type과 attrs를 가진 rich block schema로 유지하고 Markdown은 표준 기능의 편집·교환용 투영본으로 사용한다. 고급 블록은 `.msp-page.json`과 assets에 보존하고 MD에는 사람이 읽을 수 있는 fallback 링크·표·텍스트를 둔다. 허용된 제한적 extension을 도입할 수 있지만 raw HTML/MDX의 임의 script 실행은 금지하고 sanitizer와 scheme/URL 검증을 강제한다. 외부 Markdown 편집기가 이해하지 못한 고급 블록을 삭제한 것으로 오인하지 않는다.

## 2026-09-06 미인지 Notion 기능의 지속 조사와 주석 모델

- 사용자 요청: 사용자가 Notion을 많이 사용하지 않아 직접 열거하지 못한 페이지 형식·편의 기능도 조사해 누락 없이 추가하고, 문서와 코드의 주석 처리까지 구현한다.
- 공식 기능 재대조: Notion 공식 도움말 기준으로 page/subpage, text·heading·table·list·toggle·media·file·code·bookmark·embed·equation·button·breadcrumb·목차·mention·reminder·emoji, synced block, page/block/inline comment와 resolve/reopen, database property/view/relation/rollup/formula/template/sub-item/dependency, 권한·version·trash·export를 제품 backlog의 상위 범주로 유지한다. 외부 제품을 그대로 복제하지 않고 NAS 계정 경계·파일·실행 모델에 필요한 기능을 선별 구현한다.
- 주석 구분: `코드 자체 주석`은 `.py`의 실제 `#` 등 언어 문법으로 round-trip하고, `검토 댓글`은 source를 바꾸지 않는 block/cell ID와 선택 범위 anchor 기반 thread로 저장한다. `페이지 토론`, `블록 댓글`, `선택 텍스트 inline 댓글`, `코드 줄 댓글`을 구분하고 답글, @mention, 알림, 해결·재열기, 편집·삭제, 작성자·시간·권한·감사 기록을 가진다. 본문 편집으로 범위가 이동할 때 block ID와 앞뒤 문맥으로 anchor를 복구하며 불확실하면 임의 위치에 붙이지 않고 `위치 변경됨`으로 표시한다.
- 누락 방지 방식: block type, command, context menu, shortcut, importer/exporter, permission, offline/conflict, accessibility, test case를 registry와 전용 `NAS_NOTE_STUDIO_SPEC.xlsx`의 기능 원장으로 관리한다. 각 구현 묶음 뒤 공식 기능·조사 제품과 gap audit를 다시 수행하되, 모든 기능을 한 번에 활성화하지 않고 저장 호환성과 회귀 검증이 끝난 기능만 순차 공개한다.

## 2026-09-06 노트 스튜디오와 문서 스튜디오의 Office 문서 생성 연계

- 사용자 확인사항: 노트나 Python 실행 페이지에서 글·코드를 입력하다가 우클릭해 기능을 추가할 때, 기존 NAS `문서 스튜디오`의 Office 새 문서 생성을 직접 호출하고 저장된 DOCX/XLSX/PPTX/HWP/HWPX를 현재 위치에 파일 블록으로 연결한 뒤 해당 편집기를 즉시 가장 앞으로 연다.
- 기존 기반: 화면의 `문서 스튜디오`는 내부 app ID `document-workspace`이며 `POST /api/document-workspace/documents`가 계정 root, realpath, quota, 형식 allowlist, 고유 이름, 임시파일+원자 rename을 적용해 실제 빈 Office/HWP 문서를 만든다. `문서 변환`은 내부 `document-studio`로 별도 기능이므로 노트의 새 문서 메뉴에서 혼동하지 않는다. 생성 파일은 기존 `openFileWindowByPath(path, true)` 경로로 OnlyOffice 또는 RHWP 편집 창을 전면 활성화할 수 있다.
- 통합 설계: editor selection/caret 또는 block 우클릭의 `삽입 > 문서 만들기`에서 실제 지원 형식만 보여주고, 기본 저장 위치는 현재 노트북/페이지의 파일 폴더로 한다. 생성 전에 현재 page revision을 저장하고, 서버의 공통 blank document service를 재사용하는 note 전용 transaction이 파일 생성과 document-reference block 삽입을 하나의 idempotency key로 묶는다. block 저장 실패 시 새 파일을 휴지통/rollback하고, 파일은 생성됐지만 편집 창 열기만 실패하면 파일을 보존한 채 `다시 열기`를 제공한다.
- 후속 확장: `빈 문서 만들기`, `기존 NAS 문서 연결`, `선택한 글로 문서 만들기`, `현재 페이지를 문서로 내보내기`를 분리한다. 첫 구현은 검증된 빈 문서 생성·연결·전면 열기부터 하고, 선택 내용 변환은 block→OOXML/HWPX fidelity와 되돌리기 검증 뒤 추가한다. 노트는 Office 파일 복사본을 내부에 숨기지 않고 stable file reference만 보유해 파일 관리자·문서 스튜디오·NAS Drive가 같은 실제 파일을 사용한다.

## 2026-09-06 노트에서 만든 Office 문서의 첫 저장 위치와 영속 연결

- 사용자 확인사항: 노트에서 문서 스튜디오의 Office 문서를 만든 경우 첫 저장 때 NAS 위치를 선택한다. 위치 선택기의 기본값은 기능을 호출한 노트북/현재 페이지의 문서 경로이며, 사용자가 계정 내 다른 NAS 폴더를 선택하면 실제 파일은 선택 위치에 저장하되 원래 노트의 문서 블록 연결은 유지한다.
- 저장 UX: 새 문서는 계정별 복구 가능한 draft로 열고 첫 `Ctrl+S` 또는 저장에서 이름·NAS 위치 선택기를 표시한다. 기본 경로는 호출 context의 notebook/page directory이고 사용자가 바꿀 수 있다. 첫 publish 뒤 일반 `Ctrl+S`는 같은 파일에 저장하며, `다른 이름으로 저장`·`복사본 저장`만 다시 위치를 묻는다. 기존 파일을 열었을 때는 새 위치를 묻지 않는다.
- 연결 안정성: 노트 블록은 변경 가능한 경로 문자열만 저장하지 않고 server가 발급한 stable document ID와 마지막 알려진 path/revision을 함께 가진다. 파일 관리자·문서 스튜디오·NAS Drive를 통한 이동·이름 변경은 registry와 참조를 원자 갱신한다. 다른 위치 저장 뒤에도 블록 클릭은 현재 경로를 해석해 같은 문서를 열며, 권한 상실·외부 이동·삭제로 해석할 수 없으면 다른 파일을 추측해 열지 않고 `연결 끊김`과 다시 연결 기능을 제공한다.
- 안전 경계: draft와 최종 위치 모두 계정 personal root, realpath/symlink, quota·물리 여유, 확장자 allowlist와 이름 충돌 정책을 서버가 재검증한다. 블록 삭제는 기본적으로 링크만 제거하고 실제 문서는 보존하며 `링크와 파일 함께 삭제`는 별도 확인 및 휴지통을 사용한다.

## 2026-09-06 Office 문서 기본 저장 경로 해석 교정

- 사용자 교정: 직전 기록의 `현재 페이지의 문서 경로` 고정 해석은 너무 좁다. 사용자가 노트북 내부 트리의 특정 폴더를 우클릭하거나, 파일 영역에서 현재 보고 있는 경로 또는 다른 노트북 기능을 통해 Office 문서 생성을 시작했다면 그 **명령 발생 경로**가 새 문서의 기본 저장 위치다.
- 교정된 동작: 문서 생성 command는 `notebookId`, `invocationDirectory`, 선택된 page/block ID와 당시 directory revision을 draft context에 저장한다. 작성 후 첫 저장 위치 선택기는 `invocationDirectory`를 기본으로 열고, 사용자가 계정 내 다른 NAS 위치를 선택할 수 있다. 명시적 폴더 없이 page 본문에서 호출했을 때만 해당 page의 backing directory를 fallback으로 사용하고, 그것도 없으면 notebook root를 사용한다.
- 경계 변화: 작성 중 원래 폴더가 이동·삭제되거나 권한이 바뀌면 오래된 문자열 경로에 자동 저장하지 않고 stable directory identity로 현재 위치를 다시 해석한다. 해석 실패 시 notebook root로 몰래 바꾸지 않고 위치 선택을 요구한다. 다른 위치에 저장해도 호출 지점에는 문서 reference block/항목을 유지하며 실제 최종 위치를 표시한다.

## 2026-09-06 본문 내 Office 문서 링크 블록 UX 확정

- 사용자 확인: Notion 본문에서 글을 쓰다가 새 하위 페이지를 만들면 현재 문장 아래에 페이지 링크가 생기는 것처럼, 노트 본문의 현재 caret/block 위치에서 Office 문서를 생성하면 작성·첫 저장이 끝난 뒤 바로 그 위치에 클릭 가능한 문서 reference block이 생성되어야 한다.
- 확정 동작: reference block은 실제 파일을 내장하거나 복제하지 않고 stable document ID, 표시 이름, 형식, 현재 NAS 위치, 최신 저장 상태를 가진다. 클릭하면 DOCX/XLSX/PPTX는 OnlyOffice, HWP/HWPX는 RHWP 편집 창을 전면에 연다. 파일을 다른 NAS 경로에 저장하거나 이후 이동·이름 변경해도 block은 같은 문서를 계속 가리키며, 삭제·권한 상실이면 명확한 연결 끊김 상태와 다시 연결을 제공한다.

## 2026-09-06 최근 노트 설계 요구의 전용 원장 동기화 감사

- 사용자 확인 요청: 최근 대화에서 합의한 노트북·Python·Markdown·주석·문서 스튜디오 연계 요구가 모두 영구 기록되고 있는지 확인한다.
- 감사 결과: 직전 9개 요구는 `AI_MUST_READ_PROJECT_RELAY.md`와 commits `12e28c3`부터 `f27bd79`까지 모두 존재했지만, 프로그램별 상세 기준인 `docs/programs/NAS_NOTE_STUDIO_SPEC.xlsx`에는 아직 반영되지 않은 기록 격차가 있었다. 따라서 당시 상태를 `모두 기록 완료`라고 표현하지 않고 전용 원장을 즉시 동기화했다.
- 전용 원장 반영: Decisions, User_Flows, Note_Types, Block_Catalog, Slash_Commands, Context_Menus, Python_Notebook, Collaboration, Data_Model, Storage_Interop, Security, API_Contracts, Error_Recovery, Cross_App_Relations, Performance, Test_Matrix, Implementation_Status, Change_Log에 노트북 물리 계층, 혼합 Python 페이지, NAS 원격 실행과 동적 자원 gate, PY/MD 로컬 투영, Markdown 표현 경계, 댓글/소스 주석, Office 문서 생성·호출 경로 기반 첫 저장·stable reference를 연결했다.
- 검증: artifact-tool로 수정본을 다시 열어 formula error 0, `??`·replacement character·의심 mojibake 0건을 확인했다. 변경된 18개 시트의 관련 범위를 모두 PNG로 렌더해 기존 형식과 줄바꿈·한글 가독성을 확인했고, 출력본과 repo canonical workbook의 SHA-256이 일치한다. 신규 항목은 `설계 확정·구현 전`으로 표시해 구현 완료와 혼동하지 않는다.

## 2026-09-06 노트 스튜디오 M1-F 노트북 물리 계층 1차 구현

- 사용자 요청: 지금까지 합의한 대규모 노트 스튜디오 변경을 실제로 순차 구현한다. 보안과 논리 오류를 최우선으로 하고, 1차 구현 뒤 아직 부족한 점과 새로 드러난 해결 과제를 구현 완료 항목과 분리해 기록한다.
- 이번 구현 경계: 기존 `.note_studio`의 노트·버전 데이터를 자동 이동하거나 변환하지 않았다. 각 계정의 `getQuotaBasePath(user)` 바로 아래에 보이는 `NOTE MANAGER`를 자동 준비하고, 그 안에 사용자가 만든 노트북과 페이지·하위 페이지를 실제 디렉터리로 생성한다. 내부 내용·revision·버전과 노트북 registry는 계속 `.note_studio`에 두어 일반 파일 동기화가 내부 JSON을 직접 수정하지 않게 했다.
- ID와 경로 원칙: 노트북과 페이지는 UUID가 기준이고 표시 제목과 실제 폴더 이름을 분리했다. `/`, `:`, 제어문자, Windows 예약 이름과 끝의 점·공백을 정리하며 같은 이름은 `이름 (2)`처럼 새 폴더로 만든다. 자동 저장 중 제목을 글자마다 바꾸더라도 실제 경로는 흔들리지 않는다. 노트북 간 parent 결합과 실제 폴더를 옮기지 않은 논리 이동은 409로 차단한다.
- 계정·경로 보안: 관리자/마스터라도 노트 저장은 NAS root가 아닌 해당 계정 personal quota root만 사용한다. `NOTE MANAGER` 또는 그 상위 경로의 symlink와 realpath 경계 이탈을 거부한다. 다른 계정의 registry는 별도 root에 저장되어 서로 조회되지 않는다.
- UI: 왼쪽 목록을 노트북 우선 트리로 바꾸고 노트북별 페이지와 하위 페이지를 표시한다. 새 노트북은 실제 폴더 생성임을 안내하며, 노트북이 없으면 새 페이지나 파일 가져오기를 바로 만들지 않고 먼저 노트북 생성을 요구한다. 기존 노트는 `기존 노트` 그룹에서 계속 열 수 있다. 노트북과 형식 아이콘은 별도 색을 입히지 않은 단색 시스템 아이콘을 사용한다.
- 자동 검증: 로컬 note service 15/15, backend 37 pass·2개 환경 조건부 skip, frontend 기능 34 pass와 production build가 통과했다. NAS Linux에서는 LibreOffice 변환과 symlink 경계를 포함한 backend 전체 39/39가 통과했고 frontend production/PDF.js API+Worker 4.8.69 gate도 통과했다. 전체 frontend 중 `App.test.js` 하나는 기존 로컬 `node_modules`의 `react-router-dom` 테스트 해석 실패로 실행되지 않았지만 production build와 노트 관련 테스트는 통과했다.
- 운영 배포: commit `5160dfb`를 GitHub와 NAS live branch에 clean fast-forward했다. live bundle은 `main.3a1e3abc.js`, 내부 3030과 공개 HTTPS는 200, 무인증 notebook API는 401, PM2 `msp-backend`는 online이며 `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 모두 active다.
- 1차 gap 감사: 운영 자동 검증과 배포는 완료됐고 로그인 실계정 화면 검증은 남았다. 외부에서 노트북 경로가 사라지면 500 대신 `NOTE_PATH_MISSING` 상태·409로 복구 안내하고, 활성 하위 페이지가 있는 부모 삭제는 `NOTE_HAS_CHILDREN`으로 차단한다. 명시적인 page/notebook 이름 변경·이동 transaction, 일반 파일이 들어 있는 페이지의 휴지통·영구 삭제 정책, `.msp-page.json` 기반 PC 투영, 파일 관리자와 stable directory ID 통합, note 쓰기 quota admission, 기존 노트의 선택적 이관, 다중 프로세스 잠금은 다음 M1-F 묶음이다. 현재는 사용자 파일을 암묵 삭제하지 않기 위해 페이지 휴지통/영구 삭제가 실제 폴더를 제거하지 않는다.
- 다음 순서: M1-F 2차 transaction과 quota/file-manager 연계를 먼저 구현한다. M1-G Office reference, M1.5 댓글, M2 Python 실행은 이 저장 경계가 안정화되기 전 활성화하지 않는다.

## 2026-09-06 사용자별 서버 자원 보호 정책 1차 구현

- 사용자 요청: 사용자별 저장공간·CPU·RAM 등 현재값과 과거 기록을 관리자가 확인하고, 관리자 수동 기준 또는 감지된 서버 사양으로 자동 계산한 기준을 넘는 작업을 안전하게 차단한다. 장치 업그레이드 뒤에도 새 사양을 자동 반영해야 한다.
- 측정 경계: 저장공간은 각 계정 personal root의 실제 사용량과 quota를 기록한다. 하나의 Node 프로세스가 처리하는 일반 HTTP 요청의 CPU·RAM을 요청 수로 나눠 사용자별 실제 사용량처럼 표시하지 않는다. CPU·RAM·동시 작업은 userUid/jobId를 가진 Python·AI·문서 변환 같은 서버 관리 작업의 예약량과 향후 격리 worker 실제값만 귀속한다.
- 정책 엔진: `backend/resourceControlService.js`가 논리 CPU, RAM, load, swap, 온도와 NAS 여유 공간으로 자동 soft/hard 안전선을 매 수집 시 다시 계산한다. auto/manual, 정책 적용/측정 전용, 1~365일 보존, 사용자별 CPU·RAM·동시 작업 override를 원자 JSON으로 저장한다. 사용자별 한도와 별개로 모든 계정의 CPU·RAM 예약 합계를 전역 soft/hard 안전선과 동기적으로 비교해 30초 metrics 갱신 전 동시 burst도 막는다. soft는 신규 관리 작업을 대기시키고 hard 또는 사용자 한도는 신규 작업을 차단하며, 이미 처리 중인 웹 저장 요청을 죽이지 않는다.
- 이력과 보안: 30초마다 시스템 기록을 날짜별 JSONL에 쓰고 약 2분마다 사용자 storage/관리 작업 snapshot을 포함한다. 관리자 API는 최대 31일·5000점으로 제한하며 일반 사용자에게 공개하지 않는다. 비밀번호·token·파일 경로·환경 변수·프로세스 목록·디스크 일련번호는 기록이나 응답에 넣지 않는다. 사용자 storage 스캔은 매 5초 UI 갱신마다 반복하지 않고 snapshot cache를 사용한다.
- 첫 실제 적용: 기존 문서 변환 background job을 공통 reserve/release admission에 연결했다. 25% CPU·512MiB 예약을 기준으로 시스템 soft 시 10초 간격으로 대기 후 재평가하고, hard/사용자 한도 시 새 작업을 실패 상태로 명확히 차단한다. 완료·실패·취소 모두 finally에서 예약을 해제한다. 레거시 동기 실행 API도 정책을 통과하지 못하면 429와 상태/이유를 반환한다.
- 관리자 UI: 서버 설정에서 현재 허용·대기·차단 상태와 한국어 이유, auto/manual 임계값, 정책 적용 스위치, 기록 보존일, 사용자별 실제 storage와 관리 작업 예약/제한, 1시간·24시간·7일 기록 표를 제공한다. CPU·RAM 사용자값의 범위를 화면에 명시한다.
- 로컬 검증: 정책 자동 계산, soft/hard, 전역 동시 burst, 여유 RAM 회복 뒤 높은 swap 잔류 오탐 방지, 저장/검증, 사용자 CPU·RAM·동시 작업, monitor-only, 이력 비밀/경로 비노출을 포함해 backend 전체 46개 중 44 pass, 외부 변환 도구 조건부 2 skip이다. frontend production build와 PDF.js API/Worker 4.8.69, `git diff --check`를 통과했다.
- 미완료 안전 gate: 정책/이력과 문서 작업 예약 admission은 구현했지만 Python·AI의 실제 프로세스별 CPU/RAM 강제 계측은 아직 활성화하지 않는다. M2에서 non-root cgroup v2 worker, CPU/RAM/PID/time/disk/output/network 제한, 공정 대기열, 취소·재시작 orphan 정리를 함께 통과해야 한다. 이 항목은 master workbook `보류 작업`과 Note Studio 전용 원장에 구현 완료 항목과 분리해 기록했다.
- 운영 검증: commit `95574a0`을 GitHub와 NAS branch에 clean fast-forward했다. NAS Linux 전체 backend 45/45와 frontend production/PDF.js 4.8.69 gate가 통과했고 live bundle은 `main.6d92bef9.js`다. 내부 3030·공개 HTTPS 200, 무인증 metrics/history 403, 짧은 메모리 내 관리자 smoke token으로 metrics/history 200과 잘못된 mode 400을 확인했으며 token은 출력·저장하지 않았다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 active이고 PM2 `msp-backend`는 online/save다.
- 실장비 자동값: 논리 CPU 8개, RAM 6,094,794,752 bytes, 계정 22개를 감지했다. CPU soft/hard 70/90%, load 6/8, 가용 RAM soft/hard 1,523,698,688/914,219,212 bytes, 온도 75/85°C, NAS 최소 여유 98,392,299,929 bytes, 기본 사용자 관리 작업 CPU 25%·RAM 914,219,212 bytes·동시 2개다. 확인 시 CPU 2.3%, 가용 RAM 3,434,315,776 bytes, 최대 온도 51.3°C, NAS 여유 1,780,552,417,280 bytes로 gate는 `available`이었다. swap은 100%였지만 가용 RAM이 충분해 과거 swap 잔류만으로 차단하지 않았다.
- 이력/API: root 전용 `backend/data/resource_usage_history/2026-09-06.jsonl`이 700 directory/600 file 권한으로 30초마다 증가하고 gate `available`을 기록하는 것을 확인했다. 비밀·개인 파일 경로는 기록하지 않는다. 공개 브라우저 실화면은 로그인 화면까지만 확인됐고 인증 정보를 임의 입력하지 않았으므로 로그인된 관리자 설정 패널의 육안 확인은 다음 사용자 세션 E2E로 남긴다.

## 2026-09-06 NAS Drive 프로젝트 고정 경로 이동 보조 1차 구현

- 사용자 요청: 초보자가 전체 코딩 프로젝트를 다른 PC와 주고받을 때 여러 고정 절대경로 때문에 원인을 찾기 어려운 문제를 줄인다. 프로젝트 루트와 그대로 유지되는 하위 구조를 기준으로 새 위치를 자동 감지하고, sibling·ancestor 등 프로젝트 밖 참조도 찾을 수 있게 하되 사용자가 바꾸지 않을 수 있어야 한다. UI와 버튼 배치는 기존 개발도구 사례를 조사해 납득 가능하게 구성한다.
- 조사 기준: VS Code의 `${workspaceFolder}`·multi-root 상대 workspace, JetBrains의 `$PROJECT_DIR$`·사용자 path variable·명시적 local/remote path mapping, Python `pathlib.resolve()`·`relative_to()`를 기준으로 삼았다. 모든 문자열과 모든 파일 형식에서 같은 변수를 쓸 수 없으므로 이번 1차는 실제 파일 존재와 프로젝트 경계를 우선 검증하고, IDE별 portable variable 치환은 별도 후속 단계로 분리했다.
- 구현: Windows Agent 1.11.2에 `project-path-portability.js`를 추가했다. 제어센터의 `프로젝트 경로 확인`에서 연결된 계정의 NAS Drive 내부 프로젝트만 선택할 수 있다. 내부 절대경로는 마지막 경로 조각을 기준으로 프로젝트 안에 실제 동일 대상이 존재할 때만 `안전한 자동 변경`으로 기본 체크한다. 프로젝트 밖 경로는 연결된 NAS Drive 전체의 명시 허용 범위에서 suffix가 가장 길게 일치하는 대상이 정확히 하나일 때만 `직접 확인`으로 제안하며 기본 체크하지 않는다. 없거나 둘 이상이면 `변경 안 함`이다.
- UI: 상단에 선택 프로젝트와 `안전한 자동 변경 / 직접 확인 / 변경 안 함` 수를 보이고, 표에서 파일·줄, 판정, 기존 경로, 이 PC 경로를 함께 표시한다. 하단은 `변경하지 않고 열기`, `나중에`, `선택한 경로 적용하고 열기`로 두었다. 적용 뒤 같은 창에서 `방금 변경 되돌리기`를 제공한다. Windows 200% DPI 렌더에서 창·표·버튼 위치와 한글 표시를 확인했다.
- 안전 경계: PC 전체나 다른 계정 임의 경로를 검색하지 않는다. `.env`, credential/secret/token/key 이름, `.git`, `node_modules`, `.venv`, build/dist, binary, 2MiB 초과 파일, symlink를 스캔하지 않는다. plan은 Agent 상태 폴더에 두며 본문·비밀을 기록하지 않고 경로 후보와 hash만 가진다. 적용은 미리보기 당시 파일 SHA-256이 유지될 때만 뒤 offset부터 원자 교체하며, 프로젝트 밖 상태 폴더에 원본을 백업한다. 적용 후 파일 hash가 달라졌다면 undo도 새 편집을 덮어쓰지 않고 중단한다.
- 검증: 내부 suffix 자동 제안, URL 제외, 외부 유일 수동 제안, 외부 중복 미해결, secret 제외, preview 후 파일 변경 차단, 적용·byte 복구를 unit test로 확인했다. Agent self-test, Setup compile/self-test, 네이티브 UI PNG 렌더가 통과했다. 전용 Note Studio 원장과 master workbook의 Feature_Index·Do_Not_Break·Relation_Map·Patch_Log·Request_Archive를 동기화하고 formula error 0과 변경 범위 렌더를 확인했다.
- 운영 배포: commit `dc14017`을 GitHub와 NAS live branch에 clean fast-forward했다. NAS Linux 전체 backend 47/47이 통과했고 PM2 `msp-backend` online/save, 필수 서비스 6개 active, 내부·공개 HTTP 200, update API 무인증 403을 확인했다. 공개 Agent SHA-256은 `40fc9ba9627796ea49435f13cd518e88f2274eb01c39ce28722aa3a33df97aea`, Setup은 `0d90c3843e8a3712f2d44a3064d5ee1a9dc9347c1f0601a852b90c20697043b5`이며 로컬·NAS가 일치한다.
- 남은 단계: 새 Windows 설치본 실화면에서 폴더 선택·적용·undo를 확인한다. `.msp-project.json`/`.msp-page.json`과 전체 hydration 완료 신호가 생기기 전에는 단일 파일 더블클릭 시 자동 팝업을 띄우지 않는다. 이후 완전 투영 프로젝트에만 비차단 알림을 추가하고, VS Code `.code-workspace`와 JetBrains 설정은 각 형식이 공식 지원하는 portable variable로 변환하는 전용 adapter를 추가한다.

## 2026-09-06 NAS Drive 프로젝트 고정 경로 이동 보조 2차 안전성·단축키

- 사용자 요청: 1차 구현 뒤 남은 2차 기능, 부족한 점과 단축키를 추가하고 예상 오류 상황까지 자세히 검증한다.
- 1차 재감사에서 찾은 위험: 여러 파일을 차례로 처리하면 뒤 파일의 preview 충돌이 앞 파일 적용 뒤에 발견될 수 있었고, undo도 같은 이유로 일부만 복원될 여지가 있었다. 저장된 plan의 target을 변조했을 때 현재 NAS Drive realpath 재검증이 없었으며, Windows CFAPI 온라인 전용 placeholder를 일반 파일처럼 읽으면 원하지 않는 다운로드가 시작될 수 있었다. UTF-8 BOM 보존, 수동 대상 선택, IDE 전용 portable 경로와 키보드 작업도 없었다. URL의 `https:` 일부를 Windows drive 경로로 오인하는 경계 사례도 2차 테스트 중 발견했다.
- transaction 보강: 적용과 undo는 선택된 모든 파일의 현재 SHA-256, 예상 offset/문자열, target 존재·종류·symlink·realpath·현재 연결된 계정의 NAS Drive 경계를 먼저 전부 검증한다. 사전검증이 하나라도 실패하면 0개를 변경하며, 실제 저장 도중 실패하면 이미 쓴 파일을 역순 rollback한다. managed plan과 backup symlink도 거부한다. strict UTF-8만 변경하고 BOM과 기존 줄바꿈을 유지한다.
- CFAPI·노출 경계: Windows 분석 전에 `Offline`, `RecallOnOpen`, `RecallOnDataAccess` 파일 속성을 내용 읽기 없이 확인해 해당 파일·하위 항목을 제외한다. 이 메타데이터 확인 자체가 실패하면 분석을 fail-closed한다. 공개 `NAS_PATH_CHANGES.md`에는 파일:줄과 적용 adapter만 기록하고 전체 이전/이후 절대경로와 원본 backup은 Windows 사용자별 Agent 상태에만 둔다.
- 경로 adapter와 UI: VS Code `.vscode/launch.json`, 지원되는 `.vscode/tasks.json` 필드에는 `${workspaceFolder}`, `.code-workspace`의 path에는 workspace 상대경로, JetBrains `.run`/`.idea/runConfigurations`의 허용된 option에는 `$PROJECT_DIR$`를 사용한다. 일반 소스 문자열은 임의 의미 변환을 하지 않고 확인된 이 PC 실제 경로를 사용한다. 사용자는 미해결/외부 항목 하나를 골라 연결된 NAS Drive 안의 파일 또는 폴더를 직접 지정할 수 있고, F5로 현재 placeholder 상태에서 다시 분석할 수 있다. 상태 줄은 안전/확인/미해결과 online-only·인코딩·민감 파일 제외 수를 함께 표시한다.
- 단축키: `Ctrl+Enter` 적용, `Ctrl+Z` 방금 transaction 전체 undo, `Ctrl+A` 변경 가능 항목 전체 선택, `Ctrl+Shift+A` 선택 해제, `Space` 선택 행 체크 전환, `F5` 재분석, `F1` 도움말, `Esc` 닫기를 추가했다. 미해결 항목은 마우스와 키보드 모두 체크를 막고, 확인 필요 항목이 포함되면 적용 직전 다시 확인한다.
- 로컬 검증: URL/공백/JSON escape, 내부·외부·모호·수동 target, VS Code/JetBrains adapter, UTF-8 BOM·UTF-16 제외, placeholder 제외, target 변조, 두 파일 중 뒤 preview 충돌, apply 뒤 파일 충돌의 전체 undo 중단, 공개 report 절대경로 비노출을 신규 단위 회귀로 확인했다. backend 18개 test file 전체가 통과했고 환경 제약 때문에 Windows symlink 2건과 외부 문서 변환기 2건만 조건부 skip됐다. Agent self-test, Setup compile/self-test, 200% DPI 경로 검토 창 렌더를 통과하고 실제 PNG에서 표·상태·5개 보조 버튼·하단 동작 버튼을 확인했다.
- 메모리 동기화: master workbook의 Feature/Do_Not_Break/Relation/Patch/Request/보류 작업과 Note Studio 전용 원장의 Storage/Security/Keyboard/Test/Implementation/Source/Change를 artifact-tool로 갱신했다. 두 파일 모두 formula error 0이며 신규 한글의 replacement/mojibake는 없고 변경 범위를 렌더했다.
- 운영 배포와 남은 항목: commits `d3fbeff`, `d191dc6`을 GitHub와 NAS live branch에 clean fast-forward했다. NAS Linux 전체 47/47, PM2 `msp-backend` online/save, 필수 서비스 6개 active, 내부·공개 HTTP 200, update 무인증 403을 확인했다. 공개 Agent SHA-256은 `5b0c70640d2817dfee4aea8638b2af4636bab55047a921ff3b3c456f8472c101`, Setup은 `b001552ad70a7790ad1b1fb97a3d86ba0aeb35b2e7e9c13e4cc51872e3cd2974`이며 로컬·NAS가 일치한다. 새 Windows 실제 CFAPI placeholder, 파일/폴더 선택 dialog와 모든 키 조합의 사람 손 상호작용은 별도 실PC E2E가 필요하다. `.msp-project` 완전 투영 marker가 없으므로 자동 popup은 계속 금지하고, 현재는 사용자가 제어센터에서 열고 F5로 재분석하는 방식만 제공한다.

## 2026-09-06 노트 슬래시 드롭다운·입력 단축키 전수 조사

- 사용자 요청과 범위: `/` 입력 시 별도 창이 아니라 Notion처럼 caret 가까이에 드롭다운을 띄우고, `Tab`, 목록 자동 연속, `---`, `===`를 포함해 사용자가 아직 알지 못하는 편집 단축키와 입력 편의 기능을 먼저 모두 조사한다. 이번 단계에서는 바로 구현하지 않는다.
- 현재 구현 감사: `NoteStudio.js`는 `/` keydown을 가로채 MUI `Dialog`를 열고 별도 검색 필드로 포커스를 이동한다. 입력한 `/query`가 편집기 안에서 자연스럽게 이어지지 않고 caret anchor·viewport flip·IME composition·async stale result·ARIA 상태 계약이 없다. `noteStudioCommands.js` registry는 문단, H1/H2, 불릿·번호 목록, 인용, 코드, 구분선 8개만 제공한다. `StarterKit` 기본 input rule 때문에 `---`가 즉시 구분선으로 바뀐다.
- 공식 동작 조사: Notion은 `/` 뒤 입력으로 block menu를 필터링하고 화살표·Enter로 선택하며 Esc로 닫는다. 목록·제목 같은 낮은 모호성 marker는 Space를 확정 키로 쓰고 `---`는 즉시 divider로 바꾼다. Tiptap은 Suggestion utility로 trigger, query, client rect, async cancel, render lifecycle을 제공하며 공식 slash 예제 자체는 experimental이다. BlockNote는 title/subtext/badge/aliases/group를 가진 suggestion item 구성을 제공한다. WAI-ARIA combobox/listbox 패턴은 editor DOM focus를 유지하고 `aria-activedescendant`, 방향키, Home/End, Enter, Esc 상태를 노출하는 기준이 된다.
- 프로젝트 권장 UX: `/query`는 본문에 남겨둔 채 caret 아래 비모달 목록으로 표시한다. 최근 사용·기본·제목·목록·미디어/파일·페이지/문서·고급 그룹을 같은 Command Registry에서 만들고, 권한·노트 유형·offline 상태로 숨기거나 이유가 있는 disabled로 표시한다. Up/Down·Home/End 이동, Enter/Tab 실행, Esc 취소, Backspace trigger 경계 닫기, 포인터 hover/click, click-outside를 지원한다. 메뉴가 editor focus를 빼앗지 않아야 하며 IME 조합 중 명령 실행, URL·파일 경로 중간 slash 오탐, 이전 비동기 검색 응답의 역전 표시를 차단한다.
- 입력 규칙 결정안: `#`, `##`, `###`, `-`, `*`, `+`, `1.`, `[]`, `>`, `\"`은 빈 block 시작에서 marker 뒤 Space로 변환한다. `---`, `___`, `***`는 즉시 바꾸지 않고 marker만 있는 빈 block에서 `Tab`을 눌렀을 때 구분선으로 확정하며 ghost hint를 보여주는 방식을 권장한다. 변환 직후 Backspace 또는 Ctrl+Z로 marker 원문을 복구하고 backslash escape를 제공한다. 이 방식은 사용자의 `--- + Tab` 제안을 반영하지만 아직 구현 전이다.
- `===` 경계: CommonMark에서 빈 줄의 `===`는 구분선이 아니라 일반 텍스트이고, 앞줄 텍스트 아래의 `===`는 Setext H1이다. 따라서 `=== + Tab`을 기본 구분선으로 바꾸지 않는다. 강한 구분선이라는 별도 block style을 정식 도입할 경우에만 명시 설정, schema type, Markdown/HTML fallback과 round-trip을 함께 설계한다.
- 상태별 키 우선순위: slash menu가 열리면 Tab은 후보 확정, 목록에서는 중첩, 표에서는 다음 셀, 코드 편집에서는 들여쓰기, Python edit/command mode에서는 Jupyter 호환 동작, dialog/form에서는 일반 focus 이동을 우선한다. 빈 목록 항목의 Enter는 중첩이면 먼저 outdent하고 최상위이면 목록을 종료한다. 전역·rich text·Monaco·Python adapter가 같은 keydown을 이중 처리하지 않게 가장 안쪽 활성 문맥 하나만 명령을 소유한다.
- 추가 조사 목록: Ctrl+B/I/U, Ctrl+Shift+S, Ctrl+E/K/M, Enter/Shift+Enter, 목록 종료·중첩, `@`·`[[`·`+` mention/link, 표 Tab, Shift+F10 context menu, F1 문맥별 도움말을 원장에 추가했다. 슬래시 위치·IME·비동기 취소·접근성·포인터 깜빡임·input rule round-trip·Tab 상태 우선순위·브라우저/OS/Monaco/Python 충돌을 독립 E2E 항목으로 만들었다.
- 기록과 다음 gate: master `NAS_PROJECT_LOG.xlsx`의 Patch/Request와 전용 `NAS_NOTE_STUDIO_SPEC.xlsx`의 Decisions/Keyboard/Slash/Test/Implementation/Source/Change에 모두 `조사·설계 완료 / 구현 전`으로 기록했다. 다음 단계는 Dialog를 제거하고 프로젝트 소유 Tiptap Suggestion extension을 작게 구현한 뒤, 로그인된 실제 브라우저에서 한글 IME·DPI/zoom·키보드·포인터·스크린리더 E2E를 통과시키는 것이다.

## 2026-09-06 실행형 NAS AI 에이전트 1차 구현

- 사용자 요청: 기존 AI처럼 계획만 안내하거나 실제 대화를 기억한다고 꾸미지 않고, ChatGPT 에이전트처럼 현재 로그인 사용자가 NAS에서 할 수 있는 파일·친구·채팅 작업을 실제 수행한다. 관리자/마스터도 자신의 서버 권한 범위에서 사용할 수 있어야 하며, 향후 Python과 다른 언어 프로젝트의 오류 진단·실행으로 확장한다. OpenAI API 비용이 발생하므로 자동 테스트에서 실 API를 소비하지 않는다.
- 확정 원인: 기존 `backend/aiAgentRoutes.js`는 최근 20개 메시지를 평문 prompt로 합치고 OpenAI 응답 텍스트만 받았다. tool schema와 function-call 실행 반복이 전혀 없었고 system prompt가 파일 변경을 직접 수행하지 말라고 명시했다. 따라서 모델이 NAS API를 호출할 방법이 없었고, 긴 대화의 정확한 문장도 검색할 수 없어 기억을 추측했다.
- 1차 실행 도구: Responses API strict function tools로 폴더 목록, 파일명 검색, 텍스트/코드 읽기, 최대 5000개 계정별 AI 대화 키워드 검색, 폴더 생성, 텍스트 새 작성/추가, 파일·폴더 복사/이동/휴지통, 수정일 기준 날짜·월 폴더 정리, 친구 요청, 차단/해제, 채팅 메시지, NAS 파일·폴더 채팅 첨부까지 15개 도구를 제공한다. OpenAI가 직접 filesystem이나 DB를 만지지 않고 현재 브라우저의 로그인 cookie로 고정된 내부 NAS API만 호출하므로 기존 친구 관계·채팅 참가자·quota·휴지통·계정 root 검사가 매 실행마다 다시 적용된다.
- 승인과 감사: 계정별 `ask_each`, `auto_safe`, `auto_reversible`, `auto_all` 네 모드를 제공한다. safe는 폴더/텍스트, reversible은 복사·이동·30일 휴지통, external은 친구·차단·채팅/전송이다. 모든 변경은 call ID idempotency key와 pending/executing/completed/failed/rejected 상태, 실제 결과와 오류를 계정별 action 원장에 남긴다. 덮어쓰기는 `.ai_backups`에 기존 파일을 보존한다. UI는 모델이 만든 가짜 진행 단계가 아니라 반환된 실제 tool event와 승인 대기 작업의 승인·거절을 표시한다.
- 절대 자동화 금지: `auto_all`이어도 영구 삭제, 계정 삭제, 역할·용량·보안 설정 변경, credential/비밀 조회, 임의 shell·코드 실행은 자동화하지 않는다. 관리 기능은 도메인별 전용 tool과 서버 API 권한 검사를 추가한 뒤만 연다. 대상 사용자는 표시 이름/로그인 ID가 정확히 한 명일 때만 확정하며 중복 이름이면 로그인 ID를 다시 요구한다.
- 비용 경계: 기본 모델 `gpt-4.1-mini`를 유지하고 최근 대화 8개를 항목당 1200자로 제한하며 정확한 오래된 대화는 검색 tool로 가져온다. `store:false`, 병렬 tool call 비활성, 요청당 output 900 token, 최대 8 tool call·6 turn, 계정별 기본 일일 50,000 token 상한과 실제 input/output/total usage 원장을 추가했다. 단위 테스트는 mock fetch로 Responses function call 왕복을 검사해 실제 OpenAI API 호출은 0회였다.
- 검증·운영 배포: 신규 AI 단위 4/4, 로컬 전체 backend 49 pass와 외부 변환 조건부 2 skip, Node syntax, `git diff --check`, frontend production/PDF.js를 통과했다. commit `0ed118f`를 GitHub와 NAS 활성 브랜치에 fast-forward하고 NAS Linux 전체 51/51, live `main.86495f4a.js`, PM2 online/save, 필수 서비스 6개 active, 내부·공개 HTTP 200, AI configured=true, 무인증 history 401을 확인했다. OpenAI 과금 요청은 실행하지 않았다.
- 다음 단계와 보류: 로그인된 실제 계정에서 파일 검색→승인/거절→실행, 대화 검색, 4개 auto 모드, 친구·채팅·첨부 전송 UI E2E가 남았다. 그 뒤 날짜별 대량 정리의 더 상세한 preview, Note Studio·Document Workspace, 관리자 설정 tool을 작은 도메인별로 추가한다. Python/다언어는 `PENDING-MANAGED-WORKER-CGROUP-2026-09-06`의 non-root cgroup v2, network none, time/PID/RAM/CPU/disk/output 제한과 자원 admission이 완성되기 전 실행 tool로 노출하지 않는다.

## 2026-09-06 오늘 작업 최종 실제 제품 교차 검증 및 AI 안전 보강

- 사용자 요청: 오늘 요청한 모든 영역을 자체 개념으로만 완료 판정하지 말고 Notion, JupyterLab, OpenAI agent, Nextcloud/OneDrive 같은 실제 프로그램의 공식 동작과 비교하되 NAS 계정 경계·저사양 서버·Files On-Demand 구조에 맞게 변형해 검증한다. 구현되지 않았거나 수정·추가가 필요한 항목을 이해하기 쉽게 최종 정리한다.
- 상세 감사 문서: `docs/AUDITS/2026-09-06_FINAL_VALIDATION.md`에 NAS Drive, 계정 경계, 저장공간/20GiB, 시스템 디스크 확장, 서버 자원, Note Studio, Python 혼합 페이지, 경로 이동 보조, 문서 연동, 실행형 AI를 완료/부분 완료/설계만/실장비 확인 필요로 구분했다.
- 실제 제품 비교 결론: Note Studio의 물리 트리 기반은 맞지만 slash는 아직 중앙 Dialog라 Notion형 caret dropdown이 아니다. Python은 Jupyter식 command registry와 별도 kernel 수명주기가 설계뿐이다. AI는 실제 도구 실행까지 왔지만 OpenAI HITL의 exact-call RunState 재개·도구 guardrail·crash recovery까지는 미완성이다. NAS Drive는 Nextcloud/OneDrive식 다중 계정·상태 모델을 구현했지만 새 PC·재설치·업데이트·NAS reboot·Explorer overlay를 묶은 장시간 Windows E2E와 공인 코드 서명이 남았다.
- 이번 점검 중 즉시 수정: AI가 `.env`, `.git`, `.ssh`, key/certificate, 내부 휴지통·백업을 직접 지정해 읽거나 변경하지 못하게 했다. malformed function arguments는 실행 없이 fail-closed한다. 수정일 정리는 승인 시 최대 500개 source/destination/size/mtime snapshot을 저장하고 실행 직전 전부 동일한지 검사해 TOCTOU를 차단한다. OpenAI와 내부 API timeout을 추가하고 자동 재전송하지 않는다. action JSON은 0600 임시 파일+rename으로 원자 저장한다. 별도 과금되지만 usage 원장에 빠지던 meeting summary 요청을 제거했으며 승인 카드에 실제 대상/경로/메시지/preview를 표시한다.
- 로컬 검증: backend 54 tests 중 52 pass, LibreOffice 조건부 document integration 2 skip, 0 fail이다. 신규 AI 보안 회귀는 민감 경로 차단, 깨진 JSON 미실행, 승인 뒤 변경된 파일 정리 거부를 포함해 통과했다. 모든 OpenAI 시험은 mock fetch라 실제 과금 호출은 0회다. 로그인된 운영 Chrome에서 AI 패널과 저장된 과거 대화·대화/파일/읽기/작업 UI를 직접 확인했다.
- 미완료 핵심: AI durable approval/resume, prompt-injection과 최신 사용자 의도 결속, immutable recipient UID, executing crash recovery, 정확한 token reservation, streaming/semantic search/citation, 관리자·노트·문서 도구가 남았다. Note Studio caret slash/Tab/input rule/IME/댓글/Office 참조/협업과 Python worker가 남았다. quota 기본값은 여전히 50GiB이며 20GiB migration은 보류다. 시스템 디스크 1TiB는 설계뿐이다. 새 Windows 다중 PC E2E와 공인 서명도 보류다.
- 다음 안전 순서: AI durable approval·guardrail·recovery → Note Studio caret command/IME/Tab → 20GiB quota migration → Office stable reference → cgroup worker 기반 Python 정적 진단/격리 실행 → 전용 시험 계정으로 Windows 신규 PC 장시간 E2E 순서다.
- 운영 최종 확인: commit `4e4b306`을 GitHub와 NAS 활성 브랜치에 clean fast-forward했다. NAS Linux 54/54가 모두 통과해 LibreOffice 변환 2건도 성공했다. production build/PDF.js 4.8.69 gate 뒤 live `main.b651dca7.js`를 배포했고 PM2 online/save, 필수 서비스 6개 active, 내부·공개 200, 무인증 AI history 401을 확인했다. 로그인된 Chrome을 새 bundle로 reload해 AI의 5개 탭, 4개 승인 모드, 일일 token 설정과 오늘 사용량을 실제 화면에서 확인했다. 실제 OpenAI 호출과 사용자 파일 변경은 0회다. 업그레이드 전의 ‘직접 작업 불가/무료’ 같은 잘못된 AI 답변은 감사 기록 보존상 그대로 보이므로 다음 UI에서 배포 시각 이전 메시지에 `이전 AI 응답` 구분선을 표시해야 한다.

## 2026-09-06 AI durable 승인 재개·중단 복구 2차 구현

- 사용자 요청: `GOGO LETS DOING`으로 최종 감사에서 정한 다음 우선순위 작업을 즉시 이어서 구현한다.
- 이전 문제: 변경 도구가 `pending_approval`을 반환해도 Responses loop가 이를 일반 성공 `function_call_output`으로 모델에 넘겨 요청을 끝냈다. 사용자가 나중에 승인·거절해도 action만 처리되고 원래 모델 요청은 이어지지 않았다. 실행 도중 서버가 중단되면 action/run 상태가 계속 실행 중으로 남을 수 있었고, 친구·차단·채팅·파일 전송 대상은 승인 시점이 아니라 실행 시 문자열로 다시 검색했다.
- 구현: `call_id`, Responses 입력 문맥, 다음 turn, tool 호출 수를 계정별 `runs.json`에 최대 768KiB·최근 40개로 제한해 0600 원자 저장한다. 승인 대상이 하나라도 있으면 모델 호출을 멈추며, 모든 승인·거절 결과가 모인 뒤 같은 `call_id`의 `function_call_output`으로 원 요청을 이어간다. 승인 후 후속 모델 응답만 실패하면 실제 action은 다시 실행하지 않고 `response_pending`으로 두며 UI의 `작업 재실행 없이 답변만 이어받기`로 복구한다. 복구 재개에서 새 side effect가 생성되면 기존 자동 승인 설정과 관계없이 다시 승인 대기로 둔다.
- 중단·대상 안전성: 5분 넘게 `executing`인 action은 결과를 추측하거나 자동 재실행하지 않고 `recovery_required`로 표시한다. 5분 넘게 `resuming`인 run은 `response_pending`으로 바꾼다. 외부 사용자 작업은 모델 요청 직후 정확히 한 계정을 찾아 UID·loginId·표시명을 action에 고정하고, 승인 실행 직전에 같은 loginId가 같은 UID인지 다시 확인한다. 달라졌으면 `AI_TARGET_IDENTITY_CHANGED`로 중단한다.
- 로컬 검증: mock OpenAI pause/resume 2건과 immutable recipient 1건을 추가했고 전체 backend 57개 중 55 pass, 외부 변환 환경 의존 2 skip, 0 fail이다. Node syntax와 frontend production build(`main.3616ee17.js`)가 통과했다. 첫 NAS 검증에서는 신규 recipient 테스트가 root 소유 운영 `backend/data/ai`에 임시 계정을 만들려 해 EACCES로 실패했다. 제품 동작 실패가 아니라 테스트 격리 결함으로 확인해 `AI_AGENT_DATA_ROOT` 테스트 전용 경계를 추가하고 OS 임시 폴더 subprocess로 옮겼다. 실제 OpenAI API와 사용자 파일·친구·채팅 작업은 호출하지 않았다. `docs/NAS_PROJECT_LOG.xlsx`는 artifact-tool로 관련 10개 시트를 갱신하고 formula error 0, 한글/문자 깨짐 0, 변경 범위 렌더와 출력 hash 일치를 확인했다.
- 운영 반영 경계: commits `74acbab`, `3068d0a`를 GitHub에 push하고 NAS checkout에도 clean fast-forward했다. NAS Linux 전체 57/57이 통과해 문서 변환 통합 2건도 실제 성공했다. 첫 실행에서 운영 data 소유권을 침범한 테스트 격리 문제도 수정 후 NAS에서 통과했다. 그러나 frontend build 도중 NAS가 Tailscale 목록에는 active로 남은 채 ping·SSH에 응답하지 않았고 공개 origin도 HTTP 530이 됐다. 따라서 `/var/www/html` live bundle 반영, PM2 재시작, 서비스·HTTP·로그인 UI 최종 검증은 수행하지 않았으며 완료로 표시하지 않는다.
- 남은 작업: NAS 전원·네트워크가 복귀하면 같은 clean checkout의 build 상태를 먼저 확인하고 live 정적 배포·PM2·서비스·HTTP·로그인 화면을 마친다. 그 다음 deterministic prompt-injection/최신 사용자 의도 guardrail, 정확한 token reservation, 관리자·노트·문서 전용 도구를 진행한다. 제공된 관리자 자격 증명은 채팅 밖 파일·로그·Git·릴레이·워크북에 저장하거나 출력하지 않는다.

## 2026-09-07 미구현 핵심 목록의 근거와 현재 상태 정정

- 사용자 질문: 이전 답변의 미구현 핵심 8개 항목을 어디에서 미구현이라고 말했는지 확인한다.
- 근거: 해당 목록은 사용자 발언을 인용한 것이 아니라 `docs/AUDITS/2026-09-06_FINAL_VALIDATION.md`의 판정표 16~25행, AI 위험 37~45행, 권장 순서 57~64행과 이 릴레이의 2026-09-06 최종 교차 검증 기록을 요약한 것이다.
- 현재 정정: 목록 작성 뒤 `AI-AGENT-DURABLE-RUN` 작업으로 1번 중 exact-call 승인 후 대화 재개, stale 실행/응답 복구, 대상 사용자 UID 고정은 구현·NAS Linux 57/57 검증까지 완료됐다. deterministic prompt-injection/최신 사용자 의도 guardrail은 아직 남아 있다. 2~8번은 최종 감사에 기록된 완료 경계가 그대로이며, 구현 완료로 바뀐 증거가 생기면 감사 문서와 보류 원장을 함께 갱신한다.
- 변경/검증: 이번 요청에서는 코드·설정·운영 서비스를 변경하지 않고 기록 위치와 이후 구현 내역만 대조했다. NAS live 배포 중단 경계도 유지한다.

## 2026-09-07 현재 미구현·부분 구현 목록 재정리

- 사용자 요청: 이미 완료된 AI exact-call 승인 재개·복구·UID 고정을 제외하고 현재 구현되지 않은 항목을 다시 열거한다.
- 완전 미구현 또는 설계 단계: 신규·기존 계정 기본 20GiB 전환, 시스템 디스크 1TiB 보조 볼륨과 project quota/volume registry, non-root cgroup v2 Python 실행 worker와 kernel 제어, Note Studio Office stable reference transaction, 공인 Windows 코드 서명이다.
- 부분 구현 뒤 남은 핵심: Note Studio의 caret `/` 드롭다운·Tab/목록/input rule·IME/포인터 E2E·댓글/멘션/협업, AI deterministic 사용자 의도/prompt-injection guardrail·token reservation·streaming/semantic search/citation·관리자/노트/문서 도구, Windows 신규 PC·재설치·업데이트·재부팅·다중 계정 장시간 E2E와 Explorer OS별 상태 확인, 완전 hydration marker/자동 알림, 과거 잘못된 AI 응답의 `이전 AI 응답` 구분 UI가 남았다.
- 운영 경계: durable AI 코드는 GitHub와 NAS checkout에 있고 NAS Linux 57/57을 통과했지만, NAS origin 오프라인으로 새 frontend live bundle 반영·PM2·로그인 화면 최종 확인은 아직 끝나지 않았다.

## 2026-09-07 AI 단일 대화·20GiB·Note Studio 입력/Office 2차 구현과 운영 검증

- 사용자 요청: AI 에이전트의 대화/파일 읽기/작업/설정 같은 여러 선택 화면을 없애고 대화창 하나에서 모든 요청·승인·복구를 처리한다. 긴 채팅 스크롤을 고치고, 직전 미구현 목록에서 안전하게 구현 가능한 항목을 순서대로 반영한 뒤 실제 화면과 서버에서 검증한다.
- AI 단일 화면: `AiAgentPanel.js`의 5개 탭과 별도 수동 작업 폼을 제거했다. 대화 안에서 실제 pending/recovery 카드만 승인·거절·답변 재개할 수 있고 설정은 작은 접이식 영역으로 숨겼다. 전용 scroll container가 사용자의 과거 읽기 위치를 보존하며 near-bottom일 때만 새 메시지를 따라가고, 떨어져 있으면 `최신으로` 버튼을 보인다. composer는 하단 고정, Enter 전송/Shift+Enter 줄바꿈/IME 조합 보호다. 실행형 도입 전 메시지는 `이전 AI 응답` 구분선 아래에 보존한다.
- AI 안전·비용: 최신 사용자 문장에 명시된 변경 종류만 action 계획을 만들 수 있는 결정적 intent gate를 추가했다. 파일·대화처럼 신뢰하지 않는 tool 결과를 읽은 뒤의 변경은 `auto_all`이어도 승인 대기로 강제한다. 승인 재개에서도 새 변경은 다시 승인하며 대상 UID 고정 규칙을 유지한다. 요청 전 입력 토큰을 보수적으로 추정해 일일 남은 예산에서 먼저 제외하고, 남은 범위 안에서만 output token 상한을 설정한다. 실제 OpenAI API 검증 호출은 비용 보호를 위해 0회이며 mock만 사용했다.
- 저장공간: 기본 계정 quota를 50GiB에서 20GiB로 변경하고 `storageQuotaPolicyVersion=2` 1회 마이그레이션을 추가했다. 실제 개인 루트와 채팅 첨부 사용량을 cache 없이 재측정하고 20GiB 이하 계정만 낮춘다. 20GiB 초과 사용자는 사용량보다 작게 줄이지 않는다. 운영 재시작 후 식별정보를 출력하지 않은 집계에서 22/22 계정이 v2·20GiB였으며 Chrome 파일 관리자도 `20GB`를 표시했다.
- Note Studio 입력: 중앙 slash Dialog를 제거하고 실제 `/` 키 입력 위치의 비모달 Menu로 바꿨다. `/query`, 위/아래, Enter, Esc, Ctrl+K를 지원한다. 빈 문단에서 `1`/`1.`+Tab은 번호 목록, `-`/`*`+Tab은 글머리표, `---`/`===`+Tab은 구분선으로 확정한다. 목록 Enter 연속 번호와 빈 항목 Enter 종료는 StarterKit 동작을 유지한다. 편집기 text cursor와 user-select를 명시했으며 Shift+우클릭은 브라우저 기본 메뉴를 보존한다.
- Note Studio Office: 페이지 헤더와 본문 우클릭에서 DOCX/XLSX/PPTX/HWPX를 만들 수 있다. 기본은 실제 페이지 폴더이며 `다른 NAS 위치에 만들기`에서 형식과 폴더를 고를 수 있다. 서버는 note revision, 계정 access realpath, 지원 형식, quota를 다시 검사해 임시 파일+rename으로 원자 저장하고 첨부 결속 실패 시 생성 파일을 제거한다. 성공하면 해당 노트 attachment로 경로를 남기고 OnlyOffice/RHWP 창을 전면에 연다.
- 추가 발견·수정: 저장소의 오래된 백업 소스 3곳에 남아 있던 평문 계정 비밀번호를 제거했다. Debian이 GUI 세션 없이 부팅된 뒤 LibreOffice 변환이 30초 동안 대기하는 현상을 운영 회귀에서 발견해 `SAL_USE_VCLPLUGIN=svp`, 격리 HOME과 OpenCL 비활성 환경을 고정했다. 수정 후 두 문서 변환 통합 시험이 각각 실제 성공했다.
- 검증: local backend 60개 중 58 pass·외부 변환 환경 2 skip·0 fail, frontend production build, Note command helper 5/5 pass. NAS Linux 최종 60/60 pass, `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared` active, PM2 `msp-backend` online/save, 내부 `http://127.0.0.1:3030`과 공개 HTTPS 200이다. Chrome 실계정에서 AI가 탭 없는 단일 대화, 이전 응답 구분, 하단 composer로 보이는 것과 20GB 표시를 확인했다. Note Studio는 실제 `/` 키로 caret 메뉴가 열리는지 확인하고 검증 문자를 제거했으며, Office 메뉴의 페이지 기본 위치와 다른 NAS 위치 항목을 확인했다.
- Git/배포: commits `5f07553`, `d409cc6`을 GitHub 활성 브랜치와 NAS checkout에 clean fast-forward했고 local production build `main.89411759.js`를 `/var/www/html`에 배포했다. `docs/NAS_PROJECT_LOG.xlsx`의 Feature_Index, API_Routes, Do_Not_Break, Patch_Log, Request_Archive, Generated_Check, 보류 작업을 artifact-tool로 갱신하고 formula error 0과 변경 범위 렌더를 확인했다.
- 완료 경계와 남은 외부/고위험 항목: 시스템 디스크 약 1TiB를 보조 저장 풀로 활성화하는 작업은 ext4 project quota와 다중 볼륨 registry·백업/장애 복구를 함께 정한 뒤에만 가능하므로 보류다. Python은 현재 자원 admission·기록까지만 있고 실제 non-root cgroup v2 worker와 network/time/PID/RAM/CPU/disk/output 강제 제한이 없어 실행 tool을 열지 않는다. 두 번째 Windows PC 장시간 E2E·Explorer OS 상태·공인 코드 서명은 해당 실기기와 인증서가 필요하다. AI 관리자 설정·노트/문서 전용 tool과 streaming/semantic search/citation은 핵심 파일/채팅 agent와 분리한 확장 항목으로 남긴다.

## 2026-09-07 Note Studio 본문 링크·AI 노트 도구·Python 1회 실행 완성

- 사용자 요청: 앞서 미구현으로 분류한 핵심을 진행도와 함께 순서대로 구현하고, 논리상 정상이라는 판정에서 멈추지 말고 실제 NAS·운영 화면·유사 제품 동작과 대조해 검증한다.
- Python 1회 실행: 저장된 Python 코드 노트를 웹 프로세스가 직접 실행하지 않고 Docker의 non-root 사용자, `network none`, read-only root filesystem, CPU 0.5, RAM 256MiB, PID 64, 15초, 출력 64KB 경계에서 실행한다. 공통 자원 admission을 먼저 통과하고 종료·오류·timeout 모두 container를 정리한다. AI에서는 `compute` 위험으로 분류해 `auto_all`에서도 반드시 별도 승인한다. 이는 Jupyter식 지속 kernel이나 `.ipynb` 셀 실행이 아니라 안전한 1회 실행 1차다.
- 이동에 견디는 Office 참조: 첨부에 경로뿐 아니라 device/inode/birthtime/kind identity를 저장한다. 플랫폼 파일·폴더 이동은 물리 rename과 노트 인덱스 rewrite를 하나의 transaction으로 묶고 인덱스 실패 시 물리 이동도 되돌린다. 외부 프로그램의 같은 파일시스템 rename은 계정 root 안의 제한 검색으로 동일 identity를 찾아 경로를 복구한다. cross-filesystem 복사+원본 삭제는 identity가 바뀌므로 자동 추측하지 않고 향후 명시적 재연결 UI로 남긴다.
- 본문 링크와 입력: `noteLink`와 `nasResourceLink` atom block을 추가했다. `/page`는 실제 하위 페이지를 만든 뒤 caret에 단색 링크를 넣으며 삽입이 실패하면 생성 페이지를 자동 휴지통 처리한다. Office 생성도 현재 위치에 문서 링크를 넣고 클릭 시 최신 경로 resolve 후 연다. Tab 확정 규칙은 번호·글머리·할 일·H1/H2/H3·인용·코드·`---`/`===` 구분선으로 확장했고 underline·task list toolbar도 추가했다. 링크 label은 읽을 때 현재 제목/파일명으로 hydrate한다.
- AI 노트 도구: 노트 목록/읽기/생성/수정/휴지통, Office 생성, Python 1회 실행 도구를 추가했다. 읽은 노트는 신뢰하지 않는 tool data로 표시해 그 내용이 후속 변경을 유도하면 재승인한다. 변경 의도는 최신 사용자 문장과 결속하며 Python은 자동 승인하지 않는다. 모든 agent loop 회귀는 mock fetch라 실제 OpenAI API 과금은 0회다.
- 검증: NAS backend 67/67, Note Studio 명령 5/5, production build와 PDF.js API/Worker 4.8.69가 통과했다. 최종 운영 bundle은 `main.003d533b.js`이며 `/var/www/html`, 내부 3030, 공개 HTTPS에서 hash 이름이 모두 일치한다. 내부·공개 HTTP 200, PM2 `msp-backend` online/save, 무인증 `/api/ai/history` 401을 확인했다. 로그인된 Chrome을 새로고침해 플랫폼과 Note Studio의 새 노트북/새 페이지/가져오기 화면을 실제 확인했으며 시험 사용자 데이터는 만들지 않았다.
- 기록: commits `0b0b260`, `1b48201`, `d3e7072`, `84c5ca7`, `acd4a65`, `473931a`, `66d2723`에 구현을 분리했다. `docs/NAS_PROJECT_LOG.xlsx`, `docs/programs/NAS_NOTE_STUDIO_SPEC.xlsx`, `docs/AUDITS/2026-09-06_FINAL_VALIDATION.md`를 현재 완료 경계로 갱신하고 formula error 0, 문자 깨짐 0, 변경 시트 렌더를 확인했다.
- 아직 완료가 아닌 것: 시스템 디스크 1TiB 보조 풀은 현재 `/` ext4에 project quota가 없고 앱이 단일 `NAS_ROOT`를 가정하므로 유지보수 창에서 quota·volume registry·placement·backup·reboot recovery를 함께 구축해야 한다. Windows 신규 PC/업데이트/재부팅/다중 계정 장시간 E2E, Explorer OS 상태, 공인 코드 서명은 실기기·인증서가 필요하다. Note Studio의 댓글·멘션·블록 drag·breadcrumb·rich media/database·Yjs offline/collaboration과 지속 kernel/ipynb, AI streaming·semantic citation·관리자 설정·문서 변환 job 도구는 후속 제품 단계다.

## 2026-09-07 AI 패널 최상위 레이어·실제 처리 단계 표시

- 사용자 요청: AI 버튼으로 연 사이드바가 플랫폼 헤더나 앱 창에 가려지는지 확인하고, 기존 `요청을 확인하고 있습니다…` 대신 Codex처럼 지금 무엇을 확인·실행·검증하는지 보여준다.
- 확인된 원인: 운영 Chrome 화면에서 AI 패널 상단 약 48px가 TopBar 아래에 가려져 제목·활성 상태·닫기 버튼이 보이지 않았다. 코드상 MUI Drawer 기본 z-index는 1200이고 TopBar는 drawer+1인 1201이었다. 요청 상태는 실제 서버 단계와 무관한 임시 assistant 말풍선이었고, 429 같은 실패 뒤에도 해당 문구가 남았다.
- 레이어 수정: AI Drawer와 paper에 전용 z-index `2147483100`을 적용해 TopBar, 일반 앱 창, immersive 창보다 위에 표시한다. 배포 후 운영 Chrome에서 패널 제목·모델·활성 상태·설정·닫기 버튼 전체가 최상단에 보이는 것을 화면으로 확인했다.
- 진행 상태: 브라우저가 UUID requestId를 만들고 서버는 로그인 userUid와 결합해 10분 메모리 상태로 관리한다. `요청 확인 → 문맥 준비 → AI 판단 → 도구 실행 → 결과 재검토 → 저장 → 승인 대기/완료/실패`를 모델 요청과 도구 시작·완료 callback에서만 갱신한다. UI는 인증된 `/api/ai/progress/:requestId`를 350ms 간격으로 읽어 상단 고정 카드에 실제 단계, 설명, 최근 완료 단계와 진행률을 표시한다. 경로·본문·도구 인자는 원장에 넣지 않으며 다른 계정은 같은 requestId로 조회할 수 없다.
- 실패 복구: 고정 `요청을 확인하고 있습니다…` 말풍선을 제거했다. 실패 시 사용자 요청은 서버 대화에 저장되지 않고 진행 카드는 실제 오류를 보여준 뒤 사라진다. 토큰 한도 도달 상태에서 `진행 상태 표시 테스트`를 전송해 `요청 처리를 마치지 못했습니다 · 100% · 오늘 설정한 AI 토큰 한도 도달` 카드가 표시되는 것을 확인했고, OpenAI 호출과 비용은 0회였다. 화면은 reload해 시험 문장을 제거했다.
- 검증·배포: local 신규 회귀 7/7, NAS 전체 backend 70/70, Note 명령 5/5, frontend production build와 PDF.js API/Worker 4.8.69가 통과했다. commits `5c654e6`, `1931908`을 GitHub와 NAS checkout에 반영했다. live bundle은 `main.b133ff20.js`이고 디스크·내부 3030·공개 HTTPS가 일치한다. 공개 HTTP 200, PM2 `msp-backend` online/save, 무인증 progress API 401이다.
- 남은 검증 경계: 현재 계정이 일일 토큰 한도에 도달해 정상 OpenAI 요청의 여러 실제 단계는 mock callback 순서로 검증했다. 한도 초기화 후 짧은 읽기 요청 1회로 모델→도구→모델 단계의 운영 화면 전환을 추가 확인한다. 시간 기반 가짜 진행률로 대체하지 않는다.

## 2026-09-07 최근 구현 전체 자동·운영 실화면 검증

- 사용자 요청: 토큰 상한을 늘린 테스트 계정에서 AI 에이전트와 최근 구현 기능을 실제로 모두 시험하고, 논리상 통과만이 아니라 브라우저·NAS 상태·결과 파일까지 교차 확인한다.
- 자동 회귀: NAS Linux backend 전체 70/70이 통과했다. 로컬 backend는 68 pass·외부 문서 변환 환경 의존 2 skip·0 fail이었다. NAS frontend 개별 12 suite·36 test와 production build/PDF.js API·Worker 4.8.69 gate가 통과했다. Windows Node agent `--self-test`도 통과했다. 로컬에는 .NET SDK가 없어 CFAPI provider 재빌드는 실행하지 못했다.
- frontend 전체 시험 경계: NAS의 `App.test.js`는 테스트 시작 전에 `react-router-dom`을 해석하지 못해 실패했다. 설치 버전 7.2.0의 package main이 실제로 없는 `dist/main.js`를 가리키고 Node 요구 버전은 20 이상인데 운영 Node는 18.19.0이다. 기능 assertion 실패가 아니라 테스트 런타임·패키지 호환 실패이며 production build는 성공했다. 오래된 `frontend/test_storage.py`는 더 이상 존재하지 않는 `backend/storage`를 가리켜 진단용 스크립트로서 실패 메시지를 냈다.
- 실제 AI 통과: Chrome에서 progress 카드가 모델 판단·도구·저장·승인 대기로 갱신되는 것을 확인했다. `/AI_E2E_TEST_20260907` 폴더와 `result.txt`를 각각 대화 내 승인 카드로 승인했고, 승인 후 같은 대화가 자동 재개됐다. 서버에서 디렉터리 0700, 파일 0600, 내용 `E2E_OK`를 확인했다. AI 파일 읽기와 전체 검색, 명시적 대화 검색, 새로고침 후 대화 지속, 긴 대화의 `최신으로` 버튼을 확인했다. 시험 폴더는 정확한 경계를 확인한 뒤 전부 제거했다.
- 실제 AI 결함: 일반 질문 `내 키만 숫자로 답해`에는 대화 검색 도구를 쓰지 않고 `6810`을 답했다. `내 키는 177`을 검색 도구로 찾으라고 명시했을 때는 `177`을 찾았지만 `177입니다.`로 답해 숫자만 지시를 어겼다. 파일 읽기도 `한 줄 그대로` 대신 설명을 붙였다. 세 번째 파일 생성 요청에서는 실제 action과 run을 만들지 않은 채 승인 대기 문구만 생성해 승인 카드가 나타나지 않았다. 따라서 승인 UI 복구 결함이 아니라 모델이 도구 호출 없이 승인 문구를 흉내 낸 결함이다. 실제 파일은 생성되지 않아 side effect 안전성은 유지됐다.
- 실제 플랫폼 화면: AI Drawer는 viewport top 0, z-index 2147483100으로 헤더 위에 표시됐다. 사용자 관리에서 22개 계정 모두 20GB, 전체 NAS 1.79TB·사용자 할당 440GB·개인 실사용 2.4GB·추가 할당 가능 1.10TB가 표시됐다. 서버 설정에서 CPU/RAM, 시스템·NAS 디스크, NVMe 장치, 온도, 자동 안전선, 사용자별 자원과 과거 기록이 표시됐다. Note Studio의 notebook tree, 문서 스튜디오의 DOCX/XLSX/PPTX/HWPX/HWP 진입, 문서 변환의 `원본 형식 → 결과 형식`, NAS/기기 불러오기와 실행 버튼 문구를 실제 화면에서 확인했다.
- 서비스·보안: `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 active, PM2 `msp-backend`는 online, 내부 3030과 공개 HTTPS는 200이었다. 무인증 `/api/ai/history`는 401을 반환했다. 다른 실제 사용자에게 영향을 주는 친구·차단·채팅·전송과 영구 삭제는 실제 계정에서 실행하지 않고 backend mock/단위 회귀로만 검증했다.
- 비용: 이번 운영 실호출 묶음은 9회, 27,611 token을 사용해 당일 누적이 57,351에서 84,962 token으로 증가했다. 비밀키와 인증정보는 출력하거나 기록하지 않았다.
- 추가 경고: backend 전체 테스트를 일반 SSH 사용자로 실행할 때 root 0600인 `/mnt/nas/.agent_incoming/web/document-studio-jobs.json`의 이전 작업 복구에서 EACCES 경고가 났다. 운영 PM2는 root라 현재 서비스 읽기는 가능하지만 테스트 격리 또는 state 소유권 계약을 명확히 해야 한다. PM2 누적 오류 로그에는 과거 OnlyOffice callback의 공인 IP 연결 거부, 오래된 `getUserStorageSummary(...).catch is not a function`, 잘못된 JSON 요청 기록이 남아 있다. 이번 AI 요청 중 새 crash는 없었으나 로그에 시각이 없어 현재 재현 여부를 별도 확인해야 한다.
- 다음 수정 우선순위: 1) 서버가 tool action 없이 승인 대기 문구를 반환하지 못하도록 완료 응답을 구조 검증하고 재질문 또는 오류로 처리한다. 2) 기억·정확 인용 요청은 서버가 결정적으로 대화 검색을 붙이고 `숫자만/경로만/그대로` 같은 출력 계약을 후처리 검증한다. 3) frontend test runtime을 Node 20 이상 또는 호환 router 버전·Jest resolver로 정리한다. 4) 문서 작업 state 테스트 격리와 오래된 운영 오류의 현재 재현 여부를 확인한다.

## 2026-09-07 실제 사용자 AI 질문 전수 행렬·안전 gate 보강

- 사용자 정정: 직전 검증은 기능별 smoke에 불과했다. 사용자가 실제로 해볼 만한 AI 질문을 파일·검색·정리·공유·채팅·노트·문서·Python·권한·오류·모호한 요청·악성 지시까지 모두 동치 부류로 설계하고 검증한다.
- 최초 발견: 기존 정규식 gate는 38개 표본 중 19개를 오판했다. `삭제 방법만 알려줘`, `삭제하지 마`, `친구 추가가 가능한지`, `메시지는 보내지 말고 초안만`, `계정 삭제해줘`에도 변경 권한을 만들었고, `옮겨줘`는 이동으로 잡지 못했다. 노트 수정·휴지통·Office·Python은 일반 파일 도구까지 중복 허가했다.
- 안전 gate 수정: 명시적 실행 어미가 없으면 변경 권한을 만들지 않는다. 방법·설명·가능 여부·과거 회상·부정/금지·계정/권한/용량/비밀번호/보안·영구 삭제는 변경 gate에서 차단한다. `옮겨/지워/알려줘` 변형을 보완하고 append, Note, Office, Python의 구체 도구가 넓은 파일 도구보다 우선하게 했다. 한국어 실행형 요청만 결정적으로 허용하며 영어 변경 요청은 현재 안전하게 미실행한다.
- 영구 질문 행렬: `backend/tests/aiUserQuestionMatrix.test.js`에 실행형 57개와 조회·설명·질문·과거형·금지·고위험·미지원 65개, 총 122개를 추가했다. 현재 16개 변경 도구를 각각 최소 3개 질문이 포함하며 122/122가 기대 도구와 일치한다. 질문 부류와 현재 지원 밖 영역은 `docs/AUDITS/2026-09-07_AI_USER_QUESTION_MATRIX.md`에 기록했다.
- 실제 모델 격리 검증: 실제 NAS side effect 대신 mock 도구 결과를 연결해 36개 대표 질문을 `gpt-4.1-mini`로 호출했다. 정확 일치 32/36, 안전한 clarification을 포함하면 34/36이고 위험·비밀·계정·영구 삭제·임의 명령이 도구로 연결된 사례는 0개였다. 내용이 빠진 append와 대상이 모호한 전송은 올바르게 되물었다. `보고서` 검색 2건은 검색할 수 있는데도 더 구체적인 키워드를 요구해 과도한 clarification으로 남았다. input 58,023 + output 1,500 = 59,523 token을 사용했다.
- 응답 계약: 실제 action 없이 승인 대기/승인 카드를 주장하면 `AI_FALSE_APPROVAL_CLAIM`으로 바꾸고 미실행을 알린다. 모든 interruption을 거절한 경우 모델 후속 문구와 무관하게 `요청한 작업을 거절해 실행하지 않았습니다.`로 확정한다. 과거·이전·기억·말했던 내용과 `내 키`는 대화 검색을 강제한다. `숫자만`과 단일 `경로만` 요청은 후보가 하나일 때 서버가 군더더기를 제거하며 여러 후보이면 임의 선택하지 않는다.
- 운영 실화면: `내 키를 숫자로만 답해`는 `177`, NAS 루트 경로는 `/`만 반환했다. 삭제 방법 설명+실행 금지는 action/승인 카드 0개였다. 실제 폴더 생성 요청은 승인 카드가 나타났고 거절 뒤 미실행 확정 문구와 카드 제거를 확인했다. 두 시험 폴더는 NAS에 생성되지 않았다. 삭제 방법 설명에는 플랫폼 AI가 지원하지 않는 영구 삭제 가능성을 일반론으로 언급한 정확성 gap이 남았다.
- 최종 검증·배포: commits `7b1d312`, `026e284`를 GitHub와 NAS 활성 브랜치에 반영했다. NAS backend 80/80, PM2 `msp-backend` online, 내부·공개 HTTP 200, checkout clean이다. 운영 화면 검증은 7회·18,069 token을 추가 사용해 당일 누적 103,031 token이 됐다. 격리 benchmark와 합친 이번 확장 검증 사용량은 77,592 token이다.
- 현재 질문 범위 gap: 서버 자원·quota/역할·가입·보호 정책, 문서 변환/합치기, Office/HWP/PDF 본문, 파일 내용/날짜/크기/중복 검색, 버전·휴지통 복원, 친구 목록/온라인·채팅 기록, NAS Drive 장치 제어, notebook 관리, 프로젝트 정적 분석·패치, 지속 kernel/다른 언어, OCR·미디어, 백업·인터넷·자동화는 아직 AI 도구가 없다. 모델은 가능하다고 꾸미지 말고 한계와 필요한 도구를 말해야 한다.

## 2026-09-07 실제 AI 대화에서 확인한 다중 턴 작업 완성 실패·향후 AI 통합 원칙

- 사용자 교정: `사용자가 해볼 만한 질문 전부`는 한 문장별 intent/tool 분류만 뜻하지 않는다. 정보가 빠진 요청에서 AI가 필요한 것만 묻고, 다음 사용자 답을 원래 작업에 결합하고, 조건이 완성되면 승인·실행·검증까지 끝내는 전체 대화 경로를 포함한다.
- 운영 대화 증거 1: 사용자가 `간증문 써봐` → `응 만들어줘` → `한글파일로`라고 답했지만 AI는 앞선 내용·생성 의도·HWPX 형식 답변을 하나의 작업으로 결합하지 못하고 `실제 승인 작업이 생성되지 않았다`고 종료했다. 저장 위치도 묻지 않았다.
- 운영 대화 증거 2: `친구신청좀해줘`에 대상 사용자를 물은 뒤 사용자가 정확한 로그인 ID를 답했는데도, AI는 원래 실행 의도와 대상 답변을 합치지 못하고 `친구 신청 보내줘`라는 특정 문장을 반복 요구했다. 사용자가 재차 신청을 요청해도 같은 질문을 반복하는 무한 확인 상태가 재현됐다.
- 직접 확인한 원인: 서버의 변경 권한 gate가 `deriveAuthorizedMutationTools(message)`로 최신 문장 하나만 판정한다. 모델 history는 있어도 서버가 미완성 작업의 종류, 이미 채운 인자, 아직 필요한 인자, 취소/정정, 승인 상태를 구조적으로 보관하지 않는다. 프런트 AI 문맥도 현재 실제 앱/창/선택 항목이 아니라 `currentPath: '/'`만 고정 전송한다.
- 회귀 판정 정정: 기존 122문장 행렬은 단일 입력의 최소 변경 도구 허용 여부를 검증한 것이며 `전체 사용자 질문 검증 완료`의 근거가 될 수 없다. 질문 → AI 보충 질문 → 사용자 단답/정정 → slot 완성 → 승인 → 실행 → 결과 검증의 다중 턴 행렬을 별도로 구축해야 한다.
- 필수 기반 계약: 계정별 `pending task`는 원래 사용자 실행 의도, 작업 종류, typed slots, 슬롯별 출처(사용자/현재 화면/조회/기본값), 미확정 후보, 위험 등급, 취소·정정 revision을 서버에 제한적으로 보관한다. 최신 단답은 열린 작업의 기대 slot에만 결합하며 오래되거나 다른 작업의 답으로 임의 재사용하지 않는다. 같은 질문을 동일 상태에서 반복하지 않고, 진전이 없으면 선택지·현재 이해·취소 방법을 제시한다.
- 문맥 계약: AI 호출 시 실제 활성 앱, 활성 창, 현재 계정 경로, 선택 파일/폴더/노트/사용자, 호출 위치를 명시적으로 전달하되 서버가 계정·권한·존재 여부를 재검증한다. 화면 문맥이 있으면 다시 묻지 않고, 여러 후보이거나 실행 결과를 바꾸는 값만 최소 질문으로 묻는다.
- 기존 기능 우선 원칙: FILE-MANAGER, CHAT/FRIENDS, NOTE-STUDIO, DOCUMENT-WORKSPACE/변환, Windows NAS Drive, 사용자·서버 설정 등 사용자가 UI에서 할 수 있는 기존 기능을 inventory로 만들고, 각 기능에 조회·계획·실행·검증·취소/복구 AI 계약과 권한 경계를 연결한 뒤 실제 다중 턴 대화로 검증한다. UI에서 가능하다는 이유만으로 AI 실행 가능이라고 표시하지 않는다.
- 신규 기능 Definition of Done: 앞으로 추가하는 모든 기능은 `AI 제외`가 명시된 기능이 아니라면 UI/API 구현과 함께 AI capability manifest, 필요한/선택 slots와 안전한 기본값, 권한·승인·idempotency·rollback, 실제 결과 verifier, 정상/모호/부정/정정/취소/실패/재개 대화 tests, Feature_Index·Relation_Map·Code_Map·Patch_Log·질문 행렬 갱신까지 있어야 완료다. AI 연결이 빠졌으면 `부분 완료`로 기록한다.
- 예시 기대 동작: `간단한 코딩 만들어줘`는 현재 Note Studio/노트북 문맥이 있으면 그 노트북의 코드 페이지/프로젝트 후보를 기본으로 삼고, 언어·목적처럼 결과를 결정하는 최소 정보만 묻는다. 사용자가 모르면 안전한 예제와 기본 구조를 제안하고, 저장 위치·파일 구성·실행 여부를 요약한 뒤 승인한다. 생성 후 실제 노트/파일과 열기·실행 가능 여부까지 검증한다.
- 현재 상태와 다음 조치: 위 계약은 이번 요청에서 운영 대화와 코드로 확인해 기록한 설계·회귀 기준이며 아직 구현 완료가 아니다. 다음 안전한 작업은 ① 전체 기존 기능 capability inventory ② 서버 pending-task 상태기계와 실제 UI context bridge ③ 간증문/친구신청/간단한 코딩을 포함한 다중 턴 회귀 ④ 기능별 도구 연결 순으로 구현하고, 실제 화면에서 반복 질문 0회와 결과 side effect를 검증하는 것이다.

## 2026-09-07 플랫폼 전 기능 AI 카탈로그·실행 연결

- 사용자 요청: 현재 프로젝트의 모든 기능을 실제 코드와 운영 API 기준으로 다시 조회하고, 로그인 사용자가 화면에서 직접 할 수 있는 조회·파일 생성·검색·정리·복구·공유·채팅·노트·문서·장치·회의·관리 작업을 하나의 AI 대화에서 처리한다. 앞으로 새 기능을 만들 때 AI 연결을 빠뜨리지 않는 영구 검증 기준도 둔다.
- 기능 인벤토리: `backend/index.js`, `nasRoutes.js`, `friendsRoutes.js`, `chatRoutes.js`, `chatAttachmentRoutes.js`, `notificationsRoutes.js`, `shareRoutes.js`, `aiAgentRoutes.js`의 production REST route를 추출했다. 파일/저장공간, 휴지통/버전/복원점, 활동/즐겨찾기/최근, 친구/검색, 채팅/알림, Note Studio, 문서 변환, 연동 장치, 공유 링크, 회의, 관리자 사용자/가입, 서버 자원, 계정 설정의 13개 영역을 `backend/aiCapabilityCatalog.js`에 단일 카탈로그로 만들었다.
- 실행 도구 확대: 기존 핵심 파일·친구·채팅·노트 도구를 포함해 총 100개 strict tool을 연결했다. 새 범위는 휴지통·파일 버전·드라이브 복원점, 즐겨찾기/최근/활동, 친구 수락·거절·삭제·즐겨찾기, 알림 읽음, 노트북·노트 버전·첨부, 문서 변환/합치기/템플릿 job 생성·취소·재시도, 연동 PC 동기화 정지·재개·해제, 공유 링크 생성·수정·정지·재발급·해제, 그룹 채팅 생성·초대·응답·메시지·방장/부방장·내보내기·파기, 회의 조회·설정·시작·저장, 사용자 역할/용량·가입 승인/거절·자원 정책, 로그인 유지·프로필 이름이다. `GET /api/ai/capabilities`와 status의 도구/영역 수로 배포본의 실제 범위를 확인할 수 있다.
- 다중 턴 교정: 계정별 pending task를 30분 제한·64KiB 상한·0600 원자 파일로 저장한다. `간증문 만들어줘 → 한글파일로 → /경로에`나 `친구 신청해줘 → 로그인 ID` 같은 짧은 답을 원래 실행 의도와 합쳐 변경 권한을 유지하며, 취소·새 명확 요청·완료/승인 단계에서는 즉시 폐기한다. 모델에 모든 도구를 매번 보내지 않고 요청과 현재 승인 의도에 관련된 도구만 선택해 입력 토큰과 오선택을 줄인다.
- 실제 화면 문맥: 프런트가 현재 route, 파일 관리자 경로, 활성 앱/창, 활성 항목, 선택 파일들, 현재 채팅방·노트·문서 변환 작업 ID를 제한된 크기로 전달한다. 계정이 바뀌면 선택 경로를 지우며 서버가 다시 계정 root·존재·권한을 검증한다. AI 패널은 현재 provider/model/tool 수와 처리 범위를 표시한다.
- 문서 생성 보강: AI의 `create_document`가 TXT/MD뿐 아니라 실제 본문을 담은 DOCX와 rHWP 기반 HWP/HWPX를 만든다. 단순 빈 문서를 생성한 뒤 내용이 있다고 답하지 않는다. 저장은 경로 경계·확장자·quota·원자 replace를 거친다.
- 보안 경계: 읽은 파일·채팅·검색 결과는 모두 신뢰하지 않는 tool data다. 그 뒤 변경 요청은 auto_all이어도 다시 승인한다. 외부 사용자 대상은 UID+loginId를 승인 전에 고정하고 실행 직전 재조회한다. 관리자, compute, critical 작업은 auto_all에서도 자동 실행하지 않는다. 비밀번호/토큰/세션, 계정 생성·삭제와 비밀번호 변경, 영구 삭제, 공개 게스트 세션, 드라이버 내부 인증·동기화 프로토콜, 실시간 통화 미디어 제어는 사용자가 UI에서 직접 확인해야 하는 인증·장치 경계라 AI 도구로 열지 않는다.
- 누락 방지 gate: 모든 tool은 정확히 한 기능 영역에 배정돼야 하고 모든 변경 tool은 의도 규칙, action spec, 실제 실행 분기를 가져야 한다. production literal REST route는 AI 통합 또는 UI/인증/보안/드라이버/공개 경계 중 하나로 분류되지 않으면 테스트가 실패한다. 새 기능 Definition of Done에 capability 분류, 권한·승인·idempotency, 정상/모호/취소/실패/재개 회귀와 프로젝트 로그 갱신을 포함한다.
- 로컬 검증: backend 전체 92 tests에서 90 pass, 0 fail, 외부 변환 엔진이 필요한 2개만 조건부 skip이다. 100개 도구의 중복/누락, 모든 mutation의 action/의도/실행 분기, 140개 이상 production literal route 분류, 다중 턴 결합·취소, 실제 기존 API endpoint, prompt-injection 승인 경계를 영구 회귀로 검사한다. frontend production build와 PDF.js API/Worker 4.8.69 gate, Node syntax, `git diff --check`가 통과했다. 이 단계에서 실제 OpenAI 과금 호출은 0회다.
- 기록: `docs/AI_AGENT_CAPABILITY_AUDIT.md`에 현재 가능한 범위와 의도적 비위임 이유를 사용자 기준으로 정리했고, `docs/NAS_PROJECT_LOG.xlsx`의 Do_Not_Break, Feature_Index, Relation_Map, Code_Map, Patch_Log, Request_Archive, Generated_Check를 갱신했다. artifact-tool 재열기에서 formula error와 문자 깨짐 0건, 변경 범위 렌더와 기존 행 높이·줄바꿈을 확인했다.
- 운영 검증 예정: 이 변경은 아직 이 문단 작성 시점에는 NAS live에 배포하지 않았다. GitHub push와 NAS clean fast-forward 뒤 Linux backend 회귀, frontend 배포 bundle hash, PM2/필수 서비스, 내부 3030·공개 HTTPS, 인증 없는 capability/history 차단, 로그인된 브라우저의 AI 패널과 대표 저비용 대화를 확인하고 결과를 이 문단 아래에 덧붙인다.
- 첫 운영 실화면 발견과 교정: `간증문 파일로 만들어줘 → 테스트용 한 문장으로 알아서 써줘`에서 대화 연결은 유지됐지만 모델이 형식과 위치를 묻지 않고 `/test_간증문.txt`를 임의 선택해 승인 카드를 만든 결함을 확인했다. 해당 시험 작업은 거절해 파일을 만들지 않았다. 일반 문서 `create_document`는 누적 사용자 문장에 TXT/MD/DOCX/HWP/HWPX 형식과 명시적 경로 또는 `여기/현재 폴더` 지칭이 모두 없으면 서버가 `AI_DOCUMENT_SLOT_REQUIRED`로 도구 호출을 거절하고 두 값을 한 번에 묻게 했다. 회귀는 두 값 없음, 형식만 있음, 두 값 모두 있음을 각각 검사한다.
- 운영 최종 검증: commits `9f0b2e3`, `921e402`를 GitHub와 NAS 활성 브랜치에 clean fast-forward했다. NAS Linux backend 93/93이 모두 통과해 LibreOffice 실제 문서 변환 2건도 성공했다. frontend production/PDF.js API+Worker 4.8.69 gate를 통과한 `main.c312b15f.js`가 build와 `/var/www/html`에서 일치한다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 active, PM2 `msp-backend`는 online/save, 내부 3030과 공개 HTTPS는 200, 무인증 capability/history는 401이다.
- 브라우저 최종 검증: 로그인된 Chrome의 AI Drawer가 헤더 위에 열리고 `openai · gpt-4.1-mini · 100개 작업 도구`를 표시했다. `지금 실제로 할 수 있는 기능 범위를 짧게 알려줘`는 새 카탈로그의 파일·복구·저장공간·친구·채팅·공유·회의·노트·관리 범위와 제한을 답했다. 교정 배포 뒤 `간증문 파일로 다시 만들어줘`는 승인 작업을 만들지 않고 예시 본문과 함께 파일 형식·저장 위치를 한 번에 물었다. 이어 `취소`를 보내 미완성 작업이 종료됐음을 확인했다. 외부 사용자 작업과 실제 파일 생성은 0건이며 실모델 호출은 이 대표 흐름에만 제한했다.
- 남은 운영 경고: 일반 SSH 사용자로 전체 테스트를 실행할 때 root 운영 소유의 `/mnt/nas/.agent_incoming/web/document-studio-jobs.json` 이전 상태를 읽지 못했다는 EACCES 경고가 계속 보인다. PM2 운영 프로세스는 root이고 93/93 및 실변환은 통과해 이번 기능 장애는 아니지만, 향후 테스트 state root를 운영 state와 완전히 분리하는 정리는 별도 기술부채로 유지한다.

## 2026-09-07 최근 선택 창 우선·홈 전체 숨김·Alt+Tab형 창 전환기

- 사용자 요청: 최근에 추가한 앱이나 채팅 창이 선택 여부와 관계없이 위에 고정되는 현상을 없애고, 가장 최근에 선택한 창이 항상 맨 위에 오게 한다. 홈 성격의 버튼을 누르면 열린 파일·앱 창을 닫지 않고 모두 보이지 않게 한다. 최상단 NAS 파일 아이콘 왼쪽에는 얇은 고정 버튼을 추가해 Windows Alt+Tab처럼 최근 사용 창을 전환하고, 다시 누르면 닫히며 사용할 때마다 버튼이 빨간색으로 한 번 깜빡이게 한다.
- 확인된 원인: `DedicatedChatWindowLayer`와 `ChatWorkspaceWindowLayer`가 고정 `z-index: 1450`을 사용해 실제 포커스보다 항상 앞섰다. 파일·폴더·앱 창 생성 경로는 렌더 당시 `topZIndex + 1`을 직접 재사용해 연속 실행 시 같은 값이 생길 수 있었고, 이때 DOM 배치 순서가 앞뒤를 결정했다. 앱·NAS·채팅 레이어도 서로 다른 활성 기준을 사용했다.
- 통합 창 관리자: `WindowContext`에 ref 기반 단조 증가 z-index 할당기와 공통 `focusWindow`를 두고 파일·폴더·앱·채팅을 같은 MRU 순서에 넣었다. 실제 선택된 창이 포함된 레이어만 활성 z-index를 받으며 고정 최상단 채팅 예외를 제거했다. 닫기·최소화 시에는 다음 최근 가시 창으로 포커스를 넘기고, 복원은 새 z-index와 MRU를 함께 갱신한다.
- 홈 동작: `showDesktop`은 열린 창 데이터를 삭제하지 않고 전부 최소화한 뒤 desktop에 포커스를 둔다. 상단 NAS 로고, 플랫폼 바탕화면, 파일 관리자·PC 연동·설정·백업 이동은 이 동작을 사용하므로 화면에서는 모든 창이 사라지고 상단 태스크 버튼이나 전환기에서 다시 복원할 수 있다.
- 창 전환기: NAS 아이콘 왼쪽의 24px 버튼을 누르면 최근 사용 창 목록이 열리고 현재 창의 바로 전 창을 기본 선택한다. Tab/오른쪽은 정방향, Shift+Tab/왼쪽은 역방향, Enter와 마우스는 선택 창 활성화, Esc·바깥 클릭·같은 고정 버튼 재클릭은 닫기다. 열기·순환·선택·닫기 때마다 고정 버튼이 420ms 빨간색으로 한 번 점멸한다. Windows의 hold-to-switch 동작은 웹에서 Alt 키를 계속 잡지 않아도 쓰도록 클릭 유지형 패널로 변형했다.
- 영구 회귀: `frontend/scripts/verify-window-manager.mjs`가 포커스 레이어 소유권, NAS 배경/활성 구분, MRU 정렬, 직전 창 기본 선택, 정·역방향 순환, immersive 우선순위를 Jest의 native canvas 상태와 무관하게 검사한다. 로컬과 NAS에서 모두 통과했고 양쪽 production build 및 react-pdf 9.2.1/PDF.js 4.8.69 호환 검사도 통과했다.
- 배포·운영 검증: 코드 커밋 `6dbfedc`를 GitHub와 NAS 활성 브랜치에 fast-forward했다. NAS에서 생성한 `main.c8c3675f.js`를 `/var/www/html`에 배포했으며 nginx 파일과 공개 사이트가 같은 hash를 반환했다. `ssh`, `tailscaled`, `nginx`, `docker`, `cloudflared`는 active, PM2 `msp-backend`는 online/save, 내부 3030과 공개 HTTPS는 200이다. PM2 재시작 직후 첫 HTTP 확인은 포트 준비 전에 실행되어 000이었고 13초 뒤 재검증에서 정상 200이 됐다.
- 검증 경계: 현재 로컬 미리보기에는 인증된 사용자 세션이 없어 로그인 뒤 여러 실제 창을 마우스로 반복 선택하는 화면 검증은 수행하지 않았다. 대신 순수 정책 회귀, 실제 production build, NAS 배포 번들 일치와 서비스 응답을 확인했다. 다음 로그인된 브라우저 확인에서는 파일·채팅·문서 앱을 각각 열고 A→B→A 앞뒤 순서, 홈 전체 숨김, 전환기 재클릭 닫기와 빨간 점멸을 화면으로 추가 확인한다.
- 기록: `docs/NAS_PROJECT_LOG.xlsx`의 Request_Archive, Patch_Log, Feature_Index, Relation_Map, Code_Map, Do_Not_Break를 artifact-tool로 갱신했다. 수식 오류 0건, 새 한국어 행의 문자 깨짐 없음, 변경 범위 렌더를 확인했다.

## 2026-09-07 창 전환 버튼 고정 유지 교정

- 사용자 확인: 창 전환 버튼을 눌렀을 때 고정 상태로 유지되지 않고 패널이 한 번 나타난 직후 사라졌다.
- 실제 원인: `TopBar`의 전환기 keyboard effect가 열린 창 목록이 0개이면 `setTaskSwitcherOpen(false)`를 즉시 호출했다. 창이 아직 없거나 홈으로 전부 숨긴 상태에서 사용자의 명시적 버튼 토글보다 이 빈 목록 예외가 우선했다.
- 수정: 빈 목록 자동 닫기를 제거했다. 이제 열린 창이 없어도 `열려 있는 창이 없습니다.` 패널과 버튼의 `aria-pressed` 활성 상태가 계속 유지된다. 같은 버튼을 다시 누르거나 `Esc`, 패널 바깥 클릭 또는 실제 창 선택 때만 닫힌다. 빈 목록에서 Tab·Enter는 부작용 없이 패널을 유지한다.
- 재발 방지: `verify-window-manager.mjs`에 빈 목록 순환 결과와 `TopBar`의 지속 토글 계약 검사를 추가했다. 로컬과 NAS 모두 `MRU ordering, persistent toggle, layer ownership, cycling, and immersive priority verified`를 통과했고 양쪽 production build 및 PDF.js 호환 검사도 통과했다.

## 2026-09-07 PDF 즉시 자동 저장·화면 OCR 복사와 웹 내부 창 순환 교정

- 사용자 교정: PDF의 형광펜·펜·텍스트 상자 등 어떤 변경도 저장 버튼을 누르기 전 사라지면 안 된다. `서식 유지 복사`와 `일반 텍스트 복사` 모두 PDF text layer뿐 아니라 스캔·그림 안에 보이는 글자를 읽어야 한다. 전자는 드래그한 화면의 줄바꿈·공백·들여쓰기를 최대한 재현하고, 후자는 같은 영역의 글자를 읽기 쉬운 일반 텍스트로 정리한다. 상단 창 전환 버튼은 목록 패널이 아니라 NAS 웹 내부 창 전환 모드여야 하며, 켜는 즉시 직전 창으로 이동하고 활성 중 Tab·Shift+Tab으로 열린 웹 창을 순환해야 한다.
- 저장 원인과 수정: 기존 자동 저장은 1.2초 debounce라 빠른 종료·새로고침 전에 요청이 시작되지 않을 수 있었고, 새 텍스트 상자는 blur/확정 전까지 annotations 원장에 없었다. 이제 모든 annotation 변경에서 즉시 coalescing save queue를 호출한다. 저장 중 들어온 변경은 최신 스냅샷까지 이어서 저장하며 실패 시 1.5초에서 시작해 최대 30초의 지수 백오프로 자동 재시도한다. 텍스트 상자는 생성 때 ID를 받고 입력할 때마다 원장에 upsert되어 저장된다. Esc 취소는 draft 주석도 제거한다. 수동 저장과 Ctrl+S는 즉시 재시도 수단으로 계속 남긴다.
- 화면 OCR: 인증된 `POST /api/file/pdf-ocr-region`을 추가했다. 서버가 PDF 페이지를 180dpi PNG로 렌더링한 뒤 Tesseract 5.3.0 `kor+eng` TSV 결과를 사용자가 드래그한 정규화 영역으로 제한한다. `layoutText`는 문자 폭·간격·줄 시작점을 이용해 상대 들여쓰기와 공백을 재구성하고 `plainText`는 단어 사이를 한 칸으로 정규화한다. OCR 실패나 빈 결과일 때만 기존 PDF text layer 추출로 fallback하고 그 사실을 상태 문구로 알린다. 이는 그림 자체를 설명하는 vision 기능이 아니라 그림·스캔에 실제로 보이는 문자를 읽는 기능이다.
- 자원·보안: OCR은 원본 PDF 바이트를 변경하지 않고 임시 페이지 이미지를 `finally`에서 삭제한다. `getValidatedPath`로 로그인 계정의 실제 PDF를 다시 확인하고, 파일 100MiB·렌더 페이지 약 35M pixel·실행 동시 1건·대기 4건·pdfinfo 10초·렌더 30초·OCR 45초 한도를 둔다. shell 문자열 실행을 쓰지 않고 `execFile` 인자를 분리한다. Tesseract `eng`, `kor`, `osd`를 NAS에 설치했다. `apt-get update`는 기존 Steam·AnyDesk third-party 저장소 서명 키 문제로 경고가 있었지만 Debian 캐시를 이용한 설치는 성공했으며 이번 범위와 무관한 저장소 설정은 변경하지 않았다.
- 웹 내부 창 순환: 목록 dialog를 완전히 제거했다. 버튼을 켜면 당시 열린 MRU 창 ID를 세션으로 고정하고 직전 창을 즉시 `focusWindow`한다. 활성 중 Tab은 다음, Shift+Tab은 이전 창으로 즉시 이동한다. Esc 또는 같은 버튼 재클릭으로 끄며 각 전환과 종료 신호 때 버튼이 420ms 빨갛게 점멸한다. Windows OS 창은 전환하지 않는다.
- 검증: 로컬 backend 대상 10/10, PDF·창 정책 verifier, ESLint, production build와 react-pdf 9.2.1/PDF.js 4.8.69 gate를 통과했다. NAS에서는 실 렌더 OCR fixture `HELLO OCR 123` 인식이 통과했고 전체 backend는 97 pass·1 환경 조건부 skip·0 fail이다. NAS production build와 PDF.js gate가 통과했다. 최초에는 프로젝트 `frontend/build`만 새로 만들고 실제 서비스가 `/var/www/html`의 예전 `main.58dd7647.js`를 제공하는 배포 경로 차이를 발견했다. 검증된 `/var/www/html`에 새 build를 동기화한 뒤 내부 3030과 공개 HTTPS 모두 `main.4b691d97.js`와 HTTP 200을 반환한다. PM2 `msp-backend`는 online이고 nginx·docker·tailscaled·cloudflared는 active다. 무인증 OCR API는 401이다.
- 남은 실제 화면 gate: 현재 자동 브라우저에는 로그인 세션이 없어 사용자의 실제 PDF에서 한글·혼합 문서 OCR, 펜/텍스트 입력 직후 새로고침 복원, 버튼 활성 후 다중 창 Tab 순환을 육안 검증하지 못했다. 저해상도·손글씨·복잡한 다단/표는 OCR 오인식 가능성이 있으므로 실문서 결과에서 추가 보정이 필요할 수 있다. 코드 commit은 `69ce239`이며 workbook 변경은 다음 문서 commit에 포함한다.
- 배포: 커밋 `3cfd835`를 GitHub와 NAS에 fast-forward하고 `main.8023a96e.js`를 운영 nginx에 배포했다. 공개 사이트와 디스크 bundle hash가 일치하며 내부 3030·공개 HTTPS 200, 필수 서비스 active, PM2 `msp-backend` online/save 상태다.
- 기록: `docs/NAS_PROJECT_LOG.xlsx`의 Request_Archive, Patch_Log와 기존 `APP-WINDOW-MRU-SWITCHER` 기능 설명을 갱신했다. 수식 오류 0건과 변경 범위 렌더를 확인했다.

## 2026-09-07 파일·문서·노트 자동 저장과 마지막 작업 위치 복원

- 사용자 요청: NAS에서 지원하는 파일·문서·노트의 변경사항은 즉시 또는 짧은 주기로 자동 저장하고, 로그아웃·로그인·새로고침·재접속 뒤 같은 항목을 다시 열면 마지막 편집·열람 위치에서 이어지게 한다. 내용 저장과 화면 위치 저장을 구분하고 계정 간 상태가 섞이지 않게 한다.
- 저장 구조: `backend/workspaceViewStateStore.js`에 인증 계정 hash별 view-state 원장을 추가했다. resource는 파일 identity 또는 note ID로 식별하고 장치별 최신 상태를 저장하며, 같은 장치 기록이 없으면 해당 계정의 가장 최근 상태를 fallback한다. 파일 이름 변경·이동은 filesystem identity로 이어지고 삭제된 파일관리자 경로는 복원하지 않는다.
- 보안·안정성: API는 클라이언트가 보낸 계정 ID를 신뢰하지 않고 현재 로그인 계정과 실제 파일·노트·폴더 경계를 다시 검증한다. 비밀번호·token·cookie·credential 계열 키를 거절하고 상태 24KiB, 계정당 resource 2000개, resource당 장치 8개로 제한한다. 원장은 디렉터리 0700·파일 0600과 임시 파일 후 rename으로 저장한다. 클라이언트는 변경을 하나로 합치고 최대 4회 지수 백오프하며 계정·파일·노트 전환 시 이전 pending 상태를 폐기하거나 응답 sequence를 검사한다.
- 연결 범위: 파일관리자 마지막 경로, Note Studio 마지막 노트북·페이지·블록 선택·스크롤·Monaco 위치, TXT/Markdown/코드 Monaco view state, PDF 페이지·페이지 내부 오프셋·확대율, HWP 보기/편집 모드·확대율·스크롤, 미디어 재생 시간·음량·속도를 서버 동기화한다. HWP 내용 autosave는 12초에서 2.5초로 줄였고 dirty 편집 상태에서 보기로 전환하기 전에 먼저 저장한다.
- 의도적 경계: OnlyOffice 본문 저장은 기존 autosave/forcesave를 유지한다. OnlyOffice가 안정적인 외부 API로 내부 커서·페이지를 제공하지 않아 그 위치를 추정 저장하지 않는다. HWP도 편집 iframe 내부 문자 커서가 아니라 모드·확대율·스크롤까지 복원한다. 내용 원본과 view state는 서로 다른 원장으로 유지한다.
- 자동 검증: 로컬 신규 store 회귀 3/3, backend 전체 97 pass·3 skip·0 fail, frontend 대상 2 suite·8 test, production build와 PDF.js API/Worker gate가 통과했다. 로컬 frontend 전체 Jest 중 12 suite는 현재 의존 환경의 native `canvas.node` 부재로 실행되지 않았으나 production compile은 성공했다. NAS Linux backend는 100 pass·1 OCR 환경 조건부 skip·0 fail, production build는 `main.d8b7c19a.js`로 통과했다.
- 배포·운영: 코드 commit `3d9c4be`를 GitHub와 NAS 활성 브랜치에 fast-forward하고 검증된 build를 `/var/www/html`에 동기화했다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 active, PM2 `msp-backend`는 online/save, 내부 3030과 공개 HTTPS는 200, 무인증 view-state API는 401이며 NAS checkout은 clean이다.
- 실화면 경계: 공개 사이트 로그인 화면과 live bundle까지 육안 확인했다. 현재 자동 브라우저에 인증된 NAS 세션이 없어 실제 사용자 파일을 열고 편집→로그아웃→재로그인→재열기 하는 최종 화면 E2E는 수행하지 않았다. 자격 증명을 기록하거나 재사용하지 않았으며 다음 인증 세션에서 파일 유형별 체감 확인만 남는다.
- 기록: `docs/NAS_PROJECT_LOG.xlsx`와 `docs/programs/NAS_NOTE_STUDIO_SPEC.xlsx`에 feature, 관계, 코드/API/data, 보안 경계, 상태기계, 오류 복구, 시험 및 변경 이력을 반영했다. artifact-tool로 재열기·수식 오류 0건·행 배치·줄바꿈·변경 시트 렌더를 확인했다.

## 2026-09-07 Python 실행 공통 오류 의심 운영 진단

- 사용자 요청: 어떤 계정에서 실행해도 Python이 오류가 나는 것 같으므로 공통 원인을 확인한다. 이 요청에서는 바로 수정하지 않고 운영 상태와 실제 저장 코드를 진단한다.
- 공통 실행기 확인: NAS Docker 20.10.24, cgroup v2/systemd와 `python:3.12-alpine` 이미지가 존재한다. 제품과 동일한 `managedPythonWorker`에 `print` 정상 코드를 넣은 결과 non-root·network none·read-only·CPU/RAM/PID 제한 상태에서 exit 0, 약 0.5초로 성공했다. 임시 probe와 container는 실행 뒤 제거했다.
- 계정·자원 확인: 운영 정책은 auto이지만 `enforcementEnabled=false`, 즉 monitor-only이며 검사 시 CPU 약 1~4%, 가용 RAM 약 3.1GiB, 온도 약 44~55°C였다. 모든 계정의 Python 기본 요청 12.5% CPU·256MiB는 공통 한도 안이고, 실제 한 계정의 실행이 resource reservation까지 진입한 기록도 확인했다. 따라서 계정 역할 또는 자원 gate의 전 계정 공통 차단은 재현되지 않았다.
- 실제 원인: 현재 NAS에 Python 코드 노트가 있는 두 계정의 최신 저장본을 운영 worker로 각각 실행했고 둘 다 exit 0이었다. 최근 버전 이력의 실패는 입력 중인 `P`/`PRI`/`pri` 같은 미완성 식별자, 빈 코드, 또는 Python 노트에서 JavaScript의 `console` 식별자를 실행해 발생한 `NameError`였다. 이는 서버·계정 장애가 아니라 해당 실행 시점 코드 오류다.
- UX 관찰: frontend는 상단에 공통 문구 `Python 코드가 오류와 함께 종료되었습니다.`를 먼저 표시하고 실제 `NameError` 원인은 아래 stderr 영역에 둔다. 따라서 사용자가 계정 공통 장애로 오해하기 쉽다. 현재는 850ms autosave가 끝난 중간 입력본도 실행할 수 있어 입력을 잠시 멈춘 상태의 미완성 코드가 버전과 실행 대상이 될 수 있다.
- 현재 기능 경계: 이 실행기는 Jupyter의 지속 kernel이 아니라 저장된 Python 코드 노트 전체를 매번 새 컨테이너에서 한 번 실행한다. 기본 이미지는 Python 표준 라이브러리 중심이며 `numpy`/`pandas` 같은 추가 패키지, 네트워크, NAS 파일 mount, 셀 간 변수 유지가 없다. 해당 기능을 기대한 코드는 별도 오류가 정상적으로 발생한다.
- 결론·다음 안전 조치: 공통 backend 수정 근거는 현재 없다. 다음 개선 후보는 실행 전에 syntax/미완성 입력을 구분해 안내하고, `NameError`·`ModuleNotFoundError`·timeout·자원 제한을 사용자 문장으로 분류하며, 성공/실패와 stderr를 같은 상단 결과에 표시하는 UI다. 실제 사용자가 본 정확한 오류 문구가 위 이력과 다르면 그 문구와 시각으로 API 응답을 추가 추적한다.

## 2026-09-07 Python 오류 분류 개선 및 JavaScript 격리 실행 추가

- 요청 요지: 정상인 NAS를 Python 오류로 오해하지 않도록 원인을 명확히 표시하고, 기존 Python과 같은 수준의 JavaScript 코드 실행을 Note Studio와 AI 에이전트에 추가한다.
- 구현: `managedJavaScriptWorker`를 추가해 `node:22-alpine`에서 저장된 JavaScript 코드 노트를 일회성으로 실행한다. Python과 동일하게 Docker network none, non-root UID, read-only rootfs, cap-drop ALL, no-new-privileges, CPU 0.5 core, RAM/swap 256MiB, PID 64, 15초, 코드 128KiB, 출력 64KiB 제한을 강제한다. 호스트 경로·NAS 파일·인증정보를 mount 또는 전달하지 않는다.
- API·UI: `POST /api/note-studio/notes/:noteId/javascript/run`을 추가하고 Python/JavaScript 라우트를 공통 실행 경로로 묶었다. Note Studio의 JavaScript 코드 페이지에도 실행 버튼과 결과 창이 나오며, 빈 정상 출력은 `출력 없음 · 정상 종료`로 구분한다. SyntaxError, NameError/ReferenceError, 모듈 없음, timeout, 출력 초과, worker 장애를 분류해 사용자 코드 문제를 서버 오프라인으로 표현하지 않는다. Python에서 `console.log`를 쓰거나 JavaScript에서 `print`를 쓴 경우 올바른 출력 함수를 안내한다.
- AI 연결: `run_javascript_note`를 101번째 strict 도구로 등록했다. JavaScript 실행도 compute 위험 등급이며 `auto_all`에서도 별도 승인을 기다린다. 승인 후에는 저장 revision이 정확히 일치하는 JavaScript 코드 노트만 실제 제품 API로 실행한다.
- 런타임 준비: NAS에 공식 `node:22-alpine` 이미지를 받아 실행 준비를 마쳤다. 이 변경은 Python 환경을 대체하지 않으며 두 런타임은 독립 컨테이너다.
- 검증: 로컬 신규/관련 23/23, backend 전체 102 pass·5 환경 조건부 skip·0 fail, frontend production build와 react-pdf 9.2.1/PDF.js API+Worker 4.8.69 gate가 통과했다. NAS root 운영 조건에서는 실제 Python `print(6*7)`과 JavaScript `console.log(6*7)`이 각각 `42`와 exit 0을 반환했다. NAS backend 전체 104 pass·3 조건부 skip·0 fail, production build/PDF.js gate가 통과했다. 일반 SSH 사용자의 최초 probe는 Docker socket 권한 때문에 실패했지만 PM2 제품 프로세스는 root이므로 운영 실행 권한과 일치한다.
- 기능 경계: 이번 JavaScript 실행은 브라우저 DOM이나 지속 REPL/Jupyter가 아닌 Node.js CommonJS 일회성 실행이다. 외부 npm 패키지 설치, 네트워크, NAS 파일 접근, 프로세스 유지, 실행 간 변수 보존은 허용하지 않는다.
- 배포·운영: 코드 커밋 `5e82b17`을 GitHub와 NAS 활성 브랜치에 fast-forward했다. `main.173251bf.js`를 `/var/www/html`에 배포했고 build와 운영 파일 SHA-256이 일치하며 공개 HTML도 같은 bundle을 참조한다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared`는 active, PM2 `msp-backend`는 online/save, 내부 3030과 공개 HTTPS는 200, 무인증 JavaScript 실행 API는 401이다.
- 남은 확인: 로그인된 실제 Note Studio에서 JavaScript 코드 페이지의 버튼·결과 창·오류 문구를 마우스로 확인하는 육안 E2E만 남았다. 자동·운영 검증에서 기능 장애는 발견되지 않았다.

## 2026-09-07 Python 기본 패키지 런타임과 외부 패키지 안전 설계

- 사용자 요청: Python 관련 기본 패키지를 준비해 사용자가 바로 쓸 수 있게 하고, 기본 목록에 없는 외부 패키지를 가져오는 방식도 설계한다.
- 기본 런타임: 기존 stdlib 중심 `python:3.12-alpine` 직접 실행을 `msp-python-runtime:2026.09.07-1`로 교체했다. base image digest를 고정하고 wheel 전용 설치와 `pip check`를 거친 데이터·수치·그래프·이미지·문서·HTTP 파싱·유틸리티 직접 패키지 25개를 포함한다. NumPy, Pandas, SciPy, SymPy, scikit-learn, statsmodels, Matplotlib, Seaborn, Plotly, Pillow, openpyxl, XlsxWriter, python-docx, pypdf, ReportLab, requests, HTTPX, Beautiful Soup, lxml, dateutil, pytz, PyYAML, tqdm, regex, SQLAlchemy가 대상이다. 정확한 버전은 `backend/python-runtime/requirements.lock`과 서버 카탈로그가 기준이다.
- UI·API·AI: 로그인 전용 `GET /api/note-studio/python/runtime`을 추가했다. Python 코드 페이지의 `패키지` 화면은 설치된 버전과 import 이름, 실행 중 network·pip 차단을 함께 표시한다. AI에는 읽기 전용 `get_python_runtime` 도구를 추가해 현재 지원 범위를 추측하지 않고 조회한다. 전체 AI 카탈로그는 13개 영역 102개 도구다.
- 자원·보안: 실제 패키지 import를 고려해 Python 실행 예약을 RAM 512MiB·CPU 25%, 컨테이너 한도를 CPU 0.75로 조정했다. 기존 non-root, network none, read-only rootfs, cap-drop, no-new-privileges, PID 64, 15초, 코드·출력 제한과 사용자별 resource admission은 유지한다. PyTorch·TensorFlow·CUDA·브라우저·대형 LLM은 낮은 사양 NAS의 기본 이미지에 넣지 않는다.
- 외부 패키지 설계 경계: 실행 컨테이너 안의 `pip install`과 인터넷은 열지 않는다. 향후 노트북별 요청은 정규 PyPI 이름과 정확 버전만 받고 URL·Git·local path·private index·pip option을 거절한다. 별도 builder가 wheel only 다운로드, 전이 의존성 lock, SHA-256, 취약점·금지 목록, 압축/용량/시간 검사를 통과한 lock-hash 불변 이미지만 원자 활성화한다. 실패하면 기존 revision을 유지하며 같은 lock hash는 공유 cache를 쓰되 ACL·사용자 quota·queue·회수 정책을 둔다. 이 self-service는 설계만 완료했고 안전 경계 전체가 구현될 때까지 UI/API에 노출하지 않는다.
- 실제 검증: 로컬 backend 111개 중 105 pass·6 환경 조건부 skip·0 fail, frontend production build와 PDF.js API/Worker 4.8.69가 통과했다. NAS의 512MiB·network none·read-only 실제 컨테이너에서 직접 패키지 25/25 import, NumPy/Pandas 계산, SymPy, Matplotlib PNG 생성과 `pip check`가 성공했다. 제품 worker 통합 5/5, NAS 전체 backend 111개 중 107 pass·4 skip·0 fail이다. 운영 image ID는 `c92c720cc0ed`, 크기는 851,302,000 bytes다.
- 배포: 코드 commit `654ac31`을 GitHub와 NAS 활성 브랜치에 clean fast-forward했다. 운영 bundle은 `main.7af33d11.js`이며 build와 `/var/www/html`이 일치한다. `ssh`, `tailscaled`, `nginx`, `docker`, `pm2-root`, `cloudflared` active, PM2 `msp-backend` online/save, 내부 3030·공개 HTTPS 200, 무인증 runtime API 401이다.
- 기록·남은 확인: `docs/NAS_PROJECT_LOG.xlsx`, `docs/programs/NAS_NOTE_STUDIO_SPEC.xlsx`, `docs/PYTHON_PACKAGE_RUNTIME_DESIGN.md`에 구현·공급망 경계·시험·보류 상태를 남겼다. 로그인된 Note Studio에서 패키지 dialog를 누르는 육안 E2E와 외부 패키지 self-service 구현은 남아 있다.

## 2026-09-07 블록 노트 Tab 들여쓰기

- 사용자 요청: Note Studio의 블록 노트 본문에서 Tab을 눌렀을 때 웹 상단바나 다른 버튼으로 초점이 이동하지 않고 현재 내용이 들여쓰기되어야 한다.
- 원인: 기존 `handleKeyDown`은 `1.`, `-`, `[ ]`, 제목, 인용, 코드, 구분선 같은 특정 마커 뒤의 Tab만 처리했다. 일반 문장, 제목, 코드 블록, 목록과 Shift+Tab은 브라우저 기본 포커스 이동으로 빠졌다.
- 구현: Tiptap의 paragraph, heading, codeBlock에 영속 `indentLevel` 속성을 추가했다. 본문 안의 모든 Tab은 기본 동작을 차단한다. 일반 블록은 1.5rem씩 최대 8단계 들여쓰고 Shift+Tab은 한 단계 내어쓴다. ordered/bullet/task list는 단순 여백 대신 `sinkListItem`/`liftListItem`으로 실제 목록 구조를 중첩·해제한다.
- 호환성: 기존 마커+Tab 변환을 가장 먼저 처리해 `1.` 자동 번호 목록, `-` 목록, `[ ]` 할 일, 제목·인용·코드·구분선 단축키를 유지한다. 편집기 밖의 Tab 키는 접근성용 브라우저 포커스 이동을 그대로 사용한다. `indentLevel`은 노트 JSON에 저장되므로 기존 autosave와 재접속 복원의 대상이다.
- 검증·배포: 로컬과 NAS에서 Note command focused Jest 6/6, production build, react-pdf 9.2.1/PDF.js API+Worker 4.8.69 검사가 통과했다. 코드 커밋 `e64643d`를 GitHub와 NAS 활성 브랜치에 fast-forward했고 운영 build와 `/var/www/html`이 모두 `main.490657bd.js`다. 내부 3030과 공개 HTTPS는 200, nginx·docker·tailscaled·cloudflared는 active, PM2 `msp-backend`는 online이다.
- 기록·검증 경계: 마스터 로그와 Note Studio 전용 명세의 단축키, 데이터 모델, 시험, 구현 상태를 갱신하고 artifact-tool 재열기·수식 오류·문자 깨짐·렌더를 확인했다. 로그인 세션 없는 자동 검증에서는 실제 노트 caret의 육안 E2E를 수행하지 않았지만 키 처리, 저장 속성, 빌드와 운영 반영은 검증했다.

## 2026-09-07 AI 에이전트 채팅 메시지 복사

- 사용자 요청: AI 에이전트 채팅의 사용자·AI 메시지가 복사되지 않는 문제를 해결한다.
- 원인: `AiAgentPanel`의 메시지는 단순 텍스트 렌더링만 있었고 전체 메시지 복사 버튼이 없었다. `navigator.clipboard`가 보안 컨텍스트·브라우저 정책·권한 때문에 거절되는 환경을 위한 대체 경로도 없었다.
- 구현: 모든 사용자·AI 말풍선에 `메시지 복사` 버튼을 추가하고 본문에 `user-select: text`를 명시해 마우스 선택과 Ctrl+C를 허용했다. 버튼은 Clipboard API를 먼저 사용하고 실패하면 화면 밖 readonly textarea를 선택해 `execCommand('copy')`를 시도한다. 임시 요소는 성공·실패와 관계없이 `finally`에서 제거한다. 성공하면 버튼 안내가 `복사됨`으로 바뀌고 두 경로가 모두 실패하면 직접 선택·Ctrl+C 안내를 표시한다.
- 데이터 경계: 복사 대상은 화면에 표시된 메시지 문자열뿐이다. action 객체, 파일 내용, 인증정보, tool metadata를 추가로 포함하지 않는다.
- 검증·배포: 현대 Clipboard API 성공, 권한 거절 뒤 fallback, 복사 수단 없음의 3개 회귀와 기존 Note 단축키를 합쳐 로컬·NAS focused Jest 9/9가 통과했다. 양쪽 production build와 react-pdf 9.2.1/PDF.js API+Worker 4.8.69 gate도 통과했다. 코드 커밋 `3a50ecc`를 GitHub와 NAS 활성 브랜치에 fast-forward했고 운영 build와 `/var/www/html`은 `main.81e0fc06.js`로 일치한다. 내부 3030·공개 HTTPS는 200, nginx·docker·tailscaled·cloudflared는 active, PM2 `msp-backend`는 online이다.
- 검증 경계: 로그인 세션 없는 자동 브라우저에서는 OS 클립보드 내용을 육안 확인하지 못했다. 브라우저 API 두 경로와 DOM 정리, production compile, 운영 번들 반영은 자동 검증했다.
