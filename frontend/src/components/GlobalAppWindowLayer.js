import React from 'react';
import { Alert, Box, Button, CircularProgress, IconButton, Paper, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import RemoveIcon from '@mui/icons-material/Remove';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { AnimatePresence, motion } from 'framer-motion';
import { Rnd } from 'react-rnd';
import { useWindows } from '../contexts/WindowContext';
import MeetingApp from './MeetingApp';
import DocumentStudio from './DocumentStudio/DocumentStudio';
import DocumentWorkspace from './DocumentWorkspace/DocumentWorkspace';
import { getAppWindowLayerZIndex } from './windowLayerPolicy';

const NoteStudio = React.lazy(() => import('./NoteStudio/NoteStudio'));

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
  const compactWindow = useMediaQuery('(max-width:700px), (max-height:560px)');
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
      return <MeetingApp inWindow initialRoomCode={win.payload?.roomCode} autoJoin={!!win.payload?.autoJoin} conversationId={win.payload?.conversationId || null} />;
    }
    if (win.appId === 'document-studio') {
      return <DocumentStudio />;
    }
    if (win.appId === 'document-workspace') {
      return <DocumentWorkspace />;
    }
    if (win.appId === 'note-studio') {
      return <React.Suspense fallback={<Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}><CircularProgress size={30} /></Box>}><NoteStudio /></React.Suspense>;
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
    <Box sx={{ position: 'absolute', inset: 0, zIndex: getAppWindowLayerZIndex(openWindows, focusedContext), pointerEvents: 'none' }}>
      <AnimatePresence>
        {appWindows.map((win) => {
          const isActive = focusedContext === win.id;
          const compactAppChrome = win.appId === 'note-studio';
          return (
            <Rnd
              key={win.id}
              style={{
                display: win.isMinimized ? 'none' : 'block',
                zIndex: win.zIndex,
                position: 'absolute',
                pointerEvents: 'auto'
              }}
              minHeight={compactWindow ? 280 : 320}
              bounds="parent"
              minWidth={compactWindow ? 280 : 420}
              size={{
                width: win.isMaximized ? '100%' : (compactWindow ? 'calc(100% - 16px)' : win.width),
                height: win.isMaximized ? '100%' : (compactWindow ? 'calc(100% - 16px)' : win.height)
              }}
              position={{ x: win.isMaximized ? 0 : (compactWindow ? 8 : win.x), y: win.isMaximized ? 0 : (compactWindow ? 8 : win.y) }}
              disableDragging={win.isMaximized || compactWindow}
              enableResizing={!win.isMaximized && !compactWindow}
              dragHandleClassName="platform-window-header"
              onMouseDown={() => focusWindow(win.id)}
              onDragStop={(e, d) => setOpenWindows((prev) => prev.map((w) => w.id === win.id ? { ...w, x: d.x, y: d.y } : w))}
              onResizeStop={(e, direction, ref, delta, position) => setOpenWindows((prev) => prev.map((w) => w.id === win.id ? { ...w, width: ref.style.width, height: ref.style.height, x: position.x, y: position.y } : w))}
            >
              <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} style={{ height: '100%', width: '100%' }}>
                <Paper elevation={0} sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: win.isMaximized ? 0 : 1.5, border: `1px solid ${isActive ? alpha(theme.palette.primary.main, 0.62) : theme.palette.divider}`, boxShadow: `0 12px 34px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.38 : 0.12)}` }}>
                  <Box className="platform-window-header" data-compact-app-chrome={compactAppChrome ? 'true' : undefined} sx={{ height: compactAppChrome ? 30 : 46, px: compactAppChrome ? 0.5 : 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.palette.divider}`, cursor: win.isMaximized ? 'default' : 'move', bgcolor: isActive ? alpha(theme.palette.primary.main, compactAppChrome ? 0.035 : 0.07) : 'background.paper', flexShrink: 0 }}>
                    {compactAppChrome ? <Box aria-hidden="true" sx={{ flex: 1, height: '100%' }} /> : <Typography sx={{ fontWeight: 900 }}>{win.name}</Typography>}
                    <Box onMouseDown={(e) => e.stopPropagation()}>
                      <IconButton size="small" aria-label="최소화" onClick={() => toggleMinimize(win.id)} sx={compactAppChrome ? { width: 28, height: 28 } : undefined}><RemoveIcon fontSize="small" /></IconButton>
                      <IconButton size="small" aria-label="최대화" onClick={() => toggleMaximize(win.id)} sx={compactAppChrome ? { width: 28, height: 28 } : undefined}><CropSquareIcon fontSize="small" /></IconButton>
                      <IconButton size="small" aria-label="닫기" color="error" onClick={() => handleClose(win)} sx={compactAppChrome ? { width: 28, height: 28 } : undefined}><CloseIcon fontSize="small" /></IconButton>
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
