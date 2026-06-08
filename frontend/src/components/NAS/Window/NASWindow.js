import React from 'react';
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

  const safeWin = {
    ...win,
    files: Array.isArray(win.files) ? win.files : [],
  };

  const safeSelectedItems = Array.isArray(selectedItems) ? selectedItems : [];

  const rndSize = fillsParent
    ? { width: '100%', height: '100%' }
    : { width: safeWin.width, height: safeWin.height };

  const rndPosition = fillsParent
    ? { x: 0, y: 0 }
    : { x: safeWin.x, y: safeWin.y };

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
        elevation={isActive ? 10 : 2}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          border: isActive ? `2px solid ${theme.palette.primary.main}` : `1px solid ${theme.palette.divider}`,
          borderRadius: safeWin.isImmersive ? 0 : 2,
          bgcolor: 'background.paper',
        }}
      >
        <Box
          className="window-header"
          sx={{
            p: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            bgcolor: theme.palette.mode === 'dark' ? '#111827' : '#f8fafc',
            borderBottom: `1px solid ${theme.palette.divider}`,
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
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleMaximize?.(safeWin.id); }} title="최대화">
              <CropSquareIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleFullscreen?.(safeWin.id); }} title="풀스크린">
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
