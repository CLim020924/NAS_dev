const fs = require('fs');
const path = './src/components/NAS/Window/NASWindow.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. useEffect 훅 임포트 추가 (이미 있다면 건너뜀)
    if (!code.includes("import React, { useEffect }")) {
        code = code.replace("import React from 'react';", "import React, { useEffect } from 'react';");
    }

    // 2. 모바일 환경일 때 배경 스크롤(바디 스크롤) 잠금 로직 추가
    const scrollLockLogic = `
  // 🔥 [모바일 UX 최적화] 창이 열려있으면 바탕화면이 스크롤되지 않도록 꽉 잠급니다!
  useEffect(() => {
    if (isMobile && !win.isMinimized) {
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'none'; // 당겨서 새로고침 방지
      return () => {
        document.body.style.overflow = '';
        document.body.style.overscrollBehavior = '';
      };
    }
  }, [isMobile, win.isMinimized]);
`;
    if (!code.includes("document.body.style.overflow = 'hidden'")) {
        code = code.replace(
            "const isActive = focusedContext === win.id;",
            "const isActive = focusedContext === win.id;\n" + scrollLockLogic
        );
    }

    // 3. Rnd 창을 모바일에서 화면에 완벽히 고정(fixed) 시키기
    code = code.replace(
        "style={{ zIndex: win.zIndex }}",
        "style={{ zIndex: win.zIndex, position: isMobile ? 'fixed' : 'absolute' }}"
    );

    fs.writeFileSync(path, code);
    console.log("✅ NASWindow.js: 모바일 창 상단 고정 및 배경 스크롤 잠금 완벽 적용!");
} else {
    console.log("⚡ NASWindow.js 파일을 찾을 수 없습니다.");
}
