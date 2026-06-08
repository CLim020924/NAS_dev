const fs = require('fs');
const appPath = './src/App.js';

if (fs.existsSync(appPath)) {
    let code = fs.readFileSync(appPath, 'utf8');

    // 1. ServicePlatform의 진짜 주소인 '/platform'을 등록해 줍니다.
    code = code.replace(
        /<Route path="\/" element={<ServicePlatform \/>} \/>/g,
        '<Route path="/platform" element={<ServicePlatform />} />\n                    <Route path="/" element={<Navigate to="/platform" replace />} />'
    );

    // 2. 길을 잃었을 때 돌아가는 기본 주소도 '/platform'으로 바꿉니다.
    code = code.replace(
        /<Route path="\*" element={<Navigate to="\/" \/>} \/>/g,
        '<Route path="*" element={<Navigate to="/platform" replace />} />'
    );

    fs.writeFileSync(appPath, code);
    console.log("✅ App.js: '/platform' 라우트 완벽 개통!");
}

// 3. 상단바(TopBar.js)의 투명 배경 효과도 '/platform' 경로에 맞게 맞춰줍니다.
const topBarPath = './src/components/TopBar.js';
if (fs.existsSync(topBarPath)) {
    let topCode = fs.readFileSync(topBarPath, 'utf8');
    topCode = topCode.replace(/location\.pathname === '\/'/g, "location.pathname.startsWith('/platform')");
    fs.writeFileSync(topBarPath, topCode);
    console.log("✅ TopBar.js: UI 경로 인식 수정 완료!");
}
