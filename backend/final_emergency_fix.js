const fs = require('fs');

// 1. nasRoutes.js 완벽 복구 및 최적화
const nasFile = './nasRoutes.js';
let nasCode = fs.readFileSync(nasFile, 'utf8');

// oosecret 블록을 '가장 안전하고 강력한' 버전으로 교체
const ooRegex = /if\s*\(req\.query\.oosecret\s*===\s*'nas_office_2026'\s*\)\s*\{[\s\S]*?return\s+next\(\);\s*\}/;
const ooReplace = `if (req.query.oosecret === 'nas_office_2026') {
    const isActuallyAdmin = req.query.officeAdmin === 'true';
    req.user = { 
        id: req.query.officeUid || 'office',
        Masters: isActuallyAdmin,
        globalAccess: isActuallyAdmin,
        rootPath: isActuallyAdmin ? '' : decodeURIComponent(req.query.officeRoot || '')
    };
    console.log("🐳 [도커 요청] ID:", req.user.id, "Admin:", isActuallyAdmin, "Path:", req.query.path);
    return next();
}`;

// getValidatedPath 함수를 '관리자 프리패스' 버전으로 교체
const pathRegex = /const\s+getValidatedPath\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?return\s+\{\s*basePath,\s*targetPath\s*\};\s*\}/;
const pathReplace = `const getValidatedPath = (user, requestedPath) => {
  const isPrivileged = user.Masters || user.globalAccess;
  const path = require('path');
  
  // 🔥 관리자는 묻지도 따지지도 않고 최상위 nasPath 사용!
  const basePath = isPrivileged ? nasPath : path.resolve(nasPath, user.rootPath ? user.rootPath.replace(/^(\\/|\\\\)+/, '') : path.join('users', user.id));
  
  const safeReqPath = (requestedPath || '').replace(/^(\\/|\\\\)+/, '');
  const targetPath = path.resolve(basePath, safeReqPath);

  if (!isPrivileged && !targetPath.startsWith(basePath)) {
    throw new Error('권한 없는 경로');
  }
  
  return { basePath, targetPath };
}`;

if (ooRegex.test(nasCode)) nasCode = nasCode.replace(ooRegex, ooReplace);
if (pathRegex.test(nasCode)) nasCode = nasCode.replace(pathRegex, pathReplace);

fs.writeFileSync(nasFile, nasCode);
console.log("✅ 백엔드 긴급 복구 완료!");
