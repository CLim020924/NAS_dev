const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser'); // 🔹 쿠키 사용을 위한 모듈
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3030;

// 🔹 JSON 요청 파서 및 CORS 설정
app.use(express.json());
app.use(cors({
  origin: '*',
  credentials: true // 🔹 쿠키 포함 허용
}));
app.use(cookieParser()); // 🔹 쿠키 파서 추가

// 🔹 회원 데이터 (실제 서비스에서는 DB 사용)
let approvedUsers = [
  { id: 'dntdlzz', password: '001004asAS@', isMaster: true, disabled: false, isOnline: false }
];
let signupRequests = [];

// 🔹 NAS 경로 설정 (실제 NAS 마운트된 경로)
const nasPath = '/mnt/nas';

// 🔹 NAS 파일/폴더 목록 반환
app.get('/api/files', (req, res) => {
  fs.readdir(nasPath, (err, items) => {
    if (err) {
      console.error('NAS 파일 읽기 실패:', err);
      return res.status(500).json({ error: '파일 읽기 에러' });
    }

    const data = items.map(item => {
      const fullPath = path.join(nasPath, item);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (e) {
        return null;
      }

      const folder = path.dirname(fullPath) === nasPath ? 'Root' : path.basename(path.dirname(fullPath));
      return {
        name: item,
        type: stat.isDirectory() ? 'folder' : 'file',
        fullPath,
        folder: stat.isDirectory() ? folder : undefined,
        url: stat.isDirectory() ? null : `http://${req.headers.host}/api/file?path=${encodeURIComponent(fullPath)}`
      };
    }).filter(item => item !== null);

    res.json(data);
  });
});

// 🔹 특정 파일 전송
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) {
    return res.status(400).send('파일 경로 필요');
  }
  res.sendFile(filePath);
});

// 🔹 회원가입 요청
app.post('/api/signup-request', (req, res) => {
  const { id, password, passwordConfirm } = req.body;
  if (!id || !password || !passwordConfirm) {
    return res.status(400).json({ error: '모든 항목을 입력해주세요.' });
  }
  if (password !== passwordConfirm) {
    return res.status(400).json({ error: '비밀번호가 일치하지 않습니다.' });
  }
  if (approvedUsers.find(user => user.id === id) || signupRequests.find(req => req.id === id)) {
    return res.status(400).json({ error: '이미 존재하는 아이디입니다.' });
  }

  signupRequests.push({ id, password });
  res.json({ message: '회원가입 요청이 접수되었습니다.' });
});

// 🔹 로그인
app.post('/api/login', (req, res) => {
  const { id, password } = req.body;
  const user = approvedUsers.find(u => u.id === id && u.password === password);

  if (!user) {
    return res.status(401).json({ error: '아이디 혹은 비밀번호가 틀렸거나 계정이 비활성화되었습니다.' });
  }
  if (user.disabled) {
    return res.status(403).json({ error: '관리자에 의해 비활성화된 계정입니다.' });
  }

  user.isOnline = true;

  // 🔹 로그인 성공 시 쿠키 설정
  res.cookie('token', 'your_secure_token', { 
    httpOnly: true,
    secure: false,  // 🔹 HTTPS 사용 시 true로 변경
    sameSite: 'None'  // 🔹 다른 도메인에서도 사용 가능하도록 설정
  });

  res.json({ message: '로그인 성공', user });
});

// 🔹 로그아웃
app.post('/api/logout', (req, res) => {
  const { id } = req.body;
  const user = approvedUsers.find(u => u.id === id);
  if (user) {
    user.isOnline = false;
    res.json({ message: '로그아웃 성공' });
  } else {
    res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  }
});

// 🔹 회원 목록 반환
app.get('/api/members', (req, res) => {
  res.json(approvedUsers);
});

// 🔹 회원 비활성화
app.delete('/api/members/:id', (req, res) => {
  const { id } = req.params;
  const { requesterId } = req.body;

  const requester = approvedUsers.find(u => u.id === requesterId);
  if (!requester || !requester.isMaster) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }

  const user = approvedUsers.find(u => u.id === id);
  if (!user) {
    return res.status(404).json({ error: '회원이 존재하지 않습니다.' });
  }

  user.disabled = true;
  res.json({ message: '회원이 비활성화되었습니다.' });
});

// 🔹 회원 활성화
app.put('/api/members/:id/enable', (req, res) => {
  const { id } = req.params;
  const { requesterId } = req.body;

  const requester = approvedUsers.find(u => u.id === requesterId);
  if (!requester || !requester.isMaster) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }

  const user = approvedUsers.find(u => u.id === id);
  if (!user) {
    return res.status(404).json({ error: '회원이 존재하지 않습니다.' });
  }

  user.disabled = false;
  res.json({ message: '회원이 활성화되었습니다.' });
});

// 🔹 회원 삭제
app.delete('/api/members/:id/permanent', (req, res) => {
  const { id } = req.params;
  const { requesterId } = req.body;

  const requester = approvedUsers.find(u => u.id === requesterId);
  if (!requester || !requester.isMaster) {
    return res.status(403).json({ error: '권한이 없습니다.' });
  }

  approvedUsers = approvedUsers.filter(user => user.id !== id);
  res.json({ message: '회원이 삭제되었습니다.' });
});

// 🔹 서버 실행
app.listen(PORT, '0.0.0.0', () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
