const fs = require('fs');
const execSync = require('child_process').execSync;

// [1] 프론트엔드 URL 복구: 꼼수(/ds/)를 버리고 당당하게 루트(/)로 연결!
const fileViewerPath = './src/components/NAS/FileViewer.js';
if (fs.existsSync(fileViewerPath)) {
    let code = fs.readFileSync(fileViewerPath, 'utf8');
    code = code.replace(/documentServerUrl=\{.*?\}/g, 'documentServerUrl={`https://${window.location.hostname}/`}');
    fs.writeFileSync(fileViewerPath, code);
    console.log("✅ 프론트엔드 연결 주소 완벽 복구!");
}

// [2] Nginx 파일 탐색
let confPath = '';
try { confPath = execSync('grep -rl "filemanager-nas.com" /etc/nginx/ | grep -v "sites-enabled" | head -n 1').toString().trim(); } catch(e) {}
if (!confPath) confPath = '/etc/nginx/sites-available/default';

let conf = fs.readFileSync(confPath, 'utf8');

// 예전에 만들었던 쓸모없는 /ds/ 통로 싹 지우기
conf = conf.replace(/location \/ds\/ \{[\s\S]*?\}/g, '');

// 🔥 ONLYOFFICE 전용 핀셋 프록시 블록 (리액트와 절대 안 겹침!)
const proxyBlock = `
    # ONLYOFFICE 전용 라우팅
    location ~ ^/(web-apps|coauthoring|hosting|cache|fonts|sdkjs|ConvertService\\.ashx|Preloader\\.ashx|info\\.json) {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }`;

// HTTPS 설정 부분에 삽입
if (!conf.includes('web-apps|coauthoring')) {
    conf = conf.replace(/(listen\s+443[^;]*;)/, (match) => match + '\n' + proxyBlock);
    fs.writeFileSync(confPath, conf);
    console.log("✅ Nginx ONLYOFFICE 핀셋 라우팅 개통 완료!");
}
