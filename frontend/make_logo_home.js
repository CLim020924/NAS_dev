const fs = require('fs');

const topBarPath = './src/components/TopBar.js';
if (fs.existsSync(topBarPath)) {
    let code = fs.readFileSync(topBarPath, 'utf8');
    
    // 단순한 텍스트였던 로고에 onClick(홈 이동)과 마우스 hover(포인터) 효과를 부여합니다.
    const oldLogo = /<Typography variant="h6" sx=\{\{ fontWeight: 800, fontSize: '1\.1rem' \}\}>\s*FileManager NAS\+\s*<\/Typography>/;
    const newLogo = `<Typography variant="h6" onClick={() => navigate('/platform')} sx={{ fontWeight: 800, fontSize: '1.1rem', cursor: 'pointer', transition: 'opacity 0.2s', '&:hover': { opacity: 0.7 } }}> FileManager NAS+ </Typography>`;
    
    code = code.replace(oldLogo, newLogo);
    fs.writeFileSync(topBarPath, code);
    console.log("✅ TopBar.js: 로고 홈 버튼 링크 적용 완료!");
}
