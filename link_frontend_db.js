const fs = require('fs');
const path = './frontend/src/components/Settings.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // axios 추가
    if (!code.includes("import axios")) {
        code = code.replace(/import React[^;]+;/, "$&\nimport axios from 'axios';");
    }

    // 기존의 하드코딩된 가짜 데이터 덩어리를 찾아냅니다.
    const fakeDataRegex = /\/\/ \(임시\) 가입 승인 대기자 및 기존 사용자 목록 데이터[\s\S]*?\]\);/m;
    
    // 백엔드 DB와 실시간 통신하는 뇌(State & useEffect)로 교체합니다.
    const realDbLogic = `
  // 🔥 백엔드 DB와 연동되는 진짜 상태 변수들
  const [pendingUsers, setPendingUsers] = useState([]);
  const [users, setUsers] = useState([]);

  // DB에서 데이터 불러오기
  useEffect(() => {
    if (activeTab === 2 && isManager) {
      axios.get('/api/users/data', { withCredentials: true })
        .then(res => {
          if (res.data) {
            setUsers(res.data.users || []);
            setPendingUsers(res.data.pendingUsers || []);
            setGlobalFileAccess(res.data.settings?.globalFileAccess || false);
          }
        })
        .catch(err => console.error("DB 로드 실패:", err));
    }
  }, [activeTab, isManager]);

  // 권한/경로 변경 시 백엔드 DB에 즉시 저장하는 함수
  const handleUserUpdate = (updatedUsers) => {
    setUsers(updatedUsers);
    axios.put('/api/users/update', { users: updatedUsers }, { withCredentials: true })
      .catch(err => alert("DB 업데이트 실패: " + err.message));
  };
  
  // 글로벌 토글 변경 시 백엔드 DB에 즉시 저장
  const handleGlobalAccessToggle = (e) => {
    const val = e.target.checked;
    setGlobalFileAccess(val);
    localStorage.setItem('nas_global_file_access', val);
    axios.put('/api/users/update', { settings: { globalFileAccess: val } }, { withCredentials: true });
  };
`;
    
    // 코드 교체 및 기존 handleGlobalAccessToggle 제거
    code = code.replace(fakeDataRegex, realDbLogic);
    code = code.replace(/const handleGlobalAccessToggle = \(e\) => \{[\s\S]*?\/\/ 실제로는 백엔드 API로 전송해야 함\n\s*\};/m, '');

    // Select 및 input 변경 시 handleUserUpdate 호출하도록 수정
    code = code.replace(
        /<Select size="small" value=\{u\.role\}/g,
        "<Select size=\"small\" value={u.role} onChange={(e) => handleUserUpdate(users.map(user => user.id === u.id ? { ...user, role: e.target.value } : user))}"
    );
    code = code.replace(
        /<input type="text" defaultValue=\{u\.rootPath\}/g,
        "<input type=\"text\" defaultValue={u.rootPath} onBlur={(e) => handleUserUpdate(users.map(user => user.id === u.id ? { ...user, rootPath: e.target.value } : user))}"
    );

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 백엔드 DB 실시간 연동 완료!");
}
