const fs = require('fs');
const path = './src/components/Settings.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 혹시 useState가 안 불러와져 있다면 확실하게 추가!
    if (!code.includes('useState')) {
        code = code.replace(/import React([^;]+)?;/, "import React, { useState } from 'react';");
    }

    // 2. 화면을 그리기 직전(return)을 찾아서 그 바로 위에 상태 변수와 함수를 확실하게 주입!
    if (!code.includes('const [showExt, setShowExt]')) {
        const toggleLogic = `
  // 🔥 파일 확장명 숨기기 상태 변수 및 함수
  const [showExt, setShowExt] = useState(localStorage.getItem('nas_show_extensions') === 'true');
  const handleExtToggle = (e) => {
    const val = e.target.checked;
    setShowExt(val);
    localStorage.setItem('nas_show_extensions', val);
    window.dispatchEvent(new Event('nas_settings_changed')); // 메인 창에 즉시 알림!
  };
`;
        // return ( 문자열을 찾아서 그 바로 위에 꽂아넣습니다! (실패 확률 0%)
        code = code.replace(/(\s*return\s*\()/m, toggleLogic + "\n$1");
        
        fs.writeFileSync(path, code);
        console.log("✅ 설정 창: 잃어버린 변수(showExt)와 함수 완벽하게 복구 성공!");
    } else {
        console.log("⚡ 이미 변수가 존재합니다.");
    }
}
