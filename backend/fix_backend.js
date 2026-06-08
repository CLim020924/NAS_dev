const fs = require('fs');
const file = './index.js';
let code = fs.readFileSync(file, 'utf8');

const targetRegex = /target\.globalAccess\s*=\s*u\.role\s*===\s*'MASTER'\s*\?\s*true\s*:\s*u\.globalAccess;/;

if(targetRegex.test(code)) {
    code = code.replace(targetRegex, `target.globalAccess = u.role === 'MASTER' ? true : u.globalAccess;
      target.role = u.role || target.role; // 🔥 권한 문자열 누락 픽스!
      target.rootPath = u.rootPath || u.root_path || target.rootPath; // 🔥 대망의 경로 DB 저장 마법!`);
    fs.writeFileSync(file, code);
    console.log("✅ 백엔드 DB 업데이트 픽스 완벽하게 성공!");
} else {
    console.log("⚠️ 코드를 찾지 못했습니다.");
}
