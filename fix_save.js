const fs = require('fs');
const path = require('path');

// [1] 백엔드 패치: 임의의 폴더가 아닌 사용자 클라우드 절대 경로에 정확히 덮어쓰기
const backendPath = './backend/nasRoutes.js';
if (fs.existsSync(backendPath)) {
    let beCode = fs.readFileSync(backendPath, 'utf8');
    
    const oldCallback = /router\.post\('\/onlyoffice\/callback'[\s\S]*?module\.exports = router;/;
    const newCallback = `router.post('/onlyoffice/callback', async (req, res) => {
  const { status, url } = req.body;
  const relPath = req.query.path;
  const uid = req.query.uid;
  const isAdmin = req.query.isAdmin === 'true';

  // 2 = 일반 저장 완료, 6 = Ctrl+S 강제 저장
  if (status === 2 || status === 6) { 
    try {
      const axios = require('axios');
      const fs = require('fs');
      const path = require('path');
      
      // 🔥 NAS의 절대 경로를 완벽하게 역추적
      const nasPath = process.env.NAS_PATH || '/mnt/nas';
      const basePath = isAdmin ? nasPath : path.join(nasPath, 'users', uid || 'default');
      const safeReqPath = (relPath || '').replace(/^(\\/|\\\\)+/, '');
      const absoluteFilePath = path.resolve(basePath, safeReqPath);

      // 오피스 서버에서 완성된 파일 다운로드 후 NAS에 덮어쓰기
      const response = await axios.get(url, { responseType: 'stream' });
      const writer = fs.createWriteStream(absoluteFilePath);
      response.data.pipe(writer);
      
      writer.on('finish', () => { return res.json({ error: 0 }); });
      writer.on('error', (err) => { return res.json({ error: 1 }); });
    } catch (error) {
      return res.json({ error: 1 });
    }
  } else {
    return res.json({ error: 0 });
  }
});

module.exports = router;`;

    beCode = beCode.replace(oldCallback, newCallback);
    fs.writeFileSync(backendPath, beCode);
    console.log("✅ 백엔드: 파일 덮어쓰기 절대경로 매핑 완료!");
}

// [2] 프론트엔드 패치: 강제 저장(forcesave) 활성화 및 내 정보(uid) 전달
const frontendPath = './frontend/src/components/NAS/FileViewer.js';
if (fs.existsSync(frontendPath)) {
    let feCode = fs.readFileSync(frontendPath, 'utf8');

    // 내 정보 추출 로직 삽입
    if (!feCode.includes("const currentUser = JSON.parse(localStorage.getItem('user'))")) {
        feCode = feCode.replace(
            /const isOffice = /g, 
            `const currentUser = JSON.parse(localStorage.getItem('user')) || {};\n  const isAdmin = currentUser.Masters || currentUser.Managers;\n  const isOffice = `
        );
    }

    // 콜백 주소에 내 정보 포함 (백엔드가 경로를 찾을 수 있도록)
    feCode = feCode.replace(
        /const callbackUrl = \`\$\{window\.location\.origin\}\/api\/onlyoffice\/callback\?path=\$\{encodeURIComponent\(win\.fullPath\)\}\`;/g,
        'const callbackUrl = `${window.location.origin}/api/onlyoffice/callback?path=${encodeURIComponent(win.fullPath)}&uid=${currentUser.id || ""}&isAdmin=${isAdmin ? "true" : "false"}`;'
    );

    // 🔥 Ctrl + S 누르면 즉각 저장되도록 forcesave 옵션 강제 주입
    if (!feCode.includes('forcesave: true')) {
        feCode = feCode.replace(
            /mode: "edit",/g,
            'mode: "edit",\n                customization: { forcesave: true, autosave: true },'
        );
    }

    fs.writeFileSync(frontendPath, feCode);
    console.log("✅ 프론트엔드: 강제 저장(Ctrl+S) 설정 및 유저 동기화 완료!");
}
