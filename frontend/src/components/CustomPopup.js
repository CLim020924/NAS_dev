import React, { useState, useRef } from 'react';
import { Rnd } from 'react-rnd';
import { Paper, Box, Typography, IconButton, Fade } from '@mui/material';
import MinimizeIcon from '@mui/icons-material/Minimize';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import CloseIcon from '@mui/icons-material/Close';
import FileViewer from './FileViewer';

function CustomPopup({ fileName, fileUrl, open, onClose, onMinimize, popupStyle = {} }) {
  const fadeNodeRef = useRef(null);

  // 초기 크기 및 위치 (일반 모드)
  const initialWidth = 600;
  const initialHeight = 300;
  const initialX = window.innerWidth / 2 - initialWidth / 2;
  const initialY = window.innerHeight * 0.1;

  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const [isFullScreen, setIsFullScreen] = useState(false);

  const handleToggleFullscreen = () => {
    if (!isFullScreen) {
      setPosition({ x: 0, y: 0 });
      setSize({ width: window.innerWidth, height: window.innerHeight });
    } else {
      setPosition({ x: initialX, y: initialY });
      setSize({ width: initialWidth, height: initialHeight });
    }
    setIsFullScreen(prev => !prev);
  };

  const onDragStop = (e, d) => {
    setPosition({ x: d.x, y: d.y });
  };

  const onResizeStop = (e, direction, ref, delta, position) => {
    setSize({ width: ref.offsetWidth, height: ref.offsetHeight });
    setPosition(position);
  };

  if (!open) return null;

  return (
    <Fade in={open} timeout={300} nodeRef={fadeNodeRef}>
      <div ref={fadeNodeRef}>
        <Rnd
          size={{ width: size.width, height: size.height }}
          position={{ x: position.x, y: position.y }}
          onDragStop={onDragStop}
          onResizeStop={onResizeStop}
          dragHandleClassName="draggable-handle"
          enableResizing={!isFullScreen}
          style={{
            position: 'fixed',
            transition: 'none',
            ...popupStyle,
          }}
        >
          <Paper
            elevation={24}
            sx={{
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* 상단바 (드래그 가능한 영역) */}
            <Box
              className="draggable-handle"
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'primary.main',
                color: 'white',
                p: 1,
                position: 'relative',
                cursor: 'move'
              }}
            >
              <Typography variant="subtitle1" sx={{ flexGrow: 1, textAlign: 'center' }}>
                {fileName}
              </Typography>
              <Box sx={{ position: 'absolute', right: 8, display: 'flex', gap: 1 }}>
                <IconButton onClick={onMinimize} size="small" sx={{ color: 'white' }}>
                  <MinimizeIcon fontSize="inherit" />
                </IconButton>
                <IconButton onClick={handleToggleFullscreen} size="small" sx={{ color: 'white' }}>
                  {isFullScreen ? (
                    <FullscreenExitIcon fontSize="inherit" />
                  ) : (
                    <FullscreenIcon fontSize="inherit" />
                  )}
                </IconButton>
                <IconButton onClick={onClose} size="small" sx={{ color: 'white' }}>
                  <CloseIcon fontSize="inherit" />
                </IconButton>
              </Box>
            </Box>
            {/* 콘텐츠 영역: FileViewer를 사용하여 파일 내용을 표시 */}
            <Box
              sx={{
                flexGrow: 1,
                overflow: 'auto',
                p: 1,
                borderTop: '1px solid',
                borderColor: 'divider'
              }}
            >
              <FileViewer fileUrl={fileUrl} fileName={fileName} />
            </Box>
          </Paper>
        </Rnd>
      </div>
    </Fade>
  );
}

export default CustomPopup;
