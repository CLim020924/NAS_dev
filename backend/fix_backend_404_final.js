const fs = require('fs');
const path = require('path');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 1. 기존에 잘못 들어갔을 수 있는 찌꺼기 코드들 제거 (중복 방지)
    code = code.replace(/\/\/ 🔥 \[계정 관리\] 진짜 DB[\s\S]*?\n\n/g, '');
    code = code.replace(/app\.get\('\/api\/users\/data'[\s\S]*?\}\);\n/g, '');
    code = code.replace(/app\.put\('\/api\/users\/update'[\s\S]*?\}\);\n/g, '');

    // 2. [핵심] /api/login API 바로 뒤에 관리자 전용 API들을 정확한 주소로 주입!
    const loginApiMarker = /app\.post\('\/api\/login'[\s\S]*?\}\);/m;
    
    const adminApis = `

// 🔥 [관리자] 사용자 데이터 및 대기열 로드 API
app.get('/api/users/data', (req, res) => {
  try {
    const mappedUsers = approvedUsers.map(u => ({
      id: u.id,
      username: u.id,
      role: u.Masters ? 'MASTER' : (u.Managers ? 'MANAGER' : 'USER'),
      rootPath: u.rootPath || (u.Masters ? '/' : \`/USERS/\${u.id}\`)
    }));
    
    const mappedPending = signupRequests.map(r => ({
      id: r.id,
      username: r.id,
      name: r.name || r.id,
      date: r.date || new Date().toISOString().split('T')[0]
    }));

    let settings = { globalFileAccess: false };
    const settingsPath = path.join(__dirname, 'data', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    
    res.json({ users: mappedUsers, pendingUsers: mappedPending, settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔥 [관리자] 사용자 권한 및 루트 경로 업데이트 API
app.put('/api/users/update', (req, res) => {
  const { users, settings } = req.body;
  if (users) {
    users.forEach(updatedU => {
      const target = approvedUsers.find(u => u.id === updatedU.id);
      if (target) {
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
    saveMembers();
  }
  if (settings) {
    const settingsPath = path.join(__dirname, 'data', 'settings.json');
    if (!fs.existsSync(path.dirname(settingsPath))) fs.mkdirSync(path.dirname(settingsPath), {recursive: true});
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  res.json({ success: true });
});
`;

    if (code.match(loginApiMarker)) {
        code = code.replace(loginApiMarker, (match) => match + adminApis);
        fs.writeFileSync(indexPath, code);
        console.log("✅ index.js: /api/users API 주소 및 위치 완벽 교정 완료!");
    } else {
        console.log("🚨 /api/login 위치를 찾지 못했습니다. 파일 구조를 확인해주세요.");
    }
}
