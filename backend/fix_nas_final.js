const fs = require('fs');
const path = require('path');
const file = './nasRoutes.js';
let code = fs.readFileSync(file, 'utf8');

const newPathFunc = `const getValidatedPath = (user, requestedPath) => {
  const isPrivileged = user.Masters || user.globalAccess;
  const path = require('path');
  
  let relativeRoot = user.rootPath ? user.rootPath.replace(/^(\\/|\\\\)+/, '') : path.join('users', user.id);
  
  if (!isPrivileged && relativeRoot && !fs.existsSync(path.join(nasPath, relativeRoot))) {
    const userSubDir = path.join('users', relativeRoot);
    if (fs.existsSync(path.join(nasPath, userSubDir))) {
      relativeRoot = userSubDir;
    }
  }

  const basePath = isPrivileged ? nasPath : path.resolve(nasPath, relativeRoot);
  const safeReqPath = (requestedPath || '').replace(/^(\\/|\\\\)+/, '');
  const targetPath = path.resolve(basePath, safeReqPath);

  if (!isPrivileged && !targetPath.startsWith(basePath)) {
    throw new Error('권한 없는 경로');
  }
  return { basePath, targetPath };
};`;

const newAuthBlock = `if (req.query.oosecret === 'nas_office_2026') {
    const isActuallyAdmin = req.query.officeAdmin === 'true';
    req.user = { 
        id: req.query.officeUid || 'office',
        Masters: isActuallyAdmin,
        globalAccess: isActuallyAdmin,
        rootPath: isActuallyAdmin ? '' : decodeURIComponent(req.query.officeRoot || '')
    };
    return next();
}`;

code = code.replace(/const getValidatedPath = [\s\S]*?return \{ basePath, targetPath \};\s*\};/, newPathFunc);
code = code.replace(/if \(req\.query\.oosecret === 'nas_office_2026'\) \{[\s\S]*?return next\(\);\s*\}/, newAuthBlock);

fs.writeFileSync(file, code);
console.log("✅ 백엔드 nasRoutes.js 정밀 복구 완료!");
