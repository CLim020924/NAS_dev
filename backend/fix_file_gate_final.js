const fs = require('fs');
const file = './nasRoutes.js';
let code = fs.readFileSync(file, 'utf8');

// 꼰대 문지기 로직을 통째로 뜯어냅니다.
const regex = /const\s+getValidatedPath\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?return\s+\{\s*basePath,\s*targetPath\s*\};\s*\}/;

const newFunc = `const getValidatedPath = (user, requestedPath) => {
  const isPrivileged = user.Masters || user.globalAccess;
  
  // 🔥 유저의 rootPath를 기준으로 완벽한 개인용 감옥(Jail)을 만듭니다.
  const customRoot = user.rootPath ? user.rootPath.replace(/^(\\/|\\\\)+/, '') : path.join('users', user.id);
  const basePath = isPrivileged ? nasPath : path.resolve(nasPath, customRoot);
  
  // 프론트가 요청한 경로를 개인 감옥 안에서만 찾게 만듭니다.
  const safeReqPath = (requestedPath || '').replace(/^(\\/|\\\\)+/, '');
  const targetPath = path.resolve(basePath, safeReqPath);

  // 보안 검사
  if (!isPrivileged && targetPath.includes(path.join(nasPath, 'backup'))) {
    throw new Error('접근 제한된 시스템 폴더입니다.');
  }
  if (!targetPath.startsWith(path.resolve(basePath))) throw new Error('권한 없는 경로');
  
  return { basePath, targetPath };
}`;

if (regex.test(code)) {
    code = code.replace(regex, newFunc);
    fs.writeFileSync(file, code);
    console.log("✅ 파일 문지기 완벽 교정 성공! (이제 403 안 뜹니다!)");
} else {
    console.log("⚠️ 함수를 찾지 못했습니다.");
}
