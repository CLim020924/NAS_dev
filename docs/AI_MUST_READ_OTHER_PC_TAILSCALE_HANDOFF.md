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
