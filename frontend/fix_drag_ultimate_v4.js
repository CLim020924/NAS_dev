const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. [대청소] 이전에 꼬여서 들어갔던 모든 드래그 셀렉션 로직들을 흔적도 없이 완전히 뜯어냅니다.
    code = code.replace(/\/\/ 🔥 초고성능 바닐라 JS 드래그[\s\S]*?\}, \[\]\);\n?/g, '');
    
    // 2. 윈도우 창 내부 아이콘들도 레이더에 걸리도록 이름표(selectable-item) 재확인 및 부착!
    code = code.replace(/ className="selectable-item" data-path=\{[^}]+\}/g, '');
    code = code.replace(/<motion\.div key=\{([^}]+)\}([^>]*)draggable=/g, '<motion.div key={$1} className="selectable-item" data-path={$1} $2 draggable=');

    // 3. 완벽해진 V4 최종 엔진 주입
    const safeTarget = "const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));";
    
    if (code.includes(safeTarget)) {
        const v4Engine = `
  // 🔥 초고성능 바닐라 JS 드래그 셀렉션 V4 (절대영역 방어 & 이전 버그 완벽 수정)
  useEffect(() => {
    let isSelecting = false;
    let startX = 0, startY = 0;
    let selectionBox = null;
    let limitRect = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
    let currentContainer = null;

    const handleMouseDown = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.selectable-item') || e.target.closest('button') || e.target.closest('.window-header') || e.target.closest('.MuiDialogTitle-root') || e.target.closest('.react-draggable-handle') || e.target.closest('input')) return;

      const paper = e.target.closest('.MuiPaper-root');
      currentContainer = paper || document.body;

      // 🛑 절대 방어선(LimitRect) 실시간 계산
      if (!paper) {
        limitRect.top = 64; // 바탕화면 상단 메뉴바 방어
        limitRect.left = 0;
        limitRect.right = window.innerWidth;
        limitRect.bottom = window.innerHeight;
      } else {
        const pRect = paper.getBoundingClientRect();
        const header = paper.querySelector('.react-draggable-handle') || paper.querySelector('.window-header');
        limitRect.top = header ? header.getBoundingClientRect().bottom : pRect.top + 40;
        limitRect.bottom = pRect.bottom;
        limitRect.right = pRect.right;

        // 🛑 좌측 사이드바가 열려있다면, 아이콘들이 밀려난 만큼의 왼쪽 좌표를 방어선으로 설정!
        const firstIcon = paper.querySelector('.selectable-item');
        if (firstIcon && firstIcon.parentElement) {
          limitRect.left = firstIcon.parentElement.getBoundingClientRect().left;
        } else {
          limitRect.left = pRect.left;
        }
      }

      // 클릭 시작점이 방어선 밖이면 드래그 무시 (상단바나 사이드바 빈공간 클릭 시)
      if (e.clientX < limitRect.left || e.clientX > limitRect.right || e.clientY < limitRect.top || e.clientY > limitRect.bottom) return;

      setSelectedItems([]);
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;

      selectionBox = document.createElement('div');
      selectionBox.style.position = 'fixed'; // 화면 전체 기준 고정(fixed)으로 스크롤 버그 원천 차단!
      selectionBox.style.border = '1px solid rgba(59, 130, 246, 0.8)';
      selectionBox.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
      selectionBox.style.zIndex = '9999';
      selectionBox.style.pointerEvents = 'none';
      document.body.appendChild(selectionBox);
    };

    const handleMouseMove = (e) => {
      if (!isSelecting || !selectionBox) return;

      // 마우스가 방어선 밖으로 나가면 선에 걸리도록 강제 고정 (Clamping)
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

      // 충돌 검사
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
        if (selectionBox && selectionBox.parentNode) {
          selectionBox.parentNode.removeChild(selectionBox);
        }
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
        code = code.replace(safeTarget, v4Engine + '\n  ' + safeTarget);
        fs.writeFileSync(path, code);
        console.log("✅ 프론트엔드: 기존 찌꺼기 완벽 제거 후 V4 엔진 탑재 대성공!");
    } else {
        console.log("❌ 타겟 위치를 찾을 수 없습니다.");
    }
}
