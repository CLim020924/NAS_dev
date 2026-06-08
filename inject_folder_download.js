const fs = require('fs');
const path = require('path');
const backendPath = path.join(__dirname, 'backend', 'nasRoutes.js');

if (fs.existsSync(backendPath)) {
    let code = fs.readFileSync(backendPath, 'utf8');

    // 기존 찌꺼기 삭제
    code = code.replace(/module\.exports\s*=\s*router;?/g, '');
    
    // 🔥 폴더 실시간 압축 & 다운로드 API
    const folderDownloadRoute = `
// 🔥 폴더 통째로 압축 다운로드 (ZIP, TAR, TGZ 스트리밍)
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
      console.error('압축 스트리밍 에러:', err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });

    // 압축되는 데이터를 곧바로 클라이언트에게 파이프라인으로 전송 (하드디스크 용량 소모 0%)
    archive.pipe(res);
    archive.directory(fullPath, folderName);
    archive.finalize();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
`;
    code += folderDownloadRoute;
    fs.writeFileSync(backendPath, code);
    console.log("✅ 백엔드: 폴더 압축 스트리밍 API 탑재 완료!");
}
