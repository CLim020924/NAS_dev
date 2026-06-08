const fs = require('fs');
const path = require('path');
const backendPath = path.join(__dirname, 'backend', 'nasRoutes.js');

if (fs.existsSync(backendPath)) {
    let code = fs.readFileSync(backendPath, 'utf8');

    // 1. 혹시 전에 잘못 들어간 찌꺼기 코드나 기존 module.exports 전부 삭제!
    code = code.replace(/module\.exports\s*=\s*router;?/g, '');
    
    // 2. 파일 맨 끝자락에 복사 API와 module.exports를 통째로 새롭게 이어붙임!
    const copyRoute = `
// 🔥 [최종 강제 주입] 완벽 복사 API
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
      if (!fs.existsSync(srcPath)) return;

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
    console.error("복사 에러:", err);
    res.status(500).json({ error: err.message });
  }
});

// 파일의 진짜 마지막 마무리
module.exports = router;
`;
    code += copyRoute;
    fs.writeFileSync(backendPath, code);
    console.log("✅ 대성공: 백엔드 파일 맨 밑바닥에 복사 API를 강제 이식했습니다!");
} else {
    console.log("❌ nasRoutes.js 파일을 찾을 수 없습니다!");
}
