const fs = require('fs');
const backendPath = './backend/nasRoutes.js';

if (fs.existsSync(backendPath)) {
    let code = fs.readFileSync(backendPath, 'utf8');
    
    // 이미 뚫려있는지 확인
    if (!code.includes("'/file/copy'")) {
        const copyApiCode = `
// 🔥 다중 파일/폴더 복사 API 강제 탑재
router.post('/file/copy', verifyToken, (req, res) => {
  try {
    const { sourcePaths, destinationFolder } = req.body;
    if (!sourcePaths || !Array.isArray(sourcePaths) || destinationFolder === undefined) {
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    const { targetPath: destDir } = getValidatedPath(req.user, destinationFolder);
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    sourcePaths.forEach(src => {
      const { targetPath: srcPath } = getValidatedPath(req.user, src);
      if (!fs.existsSync(srcPath)) return; // 원본이 없으면 패스

      const fileName = path.basename(srcPath);
      let finalDest = path.join(destDir, fileName);
      
      // 파일 이름 중복 방지 로직 (윈도우 스타일)
      let counter = 1;
      while(fs.existsSync(finalDest)) {
        const ext = path.extname(fileName);
        const name = path.basename(fileName, ext);
        finalDest = path.join(destDir, \`\${name} - 복사본 (\${counter})\${ext}\`);
        counter++;
      }

      fs.cpSync(srcPath, finalDest, { recursive: true });
    });

    res.json({ message: '복사 완료' });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});

module.exports = router;
`;
        // 파일의 맨 마지막 줄인 'module.exports = router;' 를 찾아서 그 직전에 통째로 끼워넣기!
        code = code.replace(/module\.exports\s*=\s*router;/, copyApiCode);
        fs.writeFileSync(backendPath, code);
        console.log("✅ 백엔드: 복사 API 강제 주입 대성공!");
    } else {
        console.log("⚡ 백엔드: 이미 복사 API가 있습니다.");
    }
} else {
    console.log("❌ 백엔드 라우터 파일을 찾을 수 없습니다.");
}
