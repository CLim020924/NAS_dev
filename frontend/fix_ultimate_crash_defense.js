const fs = require('fs');

// =========================================================================
// 1. WindowContext.js: 절대 뻗지 않는 '불사신' 최대화/복원 로직 이식
// =========================================================================
const wcPath = './src/contexts/WindowContext.js';
if (fs.existsSync(wcPath)) {
    let wcCode = fs.readFileSync(wcPath, 'utf8');

    const oldToggleMaximizeRegex = /const toggleMaximize = \(id\) => \{[\s\S]*?\}\)\);\s*\};/m;
    
    // 만약 원래 크기(prevSize)가 없으면 하얀 화면을 띄우는 대신 기본값(800x600)으로 부드럽게 복구합니다!
    const newToggleMaximize = `const toggleMaximize = (id) => {
  setOpenWindows(prev => prev.map(w => {
    if (w.id !== id) return w;
    if (!w.isMaximized) {
      return { 
        ...w, 
        isMaximized: true, 
        prevSize: { width: w.width || 800, height: w.height || 600 }, 
        prevPosition: { x: w.x || 100, y: w.y || 100 } 
      };
    }
    // 복원 시 데이터가 날아갔어도 절대 에러가 나지 않도록 기본값(Fallback) 강제 적용!
    const pSize = w.prevSize || { width: 800, height: 600 };
    const pPos = w.prevPosition || { x: 100, y: 100 };
    return { 
      ...w, 
      isMaximized: false, 
      width: pSize.width, 
      height: pSize.height, 
      x: pPos.x, 
      y: pPos.y 
    };
  }));
};`;

    if (wcCode.match(oldToggleMaximizeRegex)) {
        wcCode = wcCode.replace(oldToggleMaximizeRegex, newToggleMaximize);
        fs.writeFileSync(wcPath, wcCode);
        console.log("✅ WindowContext.js: 불사신 최대화/복원 로직 이식 완료!");
    }
}

// =========================================================================
// 2. NAS.js: 고장난 '강제 최대화' 찌꺼기 완벽하게 도려내기
// =========================================================================
const nasPath = './src/components/NAS.js';
if (fs.existsSync(nasPath)) {
    let nasCode = fs.readFileSync(nasPath, 'utf8');
    
    // 몰입 모드 진입 시 강제로 isMaximized: true 를 넣던 주범을 싹 다 제거합니다.
    nasCode = nasCode.replace(/isImmersive:\s*true,\s*isMaximized:\s*true/g, "isImmersive: true");
    
    fs.writeFileSync(nasPath, nasCode);
    console.log("✅ NAS.js: 강제 최대화 찌꺼기 코드 박멸 완료!");
}
