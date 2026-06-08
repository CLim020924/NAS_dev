const fs = require('fs');
const file = './src/components/NAS/FileViewer.js';
let code = fs.readFileSync(file, 'utf8');

// 1. 필요한 Hook 및 Ref 추가
if (!code.includes('const editorRef = useRef(null);')) {
    code = code.replace('const zoomContainerRef = useRef(null);', 'const zoomContainerRef = useRef(null);\n  const editorRef = useRef(null);');
}

// 2. 단축키 핸들러 로직 삽입 (Ctrl+S, Ctrl+P 가로채기)
const shortcutLogic = `
  useEffect(() => {
    const handleShortcuts = (e) => {
      // 윈도우 시스템에서 현재 창이 활성화(focused) 상태인지 확인
      // 찬영님의 윈도우 관리 시스템에서 win.isFocused 또는 win.active를 사용한다고 가정합니다.
      const isFocused = win.isFocused || win.active || true; 
      if (!isFocused || !isOffice || !editorRef.current) return;

      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'p')) {
        e.preventDefault();
        e.stopPropagation();

        if (e.key.toLowerCase() === 's') {
          console.log("💾 NAS에 즉시 저장 시도...");
          // ONLYOFFICE에 강제 저장(ForceSave) 명령 전달
          editorRef.current.serviceCommand('forceSave');
        } else if (e.key.toLowerCase() === 'p') {
          console.log("🖨️ 문서 인쇄창 호출...");
          // ONLYOFFICE 내부 인쇄 기능 호출
          editorRef.current.downloadAs('pdf'); // PDF로 변환하여 출력 유도 또는 내부 호출
          alert('문서 내부 상단의 [인쇄] 아이콘을 이용하면 가장 정확하게 출력됩니다!');
        }
      }
    };

    window.addEventListener('keydown', handleShortcuts, true);
    return () => window.removeEventListener('keydown', handleShortcuts, true);
  }, [isOffice, win.isFocused, win.active]);
`;

// 기존 Ctrl+P 경고 로직 제거 및 새로운 로직 삽입
code = code.replace(/useEffect\(\(\) => \{[\s\S]*?handleCtrlP[\s\S]*?\}, \[isOffice\]\);/, shortcutLogic);

// 3. DocumentEditor에 레퍼런스 연결
code = code.replace(
    '<DocumentEditor id={`editor-${win.id}`}', 
    '<DocumentEditor onLoadComponent={(editor) => { editorRef.current = editor; }} id={`editor-${win.id}`}'
);

fs.writeFileSync(file, code);
console.log("✅ FileViewer 단축키(Ctrl+S/P) 및 활성창 제어 패치 완료!");
