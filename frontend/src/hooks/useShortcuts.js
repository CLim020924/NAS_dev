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
      // 입력창이나 코드/문서 편집기 안에서는 파일 단축키가 키 입력을 가로채지 않는다.
      const target = e.target;
      const targetTag = target?.tagName || '';
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      const isEditingSurface =
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(targetTag) ||
        target?.isContentEditable ||
        target?.getAttribute?.('role') === 'textbox' ||
        target?.closest?.(
          '.monaco-editor, .monaco-editor textarea, .view-lines, .inputarea, [contenteditable="true"], [role="textbox"]'
        ) ||
        path.some((node) => {
          if (!node?.classList && !node?.getAttribute) return false;
          return (
            node.classList?.contains('monaco-editor') ||
            node.classList?.contains('view-lines') ||
            node.classList?.contains('inputarea') ||
            node.getAttribute?.('contenteditable') === 'true' ||
            node.getAttribute?.('role') === 'textbox'
          );
        });
      if (isEditingSurface) return;

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
