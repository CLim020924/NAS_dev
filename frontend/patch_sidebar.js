const fs = require('fs');
const path = './src/components/GlobalSidebar.js';
if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');
    // 학번 출력 부분 완전히 삭제
    code = code.replace(/<Typography variant="caption" color="textSecondary">학번: \{user\.studentId\}<\/Typography>/g, '');
    fs.writeFileSync(path, code);
    console.log("✅ 사이드바: 불필요한 학번 정보 삭제 완료!");
}
