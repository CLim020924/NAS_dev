const fs = require('fs');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    const newApi = `
// 🔥 [신규] 개별 사용자 비밀번호 변경 API
app.put('/api/users/password', (req, res) => {
  const { id, currentPassword, newPassword } = req.body;
  const user = approvedUsers.find(u => u.id === id);
  
  if (!user) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  if (user.password !== currentPassword) return res.status(401).json({ error: '현재 비밀번호가 일치하지 않습니다.' });

  user.password = newPassword; // 비밀번호 업데이트
  saveMembers(); // DB(members.json)에 영구 저장
  res.json({ success: true, message: '비밀번호가 성공적으로 변경되었습니다.' });
});
`;

    // API를 안전한 위치에 삽입
    if (!code.includes('/api/users/password')) {
        code = code.replace("app.put('/api/users/update'", newApi + "\napp.put('/api/users/update'");
        fs.writeFileSync(indexPath, code);
        console.log("✅ index.js: 비밀번호 변경 API 주입 완료!");
    } else {
        console.log("⚡ 이미 비밀번호 변경 API가 존재합니다.");
    }
}
