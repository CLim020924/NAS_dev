const fs = require('fs');

// 1. 프론트엔드 App.js의 불필요한 path 설정 제거
const fePath = './src/App.js';
if (fs.existsSync(fePath)) {
    let feCode = fs.readFileSync(fePath, 'utf8');
    // path 설정 찌꺼기를 완벽하게 지웁니다.
    feCode = feCode.replace(/,\s*path:\s*['"]\/api\/socket\.io\/?['"]/g, '');
    feCode = feCode.replace(/path:\s*['"]\/api\/socket\.io\/?['"],\s*/g, '');
    fs.writeFileSync(fePath, feCode);
    console.log("✅ 프론트엔드: 소켓 경로 순정 복구 완료!");
}

// 2. 백엔드 index.js의 불필요한 path 설정 제거 및 서버 실행 확인
const bePath = '../backend/index.js';
if (fs.existsSync(bePath)) {
    let beCode = fs.readFileSync(bePath, 'utf8');
    beCode = beCode.replace(/,\s*path:\s*['"]\/api\/socket\.io\/?['"]/g, '');
    beCode = beCode.replace(/path:\s*['"]\/api\/socket\.io\/?['"],\s*/g, '');
    
    // 🔥 혹시라도 app.listen으로 되어있으면 소켓이 안 켜지므로 server.listen으로 확실히 고정!
    beCode = beCode.replace(/app\.listen\(/g, 'server.listen(');
    
    fs.writeFileSync(bePath, beCode);
    console.log("✅ 백엔드: 소켓 경로 순정 복구 및 서버 연결 완료!");
}
