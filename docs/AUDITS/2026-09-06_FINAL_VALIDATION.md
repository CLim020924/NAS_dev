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
| 저장공간·20GiB | 운영 전환·22계정 검증 완료 | 신규 기본 20GiB, 정책 v2 1회 이관, 실제 사용량 초과 계정 보호, 관리자 개인 root, 전체/할당/실사용/추가 할당 가능 표시 | 향후 정책 변경 때 실제 사용량 강제 재측정과 capacity ledger 회귀 유지 |
| 시스템 디스크 1TiB 확장 | 설계만 완료 | 물리 디스크와 역할·용량 기록, project quota+volume registry 방향 | ext4 project quota, 보조 volume registry, 배치·장애·백업 정책, 관리자 확장 UI, 재부팅 검증 |
| 서버 설정·자원 보호 | 모니터링·admission·Python 격리 강제 완료 | CPU/RAM/swap/load/온도/디스크, 자동/수동 안전선, 이력, 사용자별 예약량, 문서 queue/block, Python Docker CPU/RAM/PID/time/output/network 제한 | 전력·팬은 센서가 없어 표시하지 않음. 장기 kernel과 GPU/CUDA 권한은 아직 열지 않음 |
| Note Studio 물리 기반 | M1 상호작용·본문 링크 운영 배포 완료 | NOTE MANAGER, 노트북/하위 페이지 실제 폴더, 4종 편집, caret `/`, Tab 확정 목록·제목·인용·코드·구분선, 체크박스, 버전·휴지통·검색, 하위 페이지/Office 본문 링크, 외부 rename 링크 복구 | 댓글·멘션, 블록 drag, breadcrumb, rich media/database, Yjs 협업/offline은 후속 제품 단계 |
| Python 혼합 페이지 | 안전한 1회 실행 1차 완료 | 저장된 Python 코드 노트를 non-root·network none·read-only Docker에서 CPU 0.5/RAM 256MiB/PID 64/15초/출력 64KB로 실행하고 자원 admission·정리를 적용 | 지속 kernel, 셀 단위 `.ipynb`, interrupt/restart, 제한 파일 mount, 패키지 정책, MASTER 고부하 권한 UI |
| 프로젝트 경로 이동 보조 | 2차 구현·자동 검증 완료, 새 Windows E2E 필요 | VS Code/JetBrains portable adapter, 사전검증, transaction rollback/undo, BOM·placeholder·비밀 경계 | 완전 hydration marker와 자동 알림, 새 PC의 CFAPI/파일 선택/UI/단축키 실제 시험 |
| 문서 변환·작업대 연동 | 핵심·Note 연결 운영 완료 | 형식 선택, 변환/합치기/일괄 생성, 페이지/선택 NAS 위치 Office 생성, 본문 링크, 플랫폼 이동 transaction, 외부 같은 파일시스템 rename 식별자 복구 | 외부 프로그램의 cross-filesystem 복사+원본 삭제는 식별자가 바뀌므로 명시적 재연결 필요 |
| 실행형 AI 에이전트 | 핵심 실행·durable 승인·노트 도구 완료 | 단일 대화, 파일/친구/채팅/노트/Office/Python 도구, strict schema, 4단계 승인, exact-call 재개·중단 복구, 최신 사용자 의도 결속, immutable UID, 일일 token 사전 예산, 이전 응답 구분 | streaming, 내용 의미 검색/citation, 관리자 설정 변경, 문서 변환 작업 생성은 후속 확장. OpenAI 실호출 E2E는 비용 보호 때문에 미실시 |

## 이번 최종 점검에서 발견해 즉시 보강한 AI 결함

1. `.env`, `.git`, `.ssh`, private key/certificate, 내부 휴지통·백업 경로를 모델이 직접 지정해 읽거나 변경할 수 있던 범위를 서버에서 차단했다.
2. 모델이 깨진 JSON 도구 인자를 반환하면 빈 객체로 실행될 수 있던 경로를 fail-closed로 바꿨다. 이제 도구는 호출되지 않고 모델에 오류 결과만 돌아간다.
3. 날짜별 정리는 승인 화면을 띄운 뒤 파일이 바뀌거나 새 대상이 생길 수 있었다. 승인 시 source/destination/size/mtime을 최대 500개 snapshot하고 실행 직전 전부 재검사하며 한 건이라도 다르면 0건 실행한다.
4. AI·내부 NAS API에 timeout을 추가했다. 시간 초과 요청은 자동 재전송하지 않아 중복 작업과 불필요한 과금을 피한다.
5. action JSON은 0600 임시 파일에 기록한 뒤 rename하는 원자 교체로 바꿨다.
6. 회의 대화 요약을 위해 별도 OpenAI 요청을 보내면서 사용량 원장에 빠지던 경로를 제거했다. 필요한 회의 문맥은 같은 계산 요청 안에서 제한된 길이로만 보낸다.
7. 승인 카드에 대상 사용자·원본·목적지·메시지·내용·날짜 정리 preview를 표시해 사용자가 무엇을 승인하는지 볼 수 있게 했다.

## AI 위험 항목의 2026-09-07 재판정

- exact-call 승인/거절 후 같은 run 재개, stale run/action 복구, 외부 대상 UID 고정, 최신 사용자 변경 의도 결속, 신뢰하지 않는 도구 결과 뒤 재승인, 입력 추정량을 반영한 출력 예산은 구현됐다.
- Python 실행은 `auto_all`에서도 자동 실행하지 않고 별도 승인하며 전용 격리 worker만 사용한다.
- AI 대화 원장은 최대 보존량이 있으며 플랫폼 일반 채팅과 별도다. “모든 과거 대화”라고 표현하면 안 되고 보존 범위를 UI에 명시해야 한다.
- 파일 이름 검색만 가능하며 내용 의미 검색/RAG와 결과 citation은 없다.

## 검증 결과

- 로컬 backend: 67 tests 중 Linux 전용 문서 2개만 환경 skip, 나머지 통과, 0 fail
- AI 보강 단위: sensitive path 차단, 승인 후 파일 변경 거부, malformed arguments fail-closed 포함 7/7 pass
- 실제 OpenAI 과금 호출: 0회. 모든 agent loop 시험은 mock fetch 사용
- NAS 실장비: 67/67 pass로 LibreOffice 변환, 링크 복구, Python 격리까지 성공했다. production build와 PDF.js API/Worker 4.8.69 검증을 통과해 `main.003d533b.js`를 운영 정적 경로에 반영했다.
- 운영 서비스: `msp-backend` online/save, ssh·tailscaled·nginx·docker·pm2-root·cloudflared active, 내부·공개 HTTP 200, 무인증 AI history 401이다.
- 운영 화면: 로그인된 Chrome을 새 bundle로 새로고침해 플랫폼과 Note Studio 창의 새 노트북/새 페이지/가져오기 진입점을 실제 DOM에서 확인했다. AI는 여러 작업 탭을 제거한 단일 대화와 접이식 설정 구조다. 승인 작업·시험 노트 데이터는 만들지 않았고 과금 호출도 하지 않았다.
- Windows 로컬 production build: 소스 오류가 아니라 현재 작업 폴더의 npm/pnpm 중복 eslint plugin 때문에 실패. 운영 NAS의 Linux 의존성으로 build/PDF.js 검증을 다시 수행한다.

## 다음 구현 권장 순서

1. 시스템 디스크 보조 볼륨의 project quota/registry/재부팅 복구를 별도 유지보수 창에서 구축
2. 전용 테스트 계정/복제 데이터로 Windows 신규 PC·업데이트·재부팅·다중 계정 장시간 E2E
3. 공인 코드 서명 인증서를 확보해 설치·업데이트 서명 gate 검증
4. Note Studio 댓글·멘션·협업/offline과 `.ipynb` 지속 kernel을 각각 독립 단계로 구현
5. AI streaming·의미 검색/citation·관리자 설정/문서 변환 도구를 비용·권한 감사와 함께 확장
