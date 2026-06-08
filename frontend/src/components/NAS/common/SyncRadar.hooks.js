import { useEffect } from 'react';
import axios from 'axios';

const useNASSync = ({
  inlineEditRef,
  contextMenuRef,
  desktopItemsRef,
  setDesktopItems,
  openWindowsRef,
  setOpenWindows,
}) => {
  useEffect(() => {
    const syncInterval = setInterval(async () => {
      if (inlineEditRef.current || contextMenuRef.current) return;

      try {
        const res = await axios.get(`/api/files?path=/&t=${Date.now()}`, { withCredentials: true });
        const newData = res.data || [];
        if (JSON.stringify(newData) !== JSON.stringify(desktopItemsRef.current)) {
          setDesktopItems(newData);
        }
      } catch (e) {}

      openWindowsRef.current.forEach(async (win) => {
        if (win.winType === 'folder') {
          try {
            const res = await axios.get(`/api/files?path=${encodeURIComponent(win.currentPath)}&t=${Date.now()}`, { withCredentials: true });
            const newFiles = res.data || [];
            if (JSON.stringify(newFiles) !== JSON.stringify(win.files)) {
              setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, files: newFiles } : w));
            }
          } catch (e) {}
        }
      });
    }, 3000);

    return () => clearInterval(syncInterval);
  }, [inlineEditRef, contextMenuRef, desktopItemsRef, setDesktopItems, openWindowsRef, setOpenWindows]);
};

export default useNASSync;
