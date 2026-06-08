const fs = require('fs');
const file = './index.js';
let code = fs.readFileSync(file, 'utf8');

const searchStr = "target.globalAccess = u.role === 'MASTER' ? true : u.globalAccess;";
const replaceStr = "target.globalAccess = u.role === 'MASTER' ? true : u.globalAccess;\n      target.role = u.role || target.role;\n      target.rootPath = u.rootPath || u.root_path || target.rootPath;";

if (code.includes("target.rootPath = u.rootPath")) {
    console.log("✅ 이미 코드가 추가되어 있습니다! (서버 재시작만 하시면 됩니다!)");
} else if (code.includes(searchStr)) {
    code = code.replace(searchStr, replaceStr);
    fs.writeFileSync(file, code);
    console.log("✅ 백엔드 DB에 경로 저장하는 마법 추가 완료!");
} else {
    console.log("⚠️ 코드를 찾지 못했습니다. 에러 확인 필요!");
}
