const fs = require('fs');
const path = './index.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    if (!code.includes("'/api/users/reject'")) {
        const rejectApi = `
// 🔥 [긴급 복구] 가입 거절 API
app.post('/api/users/reject', (req, res) => {
  const { id } = req.body;
  signupRequests = signupRequests.filter(r => r.id !== id);
  saveRequests();
  io.emit('membersChanged');
  res.json({ success: true });
});
`;
        // approve API 바로 위에 거절 API를 꽂아 넣습니다.
        code = code.replace("app.post('/api/users/approve'", rejectApi + "\napp.post('/api/users/approve'");
        fs.writeFileSync(path, code);
        console.log("✅ index.js: 가입 거절(reject) API 복구 완료!");
    }
}
