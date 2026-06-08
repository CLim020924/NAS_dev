const fs = require('fs');
const execSync = require('child_process').execSync;

// [1] 프론트엔드 코드 수정: 위험한 8080(HTTP) 주소를 안전한 통로(HTTPS)로 교체
const fileViewerPath = './src/components/NAS/FileViewer.js';
if (fs.existsSync(fileViewerPath)) {
    let code = fs.readFileSync(fileViewerPath, 'utf8');
    code = code.split('documentServerUrl={`http://${window.location.hostname}:8080/`}').join('documentServerUrl={`https://${window.location.hostname}/ds/`}');
    fs.writeFileSync(fileViewerPath, code);
    console.log("✅ 프론트엔드 주소 안전하게 교체 완료!");
}

// [2] Nginx 파일 탐색 및 HTTPS 통로(리버스 프록시) 뚫어주기
let confPath = '';
try { confPath = execSync('grep -rl "filemanager-nas.com" /etc/nginx/sites-available/').toString().trim().split('\n')[0]; } catch(e) {}
if (!confPath) confPath = '/etc/nginx/sites-available/default';

let conf = fs.readFileSync(confPath, 'utf8');

// 이전에 잘못 들어간 찌꺼기 블록 청소
conf = conf.replace(/location \/ds\/ \{[\s\S]*?\}/g, '');

const proxyBlock = `
    location /ds/ {
        rewrite ^/ds/(.*) /$1 break;
        proxy_pass http://127.0.0.1:8080;
        proxy_redirect off;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host/ds;
        proxy_set_header X-Forwarded-Proto https;
    }`;

// 443 (HTTPS) 블록에 정확히 주입!
conf = conf.replace(/(listen\s+443[^;]*;)/, (match) => match + '\n' + proxyBlock);
fs.writeFileSync(confPath, conf);
console.log("✅ Nginx HTTPS 보안 통로 개설 완료!");
