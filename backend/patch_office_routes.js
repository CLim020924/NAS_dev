const fs = require('fs');
const path = './nasRoutes.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 도커 전용 비밀 통로(oosecret) 복구
    const oldVerifyToken = /const verifyToken = \(req, res, next\) => \{[\s\S]*?catch \(e\) \{ res\.status\(401\)\.json\(\{ error: '인증실패' \}\); \}\n\};/;
    const newVerifyToken = `const verifyToken = (req, res, next) => {
  // 🔥 [복구] ONLYOFFICE 도커 서버의 비밀 통로 (토큰 검사 우회)
  if (req.query.oosecret === 'nas_office_2026') {
    req.user = { Masters: true, globalAccess: true };
    return next();
  }
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } 
  catch (e) { res.status(401).json({ error: '인증실패' }); }
};`;
    
    code = code.replace(oldVerifyToken, newVerifyToken);

    // 2. 오피스 저장(Callback) API 복구
    if (!code.includes('/onlyoffice/callback')) {
        const callbackAPI = `
// 🔥 [복구] ONLYOFFICE 저장 콜백 API (문서 편집 후 저장 담당)
router.post('/onlyoffice/callback', async (req, res) => {
  const { status, url } = req.body;
  const relPath = req.query.path;
  const uid = req.query.uid;
  const isAdmin = req.query.isAdmin === 'true';

  if (status === 2 || status === 6) { 
    try {
      const axios = require('axios');
      const fs = require('fs');
      const path = require('path');
      
      const nasPath = process.env.NAS_PATH || '/mnt/nas';
      const basePath = isAdmin ? nasPath : path.join(nasPath, 'users', uid || 'default');
      const safeReqPath = (relPath || '').replace(/^(\\/|\\\\)+/, '');
      const absoluteFilePath = path.resolve(basePath, safeReqPath);

      const response = await axios.get(url, { responseType: 'stream' });
      const writer = fs.createWriteStream(absoluteFilePath);
      response.data.pipe(writer);
      
      writer.on('finish', () => res.json({ error: 0 }));
      writer.on('error', (err) => res.json({ error: 1 }));
    } catch (error) {
      return res.json({ error: 1 });
    }
  } else {
    return res.json({ error: 0 });
  }
});
`;
        code = code.replace('module.exports = router;', callbackAPI + '\nmodule.exports = router;');
    }
    
    fs.writeFileSync(path, code);
    console.log("✅ nasRoutes.js: 도커 연결용 비밀 통로(oosecret) 및 저장 콜백 완벽 복구!");
}
