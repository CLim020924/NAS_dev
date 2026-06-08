const fs = require('fs');
const path = './src/components/NAS.js';
if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1) 상태 및 화면 표시 함수 주입
    if (!code.includes('const getDisplayName')) {
        const displayLogic = `
  // 🔥 파일 확장명 숨기기/표시 전역 상태 및 유틸 함수
  const [showExt, setShowExt] = useState(localStorage.getItem('nas_show_extensions') === 'true');
  useEffect(() => {
    const handleStorageChange = () => setShowExt(localStorage.getItem('nas_show_extensions') === 'true');
    window.addEventListener('nas_settings_changed', handleStorageChange);
    return () => window.removeEventListener('nas_settings_changed', handleStorageChange);
  }, []);

  const getDisplayName = (item) => {
    if (item.type !== 'file' || showExt) return item.name;
    return item.name.includes('.') ? item.name.substring(0, item.name.lastIndexOf('.')) : item.name;
  };
`;
        code = code.replace(/(const \[desktopItems, setDesktopItems\] = useState\(\[\]\);)/, "$1\n" + displayLogic);
    }

    // 2) 바탕화면 아이콘 텍스트 렌더링 수정
    code = code.replace(
        /\{isSelected \|\| isMobile \? item\.name : \(item\.name\.length > 8 \? item\.name\.substring\(0, 8\) \+ '\.\.\.' : item\.name\)\}/g,
        "{isSelected || isMobile ? getDisplayName(item) : (getDisplayName(item).length > 8 ? getDisplayName(item).substring(0, 8) + '...' : getDisplayName(item))}"
    );

    // 3) 윈도우 창 내부 목록 텍스트 렌더링 수정
    code = code.replace(
        /<Typography>\{file\.name\}<\/Typography>/g,
        "<Typography>{getDisplayName(file)}</Typography>"
    );

    // 4) 이름 바꾸기 진입 시 텍스트 상자에 들어갈 초기값(defaultValue) 수정
    const oldRenameStart = /const handleRenameStart = \(item, pathContext\) => setInlineEdit\(\{ mode: 'rename', oldPath: item\.fullPath, originalName: item\.name, name: item\.name, contextPath: pathContext \}\);/g;
    const newRenameStart = "const handleRenameStart = (item, pathContext) => setInlineEdit({ mode: 'rename', oldPath: item.fullPath, originalName: item.name, name: getDisplayName(item), type: item.type, contextPath: pathContext });";
    code = code.replace(oldRenameStart, newRenameStart);

    // 5) [핵심] 윈도우 감성 200% 이름 바꾸기 최종 제출 로직 (경고창 & 보호)
    const oldRenameSubmitRegex = /\} else if \(mode === 'rename'\) \{\s*const finalName = value\.trim\(\); if \(!finalName \|\| finalName === originalName\) return;\s*if \(targetFiles\.map\(f => f\.name\)\.includes\(finalName\)\) return setSnackbar\(\{ open: true, message: "동일 이름 존재", severity: 'error' \}\);/g;
    const newRenameSubmit = `} else if (mode === 'rename') {
        let finalName = value.trim();
        if (!finalName) return;
        
        // 🔥 확장자 보호 및 윈도우 경고창 로직
        if (editState.type === 'file') {
            const isExtVisible = localStorage.getItem('nas_show_extensions') === 'true';
            const getExt = (n) => n.includes('.') ? n.substring(n.lastIndexOf('.')) : '';
            const oldExt = getExt(originalName);
            
            if (!isExtVisible) {
                // [숨김 모드] 사용자가 몰래 확장자를 적어도 그냥 이름으로 취급하고 원래 확장자를 뒤에 강제로 붙임!
                finalName += oldExt;
            } else {
                // [표시 모드] 확장자가 바뀌었는지 검사하여 윈도우 경고창 띄우기!
                const newExt = getExt(finalName);
                if (oldExt.toLowerCase() !== newExt.toLowerCase()) {
                    if (!window.confirm("파일의 확장명을 변경하면 사용할 수 없게 될 수도 있습니다.\\n변경하시겠습니까?")) {
                        setInlineEdit(null);
                        return;
                    }
                }
            }
        }
        
        if (finalName === originalName) { setInlineEdit(null); return; }
        if (targetFiles.map(f => f.name).includes(finalName)) return setSnackbar({ open: true, message: "동일 이름 존재", severity: 'error' });`;
    code = code.replace(oldRenameSubmitRegex, newRenameSubmit);

    fs.writeFileSync(path, code);
    console.log("✅ 코어 시스템: 윈도우 확장자 보호 & 경고창 로직 완벽 이식 완료!");
}
