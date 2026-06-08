const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 문제가 되었던 버튼(IconButton)을 찾아내서, 
    // 상태를 오염시키는 로직을 제거하고 안전한 몰입 모드 진입/해제 로직으로 완벽 교체합니다.
    const buggyButtonRegex = /<IconButton size="small"[^>]*toggleMaximize[^>]*>\{win\.isMaximized \? <FilterNoneIcon fontSize="small"\/> : <CropSquareIcon fontSize="small"\/>\}<\/IconButton>/g;
    
    const safeButtonLogic = `<IconButton size="small" onMouseDown={() => { window.immersiveLp = false; window.immersiveTimer = setTimeout(() => { window.immersiveLp = true; setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: true } : w)); }, 500); }} onMouseUp={() => clearTimeout(window.immersiveTimer)} onMouseLeave={() => clearTimeout(window.immersiveTimer)} onTouchStart={() => { window.immersiveLp = false; window.immersiveTimer = setTimeout(() => { window.immersiveLp = true; setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: true } : w)); }, 500); }} onTouchEnd={() => clearTimeout(window.immersiveTimer)} onClick={(e) => { e.stopPropagation(); clearTimeout(window.immersiveTimer); if (window.immersiveLp) { window.immersiveLp = false; return; } if (win.isImmersive) { setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: false } : w)); } else { toggleMaximize(win.id); } }}>{win.isMaximized ? <FilterNoneIcon fontSize="small"/> : <CropSquareIcon fontSize="small"/>}</IconButton>`;

    code = code.replace(buggyButtonRegex, safeButtonLogic);

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 버튼 상태 오염 버그 치료 및 안전한 복원 로직 탑재 완료!");
}
