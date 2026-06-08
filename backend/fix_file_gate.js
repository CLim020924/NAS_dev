const fs = require('fs');

// 1. index.js: 로그인 할 때 토큰에 rootPath 적어주기
const indexFile = './index.js';
let indexCode = fs.readFileSync(indexFile, 'utf8');
if (!indexCode.includes("rootPath: user.rootPath")) {
    indexCode = indexCode.replace(/globalAccess:\s*user\.globalAccess\s*},\s*JWT_SECRET/g, "globalAccess: user.globalAccess, rootPath: user.rootPath }, JWT_SECRET");
    fs.writeFileSync(indexFile, indexCode);
    console.log("✅ 마패(JWT)에 rootPath 각인 완료!");
}

// 2. nasRoutes.js: 문지기 검사 로직 스마트하게 고치기
const nasFile = './nasRoutes.js';
let nasCode = fs.readFileSync(nasFile, 'utf8');

if (!nasCode.includes("const allowedRoot")) {
    // 기존 멍청한 basePath 로직 교체
    const oldBasePathStr = "const basePath = isPrivileged ? nasPath : path.join(nasPath, 'users', user.id);";
    const newBasePathStr = "const basePath = nasPath;\n  const customRoot = user.rootPath ? user.rootPath.replace(/^(\\/|\\\\)+/, '') : path.join('users', user.id);\n  const allowedRoot = path.resolve(basePath, customRoot);";
    nasCode = nasCode.replace(oldBasePathStr, newBasePathStr);

    // 보안 검사 기준을 allowedRoot로 교체
    const oldCheckStr = "if (!targetPath.startsWith(path.resolve(basePath)))";
    const newCheckStr = "if (!isPrivileged && !targetPath.startsWith(allowedRoot))";
    nasCode = nasCode.replace(oldCheckStr, newCheckStr);

    fs.writeFileSync(nasFile, nasCode);
    console.log("✅ 파일 문지기(nasRoutes.js) 하위 경로 프리패스 교육 완료!");
} else {
    console.log("✅ 문지기는 이미 똑똑합니다.");
}
