const fs = require('fs');
const path = './index.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');
    
    // 🔥 실수로 빼먹었던 회원가입 API 블록입니다.
    const signupApi = `
// [복구됨] 회원가입 요청 접수 API
app.post('/api/signup-request', (req, res) => {
  const { id, password } = req.body;
  if (!id || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  
  if (approvedUsers.find(u => u.id === id) || signupRequests.find(r => r.id === id)) {
    return res.status(400).json({ error: '이미 존재하는 아이디이거나 대기 중인 요청입니다.' });
  }
  
  signupRequests.push({ id, password, date: new Date().toISOString().split('T')[0] });
  saveRequests();
  
  // 관리자 화면 실시간 갱신을 위해 소켓 신호 발송
  io.emit('membersChanged'); 
  
  res.json({ message: '회원가입 요청이 접수되었습니다.' });
});
`;

    // /api/login 바로 위에 안전하게 끼워 넣습니다.
    if (!code.includes('/api/signup-request')) {
        code = code.replace("app.post('/api/login'", signupApi + "\napp.post('/api/login'");
        fs.writeFileSync(path, code);
        console.log("✅ 백엔드: 증발했던 회원가입(signup-request) API 완벽 복구 완료!");
    } else {
        console.log("⚡ 이미 회원가입 API가 존재합니다.");
    }
}
