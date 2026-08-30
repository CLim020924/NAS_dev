# AI MUST READ: 다른 PC에서 NAS 프로젝트 이어가기

이 문서는 다른 Windows PC의 ChatGPT/Codex 앱에서 NAS 프로젝트를 이어갈 때
가장 먼저 읽어야 하는 연결·권한·작업 절차입니다. 문서에는 비밀번호, SSH
개인키, Tailscale 인증키, Agent token을 저장하지 않습니다.

## 1. 현재 연결 구조

확인일: 2026-08-30 (Asia/Seoul)

| 대상 | 장치 이름 | Tailscale 주소 | 역할 |
|---|---|---|---|
| 현재 노트북 | `limchanyoung` | `100.72.86.10` | 현재 Windows 개발·NAS Drive 검증 PC |
| Debian NAS | `chanyoung` | `100.80.39.112` | 실제 서비스와 Git 작업 트리가 있는 서버 |

- Tailnet 계정 표시: `dntdlzz40774072@gmail.com`
- NAS SSH 사용자: `limchanyoung`
- NAS SSH alias: `nas`
- NAS 실제 프로젝트: `/home/limchanyoung/my-service-platform`
- GitHub: `git@github.com:CLim020924/NAS_dev.git`
- 작업 브랜치: `cleanup/git-tracking-2026-06-08`
- 공개 사이트: `https://filemanager-nas.com`
- backend: `127.0.0.1:3030`, PM2 process `msp-backend`, systemd `pm2-root`

현재 노트북이 같은 Tailnet에 연결되어 있다는 사실은 연결 구조를 설명할 뿐,
새 PC에 접근 권한을 자동 복제하지 않습니다. 각 PC는 독립적으로 Tailscale에
로그인하고 독립 SSH 키를 사용해야 합니다.

## 2. 새 PC에서 한 번만 할 초기 설정

1. 새 PC에 Tailscale을 설치하고 위와 같은 Tailnet 계정으로 로그인합니다.
2. PowerShell에서 NAS가 보이는지 확인합니다.

   ```powershell
   tailscale ping 100.80.39.112
   Test-NetConnection 100.80.39.112 -Port 22
   ```

3. 새 PC 전용 SSH 키를 만듭니다. 기존 노트북의 개인키를 복사하지 않는 것을
   권장합니다.

   ```powershell
   ssh-keygen -t ed25519 -C "nas-chatgpt-new-pc"
   ```

4. 생성된 `.pub` 공개키만 기존에 접속 가능한 PC 또는 NAS 관리 절차를 통해
   `/home/limchanyoung/.ssh/authorized_keys`에 추가합니다. 개인키는 Git, 채팅,
   릴레이, Excel에 절대 붙이지 않습니다.
5. 새 PC의 `%USERPROFILE%\.ssh\config`에 다음 alias를 추가합니다.

   ```sshconfig
   Host nas
       HostName 100.80.39.112
       User limchanyoung
       IdentityFile ~/.ssh/id_ed25519
       IdentitiesOnly yes
   ```

6. 다음 명령이 암호 오류 없이 현재 사용자를 출력하는지 확인합니다.

   ```powershell
   ssh nas "whoami && hostname"
   ```

정상 결과의 핵심은 `limchanyoung`과 `chanyoung`입니다. 연결이 안 되면 코드를
수정하지 말고 Tailscale 로그인, ACL, NAS 전원, `ssh` 서비스, 새 PC 공개키
등록 순서로 확인합니다.

## 3. ChatGPT/Codex 앱이 프로젝트를 여는 방법

새 대화에서 앱에 다음 내용을 전달합니다.

```text
프로젝트 메모리 확인하고 시작할게 라고 먼저 말한 뒤,
NAS의 /home/limchanyoung/my-service-platform에서 작업해.
AGENTS.md, AI_MUST_READ_PROJECT_RELAY.md,
docs/AI_MUST_READ_OTHER_PC_TAILSCALE_HANDOFF.md,
docs/NAS_PROJECT_MEMORY_POLICY.md, docs/NAS_PROJECT_LOG.xlsx를 먼저 읽고
git status --short --branch를 확인해. 기존 변경은 되돌리지 마.
```

ChatGPT/Codex 앱이 로컬 프로젝트 폴더를 요구하면 GitHub 저장소를 별도 폴더에
clone할 수 있습니다. 그러나 실제 실행·배포 상태의 기준은 NAS의 위 경로입니다.
로컬 clone과 NAS 작업 트리를 같은 폴더라고 가정하지 않습니다.

```powershell
git clone --branch cleanup/git-tracking-2026-06-08 git@github.com:CLim020924/NAS_dev.git
```

## 4. 매 작업의 필수 순서

1. `ssh nas` 연결 확인
2. NAS 프로젝트에서 `git status --short --branch`
3. `AGENTS.md`와 두 AI 릴레이 문서 확인
4. `docs/NAS_PROJECT_LOG.xlsx`의 `Do_Not_Break`와 관련 시트 확인
5. 관련 코드 구조를 읽은 뒤 수정
6. 최소 단위 테스트·빌드·서비스 상태·HTTP 확인
7. 요청 요지, 진행 내용, 검증, 미완료를 `AI_MUST_READ_PROJECT_RELAY.md`에 기록
8. 기능 변경이면 프로젝트 Excel 관련 시트도 갱신
9. 비밀값 검사 후 같은 브랜치에 commit/push

## 5. 절대 하지 않을 것

- `git reset --hard`, 기존 변경의 임의 checkout/revert
- Tailscale auth key, SSH 개인키, 계정 비밀번호, DPAPI token을 Git에 저장
- SSH 연결이 안 된다는 이유로 Cloudflare/DNS/nginx 구성을 변경
- NAS Drive 개인 드라이브와 일반 folder-sync 경계를 합침
- Office/HWP와 무관한 작업에서 OnlyOffice proxy 또는 HWP render 구조 변경
- 다른 PC의 로컬 경로를 NAS 사용자 root 또는 서버 권한 근거로 사용

## 6. 빠른 상태 점검

```powershell
ssh nas "cd /home/limchanyoung/my-service-platform && git status --short --branch"
ssh nas "sudo pm2 status msp-backend --no-color"
ssh nas "systemctl is-active ssh tailscaled nginx docker pm2-root cloudflared"
curl.exe -ksS -o NUL -w "%{http_code}`n" https://filemanager-nas.com
```

정상 기준은 작업 브랜치가 `cleanup/git-tracking-2026-06-08`, backend가 online,
필수 서비스가 active, 공개 사이트가 HTTP 200인 상태입니다.

## 7. 장애 시 판단 기준

- Tailscale ping 실패: 새 PC Tailnet 로그인·ACL·NAS 전원을 먼저 확인합니다.
- Tailscale은 되지만 SSH 실패: NAS `ssh` 서비스와 새 PC 공개키 등록을 확인합니다.
- SSH는 되지만 사이트 실패: PM2, nginx, cloudflared 순서로 확인합니다.
- 공개 사이트만 되고 SSH가 실패: Cloudflare가 사이트를 제공하는 것과 Tailscale
  SSH 접근은 별개입니다. DNS를 바꾸지 않습니다.
- 새 PC에서 Git만 보임: GitHub에는 코드와 기록이 있지만 live runtime/state는
  NAS에 있습니다. 실제 검증은 `ssh nas`를 통해 수행합니다.

## 8. 문서 갱신 규칙

장치 이름, Tailscale IP, Tailnet, SSH 사용자, 프로젝트 경로, 브랜치가 바뀌면
이 문서와 `AI_MUST_READ_PROJECT_RELAY.md`, `docs/NAS_PROJECT_LOG.xlsx`의 관련
Network/Code 항목을 같은 작업에서 갱신합니다. 비밀정보는 변경 전후 모두
기록하지 않습니다.

## 9. 새 PC ChatGPT/Codex에 그대로 붙여 넣을 시작 프롬프트

아래 프롬프트는 설치 가능한 도구를 직접 확인하고, Tailscale과 OpenSSH를
설치·구성·검증한 뒤 NAS 프로젝트를 여는 절차입니다. UAC와 Tailscale 웹
로그인, 새 SSH 공개키 등록처럼 사용자의 보안 승인이 필요한 화면은 숨기거나
우회하지 말고 사용자에게 한 번만 명확히 요청해야 합니다.

```text
너는 내 Debian NAS 프로젝트를 이어서 작업하는 Codex다.

가장 먼저 정확히 다음 문장을 말해:
“프로젝트 메모리 확인하고 시작할게.”

목표는 이 Windows PC를 내 Tailscale 네트워크에 안전하게 연결하고,
SSH alias `nas`로 Debian NAS에 접속한 뒤 기존 프로젝트 메모리를 읽어
작업 가능한 상태까지 스스로 구성하는 것이다. 설명만 하지 말고 가능한
설치·확인·설정 작업을 직접 수행하라.

확인된 환경:
- Tailscale 계정 표시: dntdlzz40774072@gmail.com
- 기존 검증 노트북: limchanyoung / Tailscale 100.72.86.10
- Debian NAS: chanyoung / Tailscale 100.80.39.112
- NAS SSH 사용자: limchanyoung
- SSH alias: nas
- NAS 프로젝트: /home/limchanyoung/my-service-platform
- GitHub: git@github.com:CLim020924/NAS_dev.git
- 작업 브랜치: cleanup/git-tracking-2026-06-08
- 공개 사이트: https://filemanager-nas.com

보안 원칙:
- 비밀번호, Tailscale auth key, SSH 개인키, Agent/DPAPI token을 채팅,
  로그, 릴레이, Excel, Git에 출력하거나 저장하지 마라.
- 기존 노트북의 SSH 개인키를 복사하지 말고 이 PC 전용 ed25519 키를 생성하라.
- UAC, Tailscale 계정 로그인, NAS 공개키 등록처럼 보안 승인이 필요한 순간만
  사용자에게 짧고 명확하게 요청하고, 승인 후 즉시 계속 진행하라.
- 인증 화면을 우회하거나 임의 계정으로 로그인하지 마라.
- git reset --hard, 기존 변경 checkout/revert 같은 파괴적 명령을 쓰지 마라.

다음 순서로 진행하라:

1. 현재 Windows 버전, 관리자 권한 여부, winget, Tailscale, OpenSSH Client,
   Git 설치 여부를 읽기 전용으로 확인하라.
2. Tailscale이 없으면 공식 Windows 패키지를 winget으로 설치하라.
   우선 명령은 `winget install --id Tailscale.Tailscale --exact`다.
   winget이 없으면 Tailscale 공식 배포 경로만 사용하고 출처를 확인하라.
3. Tailscale 서비스를 시작하고 앱을 열어 위 Tailnet 계정으로 로그인하게 하라.
   브라우저 로그인/UAC가 뜨면 사용자가 완료해야 할 행동을 한 문장으로 알려주고
   기다린 뒤, 완료되면 자동으로 검증을 계속하라.
4. `tailscale status`와 `tailscale ping 100.80.39.112`를 실행해 같은 Tailnet과
   NAS 도달 여부를 확인하라. 연결 실패 시 코드를 건드리지 말고 로그인 상태,
   NAS 전원, Tailnet/ACL 순서로 진단하라.
5. Windows OpenSSH Client가 없으면 Windows Optional Capability 또는 공식
   Windows 기능으로 설치하라. Git도 없으면 `winget install --id Git.Git --exact`
   로 설치하라.
6. `%USERPROFILE%\.ssh\id_ed25519`이 없으면 이 PC 전용 키를 생성하라:
   `ssh-keygen -t ed25519 -C "nas-chatgpt-new-pc"`.
   기존 키가 있으면 덮어쓰지 말고 그대로 사용할지 확인하라.
7. 공개키 내용만 표시하거나 클립보드에 준비하고, NAS
   `/home/limchanyoung/.ssh/authorized_keys`에 등록해야 한다고 알려라.
   이미 신뢰된 다른 접속 수단이 있으면 공개키만 안전하게 추가하고 권한을
   `.ssh=700`, `authorized_keys=600`으로 유지하라. 신뢰된 접속 수단이 없으면
   사용자가 NAS 또는 기존 PC에서 공개키를 등록할 때까지 기다려라.
8. `%USERPROFILE%\.ssh\config`를 읽고 기존 항목을 보존한 채 다음 Host가 없을
   때만 추가하라:
   Host nas
       HostName 100.80.39.112
       User limchanyoung
       IdentityFile ~/.ssh/id_ed25519
       IdentitiesOnly yes
9. `ssh nas "whoami && hostname"`을 실행해 `limchanyoung`, `chanyoung`을
   확인하라. 처음 host fingerprint가 나오면 실제 대상 IP가 100.80.39.112인지
   확인한 뒤 사용자에게 승인을 요청하라. 검증을 끄지 마라.
10. SSH 성공 후 NAS에서 다음을 수행하라:
    `cd /home/limchanyoung/my-service-platform`
    `git status --short --branch`
    `git branch --show-current`
    기존 변경을 절대 되돌리지 마라.
11. 반드시 다음 파일을 순서대로 읽어라:
    - AGENTS.md
    - AI_MUST_READ_PROJECT_RELAY.md
    - docs/AI_MUST_READ_OTHER_PC_TAILSCALE_HANDOFF.md
    - docs/NAS_PROJECT_MEMORY_POLICY.md
    - docs/NAS_PROJECT_LOG.xlsx의 README, Memory_Process, Do_Not_Break,
      Feature_Index, Relation_Map 및 현재 요청 관련 시트
12. 서비스 상태를 읽기 전용으로 확인하라:
    ssh, tailscaled, nginx, docker, pm2-root, cloudflared가 enabled+active인지,
    sudo pm2 status에서 msp-backend가 online인지,
    http://127.0.0.1:3030과 https://filemanager-nas.com이 200인지 확인하라.
13. 모두 끝나면 다음만 간결하게 보고하라:
    - 이 PC의 Tailscale 장치명/IP
    - NAS ping/SSH 성공 여부
    - Git branch와 clean/dirty 상태
    - 필수 서비스 상태
    - 읽은 프로젝트 메모리 파일
    - 사용자가 직접 처리해야 하는 남은 항목
14. 매 요청마다 비밀을 제거한 요청 요지, 진행 내용, 검증, 미완료, 다음 조치를
    AI_MUST_READ_PROJECT_RELAY.md에 기록하고 활성 브랜치에 commit/push하라.
    기능 변경이면 docs/NAS_PROJECT_LOG.xlsx 관련 시트도 갱신하라.

중요: 공개 사이트가 열린다는 이유로 Tailscale/SSH 연결도 정상이라고 추정하지
말고 각각 실제 명령으로 확인하라. Cloudflare/DNS/nginx/OnlyOffice/HWP 설정은
현재 연결 작업과 무관하므로 변경하지 마라.
```
