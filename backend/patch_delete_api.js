const fs = require('fs');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    const deleteApi = `
// 🔥 [보안 강화] 관리자 인증 후 계정 삭제 API
app.post('/api/users/delete', (req, res) => {
  const { targetId, adminId, adminPassword } = req.body;

  // 1. 요청을 보낸 관리자/마스터 본인 확인 및 비밀번호 검증
  const admin = approvedUsers.find(u => u.id === adminId);
  if (!admin || admin.password !== adminPassword) {
    return res.status(401).json({ error: '관리자 비밀번호가 일치하지 않습니다.' });
  }

  // 2. 관리자 권한 확인 (마스터 혹은 매니저만 가능)
  if (!admin.Masters && !admin.Managers) {
    return res.status(403).json({ error: '삭제 권한이 없습니다.' });
  }

  // 3. 삭제 대상 확인 (admin 계정은 삭제 불가)
  if (targetId === 'admin') {
    return res.status(400).json({ error: '시스템 기본 관리자 계정은 삭제할 수 없습니다.' });
  }

  // 4. 삭제 진행
  const initialCount = approvedUsers.length;
  approvedUsers = approvedUsers.filter(u => u.id !== targetId);

  if (approvedUsers.length < initialCount) {
    saveMembers();
    // 해당 유저에게 실시간으로 로그아웃 신호를 보내 세션 종료 (선택 사항)
    io.emit('force_logout_target', { targetId });
    io.emit('membersChanged'); 
    res.json({ success: true, message: '계정이 성공적으로 삭제되었습니다.' });
  } else {
    res.status(404).json({ error: '삭제할 사용자를 찾을 수 없습니다.' });
  }
});
`;

    if (!code.includes('/api/users/delete')) {
        // app.put('/api/users/update' 위에 삽입
        code = code.replace("app.put('/api/users/update'", deleteApi + "\napp.put('/api/users/update'");
        fs.writeFileSync(indexPath, code);
        console.log("✅ 백엔드: 관리자 인증형 삭제 API 주입 완료!");
    }
}
