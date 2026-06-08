const fs = require('fs');
const filePath = '/home/limchanyoung/my-service-platform/backend/index.js';
let code = fs.readFileSync(filePath, 'utf8');

if (!code.includes('index.html')) {
    const fixCode = `
// 🎨 [프론트엔드 라우팅 방어] 모르는 주소는 다 리액트(index.html)로 토스!
const path = require('path');
app.use(express.static('/var/www/html'));
app.get('*', (req, res) => {
  if(req.path.startsWith('/api')) return res.status(404).json({error: 'API Not Found'});
  res.sendFile('/var/www/html/index.html');
});\n\n`;
    
    // server.listen이나 app.listen 바로 직전에 코드 삽입
    code = code.replace(/server\.listen\(/, fixCode + 'server.listen(');
    code = code.replace(/app\.listen\(/, fixCode + 'app.listen(');
    fs.writeFileSync(filePath, code);
    console.log("✅ 리액트 라우팅(404) 방어 코드 패치 완료!");
} else {
    console.log("✅ 이미 방어 코드가 있습니다.");
}
