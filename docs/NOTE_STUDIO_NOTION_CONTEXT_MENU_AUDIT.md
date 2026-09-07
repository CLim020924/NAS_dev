# Note Studio 블록 우클릭 메뉴 조사와 적용 기준

확인일: 2026-09-07

## 조사 결론

Notion의 핵심은 편집기 바탕에 별도 파일 메뉴를 띄우는 것이 아니라, 마우스가 가리킨 블록을 작업 대상으로 고정한 뒤 같은 블록 명령을 핸들 메뉴·우클릭·단축키에서 재사용하는 구조다. 공식 도움말에는 블록 유형 변경, 색상, 블록 링크 복사, 복제, 이동, 삭제, 댓글, 제안, AI 요청과 단어·문자 수 확인이 설명되어 있다.

참고 자료:

- Notion writing and editing basics: https://www.notion.com/help/writing-and-editing-basics
- Notion keyboard shortcuts: https://www.notion.com/help/keyboard-shortcuts
- Tiptap custom menus: https://tiptap.dev/docs/editor/getting-started/style-editor/custom-menus
- Tiptap drag handle: https://tiptap.dev/docs/editor/extensions/functionality/drag-handle

## 이번 구현

- 우클릭 좌표의 caret과 현재 블록을 메뉴가 열리기 전에 고정한다.
- 메인 메뉴에서 삽입, 블록 유형 변경, 색상, 복제, 위·아래 이동, 들여쓰기·내어쓰기, 블록 텍스트 복사, 잘라내기, AI 요청, 삭제를 제공한다.
- 삽입 하위 메뉴는 본문·제목·목록·할 일·인용·코드·구분선, 하위 페이지, NAS 파일·폴더 연결, Office 문서 생성을 묶는다.
- Office 문서 생성은 기존 안전한 페이지 폴더·다른 NAS 위치 저장 흐름을 재사용한다.
- AI 요청은 현재 노트·노트북 ID와 블록 텍스트를 입력창 초안으로만 전달한다. 사용자가 검토하기 전에 자동 전송하거나 실행하지 않는다.
- 색상은 노트 JSON의 허용된 이름 속성으로 저장하며 임의 CSS를 저장하지 않는다.
- Clipboard API가 실패하면 기존 selection 기반 대체 복사를 사용하고, 잘라내기는 복사가 성공한 뒤에만 삭제한다.
- Shift+우클릭은 브라우저 기본 메뉴를 사용할 수 있게 남긴다.

## 의도적으로 가짜 구현하지 않은 기능

다음 기능은 영구 blockId, 서버 권한, revision 또는 Yjs anchor, 원자 undo와 다중 선택 모델이 먼저 필요하다.

- 블록 링크 복사
- 블록 댓글과 제안 모드
- 다른 페이지로 블록 이동
- 여러 블록을 동시에 선택해 이동·복제·삭제
- drag handle을 이용한 다중 블록 재정렬
- synced block

이 항목들은 `PENDING-NOTE-STUDIO-BLOCK-COLLAB-20260907`로 기록한다. 임시 문서 위치를 block ID처럼 사용하면 본문 편집이나 동기화 뒤 잘못된 내용을 가리킬 수 있으므로 메뉴 모양만 먼저 노출하지 않는다.

## 검증 기준

- 빈 편집 바탕, 일반 문단, 제목, 코드 블록, 목록 항목, 문서의 첫·중간·마지막 블록에서 우클릭 대상을 확인한다.
- 변환·색·복제·이동·들여쓰기·삭제 뒤 autosave JSON을 재열어 동일한지 확인한다.
- 목록 이동과 삭제 후 ProseMirror 문서 스키마가 유효해야 한다.
- 마지막 블록 삭제 후 편집 가능한 빈 문단이 남아야 한다.
- 메뉴를 마우스로 오갈 때 selection과 hover가 깜빡이지 않아야 한다.
- 한글 IME 조합 중 우클릭, 복사, 메뉴 닫기 뒤 글자 유실이나 이중 입력이 없어야 한다.
- AI 요청은 입력창 초안까지만 채우고 자동 호출 비용을 발생시키지 않아야 한다.

