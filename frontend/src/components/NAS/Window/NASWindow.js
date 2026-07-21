import React, { useEffect, useRef, useState } from 'react';
import { Box, Paper, Typography, IconButton } from '@mui/material';
import { Rnd } from 'react-rnd';
import MenuIcon from '@mui/icons-material/Menu';
import RemoveIcon from '@mui/icons-material/Remove';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import FilterNoneIcon from '@mui/icons-material/FilterNone';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

import SidebarTree from './SidebarTree';
import FolderView from './FolderView';
import FileViewer from '../FileViewer';

const noop = () => {};

const NASWindow = ({
  win,
  theme,
  isMobile,
  fetchFiles,
  closeWindow,
  toggleSidebar,
  focusWindow,
  focusedContext,
  toggleMinimize,
  toggleMaximize,
  toggleFullscreen,
  handleUp,
  openFileWindow,
  handleContextMenu,
  handleItemClick,
  selectedItems,
  inlineEdit,
  handleInlineSubmit,
  setInlineEdit,
  handleDragOver,
  handleDrop,
  dragOverTarget,
  handleDragStart,
  handleDragLeave,
  toggleEditMode,
  handleContentChange,
  saveFile,
}) => {
  const isActive = focusedContext === win.id;
  const fillsParent = !!win.isMaximized || !!win.isImmersive;
  const isFolder = win.winType === 'folder';
  const isFile = win.winType === 'file';
  const [immersiveHeaderVisible, setImmersiveHeaderVisible] = useState(false);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const maximizeHoldTimerRef = useRef(null);
  const maximizeHoldTriggeredRef = useRef(false);
  const browserFullscreenCancelRef = useRef(false);
  const windowSurfaceRef = useRef(null);

  const safeWin = {
    ...win,
    files: Array.isArray(win.files) ? win.files : [],
  };

  const safeSelectedItems = Array.isArray(selectedItems) ? selectedItems : [];
  const fullscreenChromeActive = !!safeWin.isImmersive || isBrowserFullscreen;

  const rndSize = fillsParent
    ? { width: '100%', height: '100%' }
    : { width: safeWin.width, height: safeWin.height };

  const rndPosition = fillsParent
    ? { x: 0, y: 0 }
    : { x: safeWin.x, y: safeWin.y };

  const clearMaximizeHoldTimer = () => {
    if (maximizeHoldTimerRef.current) {
      clearTimeout(maximizeHoldTimerRef.current);
      maximizeHoldTimerRef.current = null;
    }
    if (!maximizeHoldTriggeredRef.current) {
      browserFullscreenCancelRef.current = true;
      if (document.fullscreenElement === windowSurfaceRef.current) {
        document.exitFullscreen?.().catch(() => {});
      }
    }
  };

  const enterBrowserFullscreen = async () => {
    const target = windowSurfaceRef.current;
    if (!target || document.fullscreenElement) return;
    try {
      await target.requestFullscreen?.();
      if (browserFullscreenCancelRef.current && document.fullscreenElement === target) {
        await document.exitFullscreen?.();
      }
    } catch (err) {
      console.warn('브라우저 전체화면 전환 실패', err);
    } finally {
      browserFullscreenCancelRef.current = false;
    }
  };

  const startMaximizeHold = () => {
    clearMaximizeHoldTimer();
    maximizeHoldTriggeredRef.current = false;
    browserFullscreenCancelRef.current = false;
    enterBrowserFullscreen();
    maximizeHoldTimerRef.current = setTimeout(() => {
      maximizeHoldTriggeredRef.current = true;
      toggleFullscreen?.(safeWin.id);
      setImmersiveHeaderVisible(false);
      maximizeHoldTimerRef.current = null;
    }, 550);
  };

  const handleMaximizeClick = (event) => {
    event.stopPropagation();
    if (maximizeHoldTriggeredRef.current) {
      maximizeHoldTriggeredRef.current = false;
      return;
    }
    toggleMaximize?.(safeWin.id);
  };

  const handleBrowserFullscreenToggle = (event) => {
    event.stopPropagation();
    if (safeWin.isImmersive || document.fullscreenElement === windowSurfaceRef.current) {
      document.exitFullscreen?.().catch(() => {});
      if (safeWin.isImmersive) toggleFullscreen?.(safeWin.id);
      return;
    }
    browserFullscreenCancelRef.current = false;
    enterBrowserFullscreen();
    toggleFullscreen?.(safeWin.id);
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === windowSurfaceRef.current;
      setIsBrowserFullscreen(active);
      if (!active) setImmersiveHeaderVisible(false);
      if (!active && safeWin.isImmersive) {
        toggleFullscreen?.(safeWin.id);
      }
    };
    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [safeWin.id, safeWin.isImmersive, toggleFullscreen]);

  useEffect(() => {
    if (!fullscreenChromeActive) return undefined;
    const handlePointerMove = (event) => {
      if (event.clientY <= 96) setImmersiveHeaderVisible(true);
      if (event.clientY > 132) setImmersiveHeaderVisible(false);
    };
    window.addEventListener('mousemove', handlePointerMove, true);
    window.addEventListener('pointermove', handlePointerMove, true);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove, true);
      window.removeEventListener('pointermove', handlePointerMove, true);
    };
  }, [fullscreenChromeActive]);

  useEffect(() => () => {
    clearMaximizeHoldTimer();
  }, []);

  return (
    <Rnd
      size={rndSize}
      position={rndPosition}
      onMouseDown={() => focusWindow(safeWin.id)}
      dragHandleClassName="window-header"
      bounds="parent"
      disableDragging={fillsParent}
      enableResizing={!fillsParent}
      onDragStop={(e, d) => {
        if (fillsParent) return;
      }}
    >
      <Paper
        ref={windowSurfaceRef}
        elevation={isActive ? 10 : 2}
        sx={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          border: isActive ? `2px solid ${theme.palette.primary.main}` : `1px solid ${theme.palette.divider}`,
          borderRadius: safeWin.isImmersive ? 0 : 2,
          bgcolor: 'background.paper',
        }}
      >
        {fullscreenChromeActive && (
          <Box
            onMouseEnter={() => setImmersiveHeaderVisible(true)}
            onMouseMove={() => setImmersiveHeaderVisible(true)}
            onPointerEnter={() => setImmersiveHeaderVisible(true)}
            onPointerMove={() => setImmersiveHeaderVisible(true)}
            sx={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              height: 96,
              zIndex: 2147482999,
              cursor: 'default',
              pointerEvents: 'auto',
            }}
          />
        )}
        <Box
          className="window-header"
          onMouseEnter={() => setImmersiveHeaderVisible(true)}
          onMouseLeave={() => setImmersiveHeaderVisible(false)}
          sx={{
            p: 1,
            display: 'flex',
            position: fullscreenChromeActive ? 'fixed' : 'relative',
            top: fullscreenChromeActive ? (immersiveHeaderVisible ? 0 : -72) : 0,
            left: 0,
            right: 0,
            zIndex: 2147483000,
            flexShrink: 0,
            alignItems: 'center',
            justifyContent: 'space-between',
            bgcolor: theme.palette.mode === 'dark' ? '#111827' : '#f8fafc',
            borderBottom: `1px solid ${theme.palette.divider}`,
            boxShadow: fullscreenChromeActive ? theme.shadows[4] : 'none',
            transition: fullscreenChromeActive ? 'top 180ms ease' : 'none',
            cursor: fillsParent ? 'default' : 'move',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {isFolder && (
              <>
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleSidebar?.(safeWin.id); }}>
                  <MenuIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof handleUp === 'function') handleUp(safeWin);
                  }}
                  disabled={!safeWin.currentPath || safeWin.currentPath === safeWin.basePath}
                >
                  <ArrowBackIcon fontSize="small" />
                </IconButton>
              </>
            )}

            <Typography
              variant="body2"
              sx={{
                ml: 1,
                fontWeight: 800,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {isFolder ? (safeWin.currentPath || safeWin.name || '/') : (safeWin.name || 'file')}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleMinimize?.(safeWin.id); }} title="최소화">
              <RemoveIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={handleMaximizeClick}
              onMouseDown={(e) => {
                e.stopPropagation();
                startMaximizeHold();
              }}
              onMouseUp={clearMaximizeHoldTimer}
              onMouseLeave={clearMaximizeHoldTimer}
              onTouchStart={(e) => {
                e.stopPropagation();
                startMaximizeHold();
              }}
              onTouchEnd={clearMaximizeHoldTimer}
              title="최대화 / 길게 누르면 전체화면"
            >
              <CropSquareIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={handleBrowserFullscreenToggle} title="브라우저 전체화면">
              <FilterNoneIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); closeWindow?.(safeWin.id); }} color="error" title="닫기">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {isFolder && (
            <>
              {safeWin.sidebarOpen !== false && (
                <Box
                  sx={{
                    width: 220,
                    borderRight: `1px solid ${theme.palette.divider}`,
                    display: 'flex',
                    flexDirection: 'column',
                    bgcolor: 'background.paper',
                  }}
                >
                  <SidebarTree
                    win={safeWin}
                    fetchFiles={fetchFiles}
                    theme={theme}
                    openFileWindow={openFileWindow}
                    handleContextMenu={handleContextMenu}
                    handleItemClick={handleItemClick}
                    selectedItems={safeSelectedItems}
                    inlineEdit={inlineEdit}
                    handleInlineSubmit={handleInlineSubmit}
                    setInlineEdit={setInlineEdit}
                  />
                </Box>
              )}

              <Box sx={{ flex: 1, overflow: 'auto', bgcolor: 'background.default' }}>
                <FolderView
                  win={safeWin}
                  fetchFiles={fetchFiles}
                  theme={theme}
                  isMobile={isMobile}
                  openFileWindow={openFileWindow}
                  handleContextMenu={handleContextMenu}
                  handleItemClick={handleItemClick}
                  selectedItems={safeSelectedItems}
                  inlineEdit={inlineEdit}
                  handleInlineSubmit={handleInlineSubmit}
                  setInlineEdit={setInlineEdit}
                  handleDragOver={handleDragOver || noop}
                  handleDrop={handleDrop || noop}
                  dragOverTarget={dragOverTarget}
                  handleDragStart={handleDragStart || noop}
                  handleDragLeave={handleDragLeave || noop}
                />
              </Box>
            </>
          )}

          {isFile && (
            <Box sx={{ flex: 1, overflow: 'hidden', bgcolor: 'background.paper' }}>
              <FileViewer
                win={safeWin}
                toggleEditMode={toggleEditMode || noop}
                handleContentChange={handleContentChange || noop}
                saveFile={saveFile || noop}
              />
            </Box>
          )}
        </Box>
      </Paper>
    </Rnd>
  );
};

export default NASWindow;
