const fs = require('fs');
const path = './nasRoutes.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    if (!code.includes("router.put('/file'")) {
        const putApi = `
// 🔥 [긴급 복구 완료] 파일 이동 및 이름 변경 (Drag & Drop) API
router.put('/file', verifyToken, (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) return res.status(400).json({ error: '경로가 누락되었습니다.' });

    const { targetPath: fullOldPath } = getValidatedPath(req.user, oldPath);
    const { targetPath: fullNewPath } = getValidatedPath(req.user, newPath);
    const fs = require('fs');
    const path = require('path');

    // 🛡️ 백업 폴더 보호막 (이동하거나 이름 바꿀 수 없음)
    if (fullOldPath.includes(path.join('/mnt/nas', 'backup')) || fullNewPath.includes(path.join('/mnt/nas', 'backup'))) {
      return res.status(403).json({ error: '시스템 백업 보관소는 건드릴 수 없습니다.' });
    }

    // 파일 이동(이름 변경) 실행
    if (fs.existsSync(fullOldPath)) {
      fs.renameSync(fullOldPath, fullNewPath);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(403).json({ error: err.message });
  }
});
`;
        // module.exports = router; 바로 위에 꽂아 넣습니다.
        code = code.replace('module.exports = router;', putApi + '\nmodule.exports = router;');
        fs.writeFileSync(path, code);
        console.log("✅ nasRoutes.js: 파일 이동 및 이름 변경 API 복구 완료!");
    } else {
        console.log("⚡ 이미 파일 이동 API가 존재합니다.");
    }
}
