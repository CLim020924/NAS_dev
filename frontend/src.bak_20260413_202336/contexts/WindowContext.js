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

  // 창을 포커스할 때 해당 창을 focusedContext로 지정
  const focusWindow = (id) => {
    setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, zIndex: topZIndex + 1 } : w));
    setTopZIndex(prev => prev + 1);
    setFocusedContext(id);
  };

  const closeWindow = (id) => {
    setOpenWindows(prev => prev.filter(w => w.id !== id));
    if (focusedContext === id) setFocusedContext('desktop'); // 닫은 창이 포커스였다면 바탕화면으로 포커스 이동
  };
  
  const toggleMinimize = (id) => setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: !w.isMinimized } : w));
  
  const toggleMaximize = (id) => {
  setOpenWindows(prev => prev.map(w => {
    if (w.id !== id) return w;
    if (!w.isMaximized) {
      return { 
        ...w, 
        isMaximized: true, 
        prevSize: { width: w.width || 800, height: w.height || 600 }, 
        prevPosition: { x: w.x || 100, y: w.y || 100 } 
      };
    }
    // 복원 시 데이터가 날아갔어도 절대 에러가 나지 않도록 기본값(Fallback) 강제 적용!
    const pSize = w.prevSize || { width: 800, height: 600 };
    const pPos = w.prevPosition || { x: 100, y: 100 };
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

  return (
    <WindowContext.Provider value={{
      openWindows, setOpenWindows, topZIndex, setTopZIndex,
      taskbarOrder, setTaskbarOrder, taskbarWindows, activeWindowId,
      focusedContext, setFocusedContext, // 새로 추가된 포커스 상태 내보내기
      focusWindow, closeWindow, toggleMinimize, toggleMaximize, fetchFiles
    }}>
      {children}
    </WindowContext.Provider>
  );
};

export const useWindows = () => useContext(WindowContext);
