# AI Connection Bootstrap

이 파일은 다른 Windows PC나 새 ChatGPT/Codex 대화가 NAS 연결 기준을 Git
최상단에서 즉시 찾기 위한 비밀정보 없는 연결 인덱스입니다. 연결 권한을
부여하는 파일이 아니며, 날짜가 적힌 상태는 반드시 다시 확인해야 합니다.

## 고정 식별 정보

| 항목 | 값 |
|---|---|
| NAS 장치 이름 | `chanyoung` |
| NAS Tailscale IP | `100.80.39.112` |
| 같은 LAN 안의 NAS IP | `192.168.45.30` |
| SSH 사용자 | `limchanyoung` |
| 권장 SSH alias | `nas` |
| NAS live 프로젝트 | `/home/limchanyoung/my-service-platform` |
| GitHub 저장소 | `CLim020924/NAS_dev` |
| 작업 브랜치 | `cleanup/git-tracking-2026-06-08` |
| 공개 서비스 | `https://filemanager-nas.com` |

공개 사이트가 열린다는 사실은 Tailscale 또는 SSH가 정상이라는 증거가
아닙니다. 세 경로를 각각 검사합니다.

## 접속 판단 순서

PowerShell에서 다음 순서로 현재 상태를 확인합니다.

```powershell
tailscale status
tailscale ping 100.80.39.112
Test-NetConnection 100.80.39.112 -Port 22
ssh -o BatchMode=yes -o ConnectTimeout=8 nas "whoami && hostname"
```

정상 SSH 결과는 `limchanyoung`과 `chanyoung`입니다. Tailscale 경로가
실패하고 현재 PC가 NAS와 같은 사설망에 있을 때만 다음 LAN 대체 경로를
사용할 수 있습니다.

```powershell
ssh -o BatchMode=yes -o ConnectTimeout=8 `
  -o HostKeyAlias=100.80.39.112 `
  limchanyoung@192.168.45.30 "whoami && hostname"
```

`HostKeyAlias`를 생략해 새 장치인 것처럼 신뢰하거나 host key 검증을 끄지
않습니다. LAN 주소는 외부 PC에서 사용할 수 없으며, NAS의 Tailscale 상태를
복구하는 대체 수단이지 영구 기본 경로가 아닙니다.

## 2026-10-16 상태 스냅샷

- 이 Windows PC: `chan`, Tailscale `100.88.246.29`
- NAS의 Tailscale 항목: `offline, last seen 35d ago`
- `tailscale ping 100.80.39.112`: `peer's node key has expired`
- Tailscale IP의 TCP 22: 실패
- 같은 LAN의 `192.168.45.30` SSH: 성공
- LAN SSH 확인값: 사용자 `limchanyoung`, 호스트 `chanyoung`, 브랜치
  `cleanup/git-tracking-2026-06-08`, clean worktree

이 상태는 이후 부팅·재인증·키 갱신으로 바뀔 수 있습니다. 새 작업은 위 명령을
다시 실행하고 실제 결과를 기준으로 판단합니다.

## 새 PC의 권한 준비

1. 같은 Tailnet에 로그인합니다.
2. PC마다 별도 ed25519 키를 만들고 공개키만 NAS의
   `/home/limchanyoung/.ssh/authorized_keys`에 등록합니다.
3. 개인키를 다른 PC에서 복사하지 않습니다.
4. `%USERPROFILE%\.ssh\config`의 `nas` alias가 Tailscale IP와 위 SSH 사용자를
   가리키는지 확인합니다.
5. UAC, Tailscale 로그인, 최초 host fingerprint, 공개키 등록은 사용자가 직접
   확인해야 하는 보안 경계입니다.

상세 초기 설정과 장애 분류는
`docs/AI_MUST_READ_OTHER_PC_TAILSCALE_HANDOFF.md`를 따릅니다.

## 비밀정보 저장 금지

Git 저장소가 비공개여도 다음 값은 저장하지 않습니다.

- 계정 비밀번호
- SSH 개인키 또는 개인키 본문
- Tailscale auth key와 recovery key
- API key, 쿠키, 세션 URL, Agent/DPAPI token

Git 기록은 복제·백업·로그에 오래 남아 삭제가 어렵습니다. 인증 정보는 Windows
자격 증명 저장소, SSH 키 파일, Tailscale 클라이언트처럼 해당 도구가 관리하는
보안 저장소에 둡니다.

## 이 PC에만 둘 수 있는 보조 메모

장치별 alias나 설치 경로가 필요하면 `AI_CONNECTION_LOCAL.example.md`를 복사해
`AI_CONNECTION_LOCAL.private.md`로 만들 수 있습니다. 해당 이름은 `.gitignore`에
등록되어 Git에 올라가지 않습니다. 이 로컬 파일에도 비밀번호·개인키·token은
넣지 않습니다. Git에 올라가지 않으므로 다른 PC나 다른 ChatGPT가 자동으로
읽을 수 없다는 점도 전제로 합니다.

## 새 대화의 시작 순서

1. 이 파일을 읽습니다.
2. 현재 연결 상태를 직접 검사합니다.
3. `AGENTS.md`의 필독 순서대로 릴레이와 프로젝트 기록표를 읽습니다.
4. NAS live worktree의 branch와 dirty 상태를 확인한 뒤에만 수정합니다.
5. 연결 정보가 바뀌면 이 파일, 상세 handoff, relay, workbook을 함께 갱신합니다.
