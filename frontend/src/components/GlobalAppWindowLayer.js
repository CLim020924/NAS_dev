import React from 'react';
import { Alert, Box, Button, IconButton, Paper, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import RemoveIcon from '@mui/icons-material/Remove';
import { alpha, useTheme } from '@mui/material/styles';
import { AnimatePresence, motion } from 'framer-motion';
import { Rnd } from 'react-rnd';
import { useWindows } from '../contexts/WindowContext';
import MeetingApp from './MeetingApp';

class AppWindowErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App window render failed', error, info);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.windowId !== this.props.windowId && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <Box sx={{ height: '100%', p: 2, bgcolor: 'background.paper' }}>
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => this.setState({ error: null })}>다시 시도</Button>}
        >
          앱 창을 여는 중 오류가 발생했습니다. 창을 다시 열어주세요.
        </Alert>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5, wordBreak: 'break-all' }}>
          {this.state.error?.message || String(this.state.error)}
        </Typography>
      </Box>
    );
  }
}

const GlobalAppWindowLayer = () => {
  const theme = useTheme();
  const {
    openWindows,
    setOpenWindows,
    focusedContext,
    focusWindow,
    closeWindow,
    toggleMinimize,
    toggleMaximize
  } = useWindows();

  const appWindows = openWindows.filter((win) => win.winType === 'app');

  const renderAppContent = (win) => {
    if (win.appId === 'meeting') {
      return <MeetingApp initialRoomCode={win.payload?.roomCode} autoJoin={!!win.payload?.autoJoin} />;
    }
    return null;
  };

  const handleClose = (win) => {
    if (win.appId === 'meeting') {
      toggleMinimize(win.id);
      return;
    }
    closeWindow(win.id);
  };

  if (appWindows.length === 0) return null;

  return (
    <Box sx={{ position: 'absolute', inset: 0, zIndex: 80, pointerEvents: 'none' }}>
      <AnimatePresence>
        {appWindows.map((win) => {
          const isActive = focusedContext === win.id;
          return (
            <Rnd
              key={win.id}
              style={{
                display: win.isMinimized ? 'none' : 'block',
                zIndex: win.zIndex,
                position: 'absolute',
                pointerEvents: 'auto'
              }}
              minWidth={420}
              minHeight={320}
              bounds="parent"
              size={{ width: win.isMaximized ? '100%' : win.width, height: win.isMaximized ? '100%' : win.height }}
              position={{ x: win.isMaximized ? 0 : win.x, y: win.isMaximized ? 0 : win.y }}
              disableDragging={win.isMaximized}
              enableResizing={!win.isMaximized}
              dragHandleClassName="platform-window-header"
              onMouseDown={() => focusWindow(win.id)}
              onDragStop={(e, d) => setOpenWindows((prev) => prev.map((w) => w.id === win.id ? { ...w, x: d.x, y: d.y } : w))}
              onResizeStop={(e, direction, ref, delta, position) => setOpenWindows((prev) => prev.map((w) => w.id === win.id ? { ...w, width: ref.style.width, height: ref.style.height, x: position.x, y: position.y } : w))}
            >
              <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} style={{ height: '100%', width: '100%' }}>
                <Paper elevation={0} sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: win.isMaximized ? 0 : 2, border: `1px solid ${isActive ? alpha(theme.palette.primary.main, 0.62) : theme.palette.divider}`, boxShadow: `0 24px 70px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.46 : 0.16)}` }}>
                  <Box className="platform-window-header" sx={{ height: 46, px: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.palette.divider}`, cursor: win.isMaximized ? 'default' : 'move', bgcolor: isActive ? alpha(theme.palette.primary.main, 0.07) : 'background.paper' }}>
                    <Typography sx={{ fontWeight: 900 }}>{win.name}</Typography>
                    <Box onMouseDown={(e) => e.stopPropagation()}>
                      <IconButton size="small" onClick={() => toggleMinimize(win.id)}><RemoveIcon fontSize="small" /></IconButton>
                      <IconButton size="small" onClick={() => toggleMaximize(win.id)}><CropSquareIcon fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => handleClose(win)}><CloseIcon fontSize="small" /></IconButton>
                    </Box>
                  </Box>
                  <Box sx={{ flex: 1, minHeight: 0 }}>
                    <AppWindowErrorBoundary windowId={win.id}>
                      {renderAppContent(win)}
                    </AppWindowErrorBoundary>
                  </Box>
                </Paper>
              </motion.div>
            </Rnd>
          );
        })}
      </AnimatePresence>
    </Box>
  );
};

export default GlobalAppWindowLayer;
