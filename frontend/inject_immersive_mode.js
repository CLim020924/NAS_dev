const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 전체화면 해제 감지 레이더 (ESC 키 & 마우스 상단 접근)
    if (!code.includes('handleEscAndHover')) {
        const effectCode = `
  // 🔥 전체화면(몰입 모드) 해제 이벤트 리스너
  useEffect(() => {
    const handleEscAndHover = (e) => {
      // ESC 키를 누르거나
      if (e.type === 'keydown' && e.key === 'Escape') {
        setOpenWindows(prev => prev.map(w => w.isImmersive ? { ...w, isImmersive: false } : w));
      }
      // 마우스를 화면 맨 위(5px 이내)로 갖다 대면 해제!
      if (e.type === 'mousemove' && e.clientY <= 5) {
        setOpenWindows(prev => {
          if (prev.some(w => w.isImmersive)) {
            return prev.map(w => w.isImmersive ? { ...w, isImmersive: false } : w);
          }
          return prev;
        });
      }
    };
    window.addEventListener('keydown', handleEscAndHover);
    window.addEventListener('mousemove', handleEscAndHover);
    return () => {
      window.removeEventListener('keydown', handleEscAndHover);
      window.removeEventListener('mousemove', handleEscAndHover);
    };
  }, [setOpenWindows]);
`;
        const safeTarget = "const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));";
        code = code.replace(safeTarget, effectCode + "\n  " + safeTarget);
    }

    // 2. 최대화 버튼 꾹 누르기(Long Press) 로직 주입
    const oldMaxBtn = /<IconButton size="small" onClick=\{\(\) => toggleMaximize\(win\.id\)\}>\{win\.isMaximized \? <FilterNoneIcon fontSize="small"\/> : <CropSquareIcon fontSize="small"\/>\}<\/IconButton>/g;
    const newMaxBtn = `<IconButton size="small" onClick={() => toggleMaximize(win.id)} onMouseDown={() => { window.immersiveTimer = setTimeout(() => { setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: true, isMaximized: true } : w)); }, 500); }} onMouseUp={() => clearTimeout(window.immersiveTimer)} onMouseLeave={() => clearTimeout(window.immersiveTimer)} onTouchStart={() => { window.immersiveTimer = setTimeout(() => { setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: true, isMaximized: true } : w)); }, 500); }} onTouchEnd={() => clearTimeout(window.immersiveTimer)}>{win.isMaximized ? <FilterNoneIcon fontSize="small"/> : <CropSquareIcon fontSize="small"/>}</IconButton>`;
    code = code.replace(oldMaxBtn, newMaxBtn);

    // 3. 브라우저를 꽉 채우는 화면 크기(100vw, 100vh) 압도적 할당
    const oldWinStyles = /const winStyles = isMobile \? \{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' \} : \{ width: win\.isMaximized \? '100%' : win\.width, height: win\.isMaximized \? '100%' : win\.height, x: win\.isMaximized \? 0 : win\.x, y: win\.isMaximized \? 0 : win\.y \};/g;
    const newWinStyles = "const winStyles = win.isImmersive ? { width: '100vw', height: '100vh', x: 0, y: 0 } : (isMobile ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' } : { width: win.isMaximized ? '100%' : win.width, height: win.isMaximized ? '100%' : win.height, x: win.isMaximized ? 0 : win.x, y: win.isMaximized ? 0 : win.y });";
    code = code.replace(oldWinStyles, newWinStyles);

    // 4. 창을 상단 메뉴바 위로 덮어버리는 최상위 계층(fixed, zIndex: 99999) 부여
    code = code.replace(
        /key=\{win\.id\}\s*style=\{\{\s*zIndex:\s*win\.zIndex\s*\}\}/g,
        "key={win.id} style={{ zIndex: win.isImmersive ? 99999 : win.zIndex, position: win.isImmersive ? 'fixed' : 'absolute', top: win.isImmersive ? 0 : 'auto', left: win.isImmersive ? 0 : 'auto' }}"
    );
    
    // 전체화면 시 드래그 및 리사이징 강제 잠금
    code = code.replace(/disableDragging=\{isMobile \|\| win\.isMaximized\}/g, "disableDragging={isMobile || win.isMaximized || win.isImmersive}");
    code = code.replace(/enableResizing=\{!isMobile && !win\.isMaximized\}/g, "enableResizing={!isMobile && !win.isMaximized && !win.isImmersive}");

    // 5. 몰입 모드 시 창의 헤더(닫기 버튼 구역) 숨김
    code = code.replace(
        /<Box className="window-header-drag-handle"\s*sx=\{\{\s*p:\s*1,/g,
        "<Box className=\"window-header-drag-handle\" sx={{ display: win.isImmersive ? 'none' : 'flex', p: 1,"
    );

    // 6. 몰입 모드 시 둥근 모서리(Border Radius) 제거 -> 각진 풀스크린
    code = code.replace(
        /borderRadius:\s*\(isMobile \|\| win\.isMaximized\)\s*\?\s*0\s*:\s*2,/g,
        "borderRadius: (isMobile || win.isMaximized || win.isImmersive) ? 0 : 2,"
    );

    // 7. [핵심] 몰입 모드 중일 땐 우측 하단 버튼 3대장(업로드 등) 숨김 처리
    code = code.replace(
        /<Box sx=\{\{\s*position:\s*'absolute',\s*bottom:\s*isMobile\s*\?\s*15\s*:\s*30,\s*right:\s*isMobile\s*\?\s*15\s*:\s*30,\s*display:\s*'flex',/g,
        "<Box sx={{ position: 'absolute', bottom: isMobile ? 15 : 30, right: isMobile ? 15 : 30, display: openWindows.some(w => w.isImmersive) ? 'none' : 'flex',"
    );

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 몰입형 전체화면(Immersive Fullscreen) 시스템 완벽 주입!");
}
