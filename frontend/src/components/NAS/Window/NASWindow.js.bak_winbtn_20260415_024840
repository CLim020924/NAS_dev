import React from 'react';
import { Box, Paper, Typography, IconButton } from '@mui/material';
import { Rnd } from 'react-rnd';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import SidebarTree from './SidebarTree';
import FolderView from './FolderView';

const NASWindow = ({ win, theme, isMobile, fetchFiles, closeWindow, toggleSidebar, focusWindow, focusedContext }) => {
  const isActive = focusedContext === win.id;
  return (
    <Rnd size={{ width: win.width, height: win.height }} position={{ x: win.x, y: win.y }} onMouseDown={() => focusWindow(win.id)} dragHandleClassName="window-header" bounds="parent">
      <Paper elevation={isActive ? 10 : 2} sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', border: isActive ? `2px solid ${theme.palette.primary.main}` : '1px solid #ddd' }}>
        <Box className="window-header" sx={{ p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#f5f5f5', borderBottom: '1px solid #ddd' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <IconButton size="small" onClick={() => toggleSidebar(win.id)}><MenuIcon fontSize="small" /></IconButton>
            <Typography variant="body2" sx={{ ml: 1, fontWeight: 800 }}>{win.currentPath}</Typography>
          </Box>
          <IconButton size="small" onClick={() => closeWindow(win.id)} color="error"><CloseIcon fontSize="small" /></IconButton>
        </Box>
        <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <Box sx={{ width: 220, borderRight: '1px solid #ddd', display: 'flex', flexDirection: 'column', bgcolor: '#fafafa' }}>
            <SidebarTree win={win} fetchFiles={fetchFiles} />
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', bgcolor: '#fff' }}>
            <FolderView win={win} fetchFiles={fetchFiles} theme={theme} isMobile={isMobile} />
          </Box>
        </Box>
      </Paper>
    </Rnd>
  );
};
export default NASWindow;
