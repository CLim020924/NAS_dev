const fs = require('fs');
const file = './nasRoutes.js';
let code = fs.readFileSync(file, 'utf8');

const regex = /const\s+getValidatedPath\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?return\s+\{\s*basePath,\s*targetPath\s*\};\s*\}/;

const newFunc = `const getValidatedPath = (user, requestedPath) => {
  const isPrivileged = user.Masters || user.globalAccess;
  const fs = require('fs');
  
  let customRoot = path.join('users', user.id); // 기본값
  
  if (user.rootPath) {
    if (user.rootPath === '/') {
        customRoot = ''; 
    } else {
        customRoot = user.rootPath.replace(/^(\\/|\\\\)+/, '');
        // 🔥 마법의 경로 자동 교정 (DB엔 'cksdud'인데 실제론 'users/cksdud'인 경우 알아서 찾아감)
        const directPath = path.resolve(nasPath, customRoot);
        const usersPath = path.resolve(nasPath, 'users', customRoot);
        if (!fs.existsSync(directPath) && fs.existsSync(usersPath)) {
            customRoot = path.join('users', customRoot);
        }
    }
  }

  const basePath = isPrivileged ? nasPath : path.resolve(nasPath, customRoot);
  const safeReqPath = (requestedPath || '').replace(/^(\\/|\\\\)+/, '');
  const targetPath = path.resolve(basePath, safeReqPath);

  // 🔍 서버 터미널에 로그 출력 (블랙박스)
  console.log(\`\\n[보안검문소] 👤 ID: \${user.id}\`);
  console.log(\`[보안검문소] 📂 요청경로: \${requestedPath}\`);
  console.log(\`[보안검문소] 🏠 Base: \${basePath}\`);
  console.log(\`[보안검문소] 🎯 Target: \${targetPath}\`);

  if (!isPrivileged && targetPath.includes(path.join(nasPath, 'backup'))) {
    console.log('[보안검문소] 🚨 차단: 백업 폴더 접근');
    throw new Error('접근 제한된 시스템 폴더입니다.');
  }
  
  if (!targetPath.startsWith(path.resolve(basePath))) {
    console.log('[보안검문소] 🚨 차단: 허용된 Base 경로 이탈');
    throw new Error('권한 없는 경로');
  }
  
  return { basePath, targetPath };
}`;

if (regex.test(code)) {
    code = code.replace(regex, newFunc);
    fs.writeFileSync(file, code);
    console.log("✅ 문지기 인공지능 업그레이드 및 블랙박스 장착 완료!");
} else {
    console.log("⚠️ 함수를 찾지 못했습니다.");
}
