const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 혹시 전에 잘못 들어간 코드가 있다면 깨끗하게 청소 (초기화)
    code = code.replace(/const \[clipboard, setClipboard\] = useState\(\{ paths: \[\] \}\);\n/g, '');
    code = code.replace(/\/\/ 🔥 다중 선택 & 복붙 단축키 로직[\s\S]*?window\.removeEventListener\('keydown', handleKeyDown\);\n  \}, \[.*?\]\);\n/g, '');

    // 2. 가장 안전한 위치(handleCloseSnackbar 바로 위)에 완벽한 코드 주입
    const safeTarget = "const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));";
    
    if (code.includes(safeTarget)) {
        const finalCode = `
  // 🔥 완벽 커스텀 단축키 상태 & 로직
  const [clipboard, setClipboard] = useState({ paths: [] });

  useEffect(() => {
    const handleKeyDown = async (e) => {
      // 텍스트 입력창에서는 무시
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.closest('.monaco-editor') || e.target?.closest('.onlyoffice-wrapper')) return;

      // [디버깅 레이더] F12 콘솔창에서 키보드 눌리는지 확인용!
      if (e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && ['c', 'v'].includes(e.key.toLowerCase()))) {
        console.log("⌨️ 단축키 감지됨:", e.key, "| 🎯 선택된 파일:", selectedItems, "| 📋 클립보드:", clipboard.paths);
      }

      let targetFolder = '/';
      if (focusedContext && focusedContext !== 'desktop') {
        const win = openWindowsRef.current.find(w => w.id === focusedContext);
        if (win && win.currentPath) targetFolder = win.currentPath;
      }

      // 🗑️ 삭제 (Delete)
      if (e.key === 'Delete' && selectedItems.length > 0) {
        if (window.confirm(\`선택한 \${selectedItems.length}개 항목을 삭제하시겠습니까?\`)) {
          try {
            await axios.delete('/api/file', { data: { paths: selectedItems }, withCredentials: true });
            setSelectedItems([]); 
            if (typeof fetchFiles === 'function') { fetchFiles(targetFolder); if (targetFolder !== '/') fetchFiles('/'); }
            setSnackbar({ open: true, message: '삭제 완료!', severity: 'success' });
          } catch(err) { showError('삭제', err); }
        }
      }

      // 📋 복사 (Ctrl + C)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedItems.length > 0) {
        setClipboard({ paths: selectedItems });
        setSnackbar({ open: true, message: \`\${selectedItems.length}개 항목 복사됨\`, severity: 'info' });
      }

      // 📥 붙여넣기 (Ctrl + V)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard.paths.length > 0) {
        try {
          await axios.post('/api/file/copy', { sourcePaths: clipboard.paths, destinationFolder: targetFolder }, { withCredentials: true });
          if (typeof fetchFiles === 'function') { fetchFiles(targetFolder); if (targetFolder !== '/') fetchFiles('/'); }
          setSnackbar({ open: true, message: '붙여넣기 성공!', severity: 'success' });
        } catch(err) { showError('붙여넣기', err); }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, focusedContext, clipboard, fetchFiles]);
`;
        code = code.replace(safeTarget, finalCode + "\n  " + safeTarget);
        fs.writeFileSync(path, code);
        console.log("✅ 프론트엔드: 에러 없는 완벽한 단축키 코드 주입 성공!");
    } else {
        console.log("❌ 타겟 위치를 찾을 수 없습니다.");
    }
}
