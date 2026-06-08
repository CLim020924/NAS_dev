const fs = require('fs');
const file = './nasRoutes.js';
let code = fs.readFileSync(file, 'utf8');

const targetStr = "if (!targetPath.startsWith(basePath)) {";
const cctvStr = `console.log("🚨 [문지기 차단 로그]");
  console.log("1. 유저 아이디:", user.id);
  console.log("2. 마패(토큰)에 적힌 경로:", user.rootPath);
  console.log("3. 프론트가 요청한 경로:", requestedPath);
  console.log("4. 문지기 허용구역(basePath):", basePath);
  console.log("5. 문지기 목표위치(targetPath):", targetPath);
  if (!targetPath.startsWith(basePath)) {`;

if (code.includes(targetStr) && !code.includes("[문지기 차단 로그]")) {
    code = code.replace(targetStr, cctvStr);
    fs.writeFileSync(file, code);
    console.log("✅ 문지기 CCTV 설치 완료!");
} else {
    console.log("⚠️ CCTV 설치 실패 (또는 이미 설치됨)");
}
