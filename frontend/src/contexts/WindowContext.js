import React, { createContext, useState, useContext, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';

const WindowContext = createContext();

export const WindowProvider = ({ children }) => {
  const [openWindows, setOpenWindows] = useState([]);
  const [topZIndex, setTopZIndex] = useState(100);
  const [taskbarOrder, setTaskbarOrder] = useState([]);
  
  // [추가] 현재 선택된(포커스된) 대상을 추적합니다. 기본값은 바탕화면('desktop')
  const [focusedContext, setFocusedContext] = useState('desktop');

  useEffect(() => {
    setTaskbarOrder(prev => {
      const newIds = openWindows.map(w => w.id).filter(id => !prev.includes(id));
      const validOrder = prev.filter(id => openWindows.find(w => w.id === id));
      return [...validOrder, ...newIds];
    });
  }, [openWindows]);

  const taskbarWindows = useMemo(() => {
    return taskbarOrder.map(id => openWindows.find(w => w.id === id)).filter(Boolean);
  }, [openWindows, taskbarOrder]);

  const activeWindowId = useMemo(() => {
    if (openWindows.length === 0) return null;
    return openWindows.reduce((top, current) => {
      if (!top) return current;
      return current.zIndex > top.zIndex ? current : top;
    }, null)?.id || null;
  }, [openWindows]);

  // 창 포커스 시 최소화도 함께 해제하고, 최근 사용 순서도 갱신
  const focusWindow = (id) => {
    setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: topZIndex + 1, isMinimized: false } : w));
    setTaskbarOrder(prev => [...prev.filter(itemId => itemId !== id), id]);
    setTopZIndex(prev => prev + 1);
    setFocusedContext(id);
  };

  const closeWindow = (id) => {
    setOpenWindows(prev => prev.filter(w => w.id !== id));
    if (focusedContext === id) setFocusedContext('desktop'); // 닫은 창이 포커스였다면 바탕화면으로 포커스 이동
  };
  
  const toggleMinimize = (id) => {
    const target = openWindows.find(w => w.id === id);
    if (!target) return;

    if (!target.isMinimized && focusedContext === id) {
      setFocusedContext('desktop');
    }

    setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: !w.isMinimized } : w));

    if (target.isMinimized) {
      setTaskbarOrder(prev => [...prev.filter(itemId => itemId !== id), id]);
      setTopZIndex(prev => prev + 1);
    }
  };
  
  const toggleMaximize = (id) => {
    setOpenWindows(prev => prev.map(w => {
      if (w.id !== id) return w;

      if (!w.isMaximized) {
        return {
          ...w,
          isMaximized: true,
          isImmersive: false,
          prevSize: w.prevSize || { width: w.width || 900, height: w.height || 650 },
          prevPosition: w.prevPosition || { x: w.x || 100, y: w.y || 50 }
        };
      }

      const pSize = w.prevSize || { width: 900, height: 650 };
      const pPos = w.prevPosition || { x: 100, y: 50 };
      return {
        ...w,
        isMaximized: false,
        width: pSize.width,
        height: pSize.height,
        x: pPos.x,
        y: pPos.y
      };
    }));
  };

  const toggleFullscreen = (id) => {
    setOpenWindows(prev => prev.map(w => {
      if (w.id !== id) return w;

      if (!w.isImmersive) {
        return {
          ...w,
          isImmersive: true,
          isMaximized: false,
          prevSize: w.prevSize || { width: w.width || 900, height: w.height || 650 },
          prevPosition: w.prevPosition || { x: w.x || 100, y: w.y || 50 }
        };
      }

      const pSize = w.prevSize || { width: 900, height: 650 };
      const pPos = w.prevPosition || { x: 100, y: 50 };
      return {
        ...w,
        isImmersive: false,
        width: pSize.width,
        height: pSize.height,
        x: pPos.x,
        y: pPos.y
      };
    }));
  };

  const normalizeNasPath = useCallback((value = '/') => {
    if (!value || value === 'undefined') return '/';
    const cleaned = String(value).replace(/\\/g, '/');
    return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
  }, []);

  const getPathLeafName = useCallback((targetPath) => {
    const safe = normalizeNasPath(targetPath);
    if (safe === '/') return '받은 파일';
    const segments = safe.split('/').filter(Boolean);
    return segments[segments.length - 1] || '파일';
  }, [normalizeNasPath]);


  const fetchFiles = useCallback(async (arg1, arg2) => {
    // 💡 [핵심] NAS.js가 경로 1개만 던졌는지, 창번호와 경로 2개를 다 던졌는지 찰떡같이 구분합니다!
    const isSingleArg = arg2 === undefined;
    let targetPath = isSingleArg ? arg1 : arg2;
    const targetWindowId = isSingleArg ? null : arg1;

    // 경로가 비어있거나 'undefined'라는 글자로 오면 안전하게 바탕화면('/')으로 처리
    if (!targetPath || targetPath === 'undefined') targetPath = '/';

    try {
      const response = await axios.get(`/api/files?path=${encodeURIComponent(targetPath)}`, { withCredentials: true });
      
      setOpenWindows(prev => prev.map(w => {
        // 명시된 창이거나, 현재 복사된 폴더를 열고 있는 "모든 창"의 화면을 즉시 새로고침합니다!
        if (w.id === targetWindowId || w.currentPath === targetPath) {
          return { ...w, files: response.data || [], currentPath: targetPath, isLoaded: true };
        }
        return w;
      }));
      
    } catch (err) { console.error("파일 로드 실패:", err); }
  }, []);


  const openFolderWindowByPath = useCallback((requestedPath, explicitName = null) => {
    const targetPath = normalizeNasPath(requestedPath);
    const name = explicitName || getPathLeafName(targetPath);
    const winId = targetPath === '/' ? 'system_root' : `chat_folder_${targetPath}`;

    const existing = openWindows.find((w) => w.id === winId);
    if (existing) {
      focusWindow(winId);
      return;
    }

    setOpenWindows(prev => [
      ...prev,
      {
        id: winId,
        name,
        path: targetPath,
        fullPath: targetPath,
        winType: 'folder',
        basePath: targetPath,
        currentPath: targetPath,
        files: [],
        isLoaded: false,
        zIndex: topZIndex + 1,
        sidebarOpen: true,
        width: 900,
        height: 650,
        x: 100 + (prev.length * 30),
        y: 50 + (prev.length * 30),
        isMinimized: false,
        isMaximized: false,
      }
    ]);
    setTopZIndex(prev => prev + 1);
    setFocusedContext(winId);
    setTimeout(() => fetchFiles(winId, targetPath), 0);
  }, [openWindows, focusWindow, topZIndex, fetchFiles, normalizeNasPath, getPathLeafName]);

  const openFileWindowByPath = useCallback(async (requestedPath, preferredName = null, forceEditMode = false) => {
    const safePath = normalizeNasPath(requestedPath);
    const fileId = `file_${safePath}`;

    if (openWindows.find(w => w.id === fileId)) {
      setOpenWindows(prev => prev.map(w =>
        w.id === fileId
          ? { ...w, isMinimized: false, zIndex: topZIndex + 1, mode: forceEditMode ? 'edit' : w.mode }
          : w
      ));
      setTopZIndex(prev => prev + 1);
      setFocusedContext(fileId);
      return;
    }

    const safeApiUrl = `/api/file/download?path=${encodeURIComponent(safePath)}`;
    const fallbackName = preferredName || getPathLeafName(safePath);
    let ext = fallbackName.includes('.') ? fallbackName.split('.').pop().toLowerCase() : '';
    const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'flac', 'm4a', 'pdf', 'heic', 'heif', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'hwp', 'hwpx', 'zip', 'tar', 'gz'];

    if (ext === '') {
      try {
        const { data } = await axios.get(`/api/file/detect?path=${encodeURIComponent(safePath)}`, { withCredentials: true });
        if (data.ext) ext = data.ext;
      } catch (e) {
        console.error('지문 감식 실패', e);
      }
    }

    const isBinary = binaryExts.includes(ext);

    try {
      let content = '';
      if (!isBinary) {
        const response = await axios.get(safeApiUrl, { responseType: 'text', withCredentials: true });
        content = typeof response.data === 'object' ? JSON.stringify(response.data, null, 2) : response.data;
      }

      setOpenWindows(prev => [
        ...prev,
        {
          id: fileId,
          name: fallbackName,
          fullPath: safePath,
          winType: 'file',
          content,
          originalContent: content,
          mode: forceEditMode && !isBinary ? 'edit' : 'view',
          isBinary,
          url: safeApiUrl,
          ext,
          zIndex: topZIndex + 1,
          width: 800,
          height: 600,
          x: 150 + (prev.length * 30),
          y: 100 + (prev.length * 30),
          isMinimized: false,
          isMaximized: false
        }
      ]);
      setTopZIndex(prev => prev + 1);
      setFocusedContext(fileId);
    } catch (err) {
      console.error('파일 열기 실패:', err);
      alert(err.response?.data?.error || '파일 열기에 실패했습니다.');
    }
  }, [openWindows, topZIndex, normalizeNasPath, getPathLeafName]);

  const openAppWindow = useCallback((app) => {
    if (!app?.id) return;
    const winId = `app_${app.id}`;
    const existing = openWindows.find((w) => w.id === winId);
    if (existing) {
      focusWindow(winId);
      return;
    }

    setOpenWindows(prev => [
      ...prev,
      {
        id: winId,
        appId: app.id,
        name: app.title || app.name || '앱',
        winType: 'app',
        zIndex: topZIndex + 1,
        width: app.width || 860,
        height: app.height || 620,
        x: app.x ?? 120 + (prev.length * 28),
        y: app.y ?? 72 + (prev.length * 28),
        isMinimized: false,
        isMaximized: false,
        payload: app.payload || {}
      }
    ]);
    setTopZIndex(prev => prev + 1);
    setFocusedContext(winId);
  }, [openWindows, focusWindow, topZIndex]);


  return (
    <WindowContext.Provider value={{
      openWindows, setOpenWindows, topZIndex, setTopZIndex,
      taskbarOrder, setTaskbarOrder, taskbarWindows, activeWindowId,
      focusedContext, setFocusedContext, // 새로 추가된 포커스 상태 내보내기
      focusWindow, closeWindow, toggleMinimize, toggleMaximize, toggleFullscreen, fetchFiles,
      openFolderWindowByPath, openFileWindowByPath, openAppWindow
    }}>
      {children}
    </WindowContext.Provider>
  );
};

export const useWindows = () => useContext(WindowContext);
