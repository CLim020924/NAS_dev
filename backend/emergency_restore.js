const fs = require('fs');
const path = require('path');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 1. 중복되거나 망가진 선언부 청소 (가장 중요)
    // 아까 강제로 넣었던 중복된 'const app = express();' 등을 제거합니다.
    code = code.replace(/const app = express\(\);\s*const app = express\(\);/g, 'const app = express();');
    
    // 2. 관리자 API 뭉치를 안전한 위치(파일 맨 마지막 app.listen 직전)로 이동
    // 기존에 잘못 들어간 API 패턴들을 제거
    code = code.replace(/app\.(get|post|put)\('\/api\/users\/[\s\S]*?\}\);/g, '');

    const adminApis = `
// --- [관리자 시스템 API 안전 주입] ---
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
`;

    // app.listen 바로 앞에 삽입
    code = code.replace(/app\.listen/, adminApis + '\napp.listen');
    
    fs.writeFileSync(indexPath, code);
    console.log("✅ index.js 복구 및 API 재배치 완료!");
}
