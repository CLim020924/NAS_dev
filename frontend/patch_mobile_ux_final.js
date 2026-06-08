const fs = require('fs');

// ==========================================
// 1. NASWindow.js (타이틀바 밀림 방지)
// ==========================================
const windowPath = './src/components/NAS/Window/NASWindow.js';
if (fs.existsSync(windowPath)) {
    let code = fs.readFileSync(windowPath, 'utf8');

    // 🔥 핵심 수정: Paper 컨테이너에 overflow: hidden과 height: 100%를 강제하여, 자식요소가 부모를 뚫고 늘어나서 전체가 스크롤되는 것을 막습니다.
    const oldPaperSx = /<Paper elevation=\{isActive \? 24 : 8\} sx=\{\{[\s\S]*?transition: 'border 0\.2s ease, box-shadow 0\.2s ease'[\s\S]*?\}\}>/;
    const newPaperSx = `<Paper elevation={isActive ? 24 : 8} sx={{
          height: '100%',
          maxHeight: '100%', // 🔥 자식이 부모를 뚫고 늘어나는 현상 완벽 차단
          display: 'flex',
          flexDirection: 'column',
          borderRadius: (isMobile || win.isMaximized) ? 0 : 2,
          overflow: 'hidden', // 🔥 닫기 창이 밀려 올라가지 않도록 부모 영역 밖 스크롤 컷!
          background: theme.palette.background.paper,
          color: theme.palette.text.primary,
          border: isActive ? \`3px solid \${theme.palette.primary.main}\` : \`1px solid \${theme.palette.divider}\`,
          boxShadow: isActive ? \`0 0 25px \${alpha(theme.palette.primary.main, 0.4)}\` : theme.shadows[10],
          transition: 'border 0.2s ease, box-shadow 0.2s ease'
        }}>`;
    
    code = code.replace(oldPaperSx, newPaperSx);
    fs.writeFileSync(windowPath, code);
    console.log("✅ NASWindow.js: 닫기 버튼(타이틀바) 스크롤 밀림 현상 완벽 해결!");
}

// ==========================================
// 2. NAS.js (모바일에서 창 열릴 때 버튼 숨기기)
// ==========================================
const nasPath = './src/components/NAS.js';
if (fs.existsSync(nasPath)) {
    let code = fs.readFileSync(nasPath, 'utf8');

    // 🔥 핵심 수정: 버튼의 display 속성을 '모바일이고 하나라도 창이 열려있으면 숨김'으로 변경
    const oldButtonDisplay = /display: openWindows\.some\(w => w\.isImmersive\) \? 'none' : 'flex'/g;
    const newButtonDisplay = "display: (openWindows.some(w => w.isImmersive) || (isMobile && openWindows.length > 0)) ? 'none' : 'flex'";
    
    code = code.replace(oldButtonDisplay, newButtonDisplay);
    fs.writeFileSync(nasPath, code);
    console.log("✅ NAS.js: 모바일에서 창 열림 시 플로팅 버튼(업로드/새폴더 등) 자동 숨김 적용!");
}
