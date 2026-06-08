const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 기존의 드래그 엔진(V1, V2) 깔끔하게 철거
    code = code.replace(/\/\/ 🔥 초고성능 바닐라 JS 드래그 셀렉션[\s\S]*?window\.removeEventListener\('mouseup', handleMouseUp\);\n    \};\n  \}, \[\]\);\n/g, '');

    // 2. 완벽하게 진화한 V3 엔진 (상단바 + 좌측 사이드바 동시 방어) 주입
    const safeTarget = "const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));";
    
    if (code.includes(safeTarget)) {
        const v3Engine = `
  // 🔥 초고성능 바닐라 JS 드래그 셀렉션 V3 (상단바 + 좌측 사이드바 철벽 방어)
  useEffect(() => {
    let isSelecting = false;
    let startX = 0, startY = 0;
    let selectionBox = null;
    let currentContainer = null;
    let minAllowedX = 0; // 좌측 방어선 (사이드바)
    let minAllowedY = 0; // 상단 방어선 (헤더)

    const handleMouseDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.selectable-item') || e.target.closest('button') || e.target.closest('.window-header') || e.target.closest('.MuiDialogTitle-root') || e.target.closest('.react-draggable-handle') || e.target.closest('input')) return;

      currentContainer = e.target.closest('.window-content') || e.target.closest('.MuiPaper-root') || document.body;
      
      const rect = currentContainer.getBoundingClientRect();
      minAllowedX = rect.left;
      minAllowedY = rect.top;

      // 📌 상단바(헤더) 방어선 계산
      if (currentContainer === document.body) {
        minAllowedY += 64; // 바탕화면 상단바
      } else {
        const header = currentContainer.querySelector('.MuiDialogTitle-root') || currentContainer.querySelector('.react-draggable-handle');
        if (header) minAllowedY += header.getBoundingClientRect().height;
      }

      // 📌 [핵심] 좌측 사이드바 방어선 계산!
      // 아이콘들을 감싸고 있는 실제 영역을 찾아내어, 사이드바가 열려서 밀려나면 방어선도 같이 밀려나게 만듭니다.
      if (currentContainer !== document.body) {
        const firstIcon = currentContainer.querySelector('.selectable-item');
        if (firstIcon && firstIcon.parentElement) {
          const wrapperRect = firstIcon.parentElement.getBoundingClientRect();
          // 아이콘 컨테이너의 왼쪽 시작점이 사이드바에 의해 밀려났다면 그곳을 절대 방어선으로 설정!
          minAllowedX = Math.max(minAllowedX, wrapperRect.left);
        }
      }

      // 마우스 클릭 시작점이 사이드바 위거나 상단바 위라면 아예 드래그 무시!
      if (e.clientX < minAllowedX || e.clientY < minAllowedY) return;

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

      // 📌 마우스가 사이드바(좌측)나 헤더(상단)를 침범하지 못하도록 강제 고정! (Clamping)
      let clampedX = e.clientX;
      let clampedY = e.clientY;

      if (clampedX < minAllowedX) clampedX = minAllowedX;
      if (clampedY < minAllowedY) clampedY = minAllowedY;

      const currentX = clampedX - rect.left + scrollLeft;
      const currentY = clampedY - rect.top + scrollTop;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
      selectionBox.style.width = width + 'px';
      selectionBox.style.height = height + 'px';

      // 충돌 검사 (Collision Detection)
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
        code = code.replace(safeTarget, v3Engine + '\n  ' + safeTarget);
        fs.writeFileSync(path, code);
        console.log("✅ 프론트엔드: 사이드바 완벽 방어! 드래그 V3 엔진 탑재 완료!");
    } else {
        console.log("❌ 타겟 위치를 찾을 수 없습니다.");
    }
}
