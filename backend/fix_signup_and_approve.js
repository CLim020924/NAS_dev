const fs = require('fs');
const path = require('path');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 1. 회원가입 API (/api/signup) 수정: 신청 즉시 파일에 저장!
    const oldSignupRegex = /app\.post\('\/api\/signup'[\s\S]*?res\.json\(\{[\s\S]*?\}\);\s*\}\);/m;
    const newSignupApi = `app.post('/api/signup', (req, res) => {
  const { id, password, name } = req.body;
  if (!id || !password) return res.status(400).json({ error: '아이디와 비밀번호는 필수입니다.' });

  if (approvedUsers.find(u => u.id === id) || signupRequests.find(r => r.id === id)) {
    return res.status(400).json({ error: '이미 존재하는 아이디입니다.' });
  }

  const newRequest = { id, password, name: name || id, date: new Date().toISOString().split('T')[0] };
  signupRequests.push(newRequest);
  
  // 🔥 즉시 파일에 저장해서 설정 창에서 보이게 함!
  try {
    const reqPath = path.join(__dirname, 'data', 'requests.json');
    fs.writeFileSync(reqPath, JSON.stringify(signupRequests, null, 2), 'utf8');
  } catch (err) { console.error("가입 요청 저장 실패:", err); }

  console.log("새로운 가입 요청:", id);
  res.json({ message: '가입 신청이 완료되었습니다. 관리자 승인을 기다려주세요.' });
});`;

    code = code.replace(oldSignupRegex, newSignupApi);

    // 2. [핵심] 가입 승인 API 추가: 승인 시 USERS 폴더 자동 생성!
    if (!code.includes("app.post('/api/users/approve'")) {
        const approveApi = `
// 🔥 가입 승인 API: 승인 시 USERS/아이디 폴더 자동 생성
app.post('/api/users/approve', (req, res) => {
  const { id } = req.body;
  const requestIndex = signupRequests.findIndex(r => r.id === id);
  if (requestIndex === -1) return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });

  const request = signupRequests[requestIndex];
  
  // 1. 승인된 목록으로 이동 (기본 권한: USER, 기본 경로: /USERS/아이디)
  const newUser = {
    ...request,
    Masters: false,
    Managers: false,
    disabled: false,
    isOnline: false,
    rootPath: \`/USERS/\${request.id}\`
  };
  
  approvedUsers.push(newUser);
  signupRequests.splice(requestIndex, 1);

  // 2. 실제 물리 폴더 생성 (NAS 루트 하위의 USERS/아이디)
  const userFolderPath = path.join(__dirname, '..', 'storage', 'USERS', request.id);
  try {
    if (!fs.existsSync(userFolderPath)) {
      fs.mkdirSync(userFolderPath, { recursive: true });
      console.log(\`폴더 생성 완료: \${userFolderPath}\`);
    }
  } catch (err) { console.error("사용자 폴더 생성 실패:", err); }

  saveMembers();
  const reqPath = path.join(__dirname, 'data', 'requests.json');
  fs.writeFileSync(reqPath, JSON.stringify(signupRequests, null, 2), 'utf8');

  res.json({ success: true, message: \`\${id} 계정이 승인되었습니다.\` });
});

// 🔥 가입 거절 API
app.post('/api/users/reject', (req, res) => {
  const { id } = req.body;
  signupRequests = signupRequests.filter(r => r.id !== id);
  const reqPath = path.join(__dirname, 'data', 'requests.json');
  fs.writeFileSync(reqPath, JSON.stringify(signupRequests, null, 2), 'utf8');
  res.json({ success: true });
});
`;
        code = code.replace(/app\.listen\(/, approveApi + '\napp.listen(');
    }

    fs.writeFileSync(indexPath, code);
    console.log("✅ 백엔드: 회원가입 저장 및 폴더 자동 생성 승인 로직 탑재 완료!");
}
