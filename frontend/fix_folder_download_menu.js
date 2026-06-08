const fs = require('fs');

// 1. NASContextMenu.js (우클릭 메뉴판) 수정
const menuPath = './src/components/NAS/NASContextMenu.js';
if (fs.existsSync(menuPath)) {
    let code = fs.readFileSync(menuPath, 'utf8');
    
    // 파일 다운로드 버튼과 헷갈리지 않게 고유 키(downloadFolder)로 확인 후 주입!
    if (!code.includes('downloadFolder')) {
        code = code.replace(
            /(<Divider key="d2" \/>\s*,)/,
            `$1\n        <MenuItem key="downloadFolder" onClick={() => { handleContextMenuClose(); setTimeout(() => { const items = getItemsToProcess(contextMenu.item); items.forEach((it, i) => setTimeout(() => handleDownload(it), i * 500)); }, 10); }}>\n          <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon><ListItemText>다운로드</ListItemText>\n        </MenuItem>,`
        );
        fs.writeFileSync(menuPath, code);
        console.log("✅ 메뉴판: 폴더 전용 [다운로드] 버튼 강제 소환 완료!");
    } else {
        console.log("⚡ 메뉴판: 이미 폴더 다운로드 버튼이 존재합니다.");
    }
}

// 2. NAS.js 메인 로직 점검 (혹시 아까 스킵됐을 경우를 대비한 보험)
const nasPath = './src/components/NAS.js';
if (fs.existsSync(nasPath)) {
    let nasCode = fs.readFileSync(nasPath, 'utf8');
    let modified = false;

    if (!nasCode.includes('const [folderDownload, setFolderDownload]')) {
        nasCode = nasCode.replace(
            /const \[closePrompt, setClosePrompt\] = useState\(null\);/,
            "const [closePrompt, setClosePrompt] = useState(null);\n  const [folderDownload, setFolderDownload] = useState(null);"
        );
        modified = true;
    }

    if (!nasCode.includes('executeFolderDownload')) {
        const oldHandleDownloadRegex = /const handleDownload = \(item\) => \{[\s\S]*?removeChild\(a\);\s*\};/;
        const newHandleDownload = `const handleDownload = (item) => { 
    if (item.type === 'folder') {
      setFolderDownload(item);
    } else {
      const a = document.createElement('a'); 
      a.href = \`/api/file/download?path=\${encodeURIComponent(ensureSlash(item.fullPath))}\`; 
      a.download = item.name; 
      document.body.appendChild(a); 
      a.click(); 
      document.body.removeChild(a); 
    }
  };

  const executeFolderDownload = (format) => {
    if (!folderDownload) return;
    const a = document.createElement('a');
    a.href = \`/api/file/download-folder?path=\${encodeURIComponent(ensureSlash(folderDownload.fullPath))}&format=\${format}\`;
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a);
    setFolderDownload(null);
  };`;
        if (oldHandleDownloadRegex.test(nasCode)) {
            nasCode = nasCode.replace(oldHandleDownloadRegex, newHandleDownload);
            modified = true;
        }
    }

    if (!nasCode.includes('폴더 다운로드 다이얼로그')) {
        const dialogJSX = `
      {/* 🔥 폴더 다운로드 다이얼로그 */}
      <Dialog open={!!folderDownload} onClose={() => setFolderDownload(null)} PaperProps={{ elevation: 24, sx: { borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 800, textAlign: 'center' }}>폴더 다운로드</DialogTitle>
        <DialogContent sx={{ textAlign: 'center' }}>
          <DialogContentText sx={{ mb: 3 }}>
            <strong style={{ color: '#3b82f6' }}>{folderDownload?.name}</strong> 폴더를 압축합니다.<br/>원하시는 압축 포맷을 선택해 주세요.
          </DialogContentText>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button variant="contained" color="primary" onClick={() => executeFolderDownload('zip')} sx={{ fontWeight: 'bold' }}>.ZIP (권장)</Button>
            <Button variant="outlined" color="secondary" onClick={() => executeFolderDownload('tar')}>.TAR</Button>
            <Button variant="outlined" color="info" onClick={() => executeFolderDownload('tgz')}>.TAR.GZ</Button>
          </Box>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center' }}>
          <Button onClick={() => setFolderDownload(null)} color="inherit">취소</Button>
        </DialogActions>
      </Dialog>
    `;
        nasCode = nasCode.replace(/(\s*<\/Box>\s*\)\;\s*\}\;\s*export default NAS;)/, dialogJSX + "$1");
        modified = true;
    }

    if (modified) {
        fs.writeFileSync(nasPath, nasCode);
        console.log("✅ 메인로직: 압축 팝업창(다이얼로그) 탑재 완료!");
    }
}
