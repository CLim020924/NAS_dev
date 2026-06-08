const fs = require('fs');

// 1. 프론트엔드 App.js 수정 (방송을 듣고 내 아이디면 스스로 로그아웃)
const appPath = './src/App.js';
if (fs.existsSync(appPath)) {
    let appCode = fs.readFileSync(appPath, 'utf8');
    
    const oldSocketLogic = /socket\.on\("force_logout", \(\) => \{[\s\S]*?\}\);/;
    const newSocketLogic = `socket.on("force_logout_target", (data) => {
      const currentUser = JSON.parse(localStorage.getItem('user'));
      // 방송으로 날아온 ID(targetId)가 내 ID와 똑같다면?!
      if (currentUser && (currentUser.id === data.targetId || currentUser.username === data.targetId)) {
        alert("관리자로 인해 계정정보가 변경되어 로그아웃 됩니다. 다시 로그인 하세요.");
        document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    });`;

    if (oldSocketLogic.test(appCode)) {
        appCode = appCode.replace(oldSocketLogic, newSocketLogic);
        fs.writeFileSync(appPath, appCode);
        console.log("✅ 프론트엔드: 강제 로그아웃 수신부 완벽 적용!");
    } else {
        console.log("⚡ App.js에서 기존 소켓 로직을 찾지 못했습니다.");
    }
}

// 2. 백엔드 index.js 수정 (누가 변경되었는지 전체 소켓에 타겟 ID 방송)
const bePath = '../backend/index.js';
if (fs.existsSync(bePath)) {
    let beCode = fs.readFileSync(bePath, 'utf8');
    
    // 이전 방식(소켓 ID를 일일이 찾는 방식)을 버리고 전체 방송(emit)으로 변경
    const oldEmitLogic = /const allSockets = Array\.from\(io\.sockets\.sockets\.values\(\)\);\s*updatedIds\.forEach\(targetId => allSockets\.filter\(s => s\.userId === targetId\)\.forEach\(s => s\.emit\('force_logout'\)\)\);/;
    const newEmitLogic = `updatedIds.forEach(targetId => {
        console.log(\`[시스템] \${targetId} 권한 변경 감지! 강제 로그아웃 타겟 방송 발송!\`);
        io.emit('force_logout_target', { targetId });
      });`;

    if (oldEmitLogic.test(beCode)) {
        beCode = beCode.replace(oldEmitLogic, newEmitLogic);
        fs.writeFileSync(bePath, beCode);
        console.log("✅ 백엔드: 강제 로그아웃 송출부(전체방송) 완벽 적용!");
    } else {
        console.log("⚡ index.js에서 기존 송출 로직을 찾지 못했습니다.");
    }
}
