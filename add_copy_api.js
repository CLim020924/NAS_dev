const fs = require('fs');

const backendPath = './backend/nasRoutes.js';
if (fs.existsSync(backendPath)) {
    let code = fs.readFileSync(backendPath, 'utf8');
    
    // 이미 추가되어 있는지 확인
    if (!code.includes("router.post('/file/copy'")) {
        const copyApiCode = `
// 🔥 다중 파일/폴더 복사 API (Ctrl + C / Ctrl + V)
router.post('/file/copy', verifyToken, (req, res) => {
  try {
    const { sourcePaths, destinationFolder } = req.body;
    if (!sourcePaths || !Array.isArray(sourcePaths) || destinationFolder === undefined) {
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    const { targetPath: destDir } = getValidatedPath(req.user, destinationFolder);

    // 대상 폴더가 없으면 생성
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    sourcePaths.forEach(src => {
      const { targetPath: srcPath } = getValidatedPath(req.user, src);
      if (!fs.existsSync(srcPath)) return; // 원본이 없으면 패스

      const fileName = path.basename(srcPath);
      let finalDest = path.join(destDir, fileName);
      
      // 파일 이름 중복 방지 (윈도우 스타일: - 복사본 (1))
      let counter = 1;
      while(fs.existsSync(finalDest)) {
        const ext = path.extname(fileName);
        const name = path.basename(fileName, ext);
        finalDest = path.join(destDir, \`\${name} - 복사본 (\${counter})\${ext}\`);
        counter++;
      }

      // 폴더와 파일 모두 재귀적으로 완벽하게 복사
      fs.cpSync(srcPath, finalDest, { recursive: true });
    });

    res.json({ message: '복사 완료' });
  } catch (err) { 
    res.status(500).json({ error: err.message }); 
  }
});
`;
        // 파일 삭제(DELETE) 라우터 바로 아래에 복사 라우터 끼워넣기
        code = code.replace(
            /router\.delete\('\/file', verifyToken, \(req, res\) => \{[\s\S]*?\}\);\n/g,
            match => match + '\n' + copyApiCode
        );
        
        fs.writeFileSync(backendPath, code);
        console.log("✅ 백엔드: 다중 복사(Copy & Paste) API 탑재 완료!");
    } else {
        console.log("⚡ 백엔드: 이미 복사 API가 존재합니다.");
    }
}
