const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // =========================================================================
    // 1. [핵심] 오피스 리로드(재시작) 원천 차단! (DOM 삭제 방지)
    // =========================================================================
    // 최소화 시 컴포넌트를 아예 날려버리던 찌꺼기 코드 삭제
    code = code.replace(/if\s*\(\s*win\.isMinimized\s*\)\s*return\s*null;/g, '');
    
    // Rnd 컴포넌트를 지우지 않고, 투명 망토(display: none)만 씌워서 백그라운드에 살려둡니다.
    code = code.replace(/style=\{\{\s*zIndex:\s*win\.isImmersive\s*\?\s*99999\s*:\s*win\.zIndex/g, "style={{ display: win.isMinimized ? 'none' : 'block', zIndex: win.isImmersive ? 99999 : win.zIndex");

    // =========================================================================
    // 2. 전체화면 이벤트 수정 (마우스 해제 기능 제거, 오직 ESC만 허용)
    // =========================================================================
    const oldEffect = /\/\/ 🔥 전체화면\(몰입 모드\) 해제 이벤트 리스너[\s\S]*?\}, \[setOpenWindows\]\);/g;
    const newEffect = `// 🔥 전체화면(몰입 모드) 해제 이벤트 리스너 (ESC 키로만 해제)
  useEffect(() => {
    const handleEscAndHover = (e) => {
      if (e.type === 'keydown' && e.key === 'Escape') {
        setOpenWindows(prev => prev.map(w => w.isImmersive ? { ...w, isImmersive: false } : w));
      }
    };
    window.addEventListener('keydown', handleEscAndHover);
    return () => window.removeEventListener('keydown', handleEscAndHover);
  }, [setOpenWindows]);`;
    if (code.match(oldEffect)) {
        code = code.replace(oldEffect, newEffect);
    }

    // =========================================================================
    // 3. 상단바 마우스 감지 및 슬라이드 다운(Slide-down) 애니메이션 엔진 주입
    // =========================================================================
    if (!code.includes('.immersive-header {')) {
        code = code.replace(/<AnimatePresence>/g, `<style>{\`
  .immersive-header { position: absolute !important; top: 0; left: 0; right: 0; transform: translateY(-100%); transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); z-index: 100000; box-shadow: 0 4px 20px rgba(0,0,0,0.5); }
  .immersive-hitbox { position: absolute; top: 0; left: 0; right: 0; height: 15px; z-index: 99999; }
  .immersive-hitbox:hover ~ .window-header-drag-handle, .immersive-header:hover { transform: translateY(0); }
\`}</style>
      <AnimatePresence>`);
    }

    // =========================================================================
    // 4. 헤더 컴포넌트에 슬라이드 클래스 및 투명 센서(Hitbox) 부착
    // =========================================================================
    code = code.replace(/<Box className="window-header-drag-handle"\s*sx=\{\{([^}]+)\}\}/g, (match, p1) => {
        // 기존에 강제로 디스플레이를 껐던 코드 삭제
        let newSx = p1.replace(/display:\s*win\.isImmersive\s*\?\s*'none'\s*:\s*'flex'\s*,?/, "display: 'flex', ");
        if (match.includes('immersive-header')) return match; // 중복 방지
        
        // 투명 감지 센서(Hitbox)를 헤더 바로 위에 심어줍니다.
        return `{win.isImmersive && <Box className="immersive-hitbox" />}\n                  <Box className={\`window-header-drag-handle \${win.isImmersive ? 'immersive-header' : ''}\`} sx={{${newSx}}}`;
    });

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 오피스 재시작 버그 차단 & 상단바 슬라이드 다운 기능 완벽 탑재!");
}
