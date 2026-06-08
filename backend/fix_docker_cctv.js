const fs = require('fs');
const file = '/home/limchanyoung/my-service-platform/backend/nasRoutes.js';
let code = fs.readFileSync(file, 'utf8');

const startIdx = code.indexOf("if (req.query.oosecret === 'nas_office_2026') {");
if (startIdx !== -1) {
    const endIdx = code.indexOf("return next();", startIdx);
    const blockEndIdx = code.indexOf("}", endIdx) + 1;
    
    const newBlock = `if (req.query.oosecret === 'nas_office_2026') {
    req.user = { 
        id: req.query.officeUid || 'office',
        Masters: req.query.officeAdmin === 'true',
        globalAccess: req.query.officeAdmin === 'true',
        rootPath: decodeURIComponent(req.query.officeRoot || '')
    };
    
    console.log("\\n🐳 [도커 뷰어 파일 요청 CCTV] 🐳");
    console.log("1. 도커가 전달한 유저 ID:", req.user.id);
    console.log("2. 도커가 전달한 유저 경로(rootPath):", req.user.rootPath);
    console.log("3. 전체권한(Admin) 여부:", req.user.globalAccess);
    console.log("4. 도커가 열어달라고 한 파일:", req.query.path);
    return next();
}`;
    
    code = code.substring(0, startIdx) + newBlock + code.substring(blockEndIdx);
    fs.writeFileSync(file, code);
    console.log("✅ 백엔드 도커 전용 패치 & CCTV 설치 완벽 성공!");
} else {
    console.log("⚠️ oosecret 블록을 찾지 못했습니다.");
}
