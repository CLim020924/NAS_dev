const fs = require('fs');
const path = require('path');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 1. nasPath를 실제 확인된 /mnt/nas 로 고정
    code = code.replace(/const nasPath = .*;/, "const nasPath = '/mnt/nas';");

    // 2. 승인 시 폴더 생성 경로를 USERS -> users(소문자)로 변경
    code = code.replace(
        /path\.join\(__dirname, '..', 'storage', 'USERS', id\)/g,
        "path.join(nasPath, 'users', id)"
    );

    // 3. 유저별 기본 rootPath도 users(소문자) 구조로 변경
    code = code.replace(/\/USERS\/\${user\.id}/g, "/users/${user.id}");
    code = code.replace(/\/USERS\/\${request\.id}/g, "/users/${request.id}");
    code = code.replace(/\/USERS\/\${id}/g, "/users/${id}");

    fs.writeFileSync(indexPath, code);
    console.log("✅ index.js: 실물 저장소 경로(/mnt/nas/users) 동기화 완료!");
}
