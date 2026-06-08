const fs = require('fs');
const path = './src/components/NAS/FileViewer.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');
    
    // 기존의 문제되는 한글/특수문자 포함 키를 안전한 영문/숫자 키로 교체
    code = code.replace(
        /key:\s*`\$\{win\.id\}.*?`,/, 
        "key: win.id.replace(/[^a-zA-Z0-9.\\-_=]/g, '_').substring(0, 80) + '_' + new Date().getTime(),"
    );
    
    fs.writeFileSync(path, code);
    console.log("✅ ONLYOFFICE 문서 키(Key) 안전화 패치 완료!");
} else {
    console.log("❌ FileViewer.js 파일을 찾을 수 없습니다.");
}
