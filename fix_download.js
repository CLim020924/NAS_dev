const fs = require('fs');

// [1] 백엔드 패치: 암구호(oosecret)를 대면 무사통과(Masters 권한) 시켜주는 로직 추가
const backendPath = './backend/nasRoutes.js';
if (fs.existsSync(backendPath)) {
    let code = fs.readFileSync(backendPath, 'utf8');
    const bypassCode = `const verifyToken = (req, res, next) => {
  if (req.query.oosecret === 'nas_office_2026') {
    req.user = { Masters: true };
    return next();
  }
  const token = req.cookies.token;`;
    
    code = code.replace(/const verifyToken = \(req, res, next\) => \{\s*const token = req\.cookies\.token;/g, bypassCode);
    fs.writeFileSync(backendPath, code);
    console.log("✅ 백엔드: 오피스 전용 암구호 인증 무사통과 로직 추가 완료!");
}

// [2] 프론트엔드 패치: 오피스 서버가 다운로드 요청할 때 암구호를 들고가게 수정
const frontendPath = './frontend/src/components/NAS/FileViewer.js';
if (fs.existsSync(frontendPath)) {
    let code = fs.readFileSync(frontendPath, 'utf8');
    code = code.replace(/const absoluteUrl = \`\$\{window\.location\.origin\}\$\{url\}\`;/g, 'const absoluteUrl = `${window.location.origin}${url}&oosecret=nas_office_2026`;');
    fs.writeFileSync(frontendPath, code);
    console.log("✅ 프론트엔드: 파일 요청 URL에 암구호(oosecret) 장착 완료!");
}
