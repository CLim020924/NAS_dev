const fs = require('fs');
const path = './src/components/NAS/FileViewer.js';

const newCode = `import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Typography, Button, useTheme, CircularProgress, useMediaQuery } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import axios from 'axios';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DocumentEditor } from "@onlyoffice/document-editor-react";

const FileViewer = ({ win, toggleEditMode, handleContentChange, saveFile }) => {
  const theme = useTheme();
  // 🔥 [핵심 1] 모바일 환경 감지
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  const [scale, setScale] = useState(1);
  const [isHovered, setIsHovered] = useState(false);
  const zoomContainerRef = useRef(null);
  const scaleRef = useRef(1);
  
  useEffect(() => { scaleRef.current = scale; }, [scale]);

  const { ext, url, name, isBinary, content, mode } = win;

  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'heif'].includes(ext);
  const isVideo = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext);
  const isAudio = ['mp3', 'wav', 'flac', 'm4a'].includes(ext);
  const isPDF = ext === 'pdf';
  const isMarkdown = ext === 'md';
  const currentUser = JSON.parse(localStorage.getItem('user')) || {};
  const isAdmin = currentUser.Masters || currentUser.Managers;
  const isOffice = ['docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt'].includes(ext);

  const useCustomZoom = isImage || (isMarkdown && mode === 'view');
  const docKeyRef = useRef(win.id.replace(/[^a-zA-Z0-9.\\-_=]/g, '_').substring(0, 50) + '_' + Date.now());

  // 🔥 [핵심 2] 오피스 설정에 모바일 모드(type: 'mobile') 자동 반영
  const officeConfig = useMemo(() => {
    if (!isOffice) return null;
    const absoluteUrl = \`\${window.location.origin}\${url}&oosecret=nas_office_2026\`;
    const callbackUrl = \`\${window.location.origin}/api/onlyoffice/callback?path=\${encodeURIComponent(win.fullPath)}&uid=\${currentUser.id || ""}&isAdmin=\${isAdmin ? "true" : "false"}\`;
    
    let docType = 'word';
    if (['xls', 'xlsx', 'csv'].includes(ext)) docType = 'cell';
    if (['ppt', 'pptx'].includes(ext)) docType = 'slide';

    return {
      type: isMobile ? 'mobile' : 'desktop', // 스마트폰이면 모바일 UI로 자동 변환!
      document: {
        fileType: ext,
        key: docKeyRef.current,
        title: name,
        url: absoluteUrl,
      },
      documentType: docType,
      editorConfig: {
        callbackUrl: callbackUrl,
        lang: "ko-KR",
        mode: "edit",
        customization: { forcesave: true, autosave: true, compactHeader: isMobile },
      }
    };
  }, [ext, name, url, win.fullPath, isOffice, isMobile, currentUser.id, isAdmin]);

  const getLanguage = (extension) => {
    const map = { js: 'javascript', ts: 'typescript', py: 'python', json: 'json', html: 'html', css: 'css', sql: 'sql', java: 'java', cpp: 'cpp', c: 'c', md: 'markdown' };
    return map[extension] || 'plaintext';
  };

  // 🔥 [핵심 3] Ctrl+P 인쇄 단축키 가로채기 (하얀 백지 인쇄 방지)
  useEffect(() => {
    const handleCtrlP = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        if (isOffice || isPDF) {
          e.preventDefault(); 
          e.stopPropagation();
          alert('문서의 정상적인 인쇄를 위해 뷰어 내부 상단에 있는 전용 [인쇄] 아이콘을 클릭해주세요!\\n(브라우저 단축키로 인쇄하면 내용이 하얗게 출력됩니다.)');
        }
      }
    };
    window.addEventListener('keydown', handleCtrlP, true);
    return () => window.removeEventListener('keydown', handleCtrlP, true);
  }, [isOffice, isPDF]);

  useEffect(() => {
    const handleWheel = (e) => { if (isHovered && useCustomZoom && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setScale(prev => Math.min(Math.max(0.1, prev + (e.deltaY > 0 ? -0.1 : 0.1)), 5)); } };
    const handleKeyDown = (e) => { if (isHovered && useCustomZoom && (e.ctrlKey || e.metaKey)) { if (e.key === '=' || e.key === '+') { e.preventDefault(); setScale(prev => Math.min(prev + 0.2, 5)); } else if (e.key === '-') { e.preventDefault(); setScale(prev => Math.max(prev - 0.2, 0.1)); } else if (e.key === '0') { e.preventDefault(); setScale(1); } } };
    window.addEventListener('wheel', handleWheel, { passive: false }); window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => { window.removeEventListener('wheel', handleWheel); window.removeEventListener('keydown', handleKeyDown); };
  }, [isHovered, useCustomZoom]);

  useEffect(() => {
    const container = zoomContainerRef.current; if (!container || !useCustomZoom) return;
    let initDist = null, initScale = 1;
    const getDist = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (e) => { if (e.touches.length === 2) { e.preventDefault(); initDist = getDist(e.touches); initScale = scaleRef.current; } };
    const onTouchMove = (e) => { if (e.touches.length === 2 && initDist) { e.preventDefault(); setScale(Math.min(Math.max(0.1, initScale * (getDist(e.touches) / initDist)), 5)); } };
    const onTouchEnd = () => { initDist = null; };
    container.addEventListener('touchstart', onTouchStart, { passive: false }); container.addEventListener('touchmove', onTouchMove, { passive: false }); container.addEventListener('touchend', onTouchEnd);
    return () => { container.removeEventListener('touchstart', onTouchStart); container.removeEventListener('touchmove', onTouchMove); container.removeEventListener('touchend', onTouchEnd); };
  }, [useCustomZoom]);

  useEffect(() => {
    if (isPDF) {
      setLoading(true); axios.get(url, { responseType: 'blob', withCredentials: true }).then(res => { setPdfBlobUrl(URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }))); setLoading(false); }).catch(() => setLoading(false));
    } else { setLoading(false); }
  }, [url, isPDF]);

  useEffect(() => { return () => { if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl); }; }, [pdfBlobUrl]);

  const renderContent = () => {
    if (loading) return <CircularProgress color="primary" />;
    if (isImage) return <Box component="img" src={url} alt={name} sx={{ transform: \`scale(\${scale})\`, transition: 'transform 0.05s ease-out', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} draggable="false" />;
    if (isVideo) return <Box component="video" src={url} controls autoPlay sx={{ maxWidth: '100%', maxHeight: '100%', outline: 'none' }} />;
    if (isAudio) return <Box component="audio" src={url} controls autoPlay sx={{ width: '80%', mt: 2 }} />;
    
    // 🔥 [핵심 4] 모바일 PDF 스크롤 터치 호환성 극대화 (WebkitOverflowScrolling)
    if (isPDF) {
      if (!pdfBlobUrl) return <Typography color="error">PDF 로드 실패</Typography>;
      return (
        <Box sx={{ width: '100%', height: '100%', overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <Box component="iframe" src={pdfBlobUrl} title={name} sx={{ width: '100%', height: isMobile ? 'calc(100vh - 150px)' : '100%', border: 'none', bgcolor: '#fff' }} />
        </Box>
      );
    }
    
    if (isOffice && officeConfig) {
      return (
        <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
          <DocumentEditor id={\`editor-\${win.id}\`} documentServerUrl={window.location.origin + "/"} config={officeConfig} />
        </Box>
      );
    }

    if (isBinary) return <Box sx={{ textAlign: 'center', p: 4 }}><Typography variant="h6" gutterBottom>문서 파일 ({ext.toUpperCase()})</Typography><Typography variant="body2" sx={{ mb: 3 }}>다운로드하여 확인해 주세요.</Typography><Button variant="contained" onClick={() => { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }}>다운로드</Button></Box>;
    if (isMarkdown && mode === 'view') return <Box sx={{ p: 3, width: '100%', height: '100%', overflow: 'auto', backgroundColor: theme.palette.background.paper, fontSize: \`\${scale}rem\`, transition: 'font-size 0.05s ease-out' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown></Box>;
    return <Box sx={{ width: '100%', height: '100%', overflow: 'hidden' }}><Editor height="100%" width="100%" language={getLanguage(ext)} theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'} value={content || ''} onChange={(val) => handleContentChange(win.id, val)} options={{ readOnly: mode === 'view', minimap: { enabled: false }, fontSize: 14, wordWrap: 'on', mouseWheelZoom: true }} /></Box>;
  };

  const getBgColor = () => { if (isImage || isVideo || isAudio) return '#000000'; return theme.palette.mode === 'dark' ? '#0f172a' : '#ffffff'; };

  return (
    <Box sx={{ flex: 1, minWidth: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column', p: isBinary && !isOffice && !isPDF ? 0 : 2, overflow: 'hidden', backgroundColor: getBgColor() }}>
      {!isBinary && !isOffice && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2, flexShrink: 0 }}>
          {mode === 'view' ? <Button variant="contained" size="small" startIcon={<EditIcon />} onClick={() => toggleEditMode(win.id)}>편집 모드</Button> : <Box sx={{ display: 'flex', gap: 1 }}><Button variant="outlined" size="small" startIcon={<VisibilityIcon />} onClick={() => toggleEditMode(win.id)}>보기 모드</Button><Button variant="contained" size="small" color="success" startIcon={<SaveIcon />} onClick={() => saveFile(win)}>저장</Button></Box>}
        </Box>
      )}
      <Box ref={zoomContainerRef} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} sx={{ flex: 1, minWidth: '100%', minHeight: '100%', display: 'flex', justifyContent: 'center', alignItems: isBinary && !isPDF && !isOffice ? 'center' : 'flex-start', overflow: 'hidden', position: 'relative' }}>
        {renderContent()}
      </Box>
    </Box>
  );
};
export default FileViewer;
`;

fs.writeFileSync(path, newCode);
console.log("✅ FileViewer.js: 모바일 최적화 및 Ctrl+P 인쇄 안내 로직 적용 완료!");
