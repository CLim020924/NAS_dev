const fs = require('fs');
const path = './src/components/Settings.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 승인 함수 추가
    const actionLogic = `
  const handleApprove = (id) => {
    axios.post('/api/users/approve', { id }, { withCredentials: true })
      .then(() => {
        setPendingUsers(prev => prev.filter(p => p.id !== id));
        // 유저 목록 갱신을 위해 API 다시 호출하거나 새로고침 유도
        window.location.reload(); 
      })
      .catch(err => alert("승인 실패: " + err.message));
  };

  const handleReject = (id) => {
    axios.post('/api/users/reject', { id }, { withCredentials: true })
      .then(() => setPendingUsers(prev => prev.filter(p => p.id !== id)))
      .catch(err => alert("거절 실패: " + err.message));
  };
`;
    code = code.replace(/const handleUserUpdate =/m, actionLogic + "\n  const handleUserUpdate =");

    // 버튼에 함수 연결
    code = code.replace(/<IconButton color="success" size="small"><CheckCircleIcon \/><\/IconButton>/g, `<IconButton color="success" size="small" onClick={() => handleApprove(p.id)}><CheckCircleIcon /></IconButton>`);
    code = code.replace(/<IconButton color="error" size="small"><CancelIcon \/><\/IconButton>/g, `<IconButton color="error" size="small" onClick={() => handleReject(p.id)}><CancelIcon /></IconButton>`);

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 승인/거절 버튼 기능 연결 완료!");
}
