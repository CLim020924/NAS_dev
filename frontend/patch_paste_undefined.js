const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // targetFolder가 비어있을 경우(undefined) 바탕화면('/')으로 강제 지정하는 안전장치 추가!
    code = code.replace(/destinationFolder:\s*targetFolder/g, "destinationFolder: targetFolder || '/'");
    code = code.replace(/fetchFiles\(targetFolder\)/g, "fetchFiles(targetFolder || '/')");
    code = code.replace(/if\s*\(targetFolder\s*!==\s*'\/'\)\s*fetchFiles\('\/'\);/g, "if ((targetFolder || '/') !== '/') fetchFiles('/');");

    fs.writeFileSync(path, code);
    console.log("✅ NAS.js: 붙여넣기 undefined 경로 에러 완벽 방어!");
}
