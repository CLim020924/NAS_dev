const fs = require('fs');

// 1. NASContextMenu.js (우클릭 메뉴판) 업데이트
const menuPath = './src/components/NAS/NASContextMenu.js';
if (fs.existsSync(menuPath)) {
    let menuCode = fs.readFileSync(menuPath, 'utf8');

    if (!menuCode.includes('ContentCopyIcon')) {
        // 아이콘 임포트 추가
        menuCode = menuCode.replace(
            /import VisibilityIcon from '@mui\/icons-material\/Visibility';/,
            "import VisibilityIcon from '@mui/icons-material/Visibility';\nimport ContentCopyIcon from '@mui/icons-material/ContentCopy';\nimport ContentPasteIcon from '@mui/icons-material/ContentPaste';"
        );
        
        // 프롭스에 handleCopy, handlePaste, clipboard 추가
        menuCode = menuCode.replace(
            /getItemsToProcess\s*\n\}\) => \{/,
            "getItemsToProcess,\n  handleCopy, handlePaste, clipboard\n}) => {"
        );

        // [배경 우클릭] 붙여넣기 메뉴 추가 (클립보드 비어있으면 자동 비활성화)
        menuCode = menuCode.replace(
            /(<MenuItem key="upload"[\s\S]*?<\/MenuItem>)/,
            `$1,\n        <Divider key="d_paste" />,\n        <MenuItem key="paste" disabled={!clipboard || clipboard.paths.length === 0} onClick={() => { handleContextMenuClose(); setTimeout(() => handlePaste(contextMenu.path), 10); }}>\n          <ListItemIcon><ContentPasteIcon fontSize="small" color={(!clipboard || clipboard.paths.length === 0) ? "disabled" : "primary"} /></ListItemIcon><ListItemText>붙여넣기</ListItemText>\n        </MenuItem>`
        );

        // [폴더 우클릭] 복사 메뉴 추가
        menuCode = menuCode.replace(
            /(<Divider key="d2" \/>)/,
            `$1,\n        <MenuItem key="copy" onClick={() => { handleContextMenuClose(); setTimeout(() => handleCopy(getItemsToProcess(contextMenu.item)), 10); }}>\n          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon><ListItemText>복사</ListItemText>\n        </MenuItem>`
        );

        // [파일 우클릭] 복사 메뉴 추가
        menuCode = menuCode.replace(
            /(<Divider key="d3" \/>)/,
            `$1,\n        <MenuItem key="copy" onClick={() => { handleContextMenuClose(); setTimeout(() => handleCopy(getItemsToProcess(contextMenu.item)), 10); }}>\n          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon><ListItemText>복사</ListItemText>\n        </MenuItem>`
        );

        fs.writeFileSync(menuPath, menuCode);
        console.log("✅ 1. NASContextMenu.js 메뉴판 UI 업데이트 완료");
    }
}

// 2. NAS.js (메인 로직) 업데이트
const nasPath = './src/components/NAS.js';
if (fs.existsSync(nasPath)) {
    let nasCode = fs.readFileSync(nasPath, 'utf8');

    if (!nasCode.includes('handleCopyContextMenu')) {
        const handlers = `
  // 🔥 우클릭 메뉴 전용 복사/붙여넣기 핸들러
  const handleCopyContextMenu = (items) => {
    const paths = items.map(it => it.fullPath || it.path).filter(Boolean);
    if (paths.length > 0) {
      setClipboard({ paths });
      setSnackbar({ open: true, message: \`\${paths.length}개 항목이 복사되었습니다.\`, severity: 'info' });
    }
  };

  const handlePasteContextMenu = async (targetFolder) => {
    if (!clipboard || !clipboard.paths || clipboard.paths.length === 0) return;
    try {
      await axios.post('/api/file/copy', { sourcePaths: clipboard.paths, destinationFolder: targetFolder }, { withCredentials: true });
      if (typeof fetchFiles === 'function') {
        fetchFiles(targetFolder);
        if (targetFolder !== '/') fetchFiles('/');
      }
      setSnackbar({ open: true, message: '붙여넣기 완료!', severity: 'success' });
    } catch(err) { showError('붙여넣기', err); }
  };
`;
        
        // showError 함수 바로 아래에 핸들러 주입
        nasCode = nasCode.replace(
            /const showError = \([\s\S]*?\}\s*;/g, 
            match => match + "\n" + handlers
        );

        // 메뉴판 컴포넌트에 새로운 3가지 프롭스 내려주기
        nasCode = nasCode.replace(
            /<NASContextMenu/g,
            "<NASContextMenu handleCopy={handleCopyContextMenu} handlePaste={handlePasteContextMenu} clipboard={clipboard}"
        );

        fs.writeFileSync(nasPath, nasCode);
        console.log("✅ 2. NAS.js 프롭스 및 핸들러 연결 완료");
    }
}
