const fs = require('fs');
const file = './nasRoutes.js';
let code = fs.readFileSync(file, 'utf8');

const startIdx = code.indexOf('const getValidatedPath =');
const endStr = 'return { basePath, targetPath };';
const endIdx = code.indexOf(endStr, startIdx);
const blockEndIdx = code.indexOf('}', endIdx) + 1;

const newFunc = `const getValidatedPath = (user, requestedPath) => {
  const isPrivileged = user.Masters || user.globalAccess;
  let customRoot = user.rootPath ? user.rootPath.replace(/^(\\/|\\\\)+/, '') : require('path').join('users', user.id);
  
  if (customRoot === user.id) {
      customRoot = require('path').join('users', user.id);
  }
  
  const basePath = isPrivileged ? nasPath : require('path').resolve(nasPath, customRoot);
  const safeReqPath = (requestedPath || '').replace(/^(\\/|\\\\)+/, '');
  const targetPath = require('path').resolve(basePath, safeReqPath);

  console.log("\\n🚨 [파일 문지기 CCTV 작동 중] 🚨");
  console.log("1. 요청자 ID:", user.id);
  console.log("2. 마패(토큰)에 적힌 경로:", user.rootPath);
  console.log("3. 전체권한 여부:", isPrivileged);
  console.log("4. 프론트가 열어달라고 한 경로:", requestedPath);
  console.log("5. 문지기가 허용한 기준 폴더(basePath):", basePath);
  console.log("6. 문지기가 찾으러 간 폴더(targetPath):", targetPath);
  console.log("-----------------------------------\\n");

  if (!isPrivileged && targetPath.includes(require('path').join(nasPath, 'backup'))) {
    throw new Error('접근 제한된 시스템 폴더입니다.');
  }
  if (!targetPath.startsWith(basePath)) {
    console.log("❌ 차단 사유: 찾으러 간 폴더가 허용 기준 폴더를 벗어남!");
    throw new Error('권한 없는 경로');
  }
  
  return { basePath, targetPath };
}`;

code = code.substring(0, startIdx) + newFunc + code.substring(blockEndIdx);
fs.writeFileSync(file, code);
console.log("✅ 문지기 머릿속에 CCTV 완벽하게 부착 완료!");
