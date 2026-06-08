const fs = require('fs');

// [1] 백엔드 index.js 수정
const bePath = '/home/limchanyoung/my-service-platform/backend/index.js';
if (fs.existsSync(bePath)) {
    let beCode = fs.readFileSync(bePath, 'utf8');
    // 소켓 서버 설정에 path: '/api/socket.io' 추가
    if (!beCode.includes("path: '/api/socket.io'")) {
        beCode = beCode.replace(/const io = new Server\(server, \{/, "const io = new Server(server, {\n  path: '/api/socket.io',");
        fs.writeFileSync(bePath, beCode);
        console.log("✅ 백엔드: 소켓 경로(/api/socket.io) 설정 완료!");
    } else {
        console.log("⚡ 백엔드 소켓 경로는 이미 설정되어 있습니다.");
    }
}

// [2] 프론트엔드 App.js 수정
const fePath = '/home/limchanyoung/my-service-platform/frontend/src/App.js';
if (fs.existsSync(fePath)) {
    let feCode = fs.readFileSync(fePath, 'utf8');
    // 클라이언트 접속 설정에 path: '/api/socket.io' 추가
    if (!feCode.includes("path: '/api/socket.io'")) {
        feCode = feCode.replace(
            /socketIOClient\("https:\/\/filemanager-nas\.com", \{ withCredentials: true \}\)/g, 
            "socketIOClient(\"https://filemanager-nas.com\", { path: '/api/socket.io', withCredentials: true })"
        );
        fs.writeFileSync(fePath, feCode);
        console.log("✅ 프론트엔드: 소켓 경로(/api/socket.io) 접속 설정 완료!");
    } else {
        console.log("⚡ 프론트엔드 소켓 경로는 이미 설정되어 있습니다.");
    }
}
