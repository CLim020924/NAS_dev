import { useEffect } from 'react';

const useShortcuts = ({
  selectedItems,
  onRename,
  onDelete,
  onOpen,
  onSelectAll,
  onDeselectAll,
  onNewFolder,
}) => {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 입력창(input)이나 텍스트 편집기 안에서 타이핑 중일 때는 단축키 발동 안 함
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

      // 1. 이름 바꾸기 (F2) - 단일 선택일 때만
      if (e.key === 'F2') {
        e.preventDefault();
        if (selectedItems.length === 1) onRename();
      }

      // 2. 삭제 (Delete) - 하나 이상 선택되었을 때 다중 삭제
      if (e.key === 'Delete') {
        e.preventDefault();
        if (selectedItems.length > 0) onDelete();
      }

      // 3. 열기 (Enter) - 단일 선택일 때만
      if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedItems.length === 1) onOpen();
      }

      // 4. 전체 선택 (Ctrl + A)
      if (ctrlOrCmd && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        onSelectAll();
      }

      // 5. 선택 해제 및 닫기 (ESC)
      if (e.key === 'Escape') {
        e.preventDefault();
        onDeselectAll();
      }

      // 6. 새 폴더 (Ctrl + Shift + N) - 브라우저 시크릿 창과 겹칠 수 있으므로 Alt + N 도 보조로 추가
      if ((ctrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'n') || (e.altKey && e.key.toLowerCase() === 'n')) {
        e.preventDefault();
        onNewFolder();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, onRename, onDelete, onOpen, onSelectAll, onDeselectAll, onNewFolder]);
};

export default useShortcuts;
