import os

def safe_write(filepath, content):
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    if os.path.exists(filepath) and os.path.getsize(filepath) > 100:
        print(f"SUCCESS: {filepath} written ({os.path.getsize(filepath)} bytes)")
    else:
        print(f"FAILED: {filepath} is empty or too small!")

sidebar_content = """import React, { useState, useEffect, useRef } from 'react';
import { Box, List, ListItem, ListItemIcon, ListItemText, Collapse, CircularProgress, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import axios from 'axios';

const TreeNode = ({ itemPath, itemName, isFolder, level, currentPath, fetchFiles, winId, openFileWindow, theme }) => {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(false);
  const itemRef = useRef(null);
  const isSelected = currentPath === itemPath;
  const isAncestor = itemPath === '/' ? (currentPath !== '/') : currentPath.startsWith(itemPath + '/');

  useEffect(() => { if (isAncestor && !expanded) setExpanded(true); }, [isAncestor, expanded]);
  useEffect(() => { if (isSelected && itemRef.current) itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [isSelected]);

  useEffect(() => {
    if (expanded && isFolder && children.length === 0) {
      setLoading(true);
      axios.get(`/api/files?path=${encodeURIComponent(itemPath)}&t=${Date.now()}`, { withCredentials: true })
        .then(res => {
          setChildren((res.data || []).sort((a,b) => a.type === 'folder' ? -1 : 1));
          setLoading(false);
        }).catch(() => setLoading(false));
    }
  }, [expanded, isFolder, itemPath]);

  return (
    <Box>
      <ListItem ref={itemRef} button onClick={() => isFolder ? (setExpanded(true), fetchFiles(winId, itemPath)) : openFileWindow({ name: itemName, fullPath: itemPath, type: 'file' }, false)}
        sx={{ pl: level * 2 + 1, py: 0.3, backgroundColor: isSelected ? alpha(theme.palette.primary.main, 0.15) : 'transparent' }}>
        <Box onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }} sx={{ width: 20, display: 'flex' }}>
          {isFolder ? (loading ? <CircularProgress size={10} /> : (expanded ? <KeyboardArrowDownIcon fontSize="small" /> : <KeyboardArrowRightIcon fontSize="small" />)) : null}
        </Box>
        <ListItemIcon sx={{ minWidth: 24, color: isFolder ? '#fbbf24' : 'text.secondary' }}>
          {isFolder ? <FolderIcon sx={{ fontSize: 18 }} /> : <InsertDriveFileIcon sx={{ fontSize: 18 }} />}
        </ListItemIcon>
        <ListItemText primary={itemName} primaryTypographyProps={{ sx: { fontSize: '0.85rem', fontWeight: isSelected ? 800 : 500, whiteSpace: 'nowrap' } }} />
      </ListItem>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        {children.map(c => <TreeNode key={c.fullPath} itemPath={c.fullPath} itemName={c.name} isFolder={c.type==='folder'} level={level+1} currentPath={currentPath} fetchFiles={fetchFiles} winId={winId} openFileWindow={openFileWindow} theme={theme} />)}
      </Collapse>
    </Box>
  );
};

const SidebarTree = ({ win, fetchFiles, openFileWindow, theme }) => (
  <Box sx={{ width: '100%', height: '100%', overflow: 'auto' }}>
    <List sx={{ p: 0 }}><TreeNode itemPath={win.basePath} itemName={win.name} isFolder={true} level={0} currentPath={win.currentPath} fetchFiles={fetchFiles} winId={win.id} openFileWindow={openFileWindow} theme={theme} /></List>
  </Box>
);
export default SidebarTree;
"""

nas_window_content = """import React from 'react';
import { Box, IconButton, Paper, Typography, List, ListItem, ListItemIcon, ListItemText } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { motion, AnimatePresence } from 'framer-motion';
import { Rnd } from 'react-rnd';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import StorageIcon from '@mui/icons-material/Storage';
import FolderView from './FolderView';
import SidebarTree from './SidebarTree';

const NASWindow = ({ win, isMobile, theme, focusedContext, focusWindow, toggleSidebar, handleUp, fetchFiles, closeWindow, handleDragOver, handleDrop, handleContextMenu, setSelectedItems, inlineEdit, selectedItems, dragOverTarget, handleDragStart, handleDragLeave, handleItemClick, openFileWindow, handleInlineSubmit, setInlineEdit, InlineInput }) => {
  if (win.isMinimized) return null;
  const isActive = focusedContext === win.id;
  return (
    <Rnd key={win.id} style={{ zIndex: win.zIndex, position: isMobile ? 'fixed' : 'absolute' }} disableDragging={isMobile || win.isMaximized} size={{ width: win.width, height: win.height }} position={{ x: win.x, y: win.y }} onMouseDown={() => focusWindow(win.id)} dragHandleClassName="window-header-drag-handle" bounds="parent">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ height: '100%', width: '100%' }}>
        <Paper elevation={isActive ? 24 : 8} sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden', border: isActive ? `3px solid ${theme.palette.primary.main}` : `1px solid ${theme.palette.divider}` }}>
          <Box className="window-header-drag-handle" sx={{ p: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: isActive ? alpha(theme.palette.primary.main, 0.08) : 'transparent' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <IconButton size="small" onClick={() => toggleSidebar(win.id)}><MenuIcon /></IconButton>
              <IconButton size="small" onClick={() => handleUp(win)}><ArrowBackIcon /></IconButton>
              <Typography sx={{ fontWeight: 800 }}>{win.currentPath}</Typography>
            </Box>
            <IconButton size="small" onClick={() => closeWindow(win.id)} color="error"><CloseIcon fontSize="small" /></IconButton>
          </Box>
          <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <AnimatePresence>
              {win.sidebarOpen && !isMobile && (
                <motion.div initial={{ width: 0 }} animate={{ width: 250 }} exit={{ width: 0 }} style={{ height: '100%', borderRight: `1px solid ${theme.palette.divider}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <Box sx={{ p: 1, borderBottom: `1px solid ${theme.palette.divider}` }}>
                    <Typography variant="caption" color="primary" sx={{ fontWeight: 800 }}>DIRECTORY TREE</Typography>
                  </Box>
                  <SidebarTree win={win} fetchFiles={fetchFiles} openFileWindow={openFileWindow} theme={theme} />
                </motion.div>
              )}
            </AnimatePresence>
            <FolderView win={win} theme={theme} isMobile={isMobile} fetchFiles={fetchFiles} handleDragOver={handleDragOver} handleDrop={handleDrop} handleContextMenu={handleContextMenu} setSelectedItems={setSelectedItems} inlineEdit={inlineEdit} selectedItems={selectedItems} dragOverTarget={dragOverTarget} handleDragStart={handleDragStart} handleDragLeave={handleDragLeave} handleItemClick={handleItemClick} openFileWindow={openFileWindow} handleInlineSubmit={handleInlineSubmit} setInlineEdit={setInlineEdit} InlineInput={InlineInput} />
          </Box>
        </Paper>
      </motion.div>
    </Rnd>
  );
};
export default NASWindow;
"""

safe_write('src/components/NAS/Window/SidebarTree.js', sidebar_content)
safe_write('src/components/NAS/Window/NASWindow.js', nas_window_content)
