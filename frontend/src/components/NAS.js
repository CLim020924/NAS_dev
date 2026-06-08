import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Typography, Paper, IconButton, Table, TableBody, TableCell, TableContainer, TableRow, useMediaQuery, useTheme, List, ListItem, ListItemIcon, ListItemText, Button, Snackbar, Alert, CircularProgress, LinearProgress, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Divider, Chip} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { motion, AnimatePresence } from 'framer-motion';
import { Rnd } from 'react-rnd';
import axios from 'axios';

import { ensureSlash, getUniqueName, getRelativeSegments } from './NAS/nasUtils';
import InlineInput from './NAS/InlineInput';
import FileViewer from './NAS/FileViewer';
import NASContextMenu from './NAS/NASContextMenu';
import SidebarTree from './NAS/Window/SidebarTree';

import MenuIcon from '@mui/icons-material/Menu'; 
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import CloseIcon from '@mui/icons-material/Close';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import StorageIcon from '@mui/icons-material/Storage';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import NoteAddIcon from '@mui/icons-material/NoteAdd'; 
import RemoveIcon from '@mui/icons-material/Remove';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import FilterNoneIcon from '@mui/icons-material/FilterNone';

import { useWindows } from '../contexts/WindowContext';
import { useTransfer } from '../contexts/TransferContext';
import useShortcuts from '../hooks/useShortcuts';

const NAS = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const fileInputRef = useRef(null);
  const resumeTaskRef = useRef(null);
  const uploadTargetRef = useRef('/'); 
  const desktopRef = useRef(null); 
  const uploadControllersRef = useRef({});
  
  const currentUser = JSON.parse(localStorage.getItem('user')) || {};
  const isAdmin = currentUser.Masters || currentUser.Managers;

  const [desktopItems, setDesktopItems] = useState([]);

  const [showExt, setShowExt] = useState(localStorage.getItem('nas_show_extensions') === 'true');
  useEffect(() => {
    const handleStorageChange = () => setShowExt(localStorage.getItem('nas_show_extensions') === 'true');
    window.addEventListener('nas_settings_changed', handleStorageChange);
    return () => window.removeEventListener('nas_settings_changed', handleStorageChange);
  }, []);

  const getDisplayName = (item) => {
    if (item.type !== 'file' || showExt) return item.name;
    return item.name.includes('.') ? item.name.substring(0, item.name.lastIndexOf('.')) : item.name;
  };

  const [closePrompt, setClosePrompt] = useState(null);
  const [hoveredHeader, setHoveredHeader] = useState(null);
  const [folderDownload, setFolderDownload] = useState(null);
  const [fileInfo, setFileInfo] = useState({ open: false, loading: false, item: null, data: null, error: '' });
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });
  const [transferTasks, setTransferTasks] = useState([]);

  const [contextMenu, setContextMenu] = useState(null);
  const [inlineEdit, setInlineEdit] = useState(null);
  const [selectedItems, setSelectedItems] = useState([]);
  const [dragOverTarget, setDragOverTarget] = useState(null);
  const [iconPositions, setIconPositions] = useState(() => JSON.parse(localStorage.getItem('msp_icon_positions') || '{}'));
  
  const { openWindows, setOpenWindows, topZIndex, setTopZIndex, focusedContext, setFocusedContext, focusWindow, closeWindow, toggleMinimize, toggleMaximize, fetchFiles } = useWindows();
  const { startUpload } = useTransfer();

  const desktopItemsRef = useRef(desktopItems); desktopItemsRef.current = desktopItems;
  const openWindowsRef = useRef(openWindows); openWindowsRef.current = openWindows;
  const inlineEditRef = useRef(inlineEdit); inlineEditRef.current = inlineEdit;
  const contextMenuRef = useRef(contextMenu); contextMenuRef.current = contextMenu;

  const touchTimer = useRef(null);
  const isLongPressTriggered = useRef(false);

  const handleTouchStart = (e, type, ctxData) => {
    if (e.touches.length > 1) return;
    isLongPressTriggered.current = false;
    const clientX = e.touches[0].clientX, clientY = e.touches[0].clientY;
    touchTimer.current = setTimeout(() => {
      isLongPressTriggered.current = true;
      setFocusedContext(ctxData.windowId || 'desktop');
      setContextMenu({ mouseX: clientX, mouseY: clientY, type, ...ctxData });
      const safePath = ctxData.item ? ensureSlash(ctxData.item.fullPath) : null;
      if (safePath && !selectedItems.includes(safePath)) setSelectedItems([safePath]);
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500);
  };
  const cancelTouch = () => { if (touchTimer.current) { clearTimeout(touchTimer.current); touchTimer.current = null; } };

  useEffect(() => { localStorage.setItem('msp_icon_positions', JSON.stringify(iconPositions)); }, [iconPositions]);
  
  const [clipboard, setClipboard] = useState({ paths: [] });

  useEffect(() => {
    const handleKeyDown = async (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.closest('.monaco-editor') || e.target?.closest('.onlyoffice-wrapper')) return;

      if (e.key === 'Delete' || ((e.ctrlKey || e.metaKey) && ['c', 'v'].includes(e.key.toLowerCase()))) {
        console.log("⌨️ 단축키 감지됨:", e.key, "| 🎯 선택된 파일:", selectedItems, "| 📋 클립보드:", clipboard.paths);
      }

      let targetFolder = '/';
      if (focusedContext && focusedContext !== 'desktop') {
        const win = openWindowsRef.current.find(w => w.id === focusedContext);
        if (win && win.currentPath) targetFolder = win.currentPath;
      }

      if (e.key === 'Delete' && selectedItems.length > 0) {
        if (window.confirm(`선택한 ${selectedItems.length}개 항목을 삭제하시겠습니까?`)) {
          try {
            await Promise.all(selectedItems.map(item => axios.delete('/api/file', { data: { path: item }, withCredentials: true })));
            setSelectedItems([]); 
            if (typeof fetchFiles === 'function') { fetchFiles(targetFolder || '/'); if ((targetFolder || '/') !== '/') fetchFiles('/'); }
            setSnackbar({ open: true, message: '삭제 완료!', severity: 'success' });
          } catch(err) { showError('삭제', err); }
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && selectedItems.length > 0) {
        setClipboard({ paths: selectedItems });
        setSnackbar({ open: true, message: `${selectedItems.length}개 항목 복사됨`, severity: 'info' });
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && clipboard.paths.length > 0) {
        try {
          await axios.post('/api/file/copy', { sourcePaths: clipboard.paths, destinationFolder: targetFolder || '/' }, { withCredentials: true });
          if (typeof fetchFiles === 'function') { fetchFiles(targetFolder || '/'); if ((targetFolder || '/') !== '/') fetchFiles('/'); }
          setSnackbar({ open: true, message: '붙여넣기 성공!', severity: 'success' });
        } catch(err) { showError('붙여넣기', err); }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedItems, focusedContext, clipboard, fetchFiles]);

  useEffect(() => {
    let isSelecting = false;
    let startX = 0, startY = 0;
    let selectionBox = null;
    let limitRect = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
    let currentContainer = null;

    const isBlockedSelectionTarget = (target) => {
      if (!target || typeof target.closest !== 'function') return true;

      return Boolean(
        target.closest('.selectable-item') ||
        target.closest('button') ||
        target.closest('input') ||
        target.closest('textarea') ||
        target.closest('[role="button"]') ||
        target.closest('.MuiDialog-root') ||
        target.closest('.MuiModal-root') ||
        target.closest('.MuiPopover-root') ||
        target.closest('.MuiMenu-root') ||
        target.closest('.MuiSnackbar-root') ||
        target.closest('.MuiDrawer-root') ||
        target.closest('.MuiDialogTitle-root') ||
        target.closest('.window-header-drag-handle') ||
        target.closest('.dedicated-chat-window-header') ||
        target.closest('.chat-window-header') ||
        target.closest('.monaco-editor') ||
        target.closest('.onlyoffice-wrapper')
      );
    };

    const getAllowedSelectionContainer = (target) => {
      if (!target || typeof target.closest !== 'function') return null;

      // 폴더 창 내부의 파일 목록 영역에서만 범위 선택 허용
      const folderContentArea = target.closest('.window-content-area');
      if (folderContentArea) return folderContentArea;

      // NAS 바탕화면 영역에서만 범위 선택 허용
      const desktopArea = desktopRef.current;
      if (desktopArea && (target === desktopArea || desktopArea.contains(target))) {
        return desktopArea;
      }

      return null;
    };

    const handleMouseDown = (e) => {
      if (e.button !== 0) return;

      const allowedContainer = getAllowedSelectionContainer(e.target);
      if (!allowedContainer) return;

      if (isBlockedSelectionTarget(e.target)) return;

      currentContainer = allowedContainer;
      const rect = currentContainer.getBoundingClientRect();

      limitRect = {
        top: rect.top,
        left: rect.left,
        right: rect.right,
        bottom: rect.bottom
      };

      if (
        e.clientX < limitRect.left ||
        e.clientX > limitRect.right ||
        e.clientY < limitRect.top ||
        e.clientY > limitRect.bottom
      ) {
        return;
      }

      setSelectedItems([]);
      isSelecting = true;
      startX = e.clientX;
      startY = e.clientY;

      selectionBox = document.createElement('div');
      selectionBox.style.position = 'fixed';
      selectionBox.style.border = '1px solid rgba(59, 130, 246, 0.8)';
      selectionBox.style.backgroundColor = 'rgba(59, 130, 246, 0.2)';
      selectionBox.style.zIndex = '9999';
      selectionBox.style.pointerEvents = 'none';
      document.body.appendChild(selectionBox);
    };

    const handleMouseMove = (e) => {
      if (!isSelecting || !selectionBox || !currentContainer) return;

      const clampedX = Math.max(limitRect.left, Math.min(e.clientX, limitRect.right));
      const clampedY = Math.max(limitRect.top, Math.min(e.clientY, limitRect.bottom));

      const left = Math.min(startX, clampedX);
      const top = Math.min(startY, clampedY);
      const width = Math.abs(clampedX - startX);
      const height = Math.abs(clampedY - startY);

      selectionBox.style.left = left + 'px';
      selectionBox.style.top = top + 'px';
      selectionBox.style.width = width + 'px';
      selectionBox.style.height = height + 'px';

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
        currentContainer = null;

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

      if (selectionBox && selectionBox.parentNode) {
        selectionBox.parentNode.removeChild(selectionBox);
      }
    };
  }, []);


  useEffect(() => {
    const handleEscAndHover = (e) => {
      if (e.type === 'keydown' && e.key === 'Escape') {
        setOpenWindows(prev => prev.map(w => w.isImmersive ? { ...w, isImmersive: false } : w));
      }
    };
    window.addEventListener('keydown', handleEscAndHover);
    return () => window.removeEventListener('keydown', handleEscAndHover);
  }, [setOpenWindows]);

  const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));

  const showError = (action, err) => {
    let errorMsg = err.message;
    if (err.response) { errorMsg = `Code: ${err.response.status}, Data: ${JSON.stringify(err.response.data)}`; if (err.response.status === 401) { alert("로그인이 만료되었습니다."); localStorage.removeItem('user'); window.location.href = '/login'; return; } }
    setSnackbar({ open: true, message: `[${action} 오류] ${errorMsg}`, severity: 'error' });
  };

  const handleCopyContextMenu = (items) => {
    const paths = items.map(it => it.fullPath || it.path).filter(Boolean);
    if (paths.length > 0) {
      setClipboard({ paths });
      setSnackbar({ open: true, message: `${paths.length}개 항목이 복사되었습니다.`, severity: 'info' });
    }
  };

  const handlePasteContextMenu = async (targetFolder) => {
    if (!clipboard || !clipboard.paths || clipboard.paths.length === 0) return;
    try {
      await axios.post('/api/file/copy', { sourcePaths: clipboard.paths, destinationFolder: targetFolder || '/' }, { withCredentials: true });
      if (typeof fetchFiles === 'function') {
        fetchFiles(targetFolder || '/');
        if ((targetFolder || '/') !== '/') fetchFiles('/');
      }
      setSnackbar({ open: true, message: '붙여넣기 완료!', severity: 'success' });
    } catch(err) { showError('붙여넣기', err); }
  };


  const loadDesktopItems = useCallback(async () => {
    try { const response = await axios.get(`/api/files?path=/&t=${Date.now()}`, { withCredentials: true }); setDesktopItems(response.data || []); } catch (err) { showError('바탕화면 로드', err); }
  }, [isMobile]);
  useEffect(() => { loadDesktopItems(); }, [loadDesktopItems]);

  useEffect(() => {
    const syncInterval = setInterval(async () => {
      if (inlineEditRef.current || contextMenuRef.current) return;
      try { const res = await axios.get(`/api/files?path=/&t=${Date.now()}`, { withCredentials: true }); if (JSON.stringify(res.data || []) !== JSON.stringify(desktopItemsRef.current)) setDesktopItems(res.data || []); } catch(e) {}
      openWindowsRef.current.forEach(async (win) => {
        if (win.winType === 'folder') { try { const res = await axios.get(`/api/files?path=${encodeURIComponent(win.currentPath)}&t=${Date.now()}`, { withCredentials: true }); if (JSON.stringify(res.data || []) !== JSON.stringify(win.files)) setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, files: res.data || [] } : w)); } catch(e) {} }
      });
    }, 3000); 
    return () => clearInterval(syncInterval);
  }, [setOpenWindows]);

  useEffect(() => {
    if (desktopItems.length === 0) return; 
    setIconPositions(prev => {
      let hasChanges = false; const newPos = { ...prev }; const occupied = new Set();
      desktopItems.forEach(item => { if (newPos[ensureSlash(item.fullPath)]) occupied.add(`${newPos[ensureSlash(item.fullPath)].x},${newPos[ensureSlash(item.fullPath)].y}`); });
      const maxCols = typeof window !== 'undefined' ? Math.max(1, Math.floor(window.innerWidth / 120)) : 10;
      const getNextSlot = () => { let gridCol = 0, gridRow = 0; while(true) { const x = 20 + gridCol * 110, y = 20 + gridRow * 105; if (x === 20 && y === 20) { gridCol++; continue; } if (!occupied.has(`${x},${y}`)) { occupied.add(`${x},${y}`); return { x, y }; } gridCol++; if (gridCol >= maxCols) { gridCol = 0; gridRow++; } } };
      desktopItems.forEach(item => { if (!newPos[ensureSlash(item.fullPath)]) { newPos[ensureSlash(item.fullPath)] = getNextSlot(); hasChanges = true; } });
      return hasChanges ? newPos : prev;
    });
  }, [desktopItems]);

  const refreshPath = (path) => { const safePath = ensureSlash(path); if (safePath === '/') loadDesktopItems(); openWindows.forEach(w => { if (w.winType === 'folder' && w.currentPath === safePath) setTimeout(() => fetchFiles(w.id, safePath), 50); }); window.dispatchEvent(new CustomEvent('nas_tree_refresh')); };

  useEffect(() => {
    const handleTransferCompleted = (event) => {
      const safePath = ensureSlash(event.detail?.path || '/');
      refreshPath(safePath);
    };

    window.addEventListener('nas_transfer_completed', handleTransferCompleted);
    return () => window.removeEventListener('nas_transfer_completed', handleTransferCompleted);
  }, [openWindows]);

  const getActiveTargetPath = () => { if (!focusedContext || focusedContext === 'desktop') return '/'; const activeWin = openWindows.find(w => w.id === focusedContext); if (!activeWin) return '/'; return activeWin.winType === 'folder' ? activeWin.currentPath : ensureSlash(activeWin.fullPath.substring(0, activeWin.fullPath.lastIndexOf('/'))); };
  const getSelectedItemsData = useCallback(() => { let currentFiles = focusedContext === 'desktop' || !focusedContext ? desktopItems : (openWindows.find(w => w.id === focusedContext)?.files || []); const activeWin = openWindows.find(w => w.id === focusedContext); if (activeWin && activeWin.winType === 'folder') { currentFiles = [...currentFiles, { fullPath: activeWin.currentPath, name: activeWin.currentPath === '/' ? activeWin.name : activeWin.currentPath.split('/').pop(), type: 'folder' }]; } return selectedItems.map(path => { const found = currentFiles.find(f => ensureSlash(f.fullPath) === path); if (found) return found; const name = path === '/' ? 'Root' : path.split('/').pop(); return { fullPath: path, name, type: name.includes('.') ? 'file' : 'folder' }; }); }, [selectedItems, focusedContext, desktopItems, openWindows]);
  const getItemsToProcess = (clickedItem) => selectedItems.includes(ensureSlash(clickedItem.fullPath)) && selectedItems.length > 1 ? getSelectedItemsData() : [clickedItem];

  const openFolderWindow = (item) => {
    const winId = `desk_${item.name}`; const targetPath = ensureSlash(item.path || item.fullPath);
    if (!openWindows.find(w => w.id === winId && w.id !== 'system_root')) {
      const newWinId = item.id === 'system_root' ? 'system_root' : winId; if(openWindows.find(w => w.id === newWinId)) return focusWindow(newWinId);
      setOpenWindows(prev => [...prev, { ...item, id: newWinId, winType: 'folder', basePath: targetPath, currentPath: targetPath, files: [], isLoaded: false, zIndex: topZIndex + 1, sidebarOpen: !isMobile, width: 900, height: 650, x: 100 + (prev.length * 30), y: 50 + (prev.length * 30), isMinimized: false, isMaximized: false }]);
      setTopZIndex(prev => prev + 1); setFocusedContext(newWinId);
    } else focusWindow(winId); setSelectedItems([]); 
  };

  useEffect(() => { openWindows.forEach(w => { if (w.winType === 'folder' && !w.isLoaded) fetchFiles(w.id, w.currentPath); }); }, [openWindows, fetchFiles]);

  const openFileWindow = async (fileItem, forceEditMode = false) => {
    const safePath = ensureSlash(fileItem.fullPath); const fileId = `file_${safePath}`;
    if (openWindows.find(w => w.id === fileId)) { setOpenWindows(prev => prev.map(w => w.id === fileId ? { ...w, isMinimized: false, zIndex: topZIndex + 1, mode: forceEditMode ? 'edit' : w.mode } : w)); setTopZIndex(topZIndex + 1); setFocusedContext(fileId); return; }
    const safeApiUrl = `/api/file/download?path=${encodeURIComponent(safePath)}`; 
    let ext = fileItem.name.includes('.') ? fileItem.name.split('.').pop().toLowerCase() : '';
    const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'flac', 'm4a', 'pdf', 'heic', 'heif', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'hwp', 'hwpx', 'zip', 'tar', 'gz'];
    
    if (ext === '') {
      try {
        const { data } = await axios.get(`/api/file/detect?path=${encodeURIComponent(safePath)}`, { withCredentials: true });
        if (data.ext) ext = data.ext; 
      } catch (e) { console.error('지문 감식 실패', e); }
    }

    const isBinary = binaryExts.includes(ext);
    try { let content = ''; if (!isBinary) { const response = await axios.get(safeApiUrl, { responseType: 'text', withCredentials: true }); content = typeof response.data === 'object' ? JSON.stringify(response.data, null, 2) : response.data; }
      setOpenWindows(prev => [...prev, { id: fileId, name: fileItem.name, fullPath: safePath, winType: 'file', content: content, originalContent: content, mode: forceEditMode && !isBinary ? 'edit' : 'view', isBinary: isBinary, url: safeApiUrl, ext: ext, zIndex: topZIndex + 1, width: 800, height: 600, x: 150 + (prev.length * 30), y: 100 + (prev.length * 30), isMinimized: false, isMaximized: false }]);
      setTopZIndex(prev => prev + 1); setFocusedContext(fileId); } catch (err) { showError('파일 열기', err); } setSelectedItems([]);
  };

  const handleCloseWindowClick = (win) => {
    const isOffice = ['docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt'].includes(win.ext);
    if (win.winType === 'file' && !win.isBinary && !isOffice && win.content !== win.originalContent) {
      setClosePrompt(win);
    } else {
      closeWindow(win.id);
    }
  };
  const toggleSidebar = (windowId) => setOpenWindows(prev => prev.map(w => w.id === windowId ? { ...w, sidebarOpen: !w.sidebarOpen } : w));
  const toggleEditMode = (id) => setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, mode: w.mode === 'view' ? 'edit' : 'view' } : w));
  const handleContentChange = (id, newContent) => setOpenWindows(prev => prev.map(w => w.id === id ? { ...w, content: newContent } : w));

  const saveFile = async (win) => {
    try { const blob = new Blob([win.content], { type: 'text/plain' }); const file = new File([blob], win.name, { type: 'text/plain' }); const formData = new FormData(); formData.append('path', ensureSlash(win.fullPath.substring(0, win.fullPath.lastIndexOf('/')))); formData.append('file', file);
      await axios.post('/api/file', formData, {
          withCredentials: true,
          timeout: 0,
          maxContentLength: Infinity,
          maxBodyLength: Infinity, headers: { 'Content-Type': 'multipart/form-data' } }); setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, originalContent: win.content, mode: 'view' } : w)); setSnackbar({ open: true, message: `'${win.name}' 저장 완료.`, severity: 'success' }); } catch (err) { showError('저장', err); }
  };

  const handleInlineSubmit = async (value, editState) => {
    if (!editState) return; setInlineEdit(null); 
    const { mode, contextPath, oldPath, originalName, spawnPosition } = editState;
    const safeContextPath = ensureSlash(contextPath);
    let targetFiles = safeContextPath === '/' ? desktopItems : (openWindows.find(w => w.currentPath === safeContextPath)?.files || []);
    
    try {
      if (mode === 'new') {
        let finalName = getUniqueName(value.trim() || '새 폴더', targetFiles.map(f => f.name));
        await axios.post('/api/file', { folderName: finalName, path: safeContextPath }, { withCredentials: true });
        if (safeContextPath === '/' && spawnPosition && !isMobile) setIconPositions(prev => ({ ...prev, [`/${finalName}`]: spawnPosition }));
        refreshPath(safeContextPath); setSnackbar({ open: true, message: `'${finalName}' 폴더 생성 완료`, severity: 'success' });
      
      } else if (mode === 'newFile') {
        let finalName = value.trim() || '새_파일.txt';
        if (targetFiles.map(f => f.name).includes(finalName)) return setSnackbar({ open: true, message: "동일 이름 존재", severity: 'error' });
        
        const file = new File([new Blob([''], { type: 'text/plain' })], finalName, { type: 'text/plain' });
        const formData = new FormData(); formData.append('path', safeContextPath); formData.append('file', file);
        await axios.post('/api/file', formData, {
          withCredentials: true,
          timeout: 0,
          maxContentLength: Infinity,
          maxBodyLength: Infinity, headers: { 'Content-Type': 'multipart/form-data' } });
        
        if (safeContextPath === '/' && spawnPosition && !isMobile) setIconPositions(prev => ({ ...prev, [`/${finalName}`]: spawnPosition }));
        refreshPath(safeContextPath); setSnackbar({ open: true, message: `'${finalName}' 파일 생성 완료`, severity: 'success' });
      
      } else if (mode === 'rename') {
        let finalName = value.trim();
        if (!finalName) return;
        
        if (editState.type === 'file') {
            const isExtVisible = localStorage.getItem('nas_show_extensions') === 'true';
            const getExt = (n) => n.includes('.') ? n.substring(n.lastIndexOf('.')) : '';
            const oldExt = getExt(originalName);
            
            if (!isExtVisible) {
                finalName += oldExt;
            } else {
                const newExt = getExt(finalName);
                if (oldExt.toLowerCase() !== newExt.toLowerCase()) {
                    if (!window.confirm("파일의 확장명을 변경하면 사용할 수 없게 될 수도 있습니다.\n변경하시겠습니까?")) {
                        setInlineEdit(null);
                        return;
                    }
                }
            }
        }
        
        if (finalName === originalName) { setInlineEdit(null); return; }
        if (targetFiles.map(f => f.name).includes(finalName)) return setSnackbar({ open: true, message: "동일 이름 존재", severity: 'error' });
        const safeOldPath = ensureSlash(oldPath); const newPath = `${safeContextPath.endsWith('/') && safeContextPath !== '/' ? safeContextPath : (safeContextPath === '/' ? '' : safeContextPath)}/${finalName}`;
        await axios.put('/api/file', { oldPath: safeOldPath, newPath }, { withCredentials: true });
        if (safeContextPath === '/' && !isMobile) setIconPositions(prev => { const newPos = { ...prev }; if (newPos[safeOldPath]) { newPos[newPath] = newPos[safeOldPath]; delete newPos[safeOldPath]; } return newPos; });
        refreshPath(safeContextPath);
      }
    } catch (err) { showError('적용', err); }
  };

  const getAvailableDesktopSlot = useCallback(() => {
    const occupied = new Set(['20,20']); 
    desktopItems.forEach(item => { if (iconPositions[ensureSlash(item.fullPath)]) occupied.add(`${iconPositions[ensureSlash(item.fullPath)].x},${iconPositions[ensureSlash(item.fullPath)].y}`); });
    if (inlineEdit?.windowId === 'desktop' && inlineEdit.spawnPosition) occupied.add(`${inlineEdit.spawnPosition.x},${inlineEdit.spawnPosition.y}`);
    let gridCol = 0, gridRow = 0; const maxCols = typeof window !== 'undefined' ? Math.max(1, Math.floor(window.innerWidth / 120)) : 10;
    while(true) { const x = 20 + gridCol * 110, y = 20 + gridRow * 105; if (!occupied.has(`${x},${y}`)) return { x, y }; gridCol++; if (gridCol >= maxCols) { gridCol = 0; gridRow++; } }
  }, [desktopItems, iconPositions, inlineEdit]);

  const handleCreateFolderStart = (targetPath, targetWinId, spawnPosition = null) => setInlineEdit({ mode: 'new', contextPath: targetPath, windowId: targetWinId || 'desktop', name: '', spawnPosition: spawnPosition && !isMobile ? { x: Math.max(0, Math.round((spawnPosition.x - 20) / 110)) * 110 + 20, y: Math.max(0, Math.round((spawnPosition.y - 20) / 105)) * 105 + 20 } : null });
  const handleCreateFileStart = (targetPath, targetWinId, spawnPosition = null) => setInlineEdit({ mode: 'newFile', contextPath: targetPath, windowId: targetWinId || 'desktop', name: '문서.txt', spawnPosition: spawnPosition && !isMobile ? { x: Math.max(0, Math.round((spawnPosition.x - 20) / 110)) * 110 + 20, y: Math.max(0, Math.round((spawnPosition.y - 20) / 105)) * 105 + 20 } : null });

  const handleCreateLinkedDeviceFolder = async (targetPath = '/') => {
    console.log('[NAS PC LINK] handler fired', { targetPath });

    const ok = window.confirm(
      '내 PC의 원하는 폴더를 NAS와 연동하려면 NAS Sync Agent가 필요합니다.\n\nAgent를 다운로드하시겠습니까?'
    );

    if (!ok) return;

    const safeTargetPath = ensureSlash(targetPath || '/');

    try {
      const startRes = await axios.post('/api/devices/pair/start', {
        path: safeTargetPath
      }, { withCredentials: true });

      const { pairingToken, agentDownloadUrl, agentDownloadName, agentKind } = startRes.data || {};

      if (!pairingToken) {
        throw new Error('연동 토큰을 받지 못했습니다.');
      }

      setSnackbar({
        open: true,
        message: agentKind === 'powershell'
          ? 'NAS Sync Agent PowerShell 파일을 다운로드했습니다. 실행 후 연동할 폴더를 선택하면 NAS에 동기화됩니다.'
          : 'NAS Sync Agent 실행 파일을 다운로드했습니다. 실행하면 연동이 감지됩니다.',
        severity: 'info'
      });

      if (agentDownloadUrl) {
        const a = document.createElement('a');
        a.href = agentDownloadUrl;
        a.download = agentDownloadName || (agentKind === 'powershell' ? 'NAS-Sync-Agent.ps1' : 'NAS-Sync-Agent.exe');
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      // Agent 실행 대기: 최대 약 5분
      for (let i = 0; i < 150; i++) {
        await sleep(2000);

        try {
          const statusRes = await axios.get(`/api/devices/pair/status/${encodeURIComponent(pairingToken)}`, {
            withCredentials: true
          });

          if (statusRes.data?.status === 'connected') {
            setSnackbar({
              open: true,
              message: `연동 감지! '${statusRes.data.device?.name || statusRes.data.device?.deviceName || '내 PC 폴더'}'가 NAS에 준비되었습니다.`,
              severity: 'success'
            });

            refreshPath(safeTargetPath);
            if (safeTargetPath !== '/') refreshPath('/');
            return;
          }
        } catch (pollErr) {
          console.warn('[NAS PC LINK] polling failed', pollErr);
        }
      }

      setSnackbar({
        open: true,
        message: agentKind === 'powershell'
          ? '아직 Agent 실행이 감지되지 않았습니다. 다운로드된 NAS-Sync-Agent.ps1을 PowerShell로 실행한 뒤 폴더를 선택해 주세요.'
          : '아직 Agent 실행이 감지되지 않았습니다. 다운로드된 NAS-Sync-Agent.exe를 실행해 주세요.',
        severity: 'info'
      });
    } catch (err) {
      console.error('[NAS PC LINK] failed', err);
      showError('PC 바탕화면 연동', err);
    }
  };


  const handleRenameStart = (item, pathContext) => { let wid = focusedContext; const w = openWindowsRef.current.find(x => x.id === wid); if (w && w.winType === 'folder' && !w.files.some(f => ensureSlash(f.fullPath) === ensureSlash(item.fullPath))) wid = w.id + '_tree'; setInlineEdit({ mode: 'rename', oldPath: item.fullPath, originalName: item.name, name: getDisplayName(item), type: item.type, contextPath: pathContext, windowId: wid }); };
  const getUploadUserKey = () => {
    return String(
      currentUser.userUid ||
      currentUser.loginId ||
      currentUser.id ||
      currentUser.username ||
      currentUser.name ||
      'unknown'
    );
  };

  const getResumableStorageKey = () => `nas_resumable_uploads_${getUploadUserKey()}`;

  const readResumableSessions = () => {
    try {
      const raw = localStorage.getItem(getResumableStorageKey());
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  };

  const writeResumableSessions = (sessions) => {
    try {
      localStorage.setItem(getResumableStorageKey(), JSON.stringify(sessions || []));
    } catch (err) {
      console.warn('이어올리기 세션 저장 실패:', err);
    }
  };

  const saveResumableSession = (session) => {
    if (!session || !session.taskId) return;
    const sessions = readResumableSessions();
    const idx = sessions.findIndex(s => s.taskId === session.taskId);
    const next = {
      ...session,
      updatedAt: new Date().toISOString()
    };

    if (idx >= 0) sessions[idx] = next;
    else sessions.push(next);

    writeResumableSessions(sessions);
  };

  const removeResumableSession = (taskId) => {
    if (!taskId) return;
    writeResumableSessions(readResumableSessions().filter(s => s.taskId !== taskId));
  };

  const getFileResumeKey = (file, relPath) => {
    return [
      relPath || file.name,
      file.name,
      file.size,
      file.lastModified || 0
    ].join('|');
  };

  const getStoredFileResumeKey = (meta) => {
    return [
      meta.relPath || meta.name,
      meta.name,
      meta.size,
      meta.lastModified || 0
    ].join('|');
  };

  const fileMatchesResumeMeta = (file, meta) => {
    if (!file || !meta) return false;
    return file.name === meta.name &&
      Number(file.size) === Number(meta.size) &&
      Number(file.lastModified || 0) === Number(meta.lastModified || 0);
  };

  const restoreResumableUploadTasks = useCallback(() => {
    const sessions = readResumableSessions().filter(s => s && s.taskId && s.status !== 'done' && s.status !== 'canceled');

    if (!sessions.length) return;

    setTransferTasks(prev => {
      const existing = new Set(prev.map(t => t.id));
      const restored = sessions
        .filter(s => !existing.has(s.taskId))
        .map(s => {
          const currentFile = s.files?.[s.currentFileIndex || 0] || s.files?.[0];
          return {
            id: s.taskId,
            sessionId: s.sessionId,
            name: s.taskName || currentFile?.name || '중단된 업로드',
            total: s.files?.length || 1,
            completed: s.completedFiles || 0,
            percent: s.percent || 0,
            status: 'paused',
            currentFileName: currentFile?.name || s.taskName || '중단된 업로드',
            label: '중단됨 · 같은 파일 선택 시 이어올리기',
            resumeNeedsFile: true,
            targetPath: s.targetPath || '/',
            resumeMeta: s
          };
        });

      return restored.length ? [...prev, ...restored] : prev;
    });

    sessions.forEach(s => {
      if (!uploadControllersRef.current[s.taskId]) {
        uploadControllersRef.current[s.taskId] = {
          canceled: false,
          paused: true,
          resuming: false,
          sessionId: s.sessionId,
          controllers: new Set(),
          uploadIds: new Set(Object.values(s.uploadIds || {})),
          uploadIdByKey: { ...(s.uploadIds || {}) },
          resumeMeta: s,
          files: null,
          targetPath: s.targetPath || '/',
          taskName: s.taskName || '중단된 업로드',
          currentFileIndex: s.currentFileIndex || 0
        };
      }
    });
  }, []);

  useEffect(() => {
    restoreResumableUploadTasks();
  }, [restoreResumableUploadTasks]);


  const LARGE_UPLOAD_THRESHOLD = 64 * 1024 * 1024;
  const FILE_CHUNK_SIZE = 64 * 1024 * 1024;
  const FILE_CHUNK_CONCURRENCY = 3;
  const FILE_CHUNK_RETRY = 5;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const isCanceledError = (err) => {
    return err?.code === 'ERR_CANCELED' ||
      err?.name === 'CanceledError' ||
      err?.response?.status === 409 ||
      String(err?.message || '').toLowerCase().includes('canceled') ||
      String(err?.response?.data?.error || '').includes('UPLOAD_CANCELED');
  };

  const normalizeUploadJoin = (base, rel) => {
    const safeBase = ensureSlash(base || '/');
    const cleanRel = String(rel || '').replace(/^\/+/, '');
    if (!cleanRel) return safeBase;
    return safeBase === '/' ? `/${cleanRel}` : `${safeBase}/${cleanRel}`;
  };

  const getUploadDestDir = (basePath, relPath) => {
    const fullPath = normalizeUploadJoin(basePath, relPath);
    const idx = fullPath.lastIndexOf('/');
    return idx <= 0 ? '/' : fullPath.substring(0, idx);
  };

  const getUploadTaskState = (taskId) => uploadControllersRef.current[taskId];

  const setTaskPatch = (taskId, patch) => {
    setTransferTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t));
  };

  const createUploadTaskState = (taskId, sessionId, extra = {}) => {
    const resumeMeta = extra.resumeMeta || null;
    const state = {
      canceled: false,
      paused: Boolean(extra.paused),
      resuming: false,
      sessionId,
      controllers: new Set(),
      uploadIds: new Set(Object.values(resumeMeta?.uploadIds || {})),
      uploadIdByKey: { ...(resumeMeta?.uploadIds || {}) },
      resumeMeta,
      files: extra.files || null,
      targetPath: extra.targetPath || resumeMeta?.targetPath || '/',
      taskName: extra.taskName || resumeMeta?.taskName || '',
      currentFileIndex: extra.currentFileIndex || resumeMeta?.currentFileIndex || 0
    };
    uploadControllersRef.current[taskId] = state;
    return state;
  };

  const cancelUploadTaskState = async (taskId) => {
    const state = getUploadTaskState(taskId);
    if (!state) return;

    state.canceled = true;
    state.paused = false;

    for (const ctrl of Array.from(state.controllers)) {
      try { ctrl.abort(); } catch (e) {}
    }

    const cancelCalls = [];

    if (state.sessionId) {
      cancelCalls.push(
        axios.post('/api/file/cancel-session', { sessionId: state.sessionId }, { withCredentials: true }).catch(() => null)
      );
    }

    for (const uploadId of Array.from(state.uploadIds)) {
      cancelCalls.push(
        axios.post('/api/file/chunk/cancel', { uploadId }, { withCredentials: true }).catch(() => null)
      );
    }

    await Promise.all(cancelCalls);
    removeResumableSession(taskId);
  };

  const handleCancelTransferTask = async (task) => {
    setTaskPatch(task.id, { status: 'canceling', label: '취소 중...' });

    try {
      await cancelUploadTaskState(task.id);
    } catch (err) {
      console.warn('업로드 취소 처리 중 오류:', err);
    }

    delete uploadControllersRef.current[task.id];
    setTransferTasks(prev => prev.filter(t => t.id !== task.id));
    setSnackbar({ open: true, message: `'${task.name}' 업로드 취소`, severity: 'info' });
  };

  const pauseUploadTaskState = (taskId) => {
    const state = getUploadTaskState(taskId);
    if (!state) return null;

    state.paused = true;
    state.canceled = false;

    for (const ctrl of Array.from(state.controllers)) {
      try { ctrl.abort(); } catch (e) {}
    }

    if (state.resumeMeta) {
      state.resumeMeta.status = 'paused';
      state.resumeMeta.currentFileIndex = state.currentFileIndex || 0;
      state.resumeMeta.percent = state.resumeMeta.percent || 0;
      saveResumableSession(state.resumeMeta);
    }

    return state;
  };

  const handlePauseTransferTask = async (task) => {
    const state = pauseUploadTaskState(task.id);

    setTaskPatch(task.id, {
      status: 'paused',
      label: '중단됨 · 이어올리기 가능'
    });

    if (state?.resumeMeta) saveResumableSession(state.resumeMeta);

    setSnackbar({ open: true, message: `'${task.name}' 업로드 일시정지`, severity: 'info' });
  };

  const handleResumeTransferTask = async (task) => {
    let state = getUploadTaskState(task.id);

    if (!state) {
      state = createUploadTaskState(task.id, task.sessionId, {
        paused: true,
        resumeMeta: task.resumeMeta,
        targetPath: task.targetPath || task.resumeMeta?.targetPath || '/',
        taskName: task.name
      });
    }

    if (state.resuming) return;

    if (!state.files || !state.files.length) {
      resumeTaskRef.current = task;
      setSnackbar({ open: true, message: `'${task.currentFileName || task.name}' 파일을 다시 선택하면 이어올립니다.`, severity: 'info' });
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
        fileInputRef.current.click();
      }
      return;
    }

    state.resuming = true;
    state.paused = false;
    state.canceled = false;

    setTaskPatch(task.id, {
      status: 'queued',
      label: '이어올리기 준비 중...'
    });

    try {
      await uploadFilesSequentialWithChunks({
        uploadItems: state.files,
        targetPath: state.targetPath || task.targetPath || '/',
        taskName: state.taskName || task.name,
        existingTaskId: task.id,
        existingSessionId: state.sessionId || task.sessionId,
        startIndex: state.currentFileIndex || 0,
        resumeMeta: state.resumeMeta || task.resumeMeta || null
      });
    } finally {
      const latest = getUploadTaskState(task.id);
      if (latest) latest.resuming = false;
    }
  };

  const createAbortControllerForTask = (taskId) => {
    const state = getUploadTaskState(taskId);
    const controller = new AbortController();

    if (state) {
      state.controllers.add(controller);
      if (state.canceled || state.paused) controller.abort();
    }

    return controller;
  };

  const removeAbortControllerForTask = (taskId, controller) => {
    const state = getUploadTaskState(taskId);
    if (state) state.controllers.delete(controller);
  };

  const isPausedError = (err) => {
    return err?.code === 'UPLOAD_PAUSED' || String(err?.message || '').includes('UPLOAD_PAUSED');
  };

  const throwIfTaskCanceled = (taskId) => {
    const state = getUploadTaskState(taskId);

    if (state?.canceled) {
      const err = new Error('UPLOAD_CANCELED');
      err.code = 'ERR_CANCELED';
      throw err;
    }

    if (state?.paused) {
      const err = new Error('UPLOAD_PAUSED');
      err.code = 'UPLOAD_PAUSED';
      throw err;
    }
  };

  const uploadSmallFileDirect = async ({ file, relPath, targetPath, taskId, sessionId }) => {
    throwIfTaskCanceled(taskId);

    const destDirPath = getUploadDestDir(targetPath, relPath);
    const formData = new FormData();
    formData.append('path', destDirPath);
    formData.append('file', file);

    const controller = createAbortControllerForTask(taskId);

    try {
      await axios.post('/api/file', formData, {
        withCredentials: true,
        timeout: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        signal: controller.signal,
        headers: {
          'Content-Type': 'multipart/form-data',
          'x-upload-session': sessionId
        },
        onUploadProgress: (evt) => {
          const total = evt.total || file.size;
          if (!total) return;
          const percent = Math.max(0, Math.min(99, Math.round((evt.loaded * 100) / total)));
          setTaskPatch(taskId, {
            percent,
            currentFileName: file.name,
            label: `${percent}%`
          });
        }
      });
    } finally {
      removeAbortControllerForTask(taskId, controller);
    }
  };

  const uploadLargeFileByChunks = async ({ file, relPath, targetPath, taskId }) => {
    throwIfTaskCanceled(taskId);

    const state = getUploadTaskState(taskId);
    const destDirPath = getUploadDestDir(targetPath, relPath);
    let chunkSize = Number(state?.resumeMeta?.chunkSize || FILE_CHUNK_SIZE);
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) chunkSize = FILE_CHUNK_SIZE;
    let totalChunks = Math.ceil(file.size / chunkSize);
    const fileResumeKey = getFileResumeKey(file, relPath || file.name);

    setTaskPatch(taskId, {
      status: 'uploading',
      method: 'chunk',
      currentFileName: file.name,
      percent: 0,
      chunkIndex: 0,
      totalChunks,
      label: `0% · 청크 0/${totalChunks}`
    });

    if (state?.resumeMeta) {
      state.resumeMeta.status = 'uploading';
      state.resumeMeta.targetPath = targetPath;
      state.resumeMeta.percent = state.resumeMeta.percent || 0;
      state.resumeMeta.currentFileIndex = state.currentFileIndex || 0;
      state.resumeMeta.uploadIds = state.resumeMeta.uploadIds || {};
      saveResumableSession(state.resumeMeta);
    }

    let uploadId = state?.uploadIdByKey?.[fileResumeKey] || state?.resumeMeta?.uploadIds?.[fileResumeKey] || null;
    let receivedSet = new Set();

    const getChunkByteSize = (idx) => {
      const startByte = idx * chunkSize;
      const endByte = Math.min(file.size, startByte + chunkSize);
      return Math.max(0, endByte - startByte);
    };

    if (uploadId) {
      const statusController = createAbortControllerForTask(taskId);

      try {
        const statusRes = await axios.post('/api/file/chunk/status', { uploadId }, {
          withCredentials: true,
          timeout: 0,
          signal: statusController.signal
        });

        if (statusRes.data?.canceled) {
          throw new Error('UPLOAD_CANCELED');
        }

        const serverChunkSize = Number(statusRes.data?.chunkSize);
        const serverTotalChunks = Number(statusRes.data?.totalChunks);

        if (Number.isFinite(serverChunkSize) && serverChunkSize > 0) {
          chunkSize = serverChunkSize;
          totalChunks = Number.isFinite(serverTotalChunks) && serverTotalChunks > 0
            ? serverTotalChunks
            : Math.ceil(file.size / chunkSize);
        }

        if (state?.resumeMeta) {
          state.resumeMeta.chunkSize = chunkSize;
          state.resumeMeta.totalChunks = totalChunks;
          saveResumableSession(state.resumeMeta);
        }

        receivedSet = new Set((statusRes.data?.receivedChunks || []).map(Number));
      } catch (err) {
        if (isCanceledError(err) || isPausedError(err) || getUploadTaskState(taskId)?.paused) throw err;

        if (err?.response?.status === 404) {
          uploadId = null;
          if (state?.uploadIdByKey) delete state.uploadIdByKey[fileResumeKey];
          if (state?.resumeMeta?.uploadIds) delete state.resumeMeta.uploadIds[fileResumeKey];
        } else {
          throw err;
        }
      } finally {
        removeAbortControllerForTask(taskId, statusController);
      }
    }

    if (!uploadId) {
      let initController = createAbortControllerForTask(taskId);

      try {
        const initRes = await axios.post('/api/file/chunk/init', {
          path: destDirPath,
          fileName: file.name,
          fileSize: file.size,
          chunkSize,
          totalChunks
        }, {
          withCredentials: true,
          timeout: 0,
          signal: initController.signal
        });

        uploadId = initRes.data.uploadId;
        if (!uploadId) throw new Error('청크 uploadId를 받지 못했습니다.');

        if (state?.resumeMeta) {
          state.resumeMeta.chunkSize = chunkSize;
          state.resumeMeta.totalChunks = totalChunks;
          saveResumableSession(state.resumeMeta);
        }
      } finally {
        removeAbortControllerForTask(taskId, initController);
      }
    }

    if (state) {
      state.uploadIds.add(uploadId);
      state.uploadIdByKey = state.uploadIdByKey || {};
      state.uploadIdByKey[fileResumeKey] = uploadId;

      state.resumeMeta = state.resumeMeta || {};
      state.resumeMeta.uploadIds = state.resumeMeta.uploadIds || {};
      state.resumeMeta.uploadIds[fileResumeKey] = uploadId;
      state.resumeMeta.status = 'uploading';
      saveResumableSession(state.resumeMeta);
    }

    throwIfTaskCanceled(taskId);

    let uploadedBytes = Array.from(receivedSet).reduce((sum, idx) => sum + getChunkByteSize(idx), 0);
    let completedChunks = receivedSet.size;
    const chunkProgress = new Map();

    const missingChunks = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!receivedSet.has(i)) missingChunks.push(i);
    }

    const initialPercent = Math.max(0, Math.min(99, Math.floor((uploadedBytes * 100) / file.size)));
    setTaskPatch(taskId, {
      percent: initialPercent,
      currentFileName: file.name,
      chunkIndex: completedChunks,
      totalChunks,
      label: `${initialPercent}% · 청크 ${completedChunks}/${totalChunks}`
    });

    const uploadChunk = async (chunkIndex) => {
      const startByte = chunkIndex * chunkSize;
      const endByte = Math.min(file.size, startByte + chunkSize);
      const chunkBlob = file.slice(startByte, endByte);
      const chunkBytes = endByte - startByte;

      for (let attempt = 0; attempt <= FILE_CHUNK_RETRY; attempt++) {
        throwIfTaskCanceled(taskId);

        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', String(chunkIndex));
        formData.append('startByte', String(startByte));
        formData.append('chunk', chunkBlob, `${file.name}.part${chunkIndex}`);

        const controller = createAbortControllerForTask(taskId);

        try {
          await axios.post('/api/file/chunk', formData, {
            withCredentials: true,
            timeout: 0,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            signal: controller.signal,
            headers: {
              'Content-Type': 'multipart/form-data',
              'x-upload-id': uploadId,
              'x-chunk-index': String(chunkIndex),
              'x-start-byte': String(startByte)
            },
            onUploadProgress: (evt) => {
              const loaded = Math.min(evt.loaded || 0, chunkBytes);
              const prevLoaded = chunkProgress.get(chunkIndex) || 0;

              if (loaded > prevLoaded) {
                uploadedBytes += loaded - prevLoaded;
                chunkProgress.set(chunkIndex, loaded);

                const percent = Math.max(0, Math.min(99, Math.floor((uploadedBytes * 100) / file.size)));
                if (state?.resumeMeta) {
                  state.resumeMeta.percent = percent;
                  saveResumableSession(state.resumeMeta);
                }

                setTaskPatch(taskId, {
                  percent,
                  currentFileName: file.name,
                  label: `${percent}% · 청크 ${completedChunks}/${totalChunks}`
                });
              }
            }
          });

          const prevLoaded = chunkProgress.get(chunkIndex) || 0;
          if (chunkBytes > prevLoaded) {
            uploadedBytes += chunkBytes - prevLoaded;
            chunkProgress.set(chunkIndex, chunkBytes);
          }

          completedChunks += 1;
          receivedSet.add(chunkIndex);

          const percent = Math.max(0, Math.min(99, Math.floor((uploadedBytes * 100) / file.size)));

          if (state?.resumeMeta) {
            state.resumeMeta.percent = percent;
            saveResumableSession(state.resumeMeta);
          }

          setTaskPatch(taskId, {
            percent,
            currentFileName: file.name,
            chunkIndex: completedChunks,
            totalChunks,
            label: `${percent}% · 청크 ${completedChunks}/${totalChunks}`
          });

          return;
        } catch (err) {
          if (isPausedError(err) || getUploadTaskState(taskId)?.paused) throw err;
          if (isCanceledError(err) || getUploadTaskState(taskId)?.canceled) throw err;

          const counted = chunkProgress.get(chunkIndex) || 0;
          if (counted > 0) {
            uploadedBytes = Math.max(0, uploadedBytes - counted);
            chunkProgress.delete(chunkIndex);
          }

          if (attempt >= FILE_CHUNK_RETRY) throw err;

          await sleep(500 * (attempt + 1));
        } finally {
          removeAbortControllerForTask(taskId, controller);
        }
      }
    };

    let nextMissingCursor = 0;

    const worker = async () => {
      while (true) {
        throwIfTaskCanceled(taskId);

        const current = missingChunks[nextMissingCursor];
        nextMissingCursor += 1;

        if (current === undefined) return;

        await uploadChunk(current);
      }
    };

    const workerCount = Math.min(FILE_CHUNK_CONCURRENCY, Math.max(1, missingChunks.length));
    if (missingChunks.length > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }

    throwIfTaskCanceled(taskId);

    const completeController = createAbortControllerForTask(taskId);

    try {
      await axios.post('/api/file/chunk/complete', { uploadId }, {
        withCredentials: true,
        timeout: 0,
        signal: completeController.signal
      });

      state?.uploadIds.delete(uploadId);
    } finally {
      removeAbortControllerForTask(taskId, completeController);
    }

    setTaskPatch(taskId, {
      percent: 100,
      currentFileName: file.name,
      chunkIndex: totalChunks,
      totalChunks,
      label: `100% · 청크 ${totalChunks}/${totalChunks}`
    });
  };

  const collectDroppedUploadItems = async (dataTransfer) => {
    const items = dataTransfer?.items ? Array.from(dataTransfer.items) : [];
    const plainFiles = dataTransfer?.files ? Array.from(dataTransfer.files) : [];

    const readAllEntries = async (reader) => {
      let all = [];
      while (true) {
        const chunk = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!chunk || chunk.length === 0) break;
        all = all.concat(chunk);
      }
      return all;
    };

    const scanEntry = async (entry, prefix = '') => {
      if (!entry) return [];

      if (entry.isFile) {
        try {
          const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
          if (!file) return [];
          return [{ file, relPath: `${prefix}${file.name}` }];
        } catch (err) {
          console.warn('파일 엔트리 읽기 실패:', `${prefix}${entry.name || ''}`, err);
          return [];
        }
      }

      if (entry.isDirectory) {
        const dirName = entry.name || '';
        const dirPrefix = `${prefix}${dirName}/`;
        const reader = entry.createReader();
        const children = await readAllEntries(reader);

        let out = [];
        for (const child of children) {
          out = out.concat(await scanEntry(child, dirPrefix));
        }
        return out;
      }

      return [];
    };

    if (items.length > 0 && items.some(item => item.webkitGetAsEntry && item.webkitGetAsEntry())) {
      let uploadList = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
        if (!entry) continue;
        uploadList = uploadList.concat(await scanEntry(entry, ''));
      }
      return uploadList;
    }

    return plainFiles.map(file => ({
      file,
      relPath: file.webkitRelativePath || file.name
    }));
  };

  const uploadFilesSequentialWithChunks = async ({
    uploadItems,
    targetPath,
    taskName,
    existingTaskId = null,
    existingSessionId = null,
    startIndex = 0,
    resumeMeta = null
  }) => {
    const files = (uploadItems || []).filter(item => item?.file);

    if (!files.length) {
      setSnackbar({ open: true, message: '업로드할 파일을 읽지 못했습니다.', severity: 'warning' });
      return;
    }

    const safeTargetPath = ensureSlash(targetPath || resumeMeta?.targetPath || '/');
    const taskId = existingTaskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = existingSessionId || resumeMeta?.sessionId || `upl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const displayName = taskName || resumeMeta?.taskName || files[0].file.name || '업로드';

    let state = getUploadTaskState(taskId);

    const fileMetas = files.map(item => ({
      name: item.file.name,
      size: item.file.size,
      lastModified: item.file.lastModified || 0,
      relPath: item.relPath || item.file.name,
      type: item.file.type || ''
    }));

    const baseResumeMeta = resumeMeta || state?.resumeMeta || {
      taskId,
      sessionId,
      taskName: displayName,
      targetPath: safeTargetPath,
      files: fileMetas,
      uploadIds: {},
      status: 'uploading',
      currentFileIndex: startIndex,
      completedFiles: startIndex,
      percent: 0,
      createdAt: new Date().toISOString()
    };

    baseResumeMeta.taskId = taskId;
    baseResumeMeta.sessionId = sessionId;
    baseResumeMeta.taskName = displayName;
    baseResumeMeta.targetPath = safeTargetPath;
    baseResumeMeta.files = baseResumeMeta.files && baseResumeMeta.files.length ? baseResumeMeta.files : fileMetas;
    baseResumeMeta.uploadIds = baseResumeMeta.uploadIds || {};
    baseResumeMeta.status = 'uploading';

    if (!state) {
      state = createUploadTaskState(taskId, sessionId, {
        files,
        targetPath: safeTargetPath,
        taskName: displayName,
        resumeMeta: baseResumeMeta,
        currentFileIndex: startIndex
      });
    } else {
      state.canceled = false;
      state.paused = false;
      state.files = files;
      state.targetPath = safeTargetPath;
      state.taskName = displayName;
      state.resumeMeta = baseResumeMeta;
      state.uploadIdByKey = { ...(baseResumeMeta.uploadIds || {}) };
      state.currentFileIndex = startIndex;
    }

    saveResumableSession(baseResumeMeta);

    if (!existingTaskId) {
      setTransferTasks(prev => [
        ...prev,
        {
          id: taskId,
          sessionId,
          name: displayName,
          total: files.length,
          completed: startIndex,
          percent: baseResumeMeta.percent || 0,
          status: 'queued',
          currentFileName: files[startIndex]?.file?.name || files[0].file.name,
          label: files.length > 1 ? `대기 중 · ${startIndex}/${files.length}` : '대기 중',
          targetPath: safeTargetPath,
          resumeMeta: baseResumeMeta
        }
      ]);
    } else {
      setTaskPatch(taskId, {
        sessionId,
        name: displayName,
        total: files.length,
        completed: startIndex,
        status: 'queued',
        targetPath: safeTargetPath,
        resumeMeta: baseResumeMeta,
        label: '이어올리기 준비 중...'
      });
    }

    let completedFiles = Math.max(0, startIndex || 0);

    try {
      for (let i = completedFiles; i < files.length; i++) {
        state.currentFileIndex = i;
        baseResumeMeta.currentFileIndex = i;
        baseResumeMeta.completedFiles = completedFiles;
        baseResumeMeta.status = 'uploading';
        saveResumableSession(baseResumeMeta);

        throwIfTaskCanceled(taskId);

        const item = files[i];
        const file = item.file;

        setTaskPatch(taskId, {
          status: 'uploading',
          currentFileName: file.name,
          completed: completedFiles,
          total: files.length,
          percent: i === completedFiles ? (baseResumeMeta.percent || 0) : 0,
          label: files.length > 1 ? `파일 ${i + 1}/${files.length}` : '0%',
          targetPath: safeTargetPath,
          resumeMeta: baseResumeMeta
        });

        if (file.size > LARGE_UPLOAD_THRESHOLD) {
          await uploadLargeFileByChunks({
            file,
            relPath: item.relPath || file.name,
            targetPath: safeTargetPath,
            taskId
          });
        } else {
          await uploadSmallFileDirect({
            file,
            relPath: item.relPath || file.name,
            targetPath: safeTargetPath,
            taskId,
            sessionId
          });
        }

        completedFiles += 1;
        baseResumeMeta.completedFiles = completedFiles;
        baseResumeMeta.percent = 100;
        saveResumableSession(baseResumeMeta);

        setTaskPatch(taskId, {
          completed: completedFiles,
          percent: 100,
          label: files.length > 1 ? `완료 ${completedFiles}/${files.length}` : '100%',
          resumeMeta: baseResumeMeta
        });
      }

      delete uploadControllersRef.current[taskId];
      removeResumableSession(taskId);

      setTaskPatch(taskId, {
        status: 'done',
        completed: completedFiles,
        percent: 100,
        label: files.length > 1 ? `완료 ${completedFiles}/${files.length}` : '100%'
      });

      refreshPath(safeTargetPath);
      if (safeTargetPath !== '/') refreshPath('/');

      setSnackbar({
        open: true,
        message: `'${displayName}' 업로드 완료! (${completedFiles}개)`,
        severity: 'success'
      });

      setTimeout(() => {
        setTransferTasks(prev => prev.filter(t => t.id !== taskId));
      }, 1200);
    } catch (err) {
      const latestState = getUploadTaskState(taskId);
      const wasPaused = latestState?.paused || isPausedError(err);

      if (wasPaused) {
        baseResumeMeta.status = 'paused';
        baseResumeMeta.currentFileIndex = latestState?.currentFileIndex || completedFiles;
        baseResumeMeta.completedFiles = completedFiles;
        saveResumableSession(baseResumeMeta);

        setTaskPatch(taskId, {
          status: 'paused',
          label: '중단됨 · 이어올리기 가능',
          completed: completedFiles,
          resumeMeta: baseResumeMeta
        });

        setSnackbar({ open: true, message: `'${displayName}' 업로드 일시정지`, severity: 'info' });
        return;
      }

      const wasCanceled = latestState?.canceled || isCanceledError(err);

      if (wasCanceled) {
        try {
          await cancelUploadTaskState(taskId);
        } catch (cancelErr) {
          console.warn('취소 후 서버 정리 실패:', cancelErr);
        }

        if (completedFiles > 0) {
          refreshPath(safeTargetPath);
          if (safeTargetPath !== '/') refreshPath('/');
        }

        removeResumableSession(taskId);
        delete uploadControllersRef.current[taskId];
        setTransferTasks(prev => prev.filter(t => t.id !== taskId));
        setSnackbar({ open: true, message: `'${displayName}' 업로드 취소`, severity: 'info' });
        return;
      }

      console.error('청크/순차 업로드 실패:', err);

      delete uploadControllersRef.current[taskId];

      baseResumeMeta.status = 'failed';
      saveResumableSession(baseResumeMeta);

      setTaskPatch(taskId, {
        status: 'failed',
        label: '실패',
        percent: 100,
        resumeMeta: baseResumeMeta
      });

      setTimeout(() => {
        setTransferTasks(prev => prev.filter(t => t.id !== taskId));
      }, 3000);

      showError('업로드', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUploadClick = (targetPath) => {
    uploadTargetRef.current = ensureSlash(targetPath);
    if(fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const targetPath = ensureSlash(uploadTargetRef.current);
    const uploadItems = files.map(file => ({
      file,
      relPath: file.webkitRelativePath || file.name
    }));

    try {
      await startUpload({
        uploadItems,
        targetPath,
        taskName: files.length === 1 ? files[0].name : `${files[0].name} 외 ${files.length - 1}개`
      });
    } catch (err) {
      showError('업로드', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (itemsToDel, pathContext) => {
    if (!itemsToDel || itemsToDel.length === 0) return; if (!window.confirm(itemsToDel.length === 1 ? `'${itemsToDel[0].name}' 삭제?` : `${itemsToDel.length}개 삭제?`)) return;
    try { await Promise.all(itemsToDel.map(async (item) => { const safePath = ensureSlash(item.fullPath); await axios.delete(`/api/file?path=${encodeURIComponent(safePath)}`, { data: { path: safePath }, withCredentials: true }); if (!isMobile) setIconPositions(prev => { const n = {...prev}; delete n[safePath]; return n; }); })); refreshPath(ensureSlash(pathContext)); setSelectedItems([]); setSnackbar({ open: true, message: "삭제 완료", severity: 'success' }); } catch (err) { showError('삭제', err); }
  };

  const handleDownload = (item) => { 
    if ((item.type === 'folder' || item.type === 'linked-device')) {
      setFolderDownload(item); 
    } else {
      const a = document.createElement('a'); 
      a.href = `/api/file/download?path=${encodeURIComponent(ensureSlash(item.fullPath))}`; 
      a.download = item.name; 
      document.body.appendChild(a); 
      a.click(); 
      document.body.removeChild(a); 
    }
  };

  const formatFileSize = (bytes, isDirectory = false) => {
    if (isDirectory) return '폴더';
    const size = Number(bytes || 0);
    if (size === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const idx = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    const value = size / Math.pow(1024, idx);

    return `${value.toFixed(value >= 100 || idx === 0 ? 0 : 2)} ${units[idx]} (${size.toLocaleString()} bytes)`;
  };

  const formatDateTime = (value) => {
    if (!value) return '-';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';

    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getFileInfoLocation = (data, item) => {
    const fullPath = ensureSlash(data?.path || item?.fullPath || '/');
    if (fullPath === '/') return '/';

    const idx = fullPath.lastIndexOf('/');
    return idx <= 0 ? '/' : fullPath.substring(0, idx);
  };

  const copyTextToClipboard = async (text, successMessage = '복사되었습니다.') => {
    try {
      await navigator.clipboard.writeText(text);
      setSnackbar({ open: true, message: successMessage, severity: 'success' });
    } catch (err) {
      setSnackbar({ open: true, message: '클립보드 복사에 실패했습니다.', severity: 'error' });
    }
  };

  const handleShowProperties = async (item) => {
    if (!item) return;

    const targetPath = ensureSlash(item.fullPath || item.path || '/');

    setFileInfo({
      open: true,
      loading: true,
      item,
      data: null,
      error: ''
    });

    try {
      const response = await axios.get(`/api/file/properties?path=${encodeURIComponent(targetPath)}`, {
        withCredentials: true
      });

      setFileInfo({
        open: true,
        loading: false,
        item,
        data: response.data,
        error: ''
      });
    } catch (err) {
      setFileInfo({
        open: true,
        loading: false,
        item,
        data: null,
        error: err.response?.data?.error || err.message || '파일 정보를 불러오지 못했습니다.'
      });
    }
  };

  const handleCloseFileInfo = () => {
    setFileInfo({ open: false, loading: false, item: null, data: null, error: '' });
  };

  const InfoRow = ({ label, value, mono = false }) => (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '100px 1fr', sm: '140px 1fr' }, gap: 1.5, py: 0.85, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.7)}` }}>
      <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 700 }}>{label}</Typography>
      <Typography
        variant="body2"
        sx={{
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : 'inherit',
          wordBreak: 'break-all',
          color: 'text.primary'
        }}
      >
        {value || '-'}
      </Typography>
    </Box>
  );


  const executeFolderDownload = (format) => {
    if (!folderDownload) return;
    const a = document.createElement('a');
    a.href = `/api/file/download-folder?path=${encodeURIComponent(ensureSlash(folderDownload.fullPath))}&format=${format}`;
    document.body.appendChild(a); 
    a.click(); 
    document.body.removeChild(a);
    setFolderDownload(null);
  };
  const handleUp = (win) => { if (win.currentPath === win.basePath || win.currentPath === '/') return; const segments = win.currentPath.split('/').filter(Boolean); segments.pop(); fetchFiles(win.id, segments.length > 0 ? ensureSlash(segments.join('/')) : '/'); };

  const handleDragStart = (e, item, sourceId) => {
    const rect = e.target.getBoundingClientRect();
    const safePath = ensureSlash(item.fullPath);
    let currentSelection = selectedItems.includes(safePath) ? selectedItems : [safePath];
    if (!selectedItems.includes(safePath)) setSelectedItems(currentSelection);

    e.dataTransfer.setData('application/json', JSON.stringify({
      draggedPaths: currentSelection,
      anchorPath: safePath,
      sourceId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top
    }));
    e.dataTransfer.effectAllowed = 'move';

    // OS 바깥으로 드래그 아웃 다운로드 복구
    if (!isMobile) {
      const isFolder = (item.type === 'folder' || item.type === 'linked-device');
      const fileName = isFolder ? `${item.name}.zip` : item.name;
      const mimeType = isFolder ? 'application/zip' : 'application/octet-stream';
      const downloadUrl = isFolder
        ? `${window.location.origin}/api/file/download-folder?path=${encodeURIComponent(safePath)}`
        : `${window.location.origin}/api/file/download?path=${encodeURIComponent(safePath)}`;
      e.dataTransfer.setData('DownloadURL', `${mimeType}:${fileName}:${downloadUrl}`);
    }
  };
  const handleDragOver = (e, itemPath = null) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const safePath = itemPath ? ensureSlash(itemPath) : null; if (safePath && dragOverTarget !== safePath) setDragOverTarget(safePath); };
  const handleDragLeave = (e, itemPath = null) => { const safePath = itemPath ? ensureSlash(itemPath) : null; if (safePath && dragOverTarget === safePath) setDragOverTarget(null); };

  const handleDrop = async (e, targetPath, targetId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTarget(null);

    const hasExternalFiles = e.dataTransfer && e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files');

    if (hasExternalFiles) {
      const plainFiles = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
      const taskName = plainFiles.length === 1
        ? plainFiles[0].name
        : (plainFiles.length > 1 ? `${plainFiles[0].name} 외 ${plainFiles.length - 1}개` : '업로드');

      try {
        setSnackbar({ open: true, message: `'${taskName}' 업로드 항목 분석 중...`, severity: 'info' });

        const uploadItems = await collectDroppedUploadItems(e.dataTransfer);

        await startUpload({
          uploadItems,
          targetPath,
          taskName
        });
      } catch (err) {
        console.error('외부 드래그 업로드 준비 실패:', err);
        showError('업로드', err);
      }

      return;
    }

    try {
      const dataStr = e.dataTransfer.getData('application/json'); if (!dataStr) return;
      const { draggedPaths, anchorPath, sourceId, offsetX, offsetY } = JSON.parse(dataStr);
      const safeTarget = ensureSlash(targetPath); const cleanTarget = safeTarget.endsWith('/') && safeTarget !== '/' ? safeTarget.slice(0, -1) : safeTarget;
      if (draggedPaths.some(p => safeTarget === p || safeTarget.startsWith(p + '/'))) return alert("이동 불가");

      if (sourceId === 'desktop' && targetId === 'desktop' && safeTarget === '/') {
        if (desktopRef.current && !isMobile) {
          const rect = desktopRef.current.getBoundingClientRect();
          const deltaX = (Math.max(0, Math.round((e.clientX - rect.left - (offsetX || 40) - 20) / 110)) * 110 + 20) - (iconPositions[anchorPath] || {x:0,y:0}).x;
          const deltaY = (Math.max(0, Math.round((e.clientY - rect.top - (offsetY || 40) - 20) / 105)) * 105 + 20) - (iconPositions[anchorPath] || {x:0,y:0}).y;
          let collision = false; const newPos = {};
          draggedPaths.forEach(p => { const oldP = iconPositions[p] || { x: 0, y: 0 }; const nx = Math.max(20, oldP.x + deltaX), ny = Math.max(20, oldP.y + deltaY); newPos[p] = { x: nx, y: ny }; if (desktopItems.some(i => !draggedPaths.includes(ensureSlash(i.fullPath)) && iconPositions[ensureSlash(i.fullPath)]?.x === nx && iconPositions[ensureSlash(i.fullPath)]?.y === ny)) collision = true; });
          if (!collision) setIconPositions(prev => ({ ...prev, ...newPos }));
        } return;
      }

      let refreshNeeded = new Set([cleanTarget || '/']), movedCount = 0;
      await Promise.all(draggedPaths.map(async (oldP) => { const safeOld = ensureSlash(oldP); const newP = (cleanTarget === '/' ? '' : cleanTarget) + '/' + safeOld.split('/').pop(); if (safeOld === newP) return; await axios.put('/api/file', { oldPath: safeOld, newPath: newP }, { withCredentials: true }); if (sourceId === 'desktop' && !isMobile) setIconPositions(prev => { const n = {...prev}; delete n[safeOld]; return n; }); refreshNeeded.add(ensureSlash(safeOld.substring(0, safeOld.lastIndexOf('/')))); movedCount++; }));
      if (movedCount > 0) { refreshNeeded.forEach(p => refreshPath(p)); setSelectedItems([]); setSnackbar({ open: true, message: `${movedCount}개 이동`, severity: 'success' }); }
    } catch (err) { showError('이동', err); }
  };

  const handleContextMenuClose = () => setContextMenu(null);
  const handleContextMenu = (e, type, ctxData) => { e.preventDefault(); e.stopPropagation(); setFocusedContext(ctxData.windowId || 'desktop'); setContextMenu({ mouseX: e.clientX, mouseY: e.clientY, type, ...ctxData }); const safePath = ctxData.item ? ensureSlash(ctxData.item.fullPath) : null; if (safePath && !selectedItems.includes(safePath)) setSelectedItems([safePath]); };
  const handleItemClick = (e, safePath, item) => { e.stopPropagation(); if (isLongPressTriggered.current) return; if (e.ctrlKey || e.metaKey) setSelectedItems(prev => prev.includes(safePath) ? prev.filter(p => p !== safePath) : [...prev, safePath]); else setSelectedItems([safePath]); if (isMobile && !inlineEdit) (item.type === 'folder' || item.type === 'linked-device') ? openFolderWindow(item) : openFileWindow(item, false); };

  useShortcuts({ selectedItems, onRename: () => { const items = getSelectedItemsData(); if (items.length === 1) handleRenameStart(items[0], items[0].fullPath.substring(0, items[0].fullPath.lastIndexOf('/')) || '/'); }, onDelete: () => { const items = getSelectedItemsData(); if (items.length > 0) handleDelete(items, getActiveTargetPath()); }, onOpen: () => { const items = getSelectedItemsData(); if (items.length === 1) items[0].type === 'folder' ? openFolderWindow(items[0]) : openFileWindow(items[0], false); }, onSelectAll: () => setSelectedItems((focusedContext === 'desktop' || !focusedContext ? desktopItems : (openWindows.find(w => w.id === focusedContext)?.files || [])).map(f => ensureSlash(f.fullPath))), onDeselectAll: () => { setSelectedItems([]); setInlineEdit(null); setContextMenu(null); }, onNewFolder: () => handleCreateFolderStart(getActiveTargetPath(), focusedContext, getActiveTargetPath() === '/' ? getAvailableDesktopSlot() : null) });

  return (
    <Box sx={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%', userSelect: 'none', '& .react-resizable-handle:hover': { backgroundColor: theme.palette.primary.main, opacity: 0.5 }}}>
      <Box ref={desktopRef} onDragOver={(e) => handleDragOver(e, null)} onDrop={(e) => handleDrop(e, '/', 'desktop')} onContextMenu={(e) => handleContextMenu(e, 'background', { path: '/', windowId: 'desktop' })} onMouseDown={(e) => { if (isLongPressTriggered.current) return; if (e.target === e.currentTarget) { setFocusedContext('desktop'); setSelectedItems([]); setInlineEdit(null); } }} onTouchStart={(e) => { if (e.target === e.currentTarget) handleTouchStart(e, 'background', { path: '/', windowId: 'desktop' }); }} onTouchMove={cancelTouch} onTouchEnd={cancelTouch} onTouchCancel={cancelTouch} sx={{ flex: 1, position: 'relative', overflowX: 'hidden', overflowY: 'auto', display: isMobile ? 'flex' : 'block', flexWrap: isMobile ? 'wrap' : 'nowrap', alignContent: 'flex-start', gap: isMobile ? 2 : 0, p: isMobile ? 2 : 0, background: theme.palette.mode === 'dark' ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' : 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #93c5fd 100%)' }}>
        <motion.div onClick={(e) => { e.stopPropagation(); setSelectedItems(['system_root']); if (isMobile) openFolderWindow({ id: 'system_root', name: isAdmin ? '서버 전체 저장소' : '내 클라우드', path: '/' }); }} onDoubleClick={(e) => { e.stopPropagation(); if(!isMobile) openFolderWindow({ id: 'system_root', name: isAdmin ? '서버 전체 저장소' : '내 클라우드', path: '/' }); }} style={isMobile ? { textAlign: 'center', width: '80px', cursor: 'pointer', zIndex: 10 } : { position: 'absolute', left: 20, top: 20, textAlign: 'center', cursor: 'pointer', width: '100px', zIndex: 10 }}>
          <Box sx={{ p: 1, borderRadius: '6px', border: selectedItems.includes('system_root') ? '1px solid rgba(255,255,255,0.4)' : '1px solid transparent', backgroundColor: selectedItems.includes('system_root') ? 'rgba(255, 255, 255, 0.15)' : 'transparent', color: 'white', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}><StorageIcon sx={{ fontSize: isMobile ? 40 : 60, color: isAdmin ? '#ef4444' : '#fde047' }} /><Typography variant="body2" sx={{ mt: 1, fontWeight: 'bold', fontSize: isMobile ? '0.75rem' : '0.875rem' }}>{isAdmin ? '전체 저장소' : '내 클라우드'}</Typography>
</Box>

        </motion.div>

        {desktopItems.map((item) => {
          const safePath = ensureSlash(item.fullPath); const isEditing = (inlineEdit?.mode === 'rename' && ensureSlash(inlineEdit.oldPath) === safePath && inlineEdit.windowId === 'desktop'); const isSelected = selectedItems.includes(safePath); const pos = iconPositions[safePath] || { x: 0, y: 0 }; 
          return (
            <motion.div key={safePath} className="selectable-item" data-path={safePath}     draggable={!isEditing && !isMobile} onDragStart={(e) => { if(!isEditing && !isMobile) handleDragStart(e, item, 'desktop') }} onDragOver={(e) => { if ((item.type === 'folder' || item.type === 'linked-device') && !isMobile) handleDragOver(e, item.fullPath); }} onDragLeave={(e) => { if ((item.type === 'folder' || item.type === 'linked-device') && !isMobile) handleDragLeave(e, item.fullPath); }} onDrop={(e) => { if ((item.type === 'folder' || item.type === 'linked-device') && !isMobile) handleDrop(e, item.fullPath, 'desktop'); }} onClick={(e) => handleItemClick(e, safePath, item)} onDoubleClick={(e) => { e.stopPropagation(); if(!isEditing && !isMobile) (item.type === 'folder' || item.type === 'linked-device') ? openFolderWindow(item) : openFileWindow(item, false); }} onContextMenu={(e) => { if(!isEditing) handleContextMenu(e, item.type, { item, path: '/', windowId: 'desktop' }) }} onTouchStart={(e) => { if(!isEditing) handleTouchStart(e, item.type, { item, path: '/', windowId: 'desktop' }) }} onTouchMove={cancelTouch} onTouchEnd={cancelTouch} onTouchCancel={cancelTouch} style={isMobile ? { textAlign: 'center', cursor: isEditing ? 'default' : 'pointer', width: '80px', zIndex: isSelected ? 20 : (isEditing ? 15 : 10) } : { position: 'absolute', left: pos.x, top: pos.y, textAlign: 'center', cursor: isEditing ? 'default' : 'pointer', width: '100px', zIndex: isSelected ? 20 : (isEditing ? 15 : 10) }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
                <Box sx={{ color: 'white', p: 1, borderRadius: '6px', border: dragOverTarget === safePath ? '2px dashed #fbbf24' : (isSelected ? '1px solid rgba(255,255,255,0.4)' : '1px solid transparent'), backgroundColor: dragOverTarget === safePath ? 'rgba(251, 191, 36, 0.2)' : (isSelected ? 'rgba(255, 255, 255, 0.15)' : 'transparent'), transition: 'all 0.1s ease-in-out', '&:hover': { backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)' } }}>{item.type === 'linked-device' ? <DesktopWindowsIcon sx={{ fontSize: !isMobile ? 60 : 40, color: '#38bdf8' }} /> : ((item.type === 'folder' || item.type === 'linked-device') ? <FolderIcon sx={{ fontSize: !isMobile ? 60 : 40, color: '#fde047' }} /> : <InsertDriveFileIcon sx={{ fontSize: !isMobile ? 60 : 40, color: '#e2e8f0' }} />)}
</Box>

                {isEditing ? <InlineInput defaultValue={inlineEdit.name} isDesktop={true} onSubmit={(val) => handleInlineSubmit(val, inlineEdit)} onCancel={() => setInlineEdit(null)} /> : <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 'bold', color: 'white', textShadow: '1px 1px 3px rgba(0,0,0,0.8)', wordBreak: 'break-all', maxWidth: isMobile ? '80px' : '90px', lineHeight: 1.2, fontSize: isMobile ? '0.75rem' : '0.875rem' }}>{isSelected || isMobile ? getDisplayName(item) : (getDisplayName(item).length > 8 ? getDisplayName(item).substring(0, 8) + '...' : getDisplayName(item))}</Typography>}
              
</Box>

            </motion.div>
          );
        })}
        {/* 🔥 바탕화면: 새 파일/새 폴더 입력창 표시 (아이콘 동적 변경) */}
        {inlineEdit && (inlineEdit.mode === 'new' || inlineEdit.mode === 'newFile') && inlineEdit.windowId === 'desktop' && (<motion.div style={isMobile ? { textAlign: 'center', width: '80px', zIndex: 15 } : { position: 'absolute', left: inlineEdit.spawnPosition?.x || 200, top: inlineEdit.spawnPosition?.y || 200, textAlign: 'center', width: '100px', zIndex: 15 }}><Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>{inlineEdit.mode === 'new' ? <FolderIcon sx={{ fontSize: isMobile ? 40 : 60, color: '#fde047' }} /> : <InsertDriveFileIcon sx={{ fontSize: isMobile ? 40 : 60, color: '#e2e8f0' }} />}<InlineInput defaultValue={inlineEdit.name} isDesktop={true} onSubmit={(val) => handleInlineSubmit(val, inlineEdit)} onCancel={() => setInlineEdit(null)} />
</Box>
</motion.div>)}
      
</Box>


      {/* 🔥 [버튼 3대장] 파일, 폴더, 업로드 버튼 배치! */}
      <Box sx={{ position: isMobile ? 'fixed' : 'absolute', bottom: isMobile ? 20 : 30, right: isMobile ? 15 : 30, display: (openWindows.some(w => w.isImmersive) || (isMobile && openWindows.find(w => w.id === focusedContext)?.winType === 'file')) ? 'none' : 'flex', gap: isMobile ? 1 : 2, zIndex: 1200 }}>
        <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
        <Button variant="contained" color="secondary" size={isMobile ? "small" : "medium"} onClick={() => handleUploadClick(getActiveTargetPath())} sx={{ minWidth: isMobile ? '40px' : 'auto', fontWeight: 'bold', boxShadow: 6, borderRadius: isMobile ? '50%' : 2, p: isMobile ? 1.5 : 1 }}><UploadFileIcon sx={{ mr: isMobile ? 0 : 1 }} /> {!isMobile && "업로드"}</Button>
        <Button variant="contained" color="info" size={isMobile ? "small" : "medium"} onClick={() => handleCreateFileStart(getActiveTargetPath(), focusedContext, getActiveTargetPath() === '/' ? getAvailableDesktopSlot() : null)} sx={{ bgcolor: '#0ea5e9', minWidth: isMobile ? '40px' : 'auto', fontWeight: 'bold', boxShadow: 6, borderRadius: isMobile ? '50%' : 2, p: isMobile ? 1.5 : 1, '&:hover':{ bgcolor: '#0284c7' } }}><NoteAddIcon sx={{ mr: isMobile ? 0 : 1 }} /> {!isMobile && "새 파일"}</Button>
        <Button variant="contained" color="primary" size={isMobile ? "small" : "medium"} onClick={() => handleCreateFolderStart(getActiveTargetPath(), focusedContext, getActiveTargetPath() === '/' ? getAvailableDesktopSlot() : null)} sx={{ minWidth: isMobile ? '40px' : 'auto', fontWeight: 'bold', boxShadow: 6, borderRadius: isMobile ? '50%' : 2, p: isMobile ? 1.5 : 1 }}><CreateNewFolderIcon sx={{ mr: isMobile ? 0 : 1 }} /> {!isMobile && "새 폴더"}</Button>
      
</Box>



      <AnimatePresence>
        {openWindows.filter((win) => win.winType !== 'chat').map((win) => {
          
          const winStyles = win.isImmersive ? { width: '100vw', height: '100vh', x: 0, y: 0 } : (isMobile ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' } : { width: win.isMaximized ? '100%' : win.width, height: win.isMaximized ? '100%' : win.height, x: win.isMaximized ? 0 : win.x, y: win.isMaximized ? 0 : win.y });
          const isActive = focusedContext === win.id;

          return (
            <Rnd 
              key={win.id} style={{ display: win.isMinimized ? 'none' : 'block', zIndex: win.isImmersive ? 99999 : win.zIndex, position: win.isImmersive ? 'fixed' : 'absolute', top: win.isImmersive ? 0 : 'auto', left: win.isImmersive ? 0 : 'auto' }} disableDragging={isMobile || win.isMaximized || win.isImmersive} enableResizing={!isMobile && !win.isMaximized && !win.isImmersive} 
              minWidth={300} minHeight={350} size={isMobile ? { width: '100%', height: '100%' } : { width: winStyles.width, height: winStyles.height }} position={isMobile ? { x: 0, y: 0 } : { x: winStyles.x, y: winStyles.y }} 
              onMouseDown={() => focusWindow(win.id)} onDragStop={(e, d) => setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, x: d.x, y: d.y } : w))} onResizeStop={(e, direction, ref, delta, position) => setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, width: ref.style.width, height: ref.style.height, x: position.x, y: position.y } : w))} dragHandleClassName="window-header-drag-handle" bounds="parent" 
            >
              <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} style={{ height: '100%', width: '100%' }}>
                <Paper elevation={isActive ? 24 : 8} sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: (isMobile || win.isMaximized || win.isImmersive) ? 0 : 2, overflow: 'hidden', border: isActive ? `3px solid ${theme.palette.primary.main}` : `1px solid ${theme.palette.divider}`, boxShadow: isActive ? `0 0 25px ${alpha(theme.palette.primary.main, 0.4)}` : theme.shadows[10], transition: 'border 0.2s ease, box-shadow 0.2s ease' }}>
                  {win.isImmersive && <Box onMouseEnter={() => setHoveredHeader(win.id)} sx={{ position: 'absolute', top: 0, left: 0, right: 0, height: '30px', zIndex: 99998, cursor: 'default' }} />}
                  <Box className="window-header-drag-handle" onMouseEnter={() => setHoveredHeader(win.id)} onMouseLeave={() => setHoveredHeader(null)} sx={{ display: 'flex', position: win.isImmersive ? 'absolute' : 'relative', top: win.isImmersive ? (hoveredHeader === win.id ? 0 : '-70px') : 0, left: 0, right: 0, width: '100%', transition: 'top 0.35s cubic-bezier(0.4, 0, 0.2, 1)', zIndex: 100000, p: 1, background: isActive ? alpha(theme.palette.primary.main, 0.08) : theme.palette.background.default, borderBottom: `1px solid ${theme.palette.divider}`, justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, cursor: win.isMaximized ? 'default' : 'move' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
                      {win.winType === 'folder' ? (
                        <>
                          <IconButton size="small" onClick={() => toggleSidebar(win.id)} color={isActive ? "primary" : "inherit"} onMouseDown={(e) => e.stopPropagation()}><MenuIcon /></IconButton>
                          <IconButton size="small" onClick={() => handleUp(win)} disabled={win.currentPath === win.basePath} color="inherit" onMouseDown={(e) => e.stopPropagation()}><ArrowBackIcon /></IconButton>
                          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto', ml: 1 }} onMouseDown={(e) => e.stopPropagation()}>
                            <Typography onClick={() => fetchFiles(win.id, win.basePath)} sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' }, fontWeight: 800, whiteSpace: 'nowrap' }}>{win.name}</Typography>
                            {getRelativeSegments(win.currentPath, win.basePath).map((seg, idx, arr) => (<React.Fragment key={idx}><Typography sx={{ mx: 0.5, color: 'text.secondary' }}>/</Typography><Typography onClick={() => fetchFiles(win.id, (win.basePath === '/' ? '' : win.basePath.replace(/\/$/, '')) + '/' + arr.slice(0, idx + 1).join('/'))} sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' }, fontWeight: 800, whiteSpace: 'nowrap' }}>{seg}</Typography></React.Fragment>))}
                          
</Box>

                        </>
                      ) : (<><InsertDriveFileIcon color={isActive ? "primary" : "inherit"} /><Typography sx={{ fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{win.name}</Typography></>)}
                    
</Box>

                    <Box sx={{ display: 'flex', flexShrink: 0 }} onMouseDown={(e) => e.stopPropagation()}>
                      {!isMobile && <IconButton size="small" onClick={(e) => { e.stopPropagation(); if (win.isImmersive) { setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: false, isMinimized: true } : w)); } else { toggleMinimize(win.id); } }}><RemoveIcon fontSize="small"/></IconButton>}
                      {!isMobile && <IconButton size="small" onClick={(e) => { e.stopPropagation(); if (win.isImmersive) { setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: false } : w)); } else { toggleMaximize(win.id); } }} onMouseDown={() => { window.immersiveTimer = setTimeout(() => { setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: true } : w)); }, 500); }} onMouseUp={() => clearTimeout(window.immersiveTimer)} onMouseLeave={() => clearTimeout(window.immersiveTimer)} onTouchStart={() => { window.immersiveTimer = setTimeout(() => { setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, isImmersive: true } : w)); }, 500); }} onTouchEnd={() => clearTimeout(window.immersiveTimer)}>{win.isMaximized ? <FilterNoneIcon fontSize="small"/> : <CropSquareIcon fontSize="small"/>}</IconButton>}
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleCloseWindowClick(win); }} color="error"><CloseIcon fontSize="small"/></IconButton>
                    
</Box>

                  
</Box>

                  
                  <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
                    {win.winType === 'folder' && (
                      <>
                        <AnimatePresence>
                          {win.sidebarOpen && !isMobile && (
                            <motion.div initial={{ x: -220 }} animate={{ x: 0 }} exit={{ x: -220 }} transition={{ type: 'tween', duration: 0.2 }} style={{ width: 220, height: '100%', backgroundColor: theme.palette.background.default, borderRight: `1px solid ${theme.palette.divider}`, zIndex: 10 }}>
                              <SidebarTree win={win} fetchFiles={fetchFiles} theme={theme} openFileWindow={openFileWindow} handleContextMenu={handleContextMenu} handleItemClick={handleItemClick} selectedItems={selectedItems} inlineEdit={inlineEdit} handleInlineSubmit={handleInlineSubmit} setInlineEdit={setInlineEdit} />
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <TableContainer className="window-content-area" onDragOver={(e) => handleDragOver(e, null)} onDrop={(e) => handleDrop(e, win.currentPath, win.id)} onContextMenu={(e) => handleContextMenu(e, 'background', { path: win.currentPath, windowId: win.id })} onMouseDown={(e) => { if (isLongPressTriggered.current) return; if(e.target === e.currentTarget) setSelectedItems([]); }} onTouchStart={(e) => { if (e.target === e.currentTarget) handleTouchStart(e, 'background', { path: win.currentPath, windowId: win.id }); }} onTouchMove={cancelTouch} onTouchEnd={cancelTouch} onTouchCancel={cancelTouch} sx={{ flex: 1, background: 'transparent' }}>
                          <Table stickyHeader size="small">
                            <TableBody>
                              {win.files.map((file, idx) => {
                                const safePath = ensureSlash(file.fullPath); const isEditing = (inlineEdit?.mode === 'rename' && ensureSlash(inlineEdit.oldPath) === safePath && inlineEdit.windowId === win.id); const isSelected = selectedItems.includes(safePath); const isDragTarget = dragOverTarget === safePath;
                                return (
                                  <TableRow key={idx} className="selectable-item" data-path={safePath} hover draggable={!isEditing && !isMobile} onDragStart={(e) => { if(!isEditing && !isMobile) handleDragStart(e, file, win.id) }} onDragOver={(e) => { if((file.type === 'folder' || file.type === 'linked-device') && !isMobile) handleDragOver(e, file.fullPath) }} onDragLeave={(e) => { if((file.type === 'folder' || file.type === 'linked-device') && !isMobile) handleDragLeave(e, file.fullPath) }} onDrop={(e) => { if((file.type === 'folder' || file.type === 'linked-device') && !isMobile) handleDrop(e, file.fullPath, win.id) }} onClick={(e) => handleItemClick(e, safePath, file)} onDoubleClick={(e) => { e.stopPropagation(); if(!isEditing && !isMobile) (file.type === 'folder' || file.type === 'linked-device') ? fetchFiles(win.id, ensureSlash(file.fullPath)) : openFileWindow(file, false); }} onContextMenu={(e) => { if(!isEditing) handleContextMenu(e, file.type, { item: file, path: win.currentPath, windowId: win.id }) }} onTouchStart={(e) => { if(!isEditing) handleTouchStart(e, file.type, { item: file, path: win.currentPath, windowId: win.id }); }} onTouchMove={cancelTouch} onTouchEnd={cancelTouch} onTouchCancel={cancelTouch} sx={{ cursor: isEditing ? 'default' : 'pointer', backgroundColor: isDragTarget ? alpha(theme.palette.warning.main, 0.2) : (isSelected ? alpha(theme.palette.primary.main, 0.1) : 'inherit'), border: isDragTarget ? `2px dashed ${theme.palette.warning.main}` : 'none' }}>
                                    <TableCell sx={{ display: 'flex', alignItems: 'center', py: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>{file.type === 'linked-device' ? <DesktopWindowsIcon sx={{ mr: 1.5, color: '#38bdf8' }} /> : ((file.type === 'folder' || file.type === 'linked-device') ? <FolderIcon sx={{ mr: 1.5, color: '#fbbf24' }} /> : <InsertDriveFileIcon sx={{ mr: 1.5, color: theme.palette.text.secondary }} />)}{isEditing ? <InlineInput defaultValue={inlineEdit.name} isDesktop={false} onSubmit={(val) => handleInlineSubmit(val, inlineEdit)} onCancel={() => setInlineEdit(null)} /> : <Typography>{getDisplayName(file)}</Typography>}</TableCell>
                                  </TableRow>
                                );
                              })}
                              {/* 🔥 창 안쪽: 새 파일/새 폴더 입력창 표시 */}
                              {inlineEdit && (inlineEdit.mode === 'new' || inlineEdit.mode === 'newFile') && inlineEdit.windowId === win.id && (<TableRow><TableCell sx={{ display: 'flex', alignItems: 'center', py: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>{inlineEdit.mode === 'new' ? <FolderIcon sx={{ mr: 1.5, color: '#fbbf24' }} /> : <InsertDriveFileIcon sx={{ mr: 1.5, color: theme.palette.text.secondary }} />}<InlineInput defaultValue={inlineEdit.name} isDesktop={false} onSubmit={(val) => handleInlineSubmit(val, inlineEdit)} onCancel={() => setInlineEdit(null)} /></TableCell></TableRow>)}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      </>
                    )}
                    {win.winType === 'file' && <FileViewer win={win} toggleEditMode={toggleEditMode} handleContentChange={handleContentChange} saveFile={saveFile} />}
                  
</Box>

                </Paper>
              </motion.div>
            </Rnd>
          );
        })}
      </AnimatePresence>

      
      {/* 🔥 저장 3지선다 다이얼로그 */}
      <Dialog open={Boolean(closePrompt)} onClose={() => setClosePrompt(null)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>저장되지 않은 변경 사항</DialogTitle>
        <DialogContent>
          <DialogContentText>
            '{closePrompt?.name}' 파일의 변경 내용을 저장하시겠습니까?
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button onClick={async () => { await saveFile(closePrompt); closeWindow(closePrompt.id); setClosePrompt(null); }} color="primary" variant="contained" disableElevation>저장</Button>
          <Button onClick={() => { closeWindow(closePrompt.id); setClosePrompt(null); }} color="error" variant="outlined">저장 안 함</Button>
          <Button onClick={() => setClosePrompt(null)} color="inherit">취소</Button>
        </DialogActions>
      </Dialog>
    
      <NASContextMenu handleCopy={handleCopyContextMenu} handlePaste={handlePasteContextMenu} clipboard={clipboard} contextMenu={contextMenu} handleContextMenuClose={handleContextMenuClose} refreshPath={refreshPath} handleCreateFolderStart={handleCreateFolderStart} handleUploadClick={handleUploadClick} openFolderWindow={openFolderWindow} openFileWindow={openFileWindow} handleRenameStart={handleRenameStart} handleDelete={handleDelete} handleDownload={handleDownload} handleShowProperties={handleShowProperties} getItemsToProcess={getItemsToProcess} handleCreateLinkedDeviceFolder={handleCreateLinkedDeviceFolder} />
      <Snackbar open={snackbar.open} autoHideDuration={snackbar.severity === 'info' ? null : 3000} onClose={handleCloseSnackbar} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}><Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>{snackbar.severity === 'info' && <CircularProgress size={20} sx={{ mr: 2, color: 'inherit' }} />}{snackbar.message}</Alert></Snackbar>
      {/* 파일/폴더 정보 다이얼로그 */}
      <Dialog
        open={fileInfo.open}
        onClose={handleCloseFileInfo}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          elevation: 24,
          sx: {
            borderRadius: 4,
            overflow: 'hidden',
            bgcolor: 'background.paper'
          }
        }}
      >
        <DialogTitle sx={{
          p: 0,
          background: theme.palette.mode === 'dark'
            ? 'linear-gradient(135deg, rgba(15,23,42,0.98), rgba(30,41,59,0.98))'
            : 'linear-gradient(135deg, rgba(37,99,235,0.96), rgba(14,165,233,0.96))',
          color: 'white'
        }}>
          <Box sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{
              width: 58,
              height: 58,
              borderRadius: 3,
              bgcolor: 'rgba(255,255,255,0.16)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)'
            }}>
              {fileInfo.data?.isDirectory || fileInfo.item?.type === 'folder'
                ? <FolderIcon sx={{ fontSize: 38, color: '#fde047' }} />
                : <InsertDriveFileIcon sx={{ fontSize: 38, color: '#e0f2fe' }} />
              }
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.25, wordBreak: 'break-all' }}>
                {fileInfo.data?.name || fileInfo.item?.name || '파일 정보'}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.5 }}>
                {fileInfo.data?.typeLabel || (fileInfo.item?.type === 'folder' ? '파일 폴더' : '파일')}
              </Typography>
            </Box>
          </Box>
        </DialogTitle>

        <DialogContent sx={{ p: 3 }}>
          {fileInfo.loading ? (
            <Box sx={{ py: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <CircularProgress />
              <Typography color="text.secondary">파일 정보를 불러오는 중...</Typography>
            </Box>
          ) : fileInfo.error ? (
            <Alert severity="error" sx={{ my: 1 }}>{fileInfo.error}</Alert>
          ) : fileInfo.data ? (
            <Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                <Chip
                  size="small"
                  label={fileInfo.data.isDirectory ? '폴더' : '파일'}
                  color={fileInfo.data.isDirectory ? 'warning' : 'primary'}
                  variant="filled"
                />
                {fileInfo.data.extension && (
                  <Chip size="small" label={fileInfo.data.extension.toUpperCase()} variant="outlined" />
                )}
                {fileInfo.data.permissions && (
                  <Chip size="small" label={fileInfo.data.permissions} variant="outlined" />
                )}
              </Box>

              <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>기본 정보</Typography>
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 2, px: 2 }}>
                <InfoRow label="이름" value={fileInfo.data.name} />
                <InfoRow label="종류" value={fileInfo.data.typeLabel} />
                <InfoRow label="크기" value={formatFileSize(fileInfo.data.size, fileInfo.data.isDirectory)} />
                {fileInfo.data.isDirectory && (
                  <InfoRow
                    label="항목 수"
                    value={
                      fileInfo.data.itemCount === null || fileInfo.data.itemCount === undefined
                        ? '-'
                        : `총 ${fileInfo.data.itemCount}개 · 파일 ${fileInfo.data.childFileCount ?? 0}개 · 폴더 ${fileInfo.data.childFolderCount ?? 0}개`
                    }
                  />
                )}
                <InfoRow label="위치" value={getFileInfoLocation(fileInfo.data, fileInfo.item)} mono />
                <InfoRow label="전체 경로" value={fileInfo.data.path} mono />
              </Paper>

              <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>날짜 정보</Typography>
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', mb: 2, px: 2 }}>
                <InfoRow label="만든 날짜" value={formatDateTime(fileInfo.data.created)} />
                <InfoRow label="수정한 날짜" value={formatDateTime(fileInfo.data.modified)} />
                <InfoRow label="접근한 날짜" value={formatDateTime(fileInfo.data.accessed)} />
                <InfoRow label="상태 변경일" value={formatDateTime(fileInfo.data.changed)} />
              </Paper>

              <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>관리 정보</Typography>
              <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', px: 2 }}>
                <InfoRow label="권한" value={fileInfo.data.permissions} mono />
                <InfoRow label="UID / GID" value={`${fileInfo.data.uid ?? '-'} / ${fileInfo.data.gid ?? '-'}`} mono />
              </Paper>
            </Box>
          ) : null}
        </DialogContent>

        <Divider />

        <DialogActions sx={{ p: 2, justifyContent: 'space-between' }}>
          <Button
            onClick={() => copyTextToClipboard(fileInfo.data?.path || ensureSlash(fileInfo.item?.fullPath || '/'), '전체 경로가 복사되었습니다.')}
            disabled={!fileInfo.data && !fileInfo.item}
            variant="outlined"
          >
            경로 복사
          </Button>
          <Button onClick={handleCloseFileInfo} variant="contained" disableElevation>
            닫기
          </Button>
        </DialogActions>
      </Dialog>

      {/* 🔥 폴더 다운로드 다이얼로그 */}
      <Dialog open={!!folderDownload} onClose={() => setFolderDownload(null)} PaperProps={{ elevation: 24, sx: { borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 800, textAlign: 'center' }}>폴더 다운로드</DialogTitle>
        <DialogContent sx={{ textAlign: 'center' }}>
          <DialogContentText sx={{ mb: 3 }}>
            <strong style={{ color: '#3b82f6' }}>'{folderDownload?.name}'</strong> 폴더를 압축합니다.<br/>원하시는 압축 포맷을 선택해 주세요.
          </DialogContentText>
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button variant="contained" color="primary" onClick={() => executeFolderDownload('zip')} sx={{ fontWeight: 'bold' }}>.ZIP (권장)</Button>
            <Button variant="outlined" color="secondary" onClick={() => executeFolderDownload('tar')}>.TAR</Button>
            <Button variant="outlined" color="info" onClick={() => executeFolderDownload('tgz')}>.TAR.GZ</Button>
          
</Box>

        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center' }}>
          <Button onClick={() => setFolderDownload(null)} color="inherit">취소</Button>
        </DialogActions>
      </Dialog>
    
    
</Box>

  );
};

export default NAS;
