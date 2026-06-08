import React, { useState, useRef, useEffect } from 'react';
import { Box, Button, TextField, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';

const FileEditor = ({ win, theme, toggleEditMode, saveFile, handleContentChange }) => {
  // 🔥 [핵심 4] 일반 텍스트 에디터에도 두 손가락 줌(Pinch-to-zoom) 기능 추가!
  const [scale, setScale] = useState(1);
  const containerRef = useRef(null);
  const scaleRef = useRef(1);
  
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  useEffect(() => {
    const container = containerRef.current; if (!container) return;
    let initDist = null, initScale = 1;
    const getDist = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (e) => { if (e.touches.length === 2) { e.preventDefault(); initDist = getDist(e.touches); initScale = scaleRef.current; } };
    const onTouchMove = (e) => { if (e.touches.length === 2 && initDist) { e.preventDefault(); setScale(Math.min(Math.max(0.5, initScale * (getDist(e.touches) / initDist)), 5)); } };
    const onTouchEnd = () => { initDist = null; };
    container.addEventListener('touchstart', onTouchStart, { passive: false });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd);
    return () => { container.removeEventListener('touchstart', onTouchStart); container.removeEventListener('touchmove', onTouchMove); container.removeEventListener('touchend', onTouchEnd); };
  }, []);

  return (
    <Box ref={containerRef} sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2, overflow: 'auto', backgroundColor: theme.palette.mode === 'dark' ? '#0f172a' : '#ffffff' }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        {win.mode === 'view' ? (
          <Button variant="contained" size="small" startIcon={<EditIcon />} onClick={() => toggleEditMode(win.id)}>편집 모드</Button>
        ) : (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" size="small" startIcon={<VisibilityIcon />} onClick={() => toggleEditMode(win.id)}>보기 모드</Button>
            <Button variant="contained" size="small" color="success" startIcon={<SaveIcon />} onClick={() => saveFile(win)}>저장</Button>
          </Box>
        )}
      </Box>

      {win.mode === 'view' ? (
        <Typography
          component="pre"
          sx={{
            flex: 1,
            margin: 0,
            p: 2,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
            overflow: 'auto',
            backgroundColor: theme.palette.mode === 'dark' ? '#1e293b' : '#f8fafc',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            fontFamily: 'monospace',
            fontSize: `${scale}rem`, // 두 손가락 줌에 따라 글씨가 커짐!
            transition: 'font-size 0.1s ease-out'
          }}
        >
          {win.content}
        </Typography>
      ) : (
        <TextField
          multiline
          fullWidth
          variant="outlined"
          value={win.content}
          onChange={(e) => handleContentChange(win.id, e.target.value)}
          sx={{ flex: 1, '& .MuiInputBase-root': { height: '100%', alignItems: 'flex-start', fontFamily: 'monospace', fontSize: `${scale}rem`, transition: 'font-size 0.1s ease-out' } }}
        />
      )}
    </Box>
  );
};

export default FileEditor;
