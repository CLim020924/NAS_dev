const fs = require('fs');
const path = require('path');
const backendPath = path.join(__dirname, 'backend', 'nasRoutes.js');

if (fs.existsSync(backendPath)) {
    let code = fs.readFileSync(backendPath, 'utf8');

    // 기존 찌꺼기 module.exports 삭제
    code = code.replace(/module\.exports\s*=\s*router;?/g, '');
    
    // 🔥 리눅스 file 명령어를 활용한 완벽한 감식 API
    const detectRoute = `
// 🔥 [무확장자 대응] 파일 지문(Magic Number) 감식 API
router.get('/file/detect', verifyToken, (req, res) => {
  try {
    const targetPath = req.query.path;
    if (!targetPath) return res.status(400).json({ error: '경로가 필요합니다.' });

    const { targetPath: fullPath } = getValidatedPath(req.user, targetPath);
    const fs = require('fs');
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '파일 없음' });

    // 리눅스 내장 명령어로 파일의 실제 MIME 타입(정체)을 스캔!
    const { exec } = require('child_process');
    exec(\`file -b --mime-type "\${fullPath}"\`, (err, stdout) => {
      if (err) return res.json({ ext: '' }); // 에러 나면 그냥 빈값 리턴
      
      const mime = stdout.trim();
      let detectedExt = '';
      
      // 대표적인 지문들을 확장자로 매핑
      if (mime.includes('image/jpeg')) detectedExt = 'jpg';
      else if (mime.includes('image/png')) detectedExt = 'png';
      else if (mime.includes('image/gif')) detectedExt = 'gif';
      else if (mime.includes('application/pdf')) detectedExt = 'pdf';
      else if (mime.includes('video/mp4')) detectedExt = 'mp4';
      else if (mime.includes('video/x-msvideo')) detectedExt = 'avi';
      else if (mime.includes('audio/mpeg')) detectedExt = 'mp3';
      else if (mime.includes('application/zip')) detectedExt = 'zip';
      else if (mime.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) detectedExt = 'docx';
      else if (mime.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) detectedExt = 'xlsx';
      else if (mime.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation')) detectedExt = 'pptx';
      else if (mime.includes('text/plain')) detectedExt = 'txt';
      
      res.json({ ext: detectedExt, mime });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
`;
    code += detectRoute;
    fs.writeFileSync(backendPath, code);
    console.log("✅ 백엔드: 파일 지문 감식 API 탑재 완료!");
}
