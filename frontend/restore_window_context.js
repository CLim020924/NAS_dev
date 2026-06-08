const fs = require('fs');
const appPath = './src/App.js';
const winCtxPath = './src/contexts/WindowContext.js';

let appCode = fs.readFileSync(appPath, 'utf8');
let winCtxCode = fs.readFileSync(winCtxPath, 'utf8');

// 1. WindowContext.js를 직접 스캔해서 Provider의 정확한 이름을 찾아냅니다.
let providerName = 'WindowProvider'; // 기본값
const match = winCtxCode.match(/export\s+(?:const|function|let)\s+([A-Za-z0-9_]*Provider)/);
if (match) {
    providerName = match[1];
}

// 2. App.js에 사라졌던 창 관리자를 다시 불러오고, 앱 전체를 감싸줍니다.
if (!appCode.includes('contexts/WindowContext')) {
    // Import 구문 추가
    appCode = appCode.replace(
        "import { CustomThemeProvider",
        `import { ${providerName} } from './contexts/WindowContext';\nimport { CustomThemeProvider`
    );

    // AppContent를 WindowProvider로 안전하게 감싸기
    appCode = appCode.replace(
        /<CustomThemeProvider>\s*<AppContent \/>\s*<\/CustomThemeProvider>/,
        `<CustomThemeProvider>\n      <${providerName}>\n        <AppContent />\n      </${providerName}>\n    </CustomThemeProvider>`
    );

    fs.writeFileSync(appPath, appCode);
    console.log(`✅ App.js: 창 관리자(${providerName}) 복구 완료!`);
} else {
    console.log(`⚡ 이미 ${providerName}가 포함되어 있습니다.`);
}
