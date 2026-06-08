const fs = require('fs');
const file = '/home/limchanyoung/my-service-platform/backend/index.js';
let code = fs.readFileSync(file, 'utf8');

// 혹시 모를 찌꺼기 라우팅 코드 싹 다 청소
code = code.replace(/app\.use\(express\.static\('\/var\/www\/html'\)\);[\s\S]*?res\.sendFile\('\/var\/www\/html\/index\.html'\);\n}\);/g, '');

const safeFallback = `
// 🎨 [프론트엔드 라우팅 방어] 모르는 경로는 전부 index.html로!
app.use(express.static('/var/www/html'));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({error: 'API Not Found'});
  res.sendFile('/var/www/html/index.html');
});
`;

if (!code.includes("res.sendFile('/var/www/html/index.html')")) {
    code = code.replace(/server\.listen\(/, safeFallback + '\nserver.listen(');
    code = code.replace(/app\.listen\(/, safeFallback + '\napp.listen(');
    fs.writeFileSync(file, code);
    console.log("✅ 리액트 404 방어막 완벽 패치 완료!");
}
