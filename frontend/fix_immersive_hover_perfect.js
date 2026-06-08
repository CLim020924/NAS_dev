const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 헤더 호버 상태를 완벽하게 기억할 뇌(State) 주입
    if (!code.includes('const [hoveredHeader, setHoveredHeader]')) {
        code = code.replace(
            /const \[closePrompt, setClosePrompt\] = useState\(null\);/,
            "const [closePrompt, setClosePrompt] = useState(null);\n  const [hoveredHeader, setHoveredHeader] = useState(null);"
        );
    }

    // 2. 이전에 실패했던 CSS 찌꺼기 완벽하게 청소
    code = code.replace(/<style>\{`[\s\S]*?`\}<\/style>\s*<AnimatePresence>/g, '<AnimatePresence>');
    code = code.replace(/\{win\.isImmersive && <Box className="immersive-hitbox"[^>]*>\}\s*/g, '');

    // 3. 리액트 State 기반의 완벽한 상단바 슬라이드 로직으로 교체
    const oldHeaderRegex = /<Box className=\{?`?"?window-header-drag-handle[^>]*\}?\s*sx=\{\{([^}]+)\}\}>/g;
    
    code = code.replace(oldHeaderRegex, (match, sxProps) => {
        // 기존 속성에서 레이아웃과 관련된 것들만 깨끗하게 발라냅니다.
        let cleanSx = sxProps
            .replace(/display:\s*[^,]+,/g, '')
            .replace(/position:\s*[^,]+,/g, '')
            .replace(/top:\s*[^,]+,/g, '')
            .replace(/left:\s*[^,]+,/g, '')
            .replace(/right:\s*[^,]+,/g, '')
            .replace(/width:\s*[^,]+,/g, '')
            .replace(/transition:\s*[^,]+,/g, '')
            .replace(/zIndex:\s*[^,]+,/g, '')
            .replace(/p:\s*[^,]+,/g, '');

        // 화면 맨 위에 높이 30px짜리 투명한 마우스 감지 센서(Hitbox)를 달고, 
        // 상단바 자체가 내려왔을 때도 마우스를 감지하도록 onMouseEnter/Leave를 양쪽에 걸어줍니다!
        return `{win.isImmersive && <Box onMouseEnter={() => setHoveredHeader(win.id)} sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: '30px', zIndex: 99998, cursor: 'default' }} />}\n<Box className="window-header-drag-handle" onMouseEnter={() => setHoveredHeader(win.id)} onMouseLeave={() => setHoveredHeader(null)} sx={{ display: 'flex', position: win.isImmersive ? 'absolute' : 'relative', top: win.isImmersive ? (hoveredHeader === win.id ? 0 : '-70px') : 0, left: 0, right: 0, width: '100%', transition: 'top 0.35s cubic-bezier(0.4, 0, 0.2, 1)', zIndex: 100000, p: 1, ${cleanSx} }け`.replace('}け', '}');
    });

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 몰입 모드 상단바 슬라이드(Auto-Hide) 엔진 교체 성공!");
}
