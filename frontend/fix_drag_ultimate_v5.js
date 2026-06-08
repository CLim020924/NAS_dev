const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 기존 드래그 엔진 대청소
    code = code.replace(/\/\/ 🔥 초고성능 바닐라 JS 드래그[\s\S]*?\}, \[\]\);\n?/g, '');
    
    // 2. [핵심] 윈도우 창 안쪽 파일(TableRow)에 레이더 이름표 달아주기!
    code = code.replace(/<TableRow key=\{idx\} hover draggable=/g, '<TableRow key={idx} className="selectable-item" data-path={safePath} hover draggable=');

    // 3. [핵심] 윈도우 창 파일 목록 영역(TableContainer)에 투명 유리벽 세우기!
    code = code.replace(/<TableContainer onDragOver=/g, '<TableContainer className="window-content-area" onDragOver=');

    // 4. 절대 뚫리지 않는 V5 최종 엔진 주입
    const safeTarget = "const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));";
    
    if (code.includes(safeTarget)) {
        const v5Engine = `
  // 🔥 초고성능 바닐라 JS 드래그 셀렉션 V5 (사이드바 & 헤더 완벽 차단 + 윈도우 창 호환)
  useEffect(() => {
    let isSelecting = false;
    let startX = 0, startY = 0;
    let selectionBox = null;
    let limitRect = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
    let currentContainer = null;

    const handleMouseDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.selectable-item') || e.target.closest('button') || e.target.closest('.window-header-drag-handle') || e.target.closest('.MuiDialogTitle-root') || e.target.closest('input')) return;

      // 🛑 드래그 시작점이 윈도우 창 내부 유리벽 안인지, 바탕화면인지 파악
      currentContainer = e.target.closest('.window-content-area') || document.body;

      // 🛑 절대 방어선(LimitRect) 설정! (유리벽 크기 그대로 가져오기 때문에 사이드바/상단바 원천 차단)
      if (currentContainer === document.body) {
        limitRect = { top: 64, left: 0, right: window.innerWidth, bottom: window.innerHeight };
      } else {
        const rect = currentContainer.getBoundingClientRect();
        limitRect = { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom };
      }

      // 클릭 시작점이 방어선 밖이면 무시
      if (e.clientX < limitRect.left || e.clientX > limitRect.right || e.clientY < limitRect.top || e.clientY > limitRect.bottom) return;

      setSelectedItems([]);
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;

      selectionBox = document.createElement('div');
      selectionBox.style.position = 'fixed';
      selectionBox.style.border = '1px solid rgba(59, 130, 246, 0.8)';
      selectionBox.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
      selectionBox.style.zIndex = '9999';
      selectionBox.style.pointerEvents = 'none';
      document.body.appendChild(selectionBox);
    };

    const handleMouseMove = (e) => {
      if (!isSelecting || !selectionBox) return;

      // 🛑 마우스가 유리벽 밖으로 나가면 선에 걸리도록 강제 고정 (Clamping)
      let clampedX = Math.max(limitRect.left, Math.min(e.clientX, limitRect.right));
      let clampedY = Math.max(limitRect.top, Math.min(e.clientY, limitRect.bottom));

      const left = Math.min(startX, clampedX);
      const top = Math.min(startY, clampedY);
      const width = Math.abs(clampedX - startX);
      const height = Math.abs(clampedY - startY);

      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
      selectionBox.style.width = width + 'px';
      selectionBox.style.height = height + 'px';

      // 💥 충돌 검사 (Collision Detection)
      const boxRect = selectionBox.getBoundingClientRect();
      const targetArea = currentContainer === document.body ? document : currentContainer;
      const items = targetArea.querySelectorAll('.selectable-item');
      const newSelected = [];

      items.forEach(item => {
        const itemRect = item.getBoundingClientRect();
        const isIntersecting = !(
          boxRect.right < itemRect.left || 
          boxRect.left > itemRect.right || 
          boxRect.bottom < itemRect.top || 
          boxRect.top > itemRect.bottom
        );
        if (isIntersecting) {
          const path = item.getAttribute('data-path');
          if (path) newSelected.push(path);
        }
      });

      setSelectedItems(prev => {
        if (prev.length === newSelected.length && prev.every((val, index) => val === newSelected[index])) return prev;
        return newSelected;
      });
    };

    const handleMouseUp = () => {
      if (isSelecting) {
        isSelecting = false;
        if (selectionBox && selectionBox.parentNode) selectionBox.parentNode.removeChild(selectionBox);
        selectionBox = null;
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);
`;
        code = code.replace(safeTarget, v5Engine + '\n  ' + safeTarget);
        fs.writeFileSync(path, code);
        console.log("✅ 프론트엔드: 유리벽 방어선 구축 및 V5 엔진 탑재 성공!");
    } else {
        console.log("❌ 타겟 위치를 찾을 수 없습니다.");
    }
}
