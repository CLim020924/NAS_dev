const fs = require('fs');
const path = require('path');

// 1) 데이터베이스 파일 초기화 (admin을 MASTER로 강제 지정!)
const dbPath = path.join(__dirname, 'backend', 'users_db.json');
if (!fs.existsSync(dbPath)) {
    const initialDB = {
        users: [
            { id: 'admin_1', username: 'admin', role: 'MASTER', rootPath: '/' }
        ],
        pendingUsers: [],
        settings: {
            globalFileAccess: false
        }
    };
    fs.writeFileSync(dbPath, JSON.stringify(initialDB, null, 2), 'utf8');
    console.log("✅ 백엔드: users_db.json (미니 DB) 생성 및 admin 마스터 지정 완료!");
}

// 2) 백엔드 라우터(nasRoutes.js)에 DB 읽기/쓰기 API 주입
const backendPath = path.join(__dirname, 'backend', 'nasRoutes.js');
if (fs.existsSync(backendPath)) {
    let code = fs.readFileSync(backendPath, 'utf8');
    
    // 기존 찌꺼기 module.exports 삭제
    code = code.replace(/module\.exports\s*=\s*router;?/g, '');

    const dbApiCode = `
// 🔥 [계정 관리 DB] 데이터 불러오기 API
router.get('/users/data', verifyToken, (req, res) => {
    try {
        const dbPath = require('path').join(__dirname, 'users_db.json');
        if (!require('fs').existsSync(dbPath)) return res.json({ users: [], pendingUsers: [], settings: {} });
        const dbData = JSON.parse(require('fs').readFileSync(dbPath, 'utf8'));
        res.json(dbData);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 🔥 [계정 관리 DB] 권한, 경로, 설정 업데이트 API (마스터/관리자 전용)
router.put('/users/update', verifyToken, (req, res) => {
    try {
        const { users, pendingUsers, settings } = req.body;
        const dbPath = require('path').join(__dirname, 'users_db.json');
        
        // 현재 DB 불러오기
        const dbData = JSON.parse(require('fs').readFileSync(dbPath, 'utf8'));
        
        // 데이터 병합 (전달된 데이터만 업데이트)
        if (users) dbData.users = users;
        if (pendingUsers) dbData.pendingUsers = pendingUsers;
        if (settings) dbData.settings = { ...dbData.settings, ...settings };

        // 파일에 쓰기 (영구 보존)
        require('fs').writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf8');
        res.json({ success: true, message: "DB 업데이트 완료" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
`;
    if (!code.includes('/users/data')) {
        code += dbApiCode;
        fs.writeFileSync(backendPath, code);
        console.log("✅ 백엔드: 계정 연동 API (GET / PUT) 탑재 완료!");
    }
}
