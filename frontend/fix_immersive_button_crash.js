const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. [최대화/복원 버튼] 몰입 모드일 땐 무조건 몰입 모드부터 해제!
    code = code.replace(
        /onClick=\{\(\) => toggleMaximize\(win\.id\)\}/g,
        "onClick={(e) => { e.stopPropagation(); if (win.isImmersive) { setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: false } : w)); } else { toggleMaximize(win.id); } }}"
    );

    // 2. [최소화 버튼] 몰입 모드 해제 후 최소화 진행!
    code = code.replace(
        /onClick=\{\(\) => toggleMinimize\(win\.id\)\}/g,
        "onClick={(e) => { e.stopPropagation(); if (win.isImmersive) { setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: false, isMinimized: true } : w)); } else { toggleMinimize(win.id); } }}"
    );

    // 3. [닫기 버튼] 충돌 방지를 위해 클릭 이벤트 캡처 차단
    code = code.replace(
        /onClick=\{\(\) => handleCloseWindowClick\(win\)\}/g,
        "onClick={(e) => { e.stopPropagation(); handleCloseWindowClick(win); }}"
    );

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 상단바 버튼 충돌 및 하얀 화면(Crash) 버그 완벽 치료!");
}
