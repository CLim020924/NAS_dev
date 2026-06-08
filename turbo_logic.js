const fs = require('fs');

// [1] 백엔드: HTTP Keep-Alive 소켓 최적화 (스트리밍 끊김 방지)
const bePath = './backend/index.js';
if (fs.existsSync(bePath)) {
    let code = fs.readFileSync(bePath, 'utf8');
    if (code.includes('server.setTimeout(0)')) {
        code = code.replace(
            /server\.setTimeout\(0\);\nserver\.keepAliveTimeout = 0;/, 
            "server.setTimeout(0);\nserver.keepAliveTimeout = 65000;\nserver.headersTimeout = 66000; // 🚀 파일 스트리밍 최적화"
        );
        fs.writeFileSync(bePath, code);
        console.log("✅ 백엔드: 고속 스트리밍 소켓 유지(Keep-Alive) 설정 완료!");
    }
}

// [2] 프론트엔드: Nginx 병목이 사라졌으므로 다중 파일 동시 전송량(대역폭) 확장
const nasPath = './frontend/src/components/NAS.js';
if (fs.existsSync(nasPath)) {
    let code = fs.readFileSync(nasPath, 'utf8');
    code = code.replace(/const CHUNK_SIZE = 3;/g, "const CHUNK_SIZE = 10; // 🚀 Nginx 버퍼링 해제 후 동시 전송량 극대화");
    fs.writeFileSync(nasPath, code);
    console.log("✅ 프론트엔드: 폴더 업로드 동시 전송 대역폭(3 -> 10) 확장 완료!");
}
