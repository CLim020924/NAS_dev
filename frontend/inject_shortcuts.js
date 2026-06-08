const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 이미 단축키 코드가 들어갔는지 확인
    if (!code.includes('const [clipboard, setClipboard]')) {
        const injectionCode = `
  // 🔥 전역 단축키 상태 (클립보드)
  const [clipboard, setClipboard] = useState({ paths: [] });

  // 🔥 단축키 이벤트 리스너 (Ctrl+C, Ctrl+V, Delete)
  useEffect(() => {
    const handleKeyDown = async (e) => {
      // 텍스트 입력창이나 오피스 에디터 안에서는 단축키 무시 (글씨 써야 하니까!)
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.closest('.monaco-editor') || e.target.closest('.onlyoffice-wrapper')) return;

      // 현재 선택된 파일 경로 찾기 (바탕화면이든 윈도우 창 안이든)
      // (NAS 컴포넌트의 선택 상태 변수에 맞춰 유연하게 대처)
      const targetPath = (typeof selectedItem !== 'undefined' && selectedItem) ? selectedItem.fullPath || selectedItem.path : null;
      const targetFolder = (typeof currentPath !== 'undefined' && currentPath) ? currentPath : '/';

      // 1. 삭제 (Delete)
      if (e.key === 'Delete' && targetPath) {
        if (window.confirm('선택한 항목을 삭제하시겠습니까?')) {
          try {
            await axios.delete('/api/file', { data: { paths: [targetPath] }, withCredentials: true });
            if (typeof fetchFiles === 'function') fetchFiles(targetFolder);
            if (typeof fetchDesktopItems === 'function') fetchDesktopItems();
          } catch(err) { console.error('삭제 에러:', err); }
        }
      }

      // 2. 복사 (Ctrl + C)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && targetPath) {
        setClipboard({ paths: [targetPath] });
        alert('복사되었습니다. 원하는 폴더에서 Ctrl+V를 누르세요.');
      }

      // 3. 붙여넣기 (Ctrl + V)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard.paths.length > 0) {
        try {
          await axios.post('/api/file/copy', {
            sourcePaths: clipboard.paths,
            destinationFolder: targetFolder
          }, { withCredentials: true });
          if (typeof fetchFiles === 'function') fetchFiles(targetFolder);
          if (typeof fetchDesktopItems === 'function') fetchDesktopItems();
        } catch(err) {
          alert('붙여넣기에 실패했습니다.');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clipboard, typeof selectedItem !== 'undefined' ? selectedItem : null, typeof currentPath !== 'undefined' ? currentPath : null]);
`;

        // NAS 메인 컴포넌트 선언부 바로 아래에 주입 (정규식 사용)
        code = code.replace(/(const NAS = \([^)]*\)\s*=>\s*\{)/, match => match + '\n' + injectionCode);
        
        fs.writeFileSync(path, code);
        console.log("✅ 프론트엔드: 키보드 단축키 이벤트 장착 완료!");
    } else {
        console.log("⚡ 이미 단축키 이벤트가 장착되어 있습니다.");
    }
} else {
    console.log("❌ NAS.js 파일을 찾을 수 없습니다. 경로를 확인해주세요.");
}
