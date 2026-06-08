const fs = require('fs');

// ==========================================
// 1. 백엔드 (nasRoutes.js) 도커 비밀 통로 복구
// ==========================================
const nasPath = './nasRoutes.js';
if (fs.existsSync(nasPath)) {
    let code = fs.readFileSync(nasPath, 'utf8');

    // ① 도커(ONLYOFFICE) 전용 인증 통과 로직 주입
    const oldVerifyToken = /const verifyToken = \(req, res, next\) => \{[\s\S]*?catch \(e\) \{ res\.status\(401\)\.json\(\{ error: '인증실패' \}\); \}\n\};/;
    const newVerifyToken = `const verifyToken = (req, res, next) => {
  // 🔥 [복구] ONLYOFFICE 도커 서버의 비밀 통로 (토큰 검사 우회)
  if (req.query.oosecret === 'nas_office_2026') {
    req.user = { Masters: true, globalAccess: true };
    return next();
  }
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: '로그인 필요' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } 
  catch (e) { res.status(401).json({ error: '인증실패' }); }
};`;
    code = code.replace(oldVerifyToken, newVerifyToken);

    // ② 도커 오피스 저장(Callback) API 복구
    if (!code.includes('/onlyoffice/callback')) {
        const callbackAPI = `
// 🔥 [복구] ONLYOFFICE 저장 콜백 API
router.post('/onlyoffice/callback', async (req, res) => {
  const { status, url } = req.body;
  const relPath = req.query.path;
  const uid = req.query.uid;
  const isAdmin = req.query.isAdmin === 'true';

  if (status === 2 || status === 6) { 
    try {
      const axios = require('axios');
      const fs = require('fs');
      const path = require('path');
      
      const nasPath = process.env.NAS_PATH || '/mnt/nas';
      const basePath = isAdmin ? nasPath : path.join(nasPath, 'users', uid || 'default');
      const safeReqPath = (relPath || '').replace(/^(\\/|\\\\)+/, '');
      const absoluteFilePath = path.resolve(basePath, safeReqPath);

      const response = await axios.get(url, { responseType: 'stream' });
      const writer = fs.createWriteStream(absoluteFilePath);
      response.data.pipe(writer);
      
      writer.on('finish', () => res.json({ error: 0 }));
      writer.on('error', (err) => res.json({ error: 1 }));
    } catch (error) {
      return res.json({ error: 1 });
    }
  } else {
    return res.json({ error: 0 });
  }
});
`;
        code = code.replace('module.exports = router;', callbackAPI + '\nmodule.exports = router;');
    }
    fs.writeFileSync(nasPath, code);
    console.log("✅ 백엔드: 도커 ONLYOFFICE 연결 통로 및 저장 기능 완벽 복구!");
}

// ==========================================
// 2. 프론트엔드 (FileViewer.js) Ctrl+P 복사창 주입
// ==========================================
const viewerPath = '../frontend/src/components/NAS/FileViewer.js';
const newViewerCode = `import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Box, Typography, Button, useTheme, CircularProgress, Dialog, DialogTitle, DialogContent, DialogContentText, TextField, DialogActions } from '@mui/material';
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
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  const [scale, setScale] = useState(1);
  const [isHovered, setIsHovered] = useState(false);
  const zoomContainerRef = useRef(null);
  const scaleRef = useRef(1);

  // ✨ [추가] Ctrl+P 파일 복사 팝업 전용 상태
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyDest, setCopyDest] = useState('/');
  
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

  const officeConfig = useMemo(() => {
    if (!isOffice) return null;
    const absoluteUrl = \`\${window.location.origin}\${url}&oosecret=nas_office_2026\`;
    const callbackUrl = \`\${window.location.origin}/api/onlyoffice/callback?path=\${encodeURIComponent(win.fullPath)}&uid=\${currentUser.id || ""}&isAdmin=\${isAdmin ? "true" : "false"}\`;
    
    let docType = 'word';
    if (['xls', 'xlsx', 'csv'].includes(ext)) docType = 'cell';
    if (['ppt', 'pptx'].includes(ext)) docType = 'slide';

    return {
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
        customization: { forcesave: true, autosave: true },
      }
    };
  }, [ext, name, url, win.fullPath, isOffice]);

  const getLanguage = (extension) => {
    const map = { js: 'javascript', ts: 'typescript', py: 'python', json: 'json', html: 'html', css: 'css', sql: 'sql', java: 'java', cpp: 'cpp', c: 'c', md: 'markdown' };
    return map[extension] || 'plaintext';
  };

  // ✨ [추가] Ctrl + P 인터셉트 (파일 복사창 띄우기)
  useEffect(() => {
    const handleCtrlP = (e) => {
      // 오피스 파일이 열려있고, 창에 마우스를 올리고 있을 때 작동 (오작동 방지)
      if (isOffice && isHovered && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault(); // 기본 인쇄창 막기
        e.stopPropagation();
        setCopyDialogOpen(true);
      }
    };
    // capture 플래그로 최우선으로 이벤트를 가로챕니다.
    window.addEventListener('keydown', handleCtrlP, true);
    return () => window.removeEventListener('keydown', handleCtrlP, true);
  }, [isOffice, isHovered]);

  const handleExecuteCopy = async () => {
    try {
      await axios.post('/api/file/copy', {
        sourcePaths: [win.fullPath],
        destinationFolder: copyDest
      }, { withCredentials: true });
      alert(\`'\${name}' 파일이 성공적으로 복사되었습니다!\`);
      setCopyDialogOpen(false);
    } catch (err) {
      alert("복사 실패: " + (err.response?.data?.error || err.message));
    }
  };

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
    if (isPDF) {
      if (!pdfBlobUrl) return <Typography color="error">PDF 로드 실패</Typography>;
      return <Box component="iframe" src={pdfBlobUrl} title={name} sx={{ width: '100%', height: '100%', border: 'none', bgcolor: '#fff' }} />;
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

      {/* ✨ [추가] Ctrl + P 로 호출되는 파일 복사 다이얼로그 */}
      <Dialog open={copyDialogOpen} onClose={() => setCopyDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>파일 복제 (현재 문서)</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            <strong>{name}</strong> 파일을 복사하시겠습니까?<br />
            저장할 폴더의 경로를 입력해 주세요. (기본값: 최상위 바탕화면)
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label="복사 대상 경로"
            type="text"
            fullWidth
            variant="outlined"
            value={copyDest}
            onChange={(e) => setCopyDest(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setCopyDialogOpen(false)} color="inherit">취소</Button>
          <Button onClick={handleExecuteCopy} color="primary" variant="contained">여기로 복사</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
export default FileViewer;
`;
fs.writeFileSync(viewerPath, newViewerCode);
console.log("✅ 프론트엔드: FileViewer에 Ctrl+P (파일 복사창) 기능 완벽 이식!");
