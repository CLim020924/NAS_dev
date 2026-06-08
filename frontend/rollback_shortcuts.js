const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');
    
    // 방금 주입했던 에러나는 단축키 코드를 정규식으로 찾아서 싹 지웁니다.
    const regex = /\s*\/\/ 🔥 전역 단축키 상태 \(클립보드\)[\s\S]*?typeof currentPath !== 'undefined' \? currentPath : null\]\);\n/g;
    
    if (regex.test(code)) {
        code = code.replace(regex, '');
        fs.writeFileSync(path, code);
        console.log("✅ 롤백 성공! 에러 코드를 깔끔하게 제거했습니다.");
    } else {
        console.log("⚡ 지울 코드를 찾지 못했습니다. 이미 롤백되었을 수 있습니다.");
    }
}
