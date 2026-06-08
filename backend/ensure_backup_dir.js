const fs = require('fs');
const path = require('path');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');
    const initDir = `
// 서버 시작 시 루트 백업 폴더 생성
const systemBackupPath = '/mnt/nas/backup';
if (!fs.existsSync(systemBackupPath)) fs.mkdirSync(systemBackupPath, { recursive: true });
`;
    if (!code.includes('systemBackupPath')) {
        code = code.replace("const nasPath = '/mnt/nas';", "const nasPath = '/mnt/nas';" + initDir);
        fs.writeFileSync(indexPath, code);
        console.log("✅ index.js: 시스템 백업 폴더 자동 생성 로직 주입 완료!");
    }
}
