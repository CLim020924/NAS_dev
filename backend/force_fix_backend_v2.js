const fs = require('fs');
const path = require('path');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 1. 기존에 잘못 들어간 승인/거절/데이터 API 코드들 싹 제거 (청소)
    code = code.replace(/\/\/ 🔥 \[관리자\][\s\S]*?(\n\n|\s*app\.listen)/g, 'app.listen');
    code = code.replace(/app\.(post|get|put)\('\/api\/users\/[\s\S]*?\}\);/g, '');

    // 2. [핵심] express() 선언 바로 다음에 관리자 API를 강제로 끼워넣기
    const expressInitMarker = /const app = express\(\);/;
    
    const adminApis = `
const app = express();

// --- [관리자 시스템 API 강제 주입] ---
app.get('/api/users/data', (req, res) => {
  try {
    const mappedUsers = approvedUsers.map(u => ({
      id: u.id, username: u.id,
      role: u.Masters ? 'MASTER' : (u.Managers ? 'MANAGER' : 'USER'),
      rootPath: u.rootPath || (u.Masters ? '/' : \`/USERS/\${u.id}\`)
    }));
    const mappedPending = signupRequests.map(r => ({
      id: r.id, username: r.id, name: r.name || r.id,
      date: r.date || new Date().toISOString().split('T')[0]
    }));
    res.json({ users: mappedUsers, pendingUsers: mappedPending });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/users/approve', (req, res) => {
  const { id } = req.body;
  const requestIndex = signupRequests.findIndex(r => r.id === id);
  if (requestIndex === -1) return res.status(404).json({ error: '요청 없음' });

  const request = signupRequests[requestIndex];
  const newUser = { ...request, Masters: false, Managers: false, disabled: false, rootPath: \`/USERS/\${request.id}\` };
  approvedUsers.push(newUser);
  signupRequests.splice(requestIndex, 1);

  const userPath = path.join(__dirname, '..', 'storage', 'USERS', request.id);
  if (!fs.existsSync(userPath)) fs.mkdirSync(userPath, { recursive: true });

  saveMembers();
  fs.writeFileSync(path.join(__dirname, 'data', 'requests.json'), JSON.stringify(signupRequests, null, 2));
  res.json({ success: true });
});

app.post('/api/users/reject', (req, res) => {
  const { id } = req.body;
  signupRequests = signupRequests.filter(r => r.id !== id);
  fs.writeFileSync(path.join(__dirname, 'data', 'requests.json'), JSON.stringify(signupRequests, null, 2));
  res.json({ success: true });
});

app.put('/api/users/update', (req, res) => {
  const { users } = req.body;
  if (users) {
    users.forEach(u => {
      const target = approvedUsers.find(au => au.id === u.id);
      if (target && target.id !== 'admin') {
        target.Masters = u.role === 'MASTER';
        target.Managers = u.role === 'MANAGER' || u.role === 'MASTER';
        target.rootPath = u.rootPath;
      }
    });
    saveMembers();
  }
  res.json({ success: true });
});
// --------------------------------------
`;

    if (code.match(expressInitMarker)) {
        code = code.replace(expressInitMarker, adminApis);
        fs.writeFileSync(indexPath, code);
        console.log("✅ 백엔드: API 위치를 최상단으로 강제 조정 완료!");
    } else {
        console.log("🚨 구문을 찾지 못했습니다.");
    }
}
