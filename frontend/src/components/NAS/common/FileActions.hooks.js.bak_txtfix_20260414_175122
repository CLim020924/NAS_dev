import { useCallback } from 'react';
import axios from 'axios';
import { ensureSlash } from '../../../utils/pathUtils';
import { snapToDesktopGrid } from '../../../utils/gridUtils';

const useFileActions = ({
  isMobile,
  setSnackbar,
  setDesktopItems,
  desktopItems,
  openWindows,
  setOpenWindows,
  topZIndex,
  setTopZIndex,
  setFocusedContext,
  focusWindow,
  fetchFiles,
  iconPositions,
  setIconPositions,
  fileInputRef,
  uploadTargetRef,
  loadDesktopItems,
  setSelectedItems,
  setInlineEdit,
}) => {
  const showError = useCallback((action, err) => {
    let errorMsg = err.message;
    if (err.response) {
      errorMsg = `Code: ${err.response.status}, Data: ${JSON.stringify(err.response.data)}`;
      if (err.response.status === 401) {
        alert("로그인이 만료되었거나 인증 정보가 잘못되었습니다. 다시 로그인해주세요.");
        localStorage.removeItem('user');
        window.location.href = '/login';
        return;
      }
    }
    const fullMsg = `[${action} 오류] ${errorMsg}`;
    console.error(fullMsg);
    setSnackbar({ open: true, message: fullMsg, severity: 'error' });
    if (isMobile) alert(fullMsg);
  }, [isMobile, setSnackbar]);

  const refreshPath = useCallback((path) => {
    const safePath = ensureSlash(path);
    if (safePath === '/') loadDesktopItems();

    openWindows.forEach(w => {
      if (w.winType === 'folder' && w.currentPath === safePath) {
        setTimeout(() => fetchFiles(w.id, safePath), 50);
      }
    });
  }, [loadDesktopItems, openWindows, fetchFiles]);

  const openFolderWindow = useCallback((item) => {
    const winId = `desk_${item.name}`;
    const targetPath = ensureSlash(item.path || item.fullPath);

    if (!openWindows.find(w => w.id === winId && w.id !== 'system_root')) {
      const newWinId = item.id === 'system_root' ? 'system_root' : winId;
      if (openWindows.find(w => w.id === newWinId)) {
        focusWindow(newWinId);
        return;
      }

      setOpenWindows(prev => [...prev, {
        ...item,
        id: newWinId,
        winType: 'folder',
        basePath: targetPath,
        currentPath: targetPath,
        files: [],
        isLoaded: false,
        zIndex: topZIndex + 1,
        sidebarOpen: !isMobile,
        width: 900,
        height: 650,
        x: 100 + (prev.length * 30),
        y: 50 + (prev.length * 30),
        isMinimized: false,
        isMaximized: false,
        prevSize: { width: 900, height: 650 },
        prevPosition: { x: 100, y: 50 }
      }]);
      setTopZIndex(prev => prev + 1);
      setFocusedContext(newWinId);
    } else {
      focusWindow(winId);
    }

    setSelectedItems([]);
  }, [
    openWindows,
    focusWindow,
    setOpenWindows,
    topZIndex,
    isMobile,
    setTopZIndex,
    setFocusedContext,
    setSelectedItems,
  ]);

  const openFileWindow = useCallback(async (fileItem, forceEditMode = false) => {
    const safePath = ensureSlash(fileItem.fullPath);
    const fileId = `file_${safePath}`;

    if (openWindows.find(w => w.id === fileId)) {
      setOpenWindows(prev => prev.map(w =>
        w.id === fileId
          ? { ...w, isMinimized: false, zIndex: topZIndex + 1, mode: forceEditMode ? 'edit' : w.mode }
          : w
      ));
      setTopZIndex(topZIndex + 1);
      setFocusedContext(fileId);
      return;
    }

    try {
      const safeApiUrl = `/api/file/download?path=${encodeURIComponent(safePath)}`;
      const response = await axios.get(safeApiUrl, { responseType: 'text', withCredentials: true });

      let content = response.data;
      if (typeof content === 'object') {
        content = JSON.stringify(content, null, 2);
      }

      setOpenWindows(prev => [...prev, {
        id: fileId,
        name: fileItem.name,
        fullPath: safePath,
        winType: 'file',
        content: content,
        originalContent: content,
        mode: forceEditMode ? 'edit' : 'view',
        zIndex: topZIndex + 1,
        width: 800,
        height: 600,
        x: 150 + (prev.length * 30),
        y: 100 + (prev.length * 30),
        isMinimized: false,
        isMaximized: false,
        prevSize: { width: 800, height: 600 },
        prevPosition: { x: 150, y: 100 }
      }]);
      setTopZIndex(prev => prev + 1);
      setFocusedContext(fileId);
    } catch (err) {
      showError('파일 열기', err);
    }

    setSelectedItems([]);
  }, [
    openWindows,
    setOpenWindows,
    topZIndex,
    setTopZIndex,
    setFocusedContext,
    showError,
    setSelectedItems,
  ]);

  const toggleSidebar = useCallback((windowId) => {
    setOpenWindows(prev => prev.map(w => w.id === windowId ? { ...w, sidebarOpen: !w.sidebarOpen } : w));
  }, [setOpenWindows]);

  const toggleEditMode = useCallback((id) => {
    setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, mode: w.mode === 'view' ? 'edit' : 'view' } : w));
  }, [setOpenWindows]);

  const handleContentChange = useCallback((id, newContent) => {
    setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, content: newContent } : w));
  }, [setOpenWindows]);

  const saveFile = useCallback(async (win) => {
    try {
      const blob = new Blob([win.content], { type: 'text/plain' });
      const file = new File([blob], win.name, { type: 'text/plain' });
      const formData = new FormData();
      const dirPath = win.fullPath.substring(0, win.fullPath.lastIndexOf('/'));
      formData.append('path', ensureSlash(dirPath));
      formData.append('file', file);

      await axios.post('/api/file', formData, {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, originalContent: win.content, mode: 'view' } : w));
      setSnackbar({ open: true, message: `'${win.name}' 파일이 저장되었습니다.`, severity: 'success' });
    } catch (err) {
      showError('파일 저장', err);
    }
  }, [setOpenWindows, setSnackbar, showError]);

  const getUniqueName = useCallback((baseName, existingNames) => {
    let name = baseName;
    let counter = 1;
    while (existingNames.includes(name)) {
      name = `${baseName} ${counter}`;
      counter++;
    }
    return name;
  }, []);

  const handleInlineSubmit = useCallback(async (value, editState) => {
    if (!editState) return;
    setInlineEdit(null);

    const { mode, contextPath, oldPath, originalName, spawnPosition } = editState;
    const safeContextPath = ensureSlash(contextPath);

    let targetFiles = [];
    if (safeContextPath === '/') {
      targetFiles = desktopItems;
    } else {
      const win = openWindows.find(w => w.currentPath === safeContextPath);
      if (win) targetFiles = win.files;
    }

    const existingNames = targetFiles.map(f => f.name);

    try {
      if (mode === 'new') {
        let finalName = value.trim() || '새 폴더';
        finalName = getUniqueName(finalName, existingNames);

        await axios.post('/api/file', { folderName: finalName, path: safeContextPath }, { withCredentials: true });

        if (safeContextPath === '/' && spawnPosition && !isMobile) {
          const newFullPath = `/${finalName}`;
          setIconPositions(prev => ({ ...prev, [newFullPath]: spawnPosition }));
        }

        refreshPath(safeContextPath);
        setSnackbar({ open: true, message: `'${finalName}' 생성 완료`, severity: 'success' });
      } else if (mode === 'rename') {
        const finalName = value.trim();
        if (!finalName || finalName === originalName) return;

        if (existingNames.includes(finalName)) {
          setSnackbar({ open: true, message: "동일한 이름이 이미 존재합니다.", severity: 'error' });
          return;
        }

        const safeOldPath = ensureSlash(oldPath);
        const cleanPath = safeContextPath.endsWith('/') && safeContextPath !== '/' ? safeContextPath : (safeContextPath === '/' ? '' : safeContextPath);
        const newPath = `${cleanPath}/${finalName}`;

        await axios.put('/api/file', { oldPath: safeOldPath, newPath }, { withCredentials: true });

        if (safeContextPath === '/' && !isMobile) {
          setIconPositions(prev => {
            const newPos = { ...prev };
            if (newPos[safeOldPath]) {
              newPos[newPath] = newPos[safeOldPath];
              delete newPos[safeOldPath];
            }
            return newPos;
          });
        }

        refreshPath(safeContextPath);
      }
    } catch (err) {
      showError('이름/폴더 적용', err);
    }
  }, [
    setInlineEdit,
    desktopItems,
    openWindows,
    getUniqueName,
    isMobile,
    setIconPositions,
    refreshPath,
    setSnackbar,
    showError,
  ]);

  const handleCreateFolderStart = useCallback((targetPath, targetWinId, spawnPosition = null) => {
    let snappedPosition = null;
    if (spawnPosition && !isMobile) {
      snappedPosition = snapToDesktopGrid(spawnPosition);
    }
    const finalWinId = targetWinId || 'desktop';
    setInlineEdit({ mode: 'new', contextPath: targetPath, windowId: finalWinId, name: '', spawnPosition: snappedPosition });
  }, [isMobile, setInlineEdit]);

  const handleRenameStart = useCallback((item, pathContext) => {
    setInlineEdit({ mode: 'rename', oldPath: item.fullPath, originalName: item.name, name: item.name, contextPath: pathContext });
  }, [setInlineEdit]);

  const handleUploadClick = useCallback((targetPath, targetWinId) => {
    uploadTargetRef.current = ensureSlash(targetPath);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, [uploadTargetRef, fileInputRef]);

  const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const targetPath = ensureSlash(uploadTargetRef.current);
    setSnackbar({ open: true, message: `'${file.name}' 업로드 준비 중...`, severity: 'info' });

    const formData = new FormData();
    formData.append('path', targetPath);
    formData.append('file', file);

    try {
      await axios.post('/api/file', formData, {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          if (percentCompleted === 100) {
            setSnackbar({ open: true, message: `서버에서 '${file.name}' 저장 처리 중...`, severity: 'info' });
          } else {
            setSnackbar({ open: true, message: `'${file.name}' 전송 중... ${percentCompleted}%`, severity: 'info' });
          }
        }
      });

      setSnackbar({ open: true, message: `'${file.name}' 업로드 완료!`, severity: 'success' });
      refreshPath(targetPath);
    } catch (err) {
      showError('파일 업로드', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [uploadTargetRef, setSnackbar, refreshPath, showError, fileInputRef]);

  const handleDelete = useCallback(async (itemsToDel, pathContext) => {
    if (!itemsToDel || itemsToDel.length === 0) return;

    const msg = itemsToDel.length === 1
      ? `정말로 '${itemsToDel[0].name}'을(를) 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`
      : `정말로 선택한 ${itemsToDel.length}개의 항목을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`;

    if (!window.confirm(msg)) return;

    try {
      await Promise.all(itemsToDel.map(async (item) => {
        const safePath = ensureSlash(item.fullPath);
        await axios.delete(`/api/file?path=${encodeURIComponent(safePath)}`, {
          data: { path: safePath },
          withCredentials: true
        });

        if (!isMobile) {
          setIconPositions(prev => {
            const n = { ...prev };
            delete n[safePath];
            return n;
          });
        }
      }));

      refreshPath(ensureSlash(pathContext));
      setSelectedItems([]);
      setSnackbar({ open: true, message: "삭제 완료", severity: 'success' });
    } catch (err) {
      showError('다중 파일 삭제', err);
    }
  }, [isMobile, setIconPositions, refreshPath, setSelectedItems, setSnackbar, showError]);

  const handleDownload = useCallback((item) => {
    const a = document.createElement('a');
    a.href = `/api/file/download?path=${encodeURIComponent(ensureSlash(item.fullPath))}`;
    a.download = item.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  const handleUp = useCallback((win) => {
    if (win.currentPath === win.basePath || win.currentPath === '/') return;
    const segments = win.currentPath.split('/').filter(Boolean);
    segments.pop();
    const parentPath = segments.length > 0 ? ensureSlash(segments.join('/')) : '/';
    fetchFiles(win.id, parentPath);
  }, [fetchFiles]);

  return {
    showError,
    refreshPath,
    openFolderWindow,
    openFileWindow,
    toggleSidebar,
    toggleEditMode,
    handleContentChange,
    saveFile,
    handleInlineSubmit,
    handleCreateFolderStart,
    handleRenameStart,
    handleUploadClick,
    handleFileUpload,
    handleDelete,
    handleDownload,
    handleUp,
  };
};

export default useFileActions;
