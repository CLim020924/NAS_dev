import React, { createContext, useState, useContext, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { BINARY_VIEWER_EXTENSIONS } from '../utils/officeFormats';
import {
  LEGACY_FILE_MANAGER_PATH_KEY,
  getFileManagerPathStorageKey,
  getWorkspaceIdentityTransition,
  readStoredWorkspaceIdentity,
  readWorkspaceFileManagerPath,
} from './windowWorkspaceIdentity';
import { createWorkspaceViewStateQueue, loadWorkspaceViewState } from '../utils/workspaceViewState';

const WindowContext = createContext();

const TOOLBAR_HEIGHT = 48;
const VIEWPORT_GAP = 8;

const numericDimension = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const fitWindowToViewport = (win) => {
  if (typeof window === 'undefined' || win.isMaximized || win.isImmersive || win.isMinimized) return win;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const maxWidth = Math.max(280, viewportWidth - (VIEWPORT_GAP * 2));
  const maxHeight = Math.max(240, viewportHeight - TOOLBAR_HEIGHT - VIEWPORT_GAP);
  const width = Math.min(numericDimension(win.width, 860), maxWidth);
  const height = Math.min(numericDimension(win.height, 620), maxHeight);
  const maxX = Math.max(VIEWPORT_GAP, viewportWidth - width - VIEWPORT_GAP);
  const maxY = Math.max(TOOLBAR_HEIGHT, viewportHeight - height - VIEWPORT_GAP);
  const x = Math.min(Math.max(numericDimension(win.x, VIEWPORT_GAP), VIEWPORT_GAP), maxX);
  const y = Math.min(Math.max(numericDimension(win.y, TOOLBAR_HEIGHT), TOOLBAR_HEIGHT), maxY);

  if (width === win.width && height === win.height && x === win.x && y === win.y) return win;
  return { ...win, width, height, x, y };
};

export const WindowProvider = ({ children }) => {
  const initialWorkspaceIdentity = readStoredWorkspaceIdentity(localStorage);
  const [openWindows, setOpenWindows] = useState([]);
  const [topZIndex, setTopZIndex] = useState(100);
  const topZIndexRef = useRef(100);
  const [taskbarOrder, setTaskbarOrder] = useState([]);
  const [workspaceIdentity, setWorkspaceIdentity] = useState(initialWorkspaceIdentity);
  const workspaceIdentityRef = useRef(initialWorkspaceIdentity);
  const [fileManagerPath, setFileManagerPath] = useState(() => (
    readWorkspaceFileManagerPath(localStorage, initialWorkspaceIdentity)
  ));
  const [fileManagerStateReady, setFileManagerStateReady] = useState(false);
  const fileManagerStateQueueRef = useRef(null);
  if (!fileManagerStateQueueRef.current) fileManagerStateQueueRef.current = createWorkspaceViewStateQueue();
  
  // [추가] 현재 선택된(포커스된) 대상을 추적합니다. 기본값은 바탕화면('desktop')
  const [focusedContext, setFocusedContext] = useState('desktop');
  const [aiSelectedPaths, setAiSelectedPaths] = useState([]);

  const fitOpenWindows = useCallback(() => {
    setOpenWindows((prev) => {
      let changed = false;
      const next = prev.map((win) => {
        const fitted = fitWindowToViewport(win);
        if (fitted !== win) changed = true;
        return fitted;
      });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    fitOpenWindows();
  }, [fitOpenWindows, openWindows.length]);

  useEffect(() => {
    const handleViewportResize = () => window.requestAnimationFrame(fitOpenWindows);
    window.addEventListener('resize', handleViewportResize);
    window.visualViewport?.addEventListener('resize', handleViewportResize);
    return () => {
      window.removeEventListener('resize', handleViewportResize);
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
    };
  }, [fitOpenWindows]);

  useEffect(() => {
    localStorage.removeItem(LEGACY_FILE_MANAGER_PATH_KEY);
  }, []);

  useEffect(() => {
    const key = getFileManagerPathStorageKey(workspaceIdentity);
    if (key) localStorage.setItem(key, fileManagerPath || '/');
  }, [fileManagerPath, workspaceIdentity]);

  useEffect(() => {
    const controller = new AbortController();
    fileManagerStateQueueRef.current.discard();
    setFileManagerStateReady(false);
    if (!workspaceIdentity) return () => controller.abort();
    loadWorkspaceViewState({ kind: 'file-manager' }, controller.signal)
      .then((record) => {
        const restoredPath = record?.state?.currentPath;
        if (typeof restoredPath === 'string' && restoredPath.startsWith('/')) setFileManagerPath(restoredPath);
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setFileManagerStateReady(true); });
    return () => controller.abort();
  }, [workspaceIdentity]);

  useEffect(() => {
    if (!workspaceIdentity || !fileManagerStateReady) return;
    fileManagerStateQueueRef.current.schedule({ kind: 'file-manager' }, { currentPath: fileManagerPath || '/' });
  }, [fileManagerPath, fileManagerStateReady, workspaceIdentity]);

  useEffect(() => () => fileManagerStateQueueRef.current.dispose(), []);

  useEffect(() => {
    const synchronizeWorkspaceIdentity = () => {
      const nextIdentity = readStoredWorkspaceIdentity(localStorage);
      const transition = getWorkspaceIdentityTransition(
        localStorage,
        workspaceIdentityRef.current,
        nextIdentity
      );
      if (!transition) return;

      workspaceIdentityRef.current = transition.identity;
      setWorkspaceIdentity(transition.identity);
      setOpenWindows(transition.openWindows);
      setTaskbarOrder(transition.taskbarOrder);
      setFocusedContext(transition.focusedContext);
      setAiSelectedPaths([]);
      setTopZIndex(transition.topZIndex);
      topZIndexRef.current = transition.topZIndex;
      setFileManagerPath(transition.fileManagerPath);
    };

    window.addEventListener('storage', synchronizeWorkspaceIdentity);
    window.addEventListener('nas:user-updated', synchronizeWorkspaceIdentity);
    const identityTimer = window.setInterval(synchronizeWorkspaceIdentity, 500);
    return () => {
      window.removeEventListener('storage', synchronizeWorkspaceIdentity);
      window.removeEventListener('nas:user-updated', synchronizeWorkspaceIdentity);
      window.clearInterval(identityTimer);
    };
  }, []);

  useEffect(() => {
    setTaskbarOrder(prev => {
      const newIds = openWindows.map(w => w.id).filter(id => !prev.includes(id));
      const validOrder = prev.filter(id => openWindows.find(w => w.id === id));
      return [...validOrder, ...newIds];
    });
  }, [openWindows]);

  useEffect(() => {
    topZIndexRef.current = Math.max(topZIndexRef.current, topZIndex);
  }, [topZIndex]);

  const taskbarWindows = useMemo(() => {
    return taskbarOrder.map(id => openWindows.find(w => w.id === id)).filter(Boolean);
  }, [openWindows, taskbarOrder]);

  const activeWindowId = useMemo(() => {
    const visibleWindows = openWindows.filter((win) => !win.isMinimized);
    if (visibleWindows.length === 0) return null;
    const focused = visibleWindows.find((win) => win.id === focusedContext);
    if (focused) return focused.id;
    return visibleWindows.reduce((top, current) => {
      if (!top) return current;
      return current.zIndex > top.zIndex ? current : top;
    }, null)?.id || null;
  }, [openWindows, focusedContext]);

  const allocateWindowZIndex = useCallback(() => {
    const next = topZIndexRef.current + 1;
    topZIndexRef.current = next;
    setTopZIndex(next);
    return next;
  }, []);

  // Every window type shares this single MRU authority. Never assign focus-layer z-index elsewhere.
  const focusWindow = useCallback((id) => {
    if (!id || id === 'desktop') return;
    const nextZIndex = allocateWindowZIndex();
    setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: nextZIndex, isMinimized: false } : w));
    setTaskbarOrder(prev => [...prev.filter(itemId => itemId !== id), id]);
    setFocusedContext(id);
  }, [allocateWindowZIndex]);

  const showDesktop = useCallback(() => {
    setOpenWindows(prev => prev.map(win => (
      win.isMinimized ? win : { ...win, isMinimized: true }
    )));
    setFocusedContext('desktop');
    setAiSelectedPaths([]);
  }, []);

  const closeWindow = (id) => {
    const nextWindow = [...taskbarWindows]
      .reverse()
      .find((win) => win.id !== id && !win.isMinimized);
    setOpenWindows(prev => prev.filter(w => w.id !== id));
    setTaskbarOrder(prev => prev.filter(itemId => itemId !== id));
    if (focusedContext === id) {
      if (nextWindow) focusWindow(nextWindow.id);
      else setFocusedContext('desktop');
    }
  };
  
  const toggleMinimize = (id) => {
    const target = openWindows.find(w => w.id === id);
    if (!target) return;

    if (!target.isMinimized && focusedContext === id) {
      const nextWindow = [...taskbarWindows]
        .reverse()
        .find((win) => win.id !== id && !win.isMinimized);
      if (nextWindow) focusWindow(nextWindow.id);
      else setFocusedContext('desktop');
    }

    setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: !w.isMinimized } : w));

    if (target.isMinimized) {
      setTaskbarOrder(prev => [...prev.filter(itemId => itemId !== id), id]);
      const nextZIndex = allocateWindowZIndex();
      setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: nextZIndex } : w));
      setFocusedContext(id);
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

    const nextZIndex = allocateWindowZIndex();
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
        zIndex: nextZIndex,
        sidebarOpen: true,
        width: 900,
        height: 650,
        x: 100 + (prev.length * 30),
        y: 50 + (prev.length * 30),
        isMinimized: false,
        isMaximized: false,
      }
    ]);
    setFocusedContext(winId);
    setTimeout(() => fetchFiles(winId, targetPath), 0);
  }, [openWindows, focusWindow, allocateWindowZIndex, fetchFiles, normalizeNasPath, getPathLeafName]);

  const openFileWindowByPath = useCallback(async (requestedPath, preferredName = null, forceEditMode = false) => {
    const safePath = normalizeNasPath(requestedPath);
    const fileId = `file_${safePath}`;

    if (openWindows.find(w => w.id === fileId)) {
      const nextZIndex = allocateWindowZIndex();
      setOpenWindows(prev => prev.map(w =>
        w.id === fileId
          ? { ...w, isMinimized: false, zIndex: nextZIndex, mode: forceEditMode ? 'edit' : w.mode, preferEditMode: forceEditMode || w.preferEditMode }
          : w
      ));
      setTaskbarOrder(prev => [...prev.filter(itemId => itemId !== fileId), fileId]);
      setFocusedContext(fileId);
      return;
    }

    const safeApiUrl = `/api/file/download?path=${encodeURIComponent(safePath)}`;
    const fallbackName = preferredName || getPathLeafName(safePath);
    let ext = fallbackName.includes('.') ? fallbackName.split('.').pop().toLowerCase() : '';
    const binaryExts = BINARY_VIEWER_EXTENSIONS;

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

      const nextZIndex = allocateWindowZIndex();
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
          preferEditMode: forceEditMode,
          isBinary,
          url: safeApiUrl,
          ext,
          zIndex: nextZIndex,
          width: 800,
          height: 600,
          x: 150 + (prev.length * 30),
          y: 100 + (prev.length * 30),
          isMinimized: false,
          isMaximized: false
        }
      ]);
      setTaskbarOrder(prev => [...prev.filter(itemId => itemId !== fileId), fileId]);
      setFocusedContext(fileId);
    } catch (err) {
      console.error('파일 열기 실패:', err);
      alert(err.response?.data?.error || '파일 열기에 실패했습니다.');
    }
  }, [openWindows, allocateWindowZIndex, normalizeNasPath, getPathLeafName]);

  const openAppWindow = useCallback((app) => {
    if (!app?.id) return;
    const winId = `app_${app.id}`;
    const nextZIndex = allocateWindowZIndex();

    setOpenWindows(prev => {
      const existing = prev.find((w) => w.id === winId);
      if (existing) {
        return prev.map((w) => w.id === winId ? { ...w, isMinimized: false, zIndex: nextZIndex } : w);
      }

      return [
        ...prev,
        {
        id: winId,
        appId: app.id,
        name: app.title || app.name || '앱',
        winType: 'app',
        zIndex: nextZIndex,
        width: app.width || 860,
        height: app.height || 620,
        x: app.x ?? 120 + (prev.length * 28),
        y: app.y ?? 72 + (prev.length * 28),
        isMinimized: false,
        isMaximized: false,
        payload: app.payload || {}
      }
      ];
    });
    setTaskbarOrder(prev => [...prev.filter(itemId => itemId !== winId), winId]);
    setFocusedContext(winId);
  }, [allocateWindowZIndex]);


  return (
    <WindowContext.Provider value={{
      openWindows, setOpenWindows, topZIndex, setTopZIndex,
      taskbarOrder, setTaskbarOrder, taskbarWindows, activeWindowId,
      fileManagerPath, setFileManagerPath,
      focusedContext, setFocusedContext, // 새로 추가된 포커스 상태 내보내기
      aiSelectedPaths, setAiSelectedPaths,
      focusWindow, showDesktop, closeWindow, toggleMinimize, toggleMaximize, toggleFullscreen, fetchFiles,
      openFolderWindowByPath, openFileWindowByPath, openAppWindow
    }}>
      {children}
    </WindowContext.Provider>
  );
};

export const useWindows = () => useContext(WindowContext);
