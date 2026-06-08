const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 바탕화면 아이콘들이 파란 박스 레이더에 걸리도록 '이름표(class)' 달아주기
    if (!code.includes('className="selectable-item"')) {
        code = code.replace(
            /<motion\.div key=\{safePath\} draggable=/g,
            '<motion.div key={safePath} className="selectable-item" data-path={safePath} draggable='
        );
    }

    // 2. 초고성능 바닐라 JS 드래그 셀렉션 엔진 주입
    if (!code.includes('🔥 초고성능 바닐라 JS 드래그 셀렉션')) {
        const dragSelectionEffect = `
  // 🔥 초고성능 바닐라 JS 드래그 셀렉션 (바탕화면 & 윈도우 창 공통)
  useEffect(() => {
    let isSelecting = false;
    let startX = 0, startY = 0;
    let selectionBox = null;
    let currentContainer = null;

    const handleMouseDown = (e) => {
      if (e.button !== 0) return; // 좌클릭만 허용

      // 아이콘, 버튼, 스크롤바, 창 헤더 클릭 시 드래그 무시
      if (e.target.closest('.selectable-item') || e.target.closest('button') || e.target.closest('.window-header') || e.target.closest('.MuiDialog-root') || e.target.closest('.react-draggable-handle') || e.target.closest('input')) return;

      // 드래그가 일어난 장소 파악 (폴더 윈도우 안인지, 바탕화면인지)
      currentContainer = e.target.closest('.MuiPaper-root') || document.body;

      // 드래그 시작 시 기존 선택 초기화
      setSelectedItems([]);
      isSelecting = true;

      const rect = currentContainer.getBoundingClientRect();
      const scrollLeft = currentContainer.scrollLeft || 0;
      const scrollTop = currentContainer.scrollTop || 0;

      startX = e.clientX - rect.left + scrollLeft;
      startY = e.clientY - rect.top + scrollTop;

      // 🟦 파란색 드래그 박스 DOM 생성
      selectionBox = document.createElement('div');
      selectionBox.style.position = 'absolute';
      selectionBox.style.border = '1px solid rgba(59, 130, 246, 0.8)';
      selectionBox.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
      selectionBox.style.zIndex = '9999';
      selectionBox.style.pointerEvents = 'none'; // 박스 자체가 마우스를 막지 않도록
      
      // 윈도우 창 내부라면 relative 속성 적용
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

      const currentX = e.clientX - rect.left + scrollLeft;
      const currentY = e.clientY - rect.top + scrollTop;

      const left = Math.min(startX, currentX);
      const top = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      // 박스 크기 및 위치 실시간 렌더링 (리액트를 안 거쳐서 엄청 빠름)
      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
      selectionBox.style.width = width + 'px';
      selectionBox.style.height = height + 'px';

      // 💥 충돌 검사 (Collision Detection)
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

      // 변경사항이 있을 때만 리액트 상태 업데이트 (버벅임 방지)
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

    // 전역 이벤트 리스너 등록
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
        const safeTarget = "const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));";
        code = code.replace(safeTarget, dragSelectionEffect + '\n  ' + safeTarget);
        fs.writeFileSync(path, code);
        console.log("✅ 프론트엔드: 드래그 셀렉션 엔진 주입 대성공!");
    } else {
        console.log("⚡ 이미 드래그 셀렉션 엔진이 존재합니다.");
    }
}
