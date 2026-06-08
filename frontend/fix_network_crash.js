const fs = require('fs');

const nasPath = './frontend/src/components/NAS.js';
if (fs.existsSync(nasPath)) {
    let code = fs.readFileSync(nasPath, 'utf8');
    // 동시 전송량을 10(또는 25)에서 2로 줄여서 공유기 마비 방지
    code = code.replace(/const CHUNK_SIZE = \d+;/g, "const CHUNK_SIZE = 2; // 🛡️ 공유기 기절 방지 (안정적인 동시 업로드 개수)");
    fs.writeFileSync(nasPath, code);
    console.log("✅ 프론트엔드: 동시 업로드 개수 안전선(2개)으로 하향 조정 완료!");
}
