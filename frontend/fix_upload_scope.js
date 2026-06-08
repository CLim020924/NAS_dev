const fs = require('fs');
const path = '/home/limchanyoung/my-service-platform/frontend/src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // ESLint 에러의 원인인 'uploadList.length === 1 &&' 조건을 삭제하고 'evt.total'만 남깁니다.
    code = code.replace(
        /if\s*\(\s*uploadList\.length\s*===\s*1\s*&&\s*evt\.total\s*\)/g, 
        "if (evt.total)"
    );

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: uploadList 참조 에러 완벽 해결!");
} else {
    console.log("❌ NAS.js 파일을 찾을 수 없습니다.");
}
