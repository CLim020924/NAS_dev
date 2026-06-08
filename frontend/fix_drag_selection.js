const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 윈도우 창 내부 아이콘들도 레이더망에 걸리도록 전역 이름표 부착!
    // 기존에 잘못 붙은 이름표가 있다면 떼고, 모든 <motion.div key=... draggable=...> 에 확실하게 붙입니다.
    code = code.replace(/ className="selectable-item" data-path=\{[^}]+\}/g, '');
    code = code.replace(/<motion\.div key=\{([^}]+)\}([^>]*)draggable=/g, '<motion.div key={$1} className="selectable-item" data-path={$1} $2 draggable=');

    // 2. 기존 드래그 엔진 지우기
    code = code.replace(/\/\/ 🔥 초고성능 바닐라 JS 드래그 셀렉션[\s\S]*?window\.removeEventListener\('mouseup', handleMouseUp\);\n    \};\n  \}, \[\]\);\n/g, '');

    // 3. 상단바 침범을 막는(Clamping) 똑똑한 V2 엔진 주입
    const safeTarget = "const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));";
    
    if (code.includes(safeTarget)) {
        const v2Engine = `
  // 🔥 초고성능 바닐라 JS 드래그 셀렉션 V2 (상단바 방어선 구축 완료)
  useEffect(() => {
    let isSelecting = false;
    let startX = 0, startY = 0;
    let selectionBox = null;
    let currentContainer = null;
    let headerOffset = 0; // 상단바 방어선 높이

    const handleMouseDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.selectable-item') || e.target.closest('button') || e.target.closest('.window-header') || e.target.closest('.MuiDialogTitle-root') || e.target.closest('.react-draggable-handle') || e.target.closest('input')) return;

      currentContainer = e.target.closest('.window-content') || e.target.closest('.MuiPaper-root') || document.body;
      
      // 📌 상단바 방어선 계산
      if (currentContainer === document.body) {
        headerOffset = 64; // 바탕화면 네비게이션 바 높이
      } else {
        const header = currentContainer.querySelector('.MuiDialogTitle-root') || currentContainer.querySelector('.react-draggable-handle');
        headerOffset = header ? header.getBoundingClientRect().height : 40; 
      }

      const rect = currentContainer.getBoundingClientRect();
      // 클릭 시작점이 상단바 영역이면 드래그 무시
      if (e.clientY - rect.top < headerOffset) return;

      setSelectedItems([]);
      isSelecting = true;

      const scrollLeft = currentContainer.scrollLeft || 0;
      const scrollTop = currentContainer.scrollTop || 0;

      startX = e.clientX - rect.left + scrollLeft;
      startY = e.clientY - rect.top + scrollTop;

      selectionBox = document.createElement('div');
      selectionBox.style.position = 'absolute';
      selectionBox.style.border = '1px solid rgba(59, 130, 246, 0.8)';
      selectionBox.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
      selectionBox.style.zIndex = '9999';
      selectionBox.style.pointerEvents = 'none';
      
      if (currentContainer !== document.body && window.getComputedStyle(currentContainer).position === 'static') {
        currentContainer.style.position = 'relative';
      }
      currentContainer.appendChild(selectionBox);
    };

    const handleMouseMove = (e) => {
      if (!isSelecting || !selectionBox || !currentContainer) return;

      const rect = currentContainer.getBoundingClientRect();
      const scrollLeft = currentContainer.scrollLeft || 0;
      const scrollTop = currentContainer.scrollTop || 0;

      // 📌 마우스가 상단바 위로 못 올라가게 Y좌표 강제 고정! (Clamping)
      let clampedY = e.clientY;
      const minAllowedY = rect.top + headerOffset;
      if (clampedY < minAllowedY) clampedY = minAllowedY;

      const currentX = e.clientX - rect.left + scrollLeft;
      const currentY = clampedY - rect.top + scrollTop;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
      selectionBox.style.width = width + 'px';
      selectionBox.style.height = height + 'px';

      const boxRect = selectionBox.getBoundingClientRect();
      const items = currentContainer.querySelectorAll('.selectable-item');
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
        if (selectionBox && selectionBox.parentNode) {
          selectionBox.parentNode.removeChild(selectionBox);
        }
        selectionBox = null;
        currentContainer = null;
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
        code = code.replace(safeTarget, v2Engine + '\n  ' + safeTarget);
        fs.writeFileSync(path, code);
        console.log("✅ 프론트엔드: 드래그 V2 엔진 (상단바 방어선 & 윈도우 창 호환) 탑재 완료!");
    } else {
        console.log("❌ 타겟 위치를 찾을 수 없습니다.");
    }
}
