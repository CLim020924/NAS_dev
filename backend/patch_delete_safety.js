const fs = require('fs');
const path = './nasRoutes.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    const oldDelete = /router\.delete\('\/file', verifyToken, \(req, res\) => \{[\s\S]*?\}\);/;
    const newDelete = `router.delete('/file', verifyToken, (req, res) => {
  try {
    const requestPath = req.query.path || (req.body && req.body.path);
    
    // 🛡️ 1. [빈 껍데기 차단] 경로가 없거나 undefined면 서버가 아무것도 안 하고 튕겨냅니다.
    if (!requestPath || requestPath === 'undefined' || requestPath.trim() === '' || requestPath === '/') {
      return res.status(400).json({ error: '삭제할 정확한 파일 경로가 필요합니다.' });
    }

    const { basePath, targetPath } = getValidatedPath(req.user, requestPath);
    const fs = require('fs');
    const path = require('path');

    // 🛡️ 2. [치명적 오류 방지] 유저의 최상위 폴더 자체를 지우려는 시도 원천 차단!
    if (basePath === targetPath) {
      return res.status(403).json({ error: '최상위 루트 폴더는 삭제할 수 없습니다.' });
    }

    // 🛡️ 3. [백업 보호막] 백업 폴더는 절대 건드릴 수 없습니다.
    if (targetPath.includes(path.join('/mnt/nas', 'backup'))) {
      return res.status(403).json({ error: '시스템 백업 보관소는 앱 내에서 삭제가 불가능합니다.' });
    }

    // 4. 모든 안전망을 통과했을 때만 핀포인트로 해당 파일/폴더 삭제!
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    res.json({ success: true });
  } catch (e) { 
    console.error("[삭제 에러 발생]:", e);
    res.status(403).json({ error: e.message }); 
  }
});`;

    if (oldDelete.test(code)) {
        code = code.replace(oldDelete, newDelete);
        fs.writeFileSync(path, code);
        console.log("✅ nasRoutes.js: 백업 보호 및 치명적 루트 삭제 방어막 완벽 장착!");
    } else {
        console.log("⚡ nasRoutes.js에서 기존 DELETE 라우터를 찾지 못했습니다.");
    }
}
