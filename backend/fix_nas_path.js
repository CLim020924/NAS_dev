const fs = require('fs');
const path = require('path');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 1. nasPath를 실제 프로젝트 내 storage 폴더로 변경
    // 기존: const nasPath = process.env.NAS_PATH || '/mnt/nas';
    const realStoragePath = path.join(__dirname, '..', 'storage');
    
    code = code.replace(
        "const nasPath = process.env.NAS_PATH || '/mnt/nas';",
        `const nasPath = '${realStoragePath}';`
    );

    fs.writeFileSync(indexPath, code);
    console.log(`✅ index.js: NAS 경로를 ${realStoragePath}로 수정 완료!`);
}
