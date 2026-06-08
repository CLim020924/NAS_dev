const fs = require('fs');
const file = './index.js';
let code = fs.readFileSync(file, 'utf8');

const targetStr = "globalAccess: u.globalAccess, isOnline: connectedIds.includes(u.id)";
const replaceStr = "globalAccess: u.globalAccess, isOnline: connectedIds.includes(u.id), rootPath: u.rootPath || ''";

if (code.includes("rootPath: u.rootPath")) {
    console.log("✅ 이미 프론트엔드에 rootPath를 보내주고 있습니다!");
} else if (code.includes(targetStr)) {
    code = code.replace(targetStr, replaceStr);
    fs.writeFileSync(file, code);
    console.log("✅ 백엔드가 프론트에게 경로(rootPath) 데이터를 돌려주도록 수정 완료!");
} else {
    console.log("⚠️ 코드를 찾지 못했습니다. 에러 확인 필요!");
}
