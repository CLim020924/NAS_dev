const fs = require('fs');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 1. 변경 감지 시 마스터(MASTER) 계정은 강제 로그아웃 대상에서 제외합니다.
    code = code.replace(
        /if \(hasChanged\) updatedIds\.push\(u\.id\);/g, 
        "if (hasChanged && target.id !== 'admin' && u.role !== 'MASTER') updatedIds.push(u.id);"
    );

    // 2. 소켓 신호 이름을 '강제 새로고침'에서 '강제 로그아웃'으로 변경합니다.
    code = code.replace(
        /s\.emit\('force_refresh_permissions'\);/g, 
        "s.emit('force_logout');"
    );

    fs.writeFileSync(indexPath, code);
    console.log("✅ 백엔드: 강제 로그아웃 신호 변경 및 마스터 예외 처리 완료!");
}
