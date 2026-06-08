const fs = require('fs');

// 1. Settings.js 수정 (사용자 관리 탭을 관리자에게만 보이게 숨김)
const settingsPath = './src/components/Settings.js';
if (fs.existsSync(settingsPath)) {
    let code = fs.readFileSync(settingsPath, 'utf8');
    
    // 탭 구문에서 value를 명시적으로 지정하고, 사용자 관리 탭은 isManager 조건으로 감쌉니다.
    code = code.replace(
        /<Tab label="전역 설정" \/><Tab label="파일 설정" \/><Tab label="사용자 관리" \/>/,
        '<Tab label="전역 설정" value={0} /><Tab label="파일 설정" value={1} />{isManager && <Tab label="사용자 관리" value={2} />}'
    );
    fs.writeFileSync(settingsPath, code);
    console.log("✅ Settings.js: 일반 유저 화면에서 '사용자 관리' 탭 숨김 처리 완료!");
}

// 2. App.js 수정 (일반 유저도 /settings 경로에 접근할 수 있도록 문 개방)
const appPath = './src/App.js';
if (fs.existsSync(appPath)) {
    let code = fs.readFileSync(appPath, 'utf8');
    
    // {isManager && <Route path="/settings" ...>} 부분의 잠금을 풉니다.
    code = code.replace(
        /\{isManager && <Route path="\/settings" element=\{<Settings \/>} \/>\}/g,
        '<Route path="/settings" element={<Settings />} />'
    );
    fs.writeFileSync(appPath, code);
    console.log("✅ App.js: /settings 라우트 일반 유저에게 개방 완료!");
}

// 3. TopBar.js 수정 (일반 유저 화면에서도 톱니바퀴 아이콘이 보이게 수정)
const topBarPath = './src/components/TopBar.js';
if (fs.existsSync(topBarPath)) {
    let code = fs.readFileSync(topBarPath, 'utf8');
    
    // 관리자만 톱니바퀴 아이콘을 보여주던 조건문을 완전히 제거합니다.
    const iconRegex = /\{\(user\.Masters \|\| user\.Managers \|\| user\.role === 'MASTER' \|\| user\.role === 'MANAGER'\) && \([\s\S]*?<IconButton onClick=\{\(\) => navigate\('\/settings'\)\}.*?<SettingsIcon[^>]*> <\/IconButton>[\s\S]*?\)\}/;
    
    code = code.replace(
        iconRegex,
        `<IconButton onClick={() => navigate('/settings')} size="small" sx={{ color: textColor }}> <SettingsIcon fontSize="small" /> </IconButton>`
    );
    fs.writeFileSync(topBarPath, code);
    console.log("✅ TopBar.js: 상단바 설정(톱니바퀴) 버튼 일반 유저에게 개방 완료!");
}
