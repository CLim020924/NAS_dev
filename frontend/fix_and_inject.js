const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 클립보드 상태 변수 추가 (기존 iconPositions 선언 바로 아래에)
    if (!code.includes('const [clipboard, setClipboard]')) {
        code = code.replace(
            /const \[iconPositions, setIconPositions\] = [^\n]*\n/,
            match => match + "  const [clipboard, setClipboard] = useState({ paths: [] });\n"
        );
    }

    // 2. 완벽하게 커스텀된 단축키 이벤트 로직 주입 (cancelTouch 함수 바로 아래에)
    if (!code.includes('// 🔥 다중 선택 & 복붙 단축키 로직')) {
        const effectCode = `
  // 🔥 다중 선택 & 복붙 단축키 로직 (완벽 맞춤형)
  useEffect(() => {
    const handleKeyDown = async (e) => {
      // 텍스트 에디터나 입력창에서는 단축키 무시
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.closest('.monaco-editor') || e.target?.closest('.onlyoffice-wrapper')) return;

      // 📌 현재 포커스된 위치(바탕화면 vs 특정 윈도우) 파악
      let targetFolder = '/';
      if (focusedContext && focusedContext !== 'desktop') {
        const win = openWindowsRef.current.find(w => w.id === focusedContext);
        if (win && win.currentPath) targetFolder = win.currentPath;
      }

      // 🗑️ 1. 삭제 (Delete)
      if (e.key === 'Delete' && selectedItems.length > 0) {
        if (window.confirm(\`선택한 \${selectedItems.length}개 항목을 삭제하시겠습니까?\`)) {
          try {
            await axios.delete('/api/file', { data: { paths: selectedItems }, withCredentials: true });
            setSelectedItems([]); // 선택 초기화
            if (typeof fetchFiles === 'function') {
              fetchFiles(targetFolder); // 현재 폴더 새로고침
              if (targetFolder !== '/') fetchFiles('/'); // 바탕화면도 동시 새로고침
            }
            setSnackbar({ open: true, message: '삭제가 완료되었습니다.', severity: 'success' });
          } catch(err) { showError('삭제', err); }
        }
      }

      // 📋 2. 복사 (Ctrl + C)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedItems.length > 0) {
        setClipboard({ paths: selectedItems });
        setSnackbar({ open: true, message: \`\${selectedItems.length}개 항목이 복사되었습니다.\`, severity: 'info' });
      }

      // 📥 3. 붙여넣기 (Ctrl + V)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard.paths.length > 0) {
        try {
          await axios.post('/api/file/copy', {
            sourcePaths: clipboard.paths,
            destinationFolder: targetFolder
          }, { withCredentials: true });
          
          if (typeof fetchFiles === 'function') {
            fetchFiles(targetFolder);
            if (targetFolder !== '/') fetchFiles('/');
          }
          setSnackbar({ open: true, message: '성공적으로 붙여넣었습니다.', severity: 'success' });
        } catch(err) { showError('붙여넣기', err); }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, focusedContext, clipboard, fetchFiles]);
`;
        code = code.replace(
            /const cancelTouch = \(\) => \{[^}]*\}\s*;\s*/,
            match => match + '\n' + effectCode + '\n'
        );
    }

    fs.writeFileSync(path, code);
    console.log("✅ 성공! NAS.js 변수명에 완벽하게 일치하는 단축키 로직을 주입했습니다.");
}
