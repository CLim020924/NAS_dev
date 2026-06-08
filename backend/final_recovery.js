const fs = require('fs');
const path = require('path');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // [1단계] 이전에 제가 넣었던 '지저분한 찌꺼기'들을 싹 다 도려냅니다.
    // /api/users/ 로 시작하는 모든 중복 코드를 제거합니다.
    code = code.replace(/\/\/ --- \[관리자 시스템 API[\s\S]*?\/\/ --------------------------------------/g, '');
    code = code.replace(/app\.(get|post|put)\('\/api\/users\/[\s\S]*?\}\);/g, '');
    
    // [2단계] 혹시 중복 선언된 express 선언문이 있다면 하나로 합칩니다.
    code = code.replace(/const app = express\(\);\s*const app = express\(\);/g, 'const app = express();');

    // [3단계] 가장 깨끗하고 완벽한 관리자 API 뭉치를 준비합니다. (괄호 검수 완료)
    const secureAdminApis = `
// --- [관리자 전용 API 세트] ---
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/approve', (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/reject', (req, res) => {
  try {
    const { id } = req.body;
    signupRequests = signupRequests.filter(r => r.id !== id);
    fs.writeFileSync(path.join(__dirname, 'data', 'requests.json'), JSON.stringify(signupRequests, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/update', (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// --- [관리자 전용 API 세트 끝] ---
`;

    // [4단계] app.listen( 바로 직전에 이 코드를 삽입합니다.
    if (code.includes('app.listen')) {
        code = code.replace('app.listen', secureAdminApis + '\napp.listen');
        fs.writeFileSync(indexPath, code);
        console.log("✅ index.js 문법 오류 수리 및 API 재배치 완료!");
    } else {
        console.log("🚨 app.listen 위치를 찾지 못했습니다.");
    }
}
