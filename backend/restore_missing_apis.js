const fs = require('fs');
const path = './nasRoutes.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 이미 복구되었는지 확인
    if (!code.includes('/file/copy')) {
        const missingAPIs = `
// 🔥 [복구됨] 파일 복사 (Ctrl+C / Ctrl+V) API
router.post('/file/copy', verifyToken, (req, res) => {
  try {
    const { sourcePaths, destinationFolder } = req.body;
    if (!sourcePaths || !Array.isArray(sourcePaths) || destinationFolder === undefined) {
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }

    const { targetPath: destDir } = getValidatedPath(req.user, destinationFolder);
    const fs = require('fs');
    const path = require('path');

    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    sourcePaths.forEach(src => {
      const { targetPath: srcPath } = getValidatedPath(req.user, src);
      if (!fs.existsSync(srcPath)) return;

      const fileName = path.basename(srcPath);
      let finalDest = path.join(destDir, fileName);

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

// 🔥 [복구됨] 파일/폴더 속성 조회 API
router.get('/file/properties', verifyToken, (req, res) => {
  try {
    const { targetPath } = getValidatedPath(req.user, req.query.path);
    const fs = require('fs');
    fs.stat(targetPath, (err, stats) => {
      if (err) return res.status(500).json({ error: '실패' });
      res.json({ size: stats.size, modified: stats.mtime, isDirectory: stats.isDirectory() });
    });
  } catch (err) { res.status(403).json({ error: err.message }); }
});

// 🔥 [복구됨] 무확장자 파일 감식 (Magic Number) API
router.get('/file/detect', verifyToken, (req, res) => {
  try {
    const targetPath = req.query.path;
    if (!targetPath) return res.status(400).json({ error: '경로가 필요합니다.' });

    const { targetPath: fullPath } = getValidatedPath(req.user, targetPath);
    const fs = require('fs');
    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '파일 없음' });

    const { exec } = require('child_process');
    exec(\`file -b --mime-type "\${fullPath}"\`, (err, stdout) => {
      if (err) return res.json({ ext: '' });
      
      const mime = stdout.trim();
      let detectedExt = '';
      
      if (mime.includes('image/jpeg')) detectedExt = 'jpg';
      else if (mime.includes('image/png')) detectedExt = 'png';
      else if (mime.includes('image/gif')) detectedExt = 'gif';
      else if (mime.includes('application/pdf')) detectedExt = 'pdf';
      else if (mime.includes('video/mp4')) detectedExt = 'mp4';
      else if (mime.includes('video/x-msvideo')) detectedExt = 'avi';
      else if (mime.includes('audio/mpeg')) detectedExt = 'mp3';
      else if (mime.includes('application/zip')) detectedExt = 'zip';
      else if (mime.includes('text/plain')) detectedExt = 'txt';
      
      res.json({ ext: detectedExt, mime });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🔥 [복구됨] 폴더 통째로 압축 다운로드 API
router.get('/file/download-folder', verifyToken, (req, res) => {
  try {
    const targetPath = req.query.path;
    const format = req.query.format || 'zip';
    if (!targetPath) return res.status(400).json({ error: '경로가 필요합니다.' });

    const { targetPath: fullPath } = getValidatedPath(req.user, targetPath);
    const fs = require('fs');
    const path = require('path');
    const archiver = require('archiver');

    if (!fs.existsSync(fullPath)) return res.status(404).json({ error: '폴더를 찾을 수 없습니다.' });
    if (!fs.statSync(fullPath).isDirectory()) return res.status(400).json({ error: '폴더가 아닙니다.' });

    const folderName = path.basename(fullPath) || 'archive';
    let extension = format === 'tar' ? 'tar' : (format === 'tgz' ? 'tar.gz' : 'zip');
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', \`attachment; filename="\${encodeURIComponent(folderName)}.\${extension}"\`);

    let archiveFormat = format === 'zip' ? 'zip' : 'tar';
    let archiveOptions = {};
    if (format === 'zip') archiveOptions = { zlib: { level: 9 } };
    if (format === 'tgz') { archiveFormat = 'tar'; archiveOptions = { gzip: true, gzipOptions: { level: 9 } }; }

    const archive = archiver(archiveFormat, archiveOptions);

    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });

    archive.pipe(res);
    archive.directory(fullPath, folderName);
    archive.finalize();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});
`;
        // module.exports = router; 바로 위에 누락된 API들을 꽂아 넣습니다.
        code = code.replace("module.exports = router;", missingAPIs + "\nmodule.exports = router;");
        fs.writeFileSync(path, code);
        console.log("✅ nasRoutes.js: 실수로 지웠던 복사/압축/속성/감식 API 완벽 복구!");
    } else {
        console.log("⚡ 이미 복구된 상태입니다.");
    }
}
