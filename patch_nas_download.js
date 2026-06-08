const fs = require('fs');
const path = './frontend/src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1) 다이얼로그 상태 변수 추가
    if (!code.includes('const [folderDownload, setFolderDownload]')) {
        code = code.replace(
            /const \[closePrompt, setClosePrompt\] = useState\(null\);/,
            "const [closePrompt, setClosePrompt] = useState(null);\n  const [folderDownload, setFolderDownload] = useState(null);"
        );
    }

    // 2) 기존 handleDownload 함수를 똑똑하게 교체 (폴더면 팝업 띄우고, 파일이면 그냥 다운!)
    const oldHandleDownloadRegex = /const handleDownload = \(item\) => \{[\s\S]*?removeChild\(a\);\s*\};/;
    const newHandleDownload = `const handleDownload = (item) => { 
    if (item.type === 'folder') {
      setFolderDownload(item); // 팝업 띄우기!
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
    
    if (code.match(oldHandleDownloadRegex)) {
        code = code.replace(oldHandleDownloadRegex, newHandleDownload);
    }

    // 3) 맨 밑바닥에 압축 포맷 선택 다이얼로그(UI) 주입
    if (!code.includes('폴더 다운로드 다이얼로그')) {
        const dialogJSX = `
      {/* 🔥 폴더 다운로드 다이얼로그 */}
      <Dialog open={!!folderDownload} onClose={() => setFolderDownload(null)} PaperProps={{ elevation: 24, sx: { borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 800, textAlign: 'center' }}>폴더 다운로드</DialogTitle>
        <DialogContent sx={{ textAlign: 'center' }}>
          <DialogContentText sx={{ mb: 3 }}>
            <strong style={{ color: '#3b82f6' }}>'{folderDownload?.name}'</strong> 폴더를 압축합니다.<br/>원하시는 압축 포맷을 선택해 주세요.
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
        // 컴포넌트 마지막 </Box> 바로 직전에 삽입
        code = code.replace(/(\s*<\/Box>\s*\)\;\s*\}\;\s*export default NAS;)/, dialogJSX + "$1");
        fs.writeFileSync(path, code);
        console.log("✅ 프론트엔드: 다이얼로그 UI 및 다운로드 로직 탑재 완료!");
    }
}
