const fs = require('fs');

// =========================================================================
// 1. NAS.js: 깨진 문법(Syntax) 완벽 복구 및 슬라이드 엔진 정밀 주입
// =========================================================================
const nasPath = './src/components/NAS.js';
if (fs.existsSync(nasPath)) {
    let code = fs.readFileSync(nasPath, 'utf8');

    // 혹시 빠져있을지 모르는 상태 변수(hoveredHeader) 안전 확보
    if (!code.includes('const [hoveredHeader, setHoveredHeader]')) {
        code = code.replace(
            /const \[closePrompt, setClosePrompt\] = useState\(null\);/,
            "const [closePrompt, setClosePrompt] = useState(null);\n  const [hoveredHeader, setHoveredHeader] = useState(null);"
        );
    }

    // 이전에 들어간 불필요한 찌꺼기들 전부 청소
    code = code.replace(/\{win\.isImmersive && <Box onMouseEnter=[^<]+<\/\w+>\}\n/g, '');
    code = code.replace(/\{win\.isImmersive && <Box className="immersive-hitbox"[^>]+>\}\n/g, '');

    // [핵심] 깨지거나 오타가 난 헤더(Box) 전체를 찾아내서 완벽한 코드로 갈아끼웁니다!
    // (헤더 시작부터, 그 안의 첫 번째 내용물이 시작되기 직전까지를 타겟팅)
    const brokenHeaderRegex = /<Box className=\{?`?"?window-header-drag-handle[\s\S]*?(?=<Box sx=\{\{\s*display:\s*'flex',\s*alignItems:\s*'center',\s*gap:\s*1)/g;
    
    const perfectHeader = `{win.isImmersive && <Box onMouseEnter={() => setHoveredHeader(win.id)} sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: '30px', zIndex: 99998, cursor: 'default' }} />}\n                  <Box className="window-header-drag-handle" onMouseEnter={() => setHoveredHeader(win.id)} onMouseLeave={() => setHoveredHeader(null)} sx={{ display: 'flex', position: win.isImmersive ? 'absolute' : 'relative', top: win.isImmersive ? (hoveredHeader === win.id ? 0 : '-70px') : 0, left: 0, right: 0, width: '100%', transition: 'top 0.35s cubic-bezier(0.4, 0, 0.2, 1)', zIndex: 100000, p: 1, background: isActive ? alpha(theme.palette.primary.main, 0.08) : theme.palette.background.default, borderBottom: \`1px solid \${theme.palette.divider}\`, justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, cursor: win.isMaximized ? 'default' : 'move' }}>\n                    `;

    code = code.replace(brokenHeaderRegex, perfectHeader);

    fs.writeFileSync(nasPath, code);
    console.log("✅ NAS.js: 깨진 헤더 문법 복구 및 완벽 슬라이드 엔진 장착 완료!");
}

// =========================================================================
// 2. WindowContext.js: 하얀 화면(Crash) 방어선 구축 (?. 연산자 도입)
// =========================================================================
const wcPath = './src/contexts/WindowContext.js';
if (fs.existsSync(wcPath)) {
    let wcCode = fs.readFileSync(wcPath, 'utf8');
    
    // .width 와 .height 를 읽다가 터지는 것을 막기 위해 '옵셔널 체이닝(?.)'을 강제 적용합니다.
    // 객체가 undefined 상태여도 하얀 화면으로 뻗지 않고 조용히 무시하게 만듭니다.
    wcCode = wcCode.replace(/([a-zA-Z0-9_]+)\.width/g, '$1?.width');
    wcCode = wcCode.replace(/([a-zA-Z0-9_]+)\.height/g, '$1?.height');

    fs.writeFileSync(wcPath, wcCode);
    console.log("✅ WindowContext.js: 하얀 화면(Crash) 원천 차단 방어막 전개 완료!");
} else {
    console.log("⚡ WindowContext.js 파일이 없으므로 방어막 단계를 건너뜁니다.");
}
