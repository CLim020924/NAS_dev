const fs = require('fs');

// ==========================================
// 1. 백엔드 (nasRoutes.js) - PDF 브라우저 내장 뷰어 호출 기능 추가
// ==========================================
const nasPath = './nasRoutes.js';
if (fs.existsSync(nasPath)) {
    let code = fs.readFileSync(nasPath, 'utf8');

    // 🔥 다운로드 API를 수정하여 inline=true 요청 시 브라우저 내장 뷰어로 띄워줌 (PDF 1페이지 버그 완벽 해결)
    const oldDownload = /router\.get\('\/file\/download', verifyToken, \(req, res\) => \{[\s\S]*?catch\(e\)\{ res\.status\(403\)\.send\(\); \}\n\}\);/;
    const newDownload = `router.get('/file/download', verifyToken, (req, res) => {
  try { 
    const { targetPath } = getValidatedPath(req.user, req.query.path);
    if (req.query.inline === 'true') {
      res.sendFile(targetPath); // 브라우저 자체 뷰어로 열기 (모바일 43페이지 스크롤 가능!)
    } else {
      res.download(targetPath); // 일반 파일 다운로드
    }
  } 
  catch(e){ res.status(403).send(); }
});`;
    code = code.replace(oldDownload, newDownload);
    fs.writeFileSync(nasPath, code);
    console.log("✅ 백엔드: PDF 내장 뷰어(inline) 호출 API 패치 완료!");
}

// ==========================================
// 2. 프론트엔드 (NASWindow.js) - 사이트 전체 줌(Pinch) 방지 락 걸기
// ==========================================
const windowPath = '../frontend/src/components/NAS/Window/NASWindow.js';
if (fs.existsSync(windowPath)) {
    let code = fs.readFileSync(windowPath, 'utf8');
    
    // 모바일에서 창이 열리면 웹사이트 전체 줌 기능을 강제로 끕니다.
    const scrollLockOld = "document.body.style.overscrollBehavior = 'none'; // 당겨서 새로고침 방지";
    const scrollLockNew = `document.body.style.overscrollBehavior = 'none';
      // 🔥 사이트 전체가 확대되는 것을 막습니다 (파일 내부만 확대되도록 통제권 탈취!)
      let meta = document.querySelector('meta[name="viewport"]');
      if (meta) { window.__oldMeta = meta.content; meta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no'; }`;
      
    const scrollUnlockOld = "document.body.style.overscrollBehavior = '';";
    const scrollUnlockNew = `document.body.style.overscrollBehavior = '';
      let meta = document.querySelector('meta[name="viewport"]');
      if (meta && window.__oldMeta) { meta.content = window.__oldMeta; }`;

    code = code.replace(scrollLockOld, scrollLockNew).replace(scrollUnlockOld, scrollUnlockNew);
    fs.writeFileSync(windowPath, code);
    console.log("✅ 프론트엔드 NASWindow.js: 사이트 전체 줌(확대) 방지 락 적용 완료!");
}

// ==========================================
// 3. 프론트엔드 (FileViewer.js) - PDF Blob 버그 폐기 및 줌 최적화
// ==========================================
const viewerPath = '../frontend/src/components/NAS/FileViewer.js';
const newViewerCode = `import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Typography, Button, useTheme, CircularProgress, useMediaQuery } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DocumentEditor } from "@onlyoffice/document-editor-react";

const FileViewer = ({ win, toggleEditMode, handleContentChange, saveFile }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  
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

  const docKeyRef = useRef(win.id.replace(/[^a-zA-Z0-9.\\-_=]/g, '_').substring(0, 50) + '_' + Date.now());

  const officeConfig = useMemo(() => {
    if (!isOffice) return null;
    const absoluteUrl = \`\${window.location.origin}\${url}&oosecret=nas_office_2026\`;
    const callbackUrl = \`\${window.location.origin}/api/onlyoffice/callback?path=\${encodeURIComponent(win.fullPath)}&uid=\${currentUser.id || ""}&isAdmin=\${isAdmin ? "true" : "false"}\`;
    
    let docType = 'word';
    if (['xls', 'xlsx', 'csv'].includes(ext)) docType = 'cell';
    if (['ppt', 'pptx'].includes(ext)) docType = 'slide';

    return {
      type: isMobile ? 'mobile' : 'desktop',
      document: { fileType: ext, key: docKeyRef.current, title: name, url: absoluteUrl },
      documentType: docType,
      editorConfig: { callbackUrl, lang: "ko-KR", mode: "edit", customization: { forcesave: true, autosave: true, compactHeader: isMobile } }
    };
  }, [ext, name, url, win.fullPath, isOffice, isMobile, currentUser.id, isAdmin]);

  const getLanguage = (extension) => {
    const map = { js: 'javascript', ts: 'typescript', py: 'python', json: 'json', html: 'html', css: 'css', sql: 'sql', java: 'java', cpp: 'cpp', c: 'c', md: 'markdown' };
    return map[extension] || 'plaintext';
  };

  useEffect(() => {
    const handleCtrlP = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        if (isOffice || isPDF) {
          e.preventDefault(); e.stopPropagation();
          alert('문서의 정상적인 인쇄를 위해 뷰어 내부 상단에 있는 전용 [인쇄] 아이콘을 클릭해주세요!\\n(브라우저 단축키로 인쇄하면 내용이 하얗게 출력됩니다.)');
        }
      }
    };
    window.addEventListener('keydown', handleCtrlP, true);
    return () => window.removeEventListener('keydown', handleCtrlP, true);
  }, [isOffice, isPDF]);

  // 마우스 휠 줌 (PC용)
  useEffect(() => {
    const handleWheel = (e) => { if (isHovered && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setScale(prev => Math.min(Math.max(0.1, prev + (e.deltaY > 0 ? -0.1 : 0.1)), 5)); } };
    const handleKeyDown = (e) => { if (isHovered && (e.ctrlKey || e.metaKey)) { if (e.key === '=' || e.key === '+') { e.preventDefault(); setScale(prev => Math.min(prev + 0.2, 5)); } else if (e.key === '-') { e.preventDefault(); setScale(prev => Math.max(prev - 0.2, 0.1)); } else if (e.key === '0') { e.preventDefault(); setScale(1); } } };
    window.addEventListener('wheel', handleWheel, { passive: false }); window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => { window.removeEventListener('wheel', handleWheel); window.removeEventListener('keydown', handleKeyDown); };
  }, [isHovered]);

  // 🔥 두 손가락 줌 (모바일용 파일 내부 줌)
  useEffect(() => {
    const container = zoomContainerRef.current; if (!container) return; 
    let initDist = null, initScale = 1;
    const getDist = (touches) => Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
    const onTouchStart = (e) => { if (e.touches.length === 2) { e.preventDefault(); initDist = getDist(e.touches); initScale = scaleRef.current; } };
    const onTouchMove = (e) => { if (e.touches.length === 2 && initDist) { e.preventDefault(); setScale(Math.min(Math.max(0.1, initScale * (getDist(e.touches) / initDist)), 5)); } };
    const onTouchEnd = () => { initDist = null; };
    container.addEventListener('touchstart', onTouchStart, { passive: false }); container.addEventListener('touchmove', onTouchMove, { passive: false }); container.addEventListener('touchend', onTouchEnd);
    return () => { container.removeEventListener('touchstart', onTouchStart); container.removeEventListener('touchmove', onTouchMove); container.removeEventListener('touchend', onTouchEnd); };
  }, []);

  const renderContent = () => {
    if (isImage) return <Box component="img" src={url} alt={name} sx={{ transform: \`scale(\${scale})\`, transition: 'transform 0.05s ease-out', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} draggable="false" />;
    if (isVideo) return <Box component="video" src={url} controls autoPlay sx={{ maxWidth: '100%', maxHeight: '100%', outline: 'none' }} />;
    if (isAudio) return <Box component="audio" src={url} controls autoPlay sx={{ width: '80%', mt: 2 }} />;
    
    // 🔥 [핵심 3] Blob 완전 제거 & inline=true 로 브라우저 자체 PDF 뷰어 호출! (이제 43페이지 다 나옵니다)
    if (isPDF) {
      return (
        <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, transform: \`scale(\${scale})\`, transformOrigin: 'top center', transition: 'transform 0.1s', overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <Box component="iframe" src={\`\${url}&inline=true\`} title={name} sx={{ width: '100%', height: '100%', border: 'none', bgcolor: '#fff' }} />
        </Box>
      );
    }
    
    if (isOffice && officeConfig) {
      return (
        <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, transform: \`scale(\${scale})\`, transformOrigin: 'top center', transition: 'transform 0.1s' }}>
          <DocumentEditor id={\`editor-\${win.id}\`} documentServerUrl={window.location.origin + "/"} config={officeConfig} />
        </Box>
      );
    }

    if (isBinary) return <Box sx={{ textAlign: 'center', p: 4 }}><Typography variant="h6" gutterBottom>문서 파일 ({ext.toUpperCase()})</Typography><Typography variant="body2" sx={{ mb: 3 }}>다운로드하여 확인해 주세요.</Typography><Button variant="contained" onClick={() => { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); }}>다운로드</Button></Box>;
    
    if (isMarkdown && mode === 'view') return <Box sx={{ p: 3, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'auto', backgroundColor: theme.palette.background.paper, fontSize: \`\${scale}rem\`, transition: 'font-size 0.05s ease-out' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown></Box>;
    
    return <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' }}><Editor height="100%" width="100%" language={getLanguage(ext)} theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'} value={content || ''} onChange={(val) => handleContentChange(win.id, val)} options={{ readOnly: mode === 'view', minimap: { enabled: false }, fontSize: Math.max(10, Math.floor(14 * scale)), wordWrap: 'on', mouseWheelZoom: true }} /></Box>;
  };

  const getBgColor = () => { if (isImage || isVideo || isAudio) return '#000000'; return theme.palette.mode === 'dark' ? '#0f172a' : '#ffffff'; };

  return (
    <Box sx={{ flex: 1, minWidth: '100%', minHeight: '100%', display: 'flex', flexDirection: 'column', p: isBinary && !isOffice && !isPDF ? 0 : 2, overflow: 'hidden', backgroundColor: getBgColor() }}>
      {!isBinary && !isOffice && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2, flexShrink: 0 }}>
          {mode === 'view' ? <Button variant="contained" size="small" startIcon={<EditIcon />} onClick={() => toggleEditMode(win.id)}>편집 모드</Button> : <Box sx={{ display: 'flex', gap: 1 }}><Button variant="outlined" size="small" startIcon={<VisibilityIcon />} onClick={() => toggleEditMode(win.id)}>보기 모드</Button><Button variant="contained" size="small" color="success" startIcon={<SaveIcon />} onClick={() => saveFile(win)}>저장</Button></Box>}
        </Box>
      )}
      {/* touchAction: none 으로 브라우저의 기본 줌 동작을 무시하고 우리만의 줌을 사용! */}
      <Box ref={zoomContainerRef} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} sx={{ flex: 1, height: 0, width: '100%', position: 'relative', overflow: 'hidden', touchAction: 'pan-x pan-y' }}>
        {renderContent()}
      </Box>
    </Box>
  );
};
export default FileViewer;
`;
fs.writeFileSync(viewerPath, newViewerCode);
console.log("✅ 프론트엔드 FileViewer.js: Blob 폐기 및 파일 내부 줌(Pinch) 최적화 완료!");
