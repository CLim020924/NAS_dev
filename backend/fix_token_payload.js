const fs = require('fs');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 🔥 로그인 토큰에 Masters, Managers 권한을 명시적으로 포함시킵니다.
    // nasRoutes.js가 이 정보를 보고 전체 경로를 열어주게 됩니다.
    const oldToken = "const token = jwt.sign({ id: user.id, role }, JWT_SECRET, { expiresIn: '1d' });";
    const newToken = "const token = jwt.sign({ id: user.id, role, Masters: user.Masters, Managers: user.Managers }, JWT_SECRET, { expiresIn: '1d' });";

    if (code.includes(oldToken)) {
        code = code.replace(oldToken, newToken);
        fs.writeFileSync(indexPath, code);
        console.log("✅ index.js: 로그인 토큰 권한(Masters/Managers) 복구 완료!");
    } else {
        console.log("🚨 토큰 생성 코드를 찾지 못했습니다. 이미 수정되었거나 구조가 다를 수 있습니다.");
    }
}
