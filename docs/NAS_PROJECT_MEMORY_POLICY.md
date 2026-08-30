# NAS Project Memory Policy

이 문서는 `docs/NAS_PROJECT_LOG.xlsx`를 어떻게 읽고 갱신해야 하는지
정의합니다. 목적은 긴 대화 기록, 숨은 서버 설정, 기능 간 의존성 때문에
같은 장애를 반복하지 않도록 하는 것입니다.

## 가장 중요한 교훈

이번에 `NAS_PROJECT_LOG.xlsx`의 한국어가 모든 시트에서 `??`로 깨진 원인은
워크북 생성 과정에서 한국어 본문을 PowerShell 명령 문자열과 출력
리다이렉션 경로로 흘려보냈기 때문입니다.

앞으로는 다음 규칙을 지킵니다.

1. 한국어 본문은 UTF-8 `.mjs`, `.py`, `.md`, `.json` 파일에 작성합니다.
2. NAS에서 수집하는 데이터는 NAS 안에서 UTF-8 파일로 만들고 `scp`로
   가져옵니다.
3. PowerShell here-string, `echo`, `>`, `Out-File`을 한국어 본문 생성 경로로
   쓰지 않습니다.
4. 생성된 xlsx를 다시 열어 모든 문자열 셀을 검사합니다.
5. `??`, `????`, replacement character, mojibake 의심 패턴이 발견되면
   실패로 처리하고 배포하지 않습니다.

## Workbook Location

Primary repo copy:

```text
docs/NAS_PROJECT_LOG.xlsx
```

User workspace copy:

```text
C:\Users\CHANYOUNG\Desktop\NAS_DEVELOP\NAS_PROJECT_LOG.xlsx
```

Do not keep multiple workbook variants such as `FIXED`, `REBUILT`, or dated
copies in the working folder unless the user explicitly asks for an archive.
The normal state is one canonical workbook only:

```text
NAS_PROJECT_LOG.xlsx
```

## Workbook Sheet Roles

- `README`: 파일 목적, 작성 기준, 수집 규모, 사용 방법.
- `Memory_Process`: 작업 전/중/후에 반드시 따라야 하는 절차.
- `Do_Not_Break`: 깨면 안 되는 설정과 안전한 처리 방법.
- `Feature_Index`: 기능 ID, 상태, 현재 이해, 연결 영역.
- `Relation_Map`: 기능 간 의존성 및 영향 범위.
- `Code_Map`: 실제 코드/설정 파일과 기능 ID 연결.
- `API_Routes`: 실제 backend 코드에서 수집한 API 라우트.
- `Socket_Events`: 실제 socket.io 이벤트 맵.
- `Data_Files`: backend/data JSON 등 persisted state.
- `Network_Config`: Cloudflare, tunnel, DNS, IP, port, env 공개 설정.
- `Office_Viewers`: OnlyOffice/RHWP 연결과 알려진 주의사항.
- `Patch_Log`: 요청/문제/원인/해결/검증/잔여 위험 기록.
- `Request_Archive`: 사용자 요청 원문 기록.
- `Generated_Check`: workbook 생성 및 검증 근거.

## Required Start Procedure

코드, 설정, 배포, 네트워크, 문서화 작업을 시작하기 전 다음 문장을 말하고
실제로 확인합니다.

```text
프로젝트 메모리 확인하고 시작할게
```

확인 순서:

1. `docs/NAS_PROJECT_MEMORY_POLICY.md`
2. `docs/NAS_PROJECT_LOG.xlsx`의 `README`
3. `Memory_Process`
4. `Do_Not_Break`
5. `Feature_Index`
6. `Relation_Map`
7. 관련 기능별 `Code_Map`, `API_Routes`, `Socket_Events`, topic sheet

## Reading Strategy

모든 파일을 매번 읽는 것은 비효율적입니다. 반대로 관련 파일 하나만 읽으면
의존성을 놓칠 수 있습니다.

따라서 다음 방식으로 읽습니다.

1. 공통 제어 시트에서 위험 기능과 Feature ID를 찾습니다.
2. `Relation_Map`에서 연결된 기능을 확인합니다.
3. `Code_Map`에서 관련 파일 목록을 좁힙니다.
4. 변경 전에 `git status --short --branch`를 확인합니다.
5. 관련 파일을 읽고, 위험 기능이면 한 단계 더 확장합니다.

## Feature ID Expansion

기능이 커지면 하위 ID를 추가합니다. 기존 큰 ID 하나에 계속 덧붙이지
않습니다.

예시:

```text
MEET
MEET-MEDIA
MEET-MEDIA-CAMERA
MEET-MEDIA-SCREEN
MEET-CHAT
OFFICE
OFFICE-ONLYOFFICE
OFFICE-RHWP
NET
NET-CLOUDFLARE
NET-DNS-INTERNAL
```

새 하위 기능을 만들면 다음을 같이 갱신합니다.

1. `Feature_Index`
2. `Relation_Map`
3. `Code_Map`
4. 필요하면 `Do_Not_Break`
5. `Patch_Log`
6. `Request_Archive`

## Current High-Risk Anchors

### NET-CLOUDFLARE

최종적으로 확인된 정상 구조:

- `filemanager-nas.com`: Cloudflare Tunnel `nas`, proxied
- `www.filemanager-nas.com`: Cloudflare Tunnel `nas`, proxied
- `upload.filemanager-nas.com`: A `1.234.92.152`, DNS only

`filemanager/www`를 무심코 DNS-only A 레코드로 바꾸지 않습니다.

### NET-TUNNEL

정상 tunnel config:

```yaml
tunnel: 7a4aac79-e02c-45b8-82c9-49f519cb6ca3
credentials-file: /root/.cloudflared/7a4aac79-e02c-45b8-82c9-49f519cb6ca3.json

ingress:
  - hostname: filemanager-nas.com
    service: http://127.0.0.1:3030
  - hostname: www.filemanager-nas.com
    service: http://127.0.0.1:3030
  - service: http_status:404
```

같은 터널을 root systemd와 사용자 프로세스에서 동시에 실행하지 않습니다.
중복 실행은 리디렉션 루프와 접속 불량을 만들 수 있습니다.

### NET-DNS-INTERNAL

AdGuard DHCP로 집 전체 DHCP를 대체하는 접근은 이 네트워크에서 위험했습니다.
메인 라우터 DHCP를 끄기 전에는 반드시 현재 토폴로지와 복구 방법을 먼저
확인합니다.

### OFFICE-ONLYOFFICE

OnlyOffice 문제는 프론트만 보지 않습니다. 다음을 함께 확인합니다.

- Docker documentserver 상태
- private/meta IP 허용
- Nginx route/header
- backend signed file URL
- callback save endpoint
- 브라우저 콘솔 warning과 실제 저장 성공 여부

### MEET

화상회의는 독립 기능이 아닙니다. 항상 다음과 함께 봅니다.

- `CHAT`
- `AUTH-SESSION`
- `NOTI`
- `MEET-MEDIA`
- `NET`
- 같은 계정 다중 장치 표시/권한

### AI-AGENT

OpenAI API 키가 하나여도 AI는 계정별로 다른 에이전트처럼 동작해야 합니다.
파일 읽기/수정 권한은 서버에서 사용자별로 강제합니다. 키 값은 workbook이나
git에 기록하지 않습니다.

## Patch Recording Format

`Patch_Log` 한 행에는 다음 내용을 넣습니다.

- Patch ID
- 날짜
- 상태
- 사용자 요청 원문
- 문제/증상
- 원인
- 해결 방법
- 검증
- 다음 주의사항

사용자 요청 원문은 해석문보다 먼저 둡니다. 나중에 의도가 왜곡되는 것을
막기 위해서입니다.

## Status Values

- `완료`: 실제 구현과 검증이 끝남.
- `부분 확인`: 일부 구현/검증만 끝남.
- `확인 필요`: 서버, 장치, 브라우저 조건 때문에 아직 검증하지 못함.
- `문제 있음`: 알려진 오류가 남아 있음.
- `오해/교정`: 잘못된 판단이나 설정을 되돌리고 교훈을 남김.

검증하지 못한 작업을 `완료`라고 적지 않습니다.
