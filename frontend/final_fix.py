import os

# 파일 경로 정의
sidebar_path = 'src/components/NAS/Window/SidebarTree.js'
window_path = 'src/components/NAS/Window/NASWindow.js'

# SidebarTree.js 내용
sidebar_code = """import React, { useState, useEffect, useRef } from 'react';
import { Box, List, ListItem, ListItemIcon, ListItemText, Collapse, CircularProgress, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import StorageIcon from '@mui/icons-material/Storage';
import axios from 'axios';

const ensureSlash = (p) => p.startsWith('/') ? p : '/' + p;

const TreeNode = ({ itemPath, itemName, isFolder, level, currentPath, fetchFiles, winId, openFileWindow, theme }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const itemRef = useRef(null);

  const safeItemPath = ensureSlash(itemPath);
  const safeCurrentPath = ensureSlash(currentPath);
  const isSelected = safeCurrentPath === safeItemPath;
  const isAncestor = safeItemPath === '/' ? safeCurrentPath !== '/' : safeCurrentPath.startsWith(safeItemPath + '/');

  useEffect(() => { if (isAncestor && !expanded) setExpanded(true); }, [isAncestor, expanded]);
  useEffect(() => { if (isSelected && itemRef.current) itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [isSelected]);

  useEffect(() => {
    if (expanded && isFolder && !loaded) {
      let isMounted = true; setLoading(true);
      axios.get('/api/files?path=' + encodeURIComponent(safeItemPath) + '&t=' + Date.now(), { withCredentials: true })
        .then(res => {
          if (isMounted) {
            const sorted = (res.data || []).sort((a, b) => (a.type === 'folder' && b.type !== 'folder' ? -1 : 1));
            setChildren(sorted); setLoaded(true); setLoading(false);
          }
        }).catch(e => { if (isMounted) setLoading(false); });
      return () => { isMounted = false; };
    }
  }, [expanded, isFolder, loaded, safeItemPath]);

  return (
    <Box>
      <ListItem ref={itemRef} button onClick={(e) => { e.stopPropagation(); if(isFolder){ setExpanded(true); fetchFiles(winId, safeItemPath); } else { openFileWindow({ name: itemName, fullPath: safeItemPath, type: 'file' }, false); } }}
        sx={{ pl: level * 1.5 + 1, pr: 1, py: 0.3, minHeight: 30, backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.15) : 'transparent', borderLeft: isSelected ? '4px solid ' + theme.palette.primary.main : '4px solid transparent' }}>
        <Box onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} sx={{ display: 'flex', alignItems: 'center', width: 20, flexShrink: 0 }}>
          {isFolder ? (loading ? <CircularProgress size={10} /> : (expanded ? <KeyboardArrowDownIcon fontSize='small' /> : <KeyboardArrowRightIcon fontSize='small' />)) : null}
        </Box>
        <ListItemIcon sx={{ minWidth: 24, color: isFolder ? '#fbbf24' : theme.palette.text.secondary }}>
          {isFolder ? <FolderIcon sx={{ fontSize: 18 }} /> : <InsertDriveFileIcon sx={{ fontSize: 18 }} />}
        </ListItemIcon>
        <ListItemText primary={itemName} primaryTypographyProps={{ sx: { fontSize: '0.85rem', fontWeight: isSelected ? 800 : 500, whiteSpace: 'nowrap', color: isSelected ? theme.palette.primary.main : 'inherit' } }} />
      </ListItem>
      <Collapse in={expanded} timeout='auto' unmountOnExit>
        {children.map(c => <TreeNode key={c.fullPath} itemPath={c.fullPath} itemName={c.name} isFolder={c.type==='folder'} level={level + 1} currentPath={currentPath} fetchFiles={fetchFiles} winId={winId} openFileWindow={openFileWindow} theme={theme} />)}
      </Collapse>
    </Box>
  );
};

const SidebarTree = (props) => {
  return (
    <Box sx={{ width: '100%', height: '100%', overflow: 'auto', bgcolor: 'background.default' }}>
      <List sx={{ p: 0, minWidth: 'max-content' }}>
        <TreeNode itemPath={props.win.basePath} itemName={props.win.name} isFolder={true} level={0} currentPath={props.win.currentPath} fetchFiles={props.fetchFiles} winId={props.win.id} openFileWindow={props.openFileWindow} theme={props.theme} />
      </List>
    </Box>
  );
};
export default SidebarTree;
"""

# NASWindow.js 내용
window_code = """import React, { useEffect } from 'react';
import { Box, IconButton, Paper, Typography, List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
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
import StorageIcon from '@mui/icons-material/Storage';
import { getRelativeSegments } from '../../../utils/pathUtils';
import FolderView from './FolderView';
import FileEditor from './FileEditor';
import SidebarTree from './SidebarTree';

const NASWindow = ({ win, isMobile, theme, focusedContext, focusWindow, setOpenWindows, toggleSidebar, handleUp, fetchFiles, toggleMinimize, toggleMaximize, closeWindow, handleDragOver, handleDrop, handleContextMenu, setSelectedItems, inlineEdit, selectedItems, dragOverTarget, handleDragStart, handleDragLeave, handleItemClick, openFileWindow, handleInlineSubmit, setInlineEdit, InlineInput, toggleEditMode, saveFile, handleContentChange }) => {
  if (win.isMinimized) return null;
  const winStyles = isMobile ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } : { width: win.isMaximized ? '100%' : win.width, height: win.isMaximized ? '100%' : win.height, x: win.isMaximized ? 0 : win.x, y: win.isMaximized ? 0 : win.y };
  const isActive = focusedContext === win.id;

  useEffect(() => {
    if (isMobile && !win.isMinimized) {
      document.body.style.overflow = 'hidden';
      let meta = document.querySelector('meta[name="viewport"]');
      if (meta) { window.__oldMeta = meta.content; meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'; }
      return () => { document.body.style.overflow = ''; if (meta && window.__oldMeta) meta.content = window.__oldMeta; };
    }
  }, [isMobile, win.isMinimized]);

  return (
    <Rnd key={win.id} style={{ zIndex: win.zIndex, position: isMobile ? 'fixed' : 'absolute' }} disableDragging={isMobile || win.isMaximized} enableResizing={!isMobile && !win.isMaximized} size={isMobile ? { width: '100%', height: '100%' } : { width: winStyles.width, height: winStyles.height }} position={isMobile ? { x: 0, y: 0 } : { x: winStyles.x, y: winStyles.y }} onMouseDown={() => focusWindow(win.id)} dragHandleClassName='window-header-drag-handle' bounds='parent'>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ height: '100%', width: '100%' }}>
        <Paper elevation={isActive ? 24 : 8} sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: (isMobile || win.isMaximized) ? 0 : 2, overflow: 'hidden', background: theme.palette.background.paper, border: isActive ? '3px solid ' + theme.palette.primary.main : '1px solid ' + theme.palette.divider }}>
          <Box className='window-header-drag-handle' sx={{ p: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, background: isActive ? alpha(theme.palette.primary.main, 0.08) : 'transparent' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {win.winType === 'folder' ? (
                <>
                  <IconButton size='small' onClick={() => toggleSidebar(win.id)}><MenuIcon /></IconButton>
                  <IconButton size='small' onClick={() => handleUp(win)} disabled={win.currentPath === win.basePath}><ArrowBackIcon /></IconButton>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: 800 }}>{win.name}</Typography>
                    {getRelativeSegments(win.currentPath, win.basePath).map((s, i, a) => <Typography key={i} sx={{ ml: 0.5 }}> / {s}</Typography>)}
                  </Box>
                </>
              ) : <><InsertDriveFileIcon /><Typography sx={{ fontWeight: 800 }}>{win.name}</Typography></>}
            </Box>
            <Box sx={{ display: 'flex' }}>
              {!isMobile && <IconButton size='small' onClick={() => toggleMinimize(win.id)}><RemoveIcon fontSize='small' /></IconButton>}
              {!isMobile && <IconButton size='small' onClick={() => toggleMaximize(win.id)}>{win.isMaximized ? <FilterNoneIcon fontSize='small' /> : <CropSquareIcon fontSize='small' />}</IconButton>}
              <IconButton size='small' onClick={() => closeWindow(win.id)} color="error"><CloseIcon fontSize="small" /></IconButton>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {win.winType === 'folder' && (
              <>
                <AnimatePresence>
                  {win.sidebarOpen && !isMobile && (
                    <motion.div initial={{ width: 0 }} animate={{ width: 250 }} exit={{ width: 0 }} style={{ height: '100%', borderRight: '1px solid ' + theme.palette.divider, zIndex: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                      <Box sx={{ p: 1, borderBottom: '1px solid ' + theme.palette.divider, display: 'flex', alignItems: 'center', gap: 1 }}>
                         <StorageIcon fontSize="small" color="primary" />
                         <Typography variant='caption' color='primary' sx={{ fontWeight: 800 }}>DIRECTORY TREE</Typography>
                      </Box>
                      <SidebarTree win={win} fetchFiles={fetchFiles} openFileWindow={openFileWindow} theme={theme} />
                    </motion.div>
                  )}
                </AnimatePresence>
                <FolderView win={win} theme={theme} isMobile={isMobile} fetchFiles={fetchFiles} handleDragOver={handleDragOver} handleDrop={handleDrop} handleContextMenu={handleContextMenu} setSelectedItems={setSelectedItems} inlineEdit={inlineEdit} selectedItems={selectedItems} dragOverTarget={dragOverTarget} handleDragStart={handleDragStart} handleDragLeave={handleDragLeave} handleItemClick={handleItemClick} openFileWindow={openFileWindow} handleInlineSubmit={handleInlineSubmit} setInlineEdit={setInlineEdit} InlineInput={InlineInput} />
              </>
            )}
            {win.winType === 'file' && <FileEditor win={win} theme={theme} toggleEditMode={toggleEditMode} saveFile={saveFile} handleContentChange={handleContentChange} />}
          </Box>
        </Paper>
      </motion.div>
    </Rnd>
  );
};
export default NASWindow;
"""

with open(sidebar_path, 'w', encoding='utf-8') as f: f.write(sidebar_code)
with open(window_path, 'w', encoding='utf-8') as f: f.write(window_code)
print("SUCCESS: Files have been written successfully.")
