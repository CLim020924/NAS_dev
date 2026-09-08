# Note Studio의 VS Code 탐색기·확장 기능 적용 기준

확인일: 2026-09-08

## 조사 목적

Note Studio의 노트북·페이지·실제 파일 트리와 개발 도구 검색을 VS Code처럼
익숙하게 만들되, VS Code의 화면을 그대로 복제하거나 외부 확장을 NAS에서
무검증 실행하지 않는다. 현재 프로젝트의 계정별 `NOTE MANAGER` 경계, Docker
실행 격리, 실행 큐와 노트/프로젝트 구분을 유지하는 것이 우선이다.

## VS Code가 실제로 나누는 대상

VS Code의 Explorer는 하나의 메뉴를 모든 항목에 붙이지 않는다. 선택 대상이
폴더인지 파일인지, 워크스페이스 루트인지, 쓰기 가능한지, 비교 대상으로 이미
선택됐는지에 따라 메뉴의 표시와 활성 상태를 바꾼다. 기본 Explorer 메뉴의
배치 순서는 다음 성격의 그룹으로 구성된다.

1. 탐색과 생성: 새 파일, 새 폴더, 옆에서 열기, 연결 프로그램으로 열기
2. 워크스페이스: 루트 폴더 추가·제거
3. 비교: 비교 대상으로 선택, 선택한 파일과 비교
4. 편집: 잘라내기, 복사, 붙여넣기
5. 가져오기·내보내기: 웹 환경의 업로드·다운로드
6. 경로: 절대 경로 복사, 상대 경로 복사
7. 변경: 이름 바꾸기, 휴지통 이동 또는 영구 삭제

확장 Tree View도 같은 원칙을 쓴다. 자주 쓰는 동작은 항목 오른쪽 inline action,
나머지는 우클릭 메뉴에 둔다. 공식 UX 지침은 한 항목에 inline action을 세 개
넘게 두지 않고, 대상에 맞지 않는 명령을 모든 항목에 노출하지 말며, 큰 명령
묶음은 하위 메뉴로 정리하도록 권한다.

## Note Studio에 대응시키는 방법

Note Studio에는 서로 다른 세 종류의 트리가 있으므로 메뉴도 분리한다.

| 대상 | 한 번 클릭 | 더블 클릭 | inline action | 우클릭 핵심 |
| --- | --- | --- | --- | --- |
| 노트북 | 노트북 선택 | 전용 터미널 열기 | 새 페이지, 더보기 | 열기, 접기, 새 페이지, 터미널, NAS에서 열기, 개발 도구, 이름 변경, 경로 복사 |
| 페이지 | 페이지 열기 | 페이지 열기 | 하위 페이지, 더보기 | 열기, 접기, 하위 페이지, 이름 변경, 경로 복사, 휴지통 |
| 실제 폴더·파일 | 선택·폴더 접기 또는 파일 열기 | 폴더를 NAS 파일관리자로 열기 | 더보기 | 새 파일·폴더, 이름 변경, 경로 복사, 휴지통 |

노트북 inline action은 두 개만 둔다. 새 페이지와 더보기다. 터미널·개발 도구는
프로젝트형 노트북에만 의미가 있으므로 우클릭 메뉴에서 조건부로 노출한다.
F2는 현재 포커스된 노트북 또는 페이지 이름 변경에 사용한다.

노트북의 표시 이름 변경과 실제 폴더 이름 변경은 분리한다. 표시 이름 변경은
코드의 고정 경로, 외부 IDE 설정과 PC 동기화 경로를 깨지 않는다. 실제 폴더
이동은 모든 페이지의 물리 경로와 연결 문서, 실행 세션을 원자적으로 갱신할 수
있는 별도 이동 작업으로만 제공한다.

## VS Code 확장 검색과 실행 구조

VS Code의 Extensions View는 검색 입력, 설치됨, 권장, 업데이트, 비활성 상태를
필터로 나눈다. 확장은 `publisher.extension` ID로 식별하며 워크스페이스 권장은
프로젝트의 `.vscode/extensions.json`에 저장한다. 권장은 자동 설치가 아니라,
워크스페이스를 연 사용자가 검토하고 설치하도록 알려주는 선언이다.

확장이 실행되는 위치도 나뉜다.

- UI extension: 사용자 화면 가까이에서 실행
- workspace extension: 프로젝트 파일과 도구가 있는 위치에서 실행
- web extension: 브라우저 WebWorker에서 실행하며 `browser` 진입점 사용
- declarative extension: 테마·문법·snippet처럼 실행 코드 없이 기여점만 제공

따라서 Monaco를 사용하는 Note Studio가 임의 VSIX를 곧바로 실행하는 것은 VS
Code와 같은 동작이 아니다. Node 기반 확장에는 VS Code Extension Host와
`vscode.*` API가 필요하고, 웹 확장도 VS Code가 제공하는 브라우저 Extension
Host가 필요하다.

## NAS에 적용할 1차 범위

1. 공개 Open VSX Registry를 서버 프록시로 검색한다. 브라우저가 외부 Registry에
   직접 연결하거나 인증정보를 전달하지 않는다.
2. 검색 결과에는 확장 ID, 버전, 게시자 검증 여부, 다운로드 수, 설명과 실행 위치
   정보를 표시한다.
3. 프로젝트형 노트북은 선택한 확장 ID를 해당 폴더의
   `.vscode/extensions.json` 권장 목록에 추가·제거할 수 있다. 이 파일이 PC로
   동기화되면 VS Code의 표준 워크스페이스 권장 기능이 그대로 작동한다.
4. `NAS에서 실행`은 별도 호환 어댑터가 검증된 항목에만 제공한다. 일반 VSIX
   검색 결과에는 이 버튼을 표시하지 않는다.
5. Open VSX 응답은 시간 제한·크기 제한·결과 개수 제한·캐시를 적용하고, 외부
   URL을 서버가 임의로 따라가 실행하거나 VSIX를 설치하지 않는다.

## 다음 호환 계층

NAS 자체 자동완성·진단은 VSIX 실행보다 Language Server Protocol 연결을 우선한다.
언어 서버는 별도 프로세스에서 동작하고 autocomplete, diagnostics, hover,
definition, references, rename, formatting 같은 기능을 표준 프로토콜로 제공한다.
현재 NAS의 사용자별 자원 제한과 실행 큐를 언어 서버 수명주기에도 적용해야 한다.

웹 호환 테마·문법·snippet은 이후 manifest와 라이선스를 검사해 제한적으로
가져올 수 있다. debugger, task, terminal, Node workspace extension은 임의 실행
권한이 크므로 워크스페이스 신뢰, 관리자 승인, 고정 버전·해시, 별도 컨테이너와
rollback이 준비되기 전에는 실행하지 않는다.

## 보안 기준

- Registry 검색 결과와 검증 배지는 신뢰의 전부가 아니다.
- 타이포스쿼팅, 폐기·미검증 게시자, 라이선스, 고정 버전과 해시를 별도로 본다.
- 프로젝트를 처음 받았다고 terminal, task, debugger, AI agent, extension을 자동
  실행하지 않는다.
- 일반 사용자가 선택한 확장이 NAS host, 다른 계정, Docker socket, 환경변수,
  Tailscale 또는 내부 서비스에 접근하지 못하게 한다.
- `.vscode/extensions.json`이 손상됐으면 덮어쓰지 않고 오류를 보여준다.

## 공식 근거

- VS Code Contribution Points: https://code.visualstudio.com/api/references/contribution-points
- VS Code Tree View API: https://code.visualstudio.com/api/extension-guides/tree-view
- VS Code Context Menu UX: https://code.visualstudio.com/api/ux-guidelines/context-menus
- VS Code Views UX: https://code.visualstudio.com/api/ux-guidelines/views
- VS Code Extension Marketplace: https://code.visualstudio.com/docs/configure/extensions/extension-marketplace
- VS Code Extension Host: https://code.visualstudio.com/api/advanced-topics/extension-host
- VS Code Web Extensions: https://code.visualstudio.com/api/extension-guides/web-extensions
- VS Code Language Server: https://code.visualstudio.com/api/language-extensions/language-server-extension-guide
- VS Code Workspace Trust: https://code.visualstudio.com/docs/editing/workspaces/workspace-trust
- VS Code Explorer menu source: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/files/browser/fileActions.contribution.ts
- Open VSX Registry API: https://github.com/eclipse-openvsx/openvsx/wiki/Registry-API
