const fs = require('fs');
const path = require('path');
const indexPath = './index.js';

if (fs.existsSync(indexPath)) {
    let code = fs.readFileSync(indexPath, 'utf8');

    // 1. 기존 삭제 로직을 '백업 이동' 로직으로 교체
    const oldDeleteLogic = /\/\/ 4\. 삭제 진행[\s\S]*?approvedUsers = approvedUsers\.filter\(u => u\.id !== targetId\);/;
    const newDeleteLogic = `// 4. 데이터 백업 및 삭제 진행
  const userFolderPath = path.join('/mnt/nas/users', targetId);
  const backupRootPath = path.join('/mnt/nas/users', 'backup');
  
  // 백업 폴더가 없으면 생성
  if (!fs.existsSync(backupRootPath)) fs.mkdirSync(backupRootPath, { recursive: true });

  if (fs.existsSync(userFolderPath)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupRootPath, \`\${targetId}_\${timestamp}\`);
    
    try {
      fs.renameSync(userFolderPath, backupPath); // 폴더 이동 (백업)
      console.log(\`[백업] \${targetId}의 데이터가 \${backupPath}로 이동되었습니다.\`);
    } catch (err) {
      console.error("폴더 백업 이동 실패:", err);
    }
  }

  approvedUsers = approvedUsers.filter(u => u.id !== targetId);`;

    code = code.replace(oldDeleteLogic, newDeleteLogic);
    fs.writeFileSync(indexPath, code);
    console.log("✅ 백엔드: 폴더 백업 이동 로직 적용 완료!");
}
