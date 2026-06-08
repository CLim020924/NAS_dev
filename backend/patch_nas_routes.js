const fs = require('fs');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 1. nasRoutes 불러오기 (상단 변수 선언부)
    if (!code.includes("const nasRoutes = require('./nasRoutes');")) {
        code = code.replace("const jwt = require('jsonwebtoken');", "const jwt = require('jsonwebtoken');\nconst nasRoutes = require('./nasRoutes');");
    }

    // 2. /api 경로에 nasRoutes 연결 (미들웨어 설정부)
    if (!code.includes("app.use('/api', nasRoutes);")) {
        // 회원가입 요청 API 직전에 삽입하여 경로 충돌을 방지합니다.
        code = code.replace("app.post('/api/signup-request'", "app.use('/api', nasRoutes);\n\napp.post('/api/signup-request'");
    }

    fs.writeFileSync(indexPath, code);
    console.log("✅ index.js: NAS 파일 경로(nasRoutes) 복구 완료!");
}
