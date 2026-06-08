const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3030;

// JSON 요청 파서를 사용하고 CORS 설정 적용
app.use(express.json());
app.use(cors());

// 임시 메모리 데이터베이스 (실제 서비스에서는 DB를 사용해야 함)
let approvedUsers = [
  { id: 'dntdlzz', password: '001004asAS@', isMaster: true } // 초기 마스터 계정
];
let signupRequests = [];

// 회원가입 요청 API (POST /api/signup-request)
// 클라이언트가 아이디, 비밀번호, 비밀번호 확인 값을 보냅니다.
app.post('/api/signup-request', (req, res) => {
  const { id, password, passwordConfirm } = req.body;
  if (!id || !password || !passwordConfirm) {
    return res.status(400).json({ error: '모든 항목을 입력해주세요.' });
  }
  if (password !== passwordConfirm) {
    return res.status(400).json({ error: '비밀번호가 일치하지 않습니다.' });
  }
  // 이미 존재하는 아이디인지 확인
  if (approvedUsers.find(user => user.id === id) || signupRequests.find(req => req.id === id)) {
    return res.status(400).json({ error: '이미 존재하는 아이디입니다.' });
  }
  // 회원가입 요청 저장
  const newRequest = { id, password };
  signupRequests.push(newRequest);
  res.json({ message: '회원가입 요청이 접수되었습니다.' });
});

// 로그인 API (POST /api/login)
app.post('/api/login', (req, res) => {
  const { id, password } = req.body;
  const user = approvedUsers.find(u => u.id === id && u.password === password);
  if (!user) {
    return res.status(401).json({ error: '아이디 혹은 비밀번호가 틀렸습니다.' });
  }
  res.json({ message: '로그인 성공', user });
});

// 마스터 전용: 회원가입 요청 목록 조회 (GET /api/signup-requests)
app.get('/api/signup-requests', (req, res) => {
  // 실제 서비스에서는 인증 확인 필요
  res.json(signupRequests);
});

// 마스터 전용: 회원가입 요청 수락 (POST /api/signup-requests/:id/accept)
app.post('/api/signup-requests/:id/accept', (req, res) => {
  const requestId = req.params.id;
  const index = signupRequests.findIndex(r => r.id === requestId);
  if (index === -1) {
    return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
  }
  const newUser = signupRequests[index];
  approvedUsers.push({ id: newUser.id, password: newUser.password, isMaster: false });
  signupRequests.splice(index, 1);
  res.json({ message: '회원가입 요청이 승인되었습니다.' });
});

// 마스터 전용: 회원가입 요청 거절 (POST /api/signup-requests/:id/reject)
app.post('/api/signup-requests/:id/reject', (req, res) => {
  const requestId = req.params.id;
  const index = signupRequests.findIndex(r => r.id === requestId);
  if (index === -1) {
    return res.status(404).json({ error: '요청을 찾을 수 없습니다.' });
  }
  signupRequests.splice(index, 1);
  res.json({ message: '회원가입 요청이 거절되었습니다.' });
});

// 마스터 전용: 새로운 마스터 계정 생성 (POST /api/create-master)
app.post('/api/create-master', (req, res) => {
  const { id, password } = req.body;
  if (!id || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }
  if (approvedUsers.find(u => u.id === id)) {
    return res.status(400).json({ error: '이미 존재하는 아이디입니다.' });
  }
  approvedUsers.push({ id, password, isMaster: true });
  res.json({ message: '새로운 마스터 계정이 생성되었습니다.' });
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
