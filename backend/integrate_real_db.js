const fs = require('fs');
const path = require('path');

// 1. 혹시 전에 만들었던 잘못된 가짜 DB 연동 코드(nasRoutes.js)가 있다면 청소!
const nasRoutesPath = './nasRoutes.js';
if (fs.existsSync(nasRoutesPath)) {
    let nasCode = fs.readFileSync(nasRoutesPath, 'utf8');
    nasCode = nasCode.replace(/\/\/ 🔥 \[계정 관리 DB\] 데이터 불러오기 API[\s\S]*?module\.exports = router;/m, 'module.exports = router;');
    fs.writeFileSync(nasRoutesPath, nasCode);
}

// 2. [핵심] index.js 수술 시작
const indexPath = './index.js';
if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 2-1. 기존 로그인 응답(res.json)을 찾아서, 프론트엔드에 권한과 경로를 쏴주도록 업그레이드!
    const oldLoginRes = /res\.json\(\{\s*message:\s*'로그인 성공',\s*user\s*\}\);/g;
    const newLoginRes = `// 🔥 로그인 성공 시, 마스터/관리자 권한과 루트 경로를 계산해서 프론트엔드로 전송!
  const role = user.Masters ? 'MASTER' : (user.Managers ? 'MANAGER' : 'USER');
  const rootPath = user.rootPath || (user.Masters ? '/' : \`/USERS/\${user.id}\`);
  const enhancedUser = { ...user, role, rootPath };
  res.json({ message: '로그인 성공', user: enhancedUser });`;
    
    if (code.match(oldLoginRes)) {
        code = code.replace(oldLoginRes, newLoginRes);
    }

    // 2-2. 프론트엔드 설정 창과 찬영님의 members.json을 연결해주는 튼튼한 다리(API) 건설!
    if (!code.includes("app.get('/api/users/data'")) {
        const apis = `
// 🔥 [계정 관리] 진짜 DB(members.json & requests.json) 연동 API
app.get('/api/users/data', (req, res) => {
  const mappedUsers = approvedUsers.map(u => ({
    id: u.id,
    username: u.id, // 프론트엔드는 username이라는 이름표를 좋아함
    role: u.Masters ? 'MASTER' : (u.Managers ? 'MANAGER' : 'USER'),
    rootPath: u.rootPath || (u.Masters ? '/' : \`/USERS/\${u.id}\`)
  }));
  const mappedPending = signupRequests.map(r => ({
    id: r.id,
    username: r.id,
    name: r.name || r.id,
    date: r.date || new Date().toISOString().split('T')[0]
  }));
  
  // 마스터 전용 보안 설정(토글) 로드
  let settings = { globalFileAccess: false };
  try {
    const settingsPath = require('path').join(__dirname, 'data', 'settings.json');
    if (require('fs').existsSync(settingsPath)) settings = JSON.parse(require('fs').readFileSync(settingsPath, 'utf8'));
  } catch(e) {}
  
  res.json({ users: mappedUsers, pendingUsers: mappedPending, settings });
});

app.put('/api/users/update', (req, res) => {
  const { users, settings } = req.body;
  
  // 1. 회원 권한 및 경로 업데이트
  if (users) {
    users.forEach(updatedU => {
      const target = approvedUsers.find(u => u.id === updatedU.id);
      if (target) {
        // 🚨 admin 계정은 무조건 절대 마스터! 강등 불가!
        if (target.id === 'admin') {
          target.Masters = true;
          target.Managers = true;
          target.rootPath = '/';
        } else {
          target.Masters = updatedU.role === 'MASTER';
          target.Managers = updatedU.role === 'MANAGER' || updatedU.role === 'MASTER';
          target.rootPath = updatedU.rootPath;
        }
      }
    });
    saveMembers(); // 찬영님의 원래 함수를 호출해서 members.json에 안전하게 영구 저장!
  }
  
  // 2. 보안 설정(토글) 업데이트
  if (settings) {
    require('fs').writeFileSync(require('path').join(__dirname, 'data', 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  }
  res.json({ success: true });
});
`;
        // 서버 시동(app.listen) 직전에 API들을 안전하게 꽂아 넣습니다.
        code = code.replace(/app\.listen\(/, apis + '\napp.listen(');
    }

    fs.writeFileSync(indexPath, code);
    console.log("✅ 백엔드: members.json 실시간 연동 및 admin 절대 마스터화 완료!");
}
