const fs = require('fs');
const path = './nasRoutes.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 삭제(delete)와 수정(put) 라우터에 백업 보호막을 설치합니다.
    const protectionLogic = `
    // 🛡️ [시스템 보호] 백업 보관소는 앱 내에서 절대 수정/삭제할 수 없습니다.
    if (targetPath.includes(path.join('/mnt/nas', 'backup'))) {
      return res.status(403).json({ error: '시스템 백업 보관소는 앱 내에서 수정/삭제가 불가능합니다.' });
    }
    `;

    // router.delete 내부와 router.put 내부에 각각 주입
    code = code.replace("const { targetPath } = getValidatedPath(req.user, requestPath);", "const { targetPath } = getValidatedPath(req.user, requestPath);" + protectionLogic);
    code = code.replace("const { targetPath: fullOldPath } = getValidatedPath(req.user, oldPath);", "const { targetPath: fullOldPath } = getValidatedPath(req.user, oldPath);" + protectionLogic);

    fs.writeFileSync(path, code);
    console.log("✅ nasRoutes.js: 백업 폴더 파괴 방지 로직 장착!");
}
