const fs = require('fs');
const file = '/home/limchanyoung/my-service-platform/backend/index.js';
let code = fs.readFileSync(file, 'utf8');

// 방어막 코드에 껴있던 중복 선언 줄만 쏙 빼서 덮어쓰기
code = code.replace("const path = require('path');\napp.use(express.static('/var/www/html'));", "app.use(express.static('/var/www/html'));");

fs.writeFileSync(file, code);
console.log("✅ 겹치는 'path' 변수 삭제 완료!");
