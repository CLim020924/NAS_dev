const fs = require('fs');
const path = './src/App.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 엉터리 쿠키 검사 로직을 로컬스토리지 검사로 교체
    code = code.replace(
        "const token = document.cookie.split('; ').find(row => row.startsWith('token='));\n  return token ? children : <Navigate to=\"/login\" />;",
        "const user = localStorage.getItem('user');\n  return user ? children : <Navigate to=\"/login\" />;"
    );

    fs.writeFileSync(path, code);
    console.log("✅ App.js: 출입문(PrivateRoute) 논리 오류 수정 완료!");
}
