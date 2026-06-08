const fs = require('fs');
const path = './src/components/Settings.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // @mui/material 에서 불러오는 부품 목록을 찾아서 중복된 단어를 제거합니다.
    const importMatch = code.match(/import\s+\{([^}]+)\}\s+from\s+'@mui\/material'/);
    if (importMatch) {
        const imports = importMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        const uniqueImports = [...new Set(imports)]; // 중복 자동 제거 마법!
        code = code.replace(importMatch[0], `import { ${uniqueImports.join(', ')} } from '@mui/material'`);
        
        fs.writeFileSync(path, code);
        console.log("✅ 설정 창: 중복된 Divider 에러 깔끔하게 치료 완료!");
    }
}
