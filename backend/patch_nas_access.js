const fs = require('fs');
let code = fs.readFileSync('./nasRoutes.js', 'utf8');
// 기존에 Managers에게 통째로 주던 권한을 뺏고, 개별 globalAccess 권한을 확인하도록 변경!
code = code.replace(/const basePath = \(user\.Masters \|\| user\.Managers\)/g, "const basePath = (user.Masters || user.globalAccess)");
fs.writeFileSync('./nasRoutes.js', code);
console.log("✅ nasRoutes.js: 개별 파일 접근 권한 검사 로직 적용 완료!");
