const fs = require('fs');
const path = require('path');
const nasRoutesPath = './nasRoutes.js';

if (fs.existsSync(nasRoutesPath)) {
    let code = fs.readFileSync(nasRoutesPath, 'utf8');

    // 1. 보안 로직 강화: getValidatedPath 함수 수정
    // 일반 유저가 'users/backup'이라는 단어가 포함된 경로에 접근하려고 하면 즉시 차단합니다.
    const oldValidatedPath = /const getValidatedPath = \(user, requestedPath\) => \{[\s\S]*?basePath, targetPath \};/g;
    const newValidatedPath = `const getValidatedPath = (user, requestedPath) => {
  const isPrivileged = user.Masters || user.globalAccess;
  const basePath = isPrivileged 
    ? nasPath 
    : path.join(nasPath, 'users', user.id);

  const safeReqPath = (requestedPath || '').replace(/^(\/|\\)+/, '');
  const targetPath = path.resolve(basePath, safeReqPath);

  // 🔒 [보안 추가] 마스터/전체권한이 없는 유저가 backup 폴더 경로를 포함하면 차단
  const relativeFromNas = path.relative(nasPath, targetPath);
  if (!isPrivileged && relativeFromNas.split(path.sep).includes('backup')) {
    throw new Error('보안 정책상 접근이 제한된 시스템 폴더입니다.');
  }

  if (!targetPath.startsWith(path.resolve(basePath))) {
    throw new Error('접근 권한이 없는 경로입니다.');
  }

  return { basePath, targetPath };
};`;

    code = code.replace(oldValidatedPath, newValidatedPath);

    // 2. 서버 시작 시 백업 폴더 자동 생성 로직 추가
    if (!code.includes("users/backup")) {
        const backupInit = `
const backupPath = path.join(nasPath, 'users', 'backup');
if (!fs.existsSync(backupPath)) {
  fs.mkdirSync(backupPath, { recursive: true });
  console.log('📂 시스템 백업 폴더(/users/backup) 생성 완료');
}
`;
        code = code.replace("if (!fs.existsSync(nasPath)) {", backupInit + "\nif (!fs.existsSync(nasPath)) {");
    }

    fs.writeFileSync(nasRoutesPath, code);
    console.log("✅ nasRoutes.js: 백업 폴더 보안 및 자동 생성 로직 반영 완료!");
}
