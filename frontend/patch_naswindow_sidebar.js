const fs = require('fs');
const path = './src/components/NAS/Window/NASWindow.js';

const newCode = `import React, { useEffect } from 'react';
import { Box, IconButton, Paper, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { motion, AnimatePresence } from 'framer-motion';
import { Rnd } from 'react-rnd';
import MenuIcon from '@mui/icons-material/Menu';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RemoveIcon from '@mui/icons-material/Remove';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import FilterNoneIcon from '@mui/icons-material/FilterNone';
import { getRelativeSegments } from '../../../utils/pathUtils';
import FolderView from './FolderView';
import FileEditor from './FileEditor';

// 🔥 [사이드바 트리 뷰] 우리가 만든 새로운 컴포넌트 임포트!
import SidebarTree from './SidebarTree';

const NASWindow = ({
  win,
  isMobile,
  theme,
  focusedContext,
  focusWindow,
  setOpenWindows,
  toggleSidebar,
  handleUp,
  fetchFiles,
  toggleMinimize,
  toggleMaximize,
  closeWindow,
  handleDragOver,
  handleDrop,
  handleContextMenu,
  setSelectedItems,
  inlineEdit,
  selectedItems,
  dragOverTarget,
  handleDragStart,
  handleDragLeave,
  handleItemClick,
  openFileWindow,
  handleInlineSubmit,
  setInlineEdit,
  InlineInput,
  toggleEditMode,
  saveFile,
  handleContentChange,
}) => {
  if (win.isMinimized) return null;

  const winStyles = isMobile
    ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }
    : {
        width: win.isMaximized ? '100%' : win.width,
        height: win.isMaximized ? '100%' : win.height,
        x: win.isMaximized ? 0 : win.x,
        y: win.isMaximized ? 0 : win.y
      };

  const isActive = focusedContext === win.id;

  // 🔥 [모바일 UX 최적화] 창이 열려있으면 바탕화면이 스크롤되지 않도록 꽉 잠급니다!
  useEffect(() => {
    if (isMobile && !win.isMinimized) {
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'none';
      let meta = document.querySelector('meta[name="viewport"]');
      if (meta) { window.__oldMeta = meta.content; meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'; }
      return () => {
        document.body.style.overflow = '';
        document.body.style.overscrollBehavior = '';
        let meta = document.querySelector('meta[name="viewport"]');
        if (meta && window.__oldMeta) { meta.content = window.__oldMeta; }
      };
    }
  }, [isMobile, win.isMinimized]);


  return (
    <Rnd
      key={win.id}
      style={{ zIndex: win.zIndex, position: isMobile ? 'fixed' : 'absolute' }}
      disableDragging={isMobile || win.isMaximized}
      enableResizing={!isMobile && !win.isMaximized}
      minWidth={300}
      minHeight={350}
      size={isMobile ? { width: '100%', height: '100%' } : { width: winStyles.width, height: winStyles.height }}
      position={isMobile ? { x: 0, y: 0 } : { x: winStyles.x, y: winStyles.y }}
      onMouseDown={() => focusWindow(win.id)}
      onDragStop={(e, d) => setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, x: d.x, y: d.y } : w))}
      onResizeStop={(e, direction, ref, delta, position) => setOpenWindows(prev => prev.map(w => w.id === win.id ? { ...w, width: ref.style.width, height: ref.style.height, x: position.x, y: position.y } : w))}
      dragHandleClassName="window-header-drag-handle"
      bounds="parent"
    >
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} style={{ height: '100%', width: '100%' }}>
        <Paper elevation={isActive ? 24 : 8} sx={{
          height: '100%',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: (isMobile || win.isMaximized) ? 0 : 2,
          overflow: 'hidden',
          background: theme.palette.background.paper,
          color: theme.palette.text.primary,
          border: isActive ? \`3px solid \${theme.palette.primary.main}\` : \`1px solid \${theme.palette.divider}\`,
          boxShadow: isActive ? \`0 0 25px \${alpha(theme.palette.primary.main, 0.4)}\` : theme.shadows[10],
          transition: 'border 0.2s ease, box-shadow 0.2s ease'
        }}>
          <Box className="window-header-drag-handle" sx={{
            p: 1,
            background: isActive ? alpha(theme.palette.primary.main, 0.08) : theme.palette.background.default,
            borderBottom: \`1px solid \${theme.palette.divider}\`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
            cursor: win.isMaximized ? 'default' : 'move'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
              {win.winType === 'folder' ? (
                <>
                  <IconButton size="small" onClick={() => toggleSidebar(win.id)} color={isActive ? 'primary' : 'inherit'} onMouseDown={(e) => e.stopPropagation()}>
                    <MenuIcon />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleUp(win)} disabled={win.currentPath === win.basePath} color="inherit" onMouseDown={(e) => e.stopPropagation()}>
                    <ArrowBackIcon />
                  </IconButton>
                  <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto', ml: 1 }} onMouseDown={(e) => e.stopPropagation()}>
                    <Typography onClick={() => { fetchFiles(win.id, win.basePath); }} sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' }, fontWeight: 800, whiteSpace: 'nowrap' }}>
                      {win.name}
                    </Typography>
                    {getRelativeSegments(win.currentPath, win.basePath).map((segment, idx, arr) => {
                      const b = win.basePath === '/' ? '' : win.basePath.replace(/\\/$/, '');
                      const absoluteToHere = b + '/' + arr.slice(0, idx + 1).join('/');

                      return (
                        <React.Fragment key={idx}>
                          <Typography sx={{ mx: 0.5, color: 'text.secondary' }}>/</Typography>
                          <Typography onClick={() => { fetchFiles(win.id, absoluteToHere); }} sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' }, fontWeight: 800, whiteSpace: 'nowrap' }}>
                            {segment}
                          </Typography>
                        </React.Fragment>
                      );
                    })}
                  </Box>
                </>
              ) : (
                <>
                  <InsertDriveFileIcon color={isActive ? 'primary' : 'inherit'} />
                  <Typography sx={{ fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {win.name}
                  </Typography>
                </>
              )}
            </Box>

            <Box sx={{ display: 'flex', flexShrink: 0 }} onMouseDown={(e) => e.stopPropagation()}>
              {!isMobile && (
                <IconButton size="small" onClick={() => toggleMinimize(win.id)}>
                  <RemoveIcon fontSize="small" />
                </IconButton>
              )}

              {!isMobile && (
                <IconButton size="small" onClick={() => toggleMaximize(win.id)}>
                  {win.isMaximized ? <FilterNoneIcon fontSize="small" /> : <CropSquareIcon fontSize="small" />}
                </IconButton>
              )}

              <IconButton size="small" onClick={() => closeWindow(win.id)} color="error">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
            {win.winType === 'folder' && (
              <>
                {/* 🔥 여기에 새로운 사이드바 트리 뷰가 장착됩니다! */}
                <AnimatePresence>
                  {win.sidebarOpen && !isMobile && (
                    <motion.div initial={{ x: -250 }} animate={{ x: 0 }} exit={{ x: -250 }} transition={{ type: 'tween', duration: 0.2 }} style={{ width: 250, height: '100%', backgroundColor: theme.palette.background.default, borderRight: \`1px solid \${theme.palette.divider}\`, zIndex: 10, display: 'flex', flexDirection: 'column' }}>
                      <SidebarTree win={win} fetchFiles={fetchFiles} openFileWindow={openFileWindow} theme={theme} />
                    </motion.div>
                  )}
                </AnimatePresence>
                
                <FolderView
                  win={win}
                  theme={theme}
                  isMobile={isMobile}
                  fetchFiles={fetchFiles}
                  handleDragOver={handleDragOver}
                  handleDrop={handleDrop}
                  handleContextMenu={handleContextMenu}
                  setSelectedItems={setSelectedItems}
                  inlineEdit={inlineEdit}
                  selectedItems={selectedItems}
                  dragOverTarget={dragOverTarget}
                  handleDragStart={handleDragStart}
                  handleDragLeave={handleDragLeave}
                  handleItemClick={handleItemClick}
                  openFileWindow={openFileWindow}
                  handleInlineSubmit={handleInlineSubmit}
                  setInlineEdit={setInlineEdit}
                  InlineInput={InlineInput}
                />
              </>
            )}

            {win.winType === 'file' && (
              <FileEditor
                win={win}
                theme={theme}
                toggleEditMode={toggleEditMode}
                saveFile={saveFile}
                handleContentChange={handleContentChange}
              />
            )}
          </Box>
        </Paper>
      </motion.div>
    </Rnd>
  );
};

export default NASWindow;
`;

fs.writeFileSync(path, newCode);
console.log("✅ NASWindow.js: 사이드바 트리뷰 장착 완료!");
