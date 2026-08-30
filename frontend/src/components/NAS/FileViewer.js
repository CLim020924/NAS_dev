import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Box, Typography, Button, IconButton, useTheme, useMediaQuery } from '@mui/material';
import axios from 'axios';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import PrintIcon from '@mui/icons-material/Print';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { DocumentEditor } from "@onlyoffice/document-editor-react";
import { useWindows } from '../../contexts/WindowContext';
import { getOnlyOfficeDocumentType, isOnlyOfficeFormat } from '../../utils/officeFormats';
import RhwpDocumentViewer from '../shared/RhwpDocumentViewer';
import { transferUrl } from '../../transferBaseUrl';
import { getPdfZoomKeyDirection, stepPdfZoom } from './pdfZoom';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const FileViewer = ({ win, toggleEditMode, handleContentChange, saveFile, onDirtyChange }) => {
  const theme = useTheme(); // 오타 수정 완료
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { focusedContext } = useWindows();
  const [isSaving, setIsSaving] = useState(false);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfError, setPdfError] = useState('');
  const [pdfPageWidth, setPdfPageWidth] = useState(720);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [officeAccessToken, setOfficeAccessToken] = useState('');
  const [officeDocumentRevisionKey, setOfficeDocumentRevisionKey] = useState('');
  const [officeAccessError, setOfficeAccessError] = useState('');
  const editorRef = useRef(null);
  const officeSaveResolveRef = useRef(null);
  const pdfContainerRef = useRef(null);
  const dirtyRef = useRef(!!win.hasUnsavedChanges);
  const saveHandlerRef = useRef(null);
  
  const { ext, url, name, isBinary, content, mode } = win;

  // 변수 선언 최상단 배치
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'heif'].includes(ext);
  const isVideo = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext);
  const isAudio = ['mp3', 'wav', 'flac', 'm4a'].includes(ext);
  const isOffice = isOnlyOfficeFormat(ext);
  const isHwp = ['hwp', 'hwpx'].includes(ext);
  const isPDF = ext === 'pdf';
  const isMarkdown = ext === 'md';
  const isTextEditable = !isBinary && !isOffice && !isPDF;

  const publicOfficeBase = (window.__OO_PUBLIC_BASE__ || window.location.origin).replace(/\/$/, '');
  const encodeBase64Url = (value) => {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const createOnlyOfficeDocumentKey = useCallback((value) => {
    const text = String(value || '');
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const encoded = encodeBase64Url(text).replace(/[^a-zA-Z0-9]/g, '').slice(0, 80);
    return `nas${ext}${(hash >>> 0).toString(16)}${encoded}`.slice(0, 120);
  }, [ext]);

  const setFileDirty = useCallback((dirty) => {
    dirtyRef.current = !!dirty;
    onDirtyChange?.(win.id, !!dirty);
  }, [onDirtyChange, win.id]);

  const triggerBrowserDownload = () => {
    const link = document.createElement('a');
    link.href = url;
    link.download = name || '';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleNasSave = useCallback(async () => {
    if (editorRef.current && isOffice && ext !== 'pdf') {
      if (!dirtyRef.current) return true;
      setIsSaving(true);
      try {
        const saved = await new Promise((resolve) => {
          let settled = false;
          const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            if (officeSaveResolveRef.current === finish) officeSaveResolveRef.current = null;
            resolve(result);
          };
          const timeoutId = setTimeout(() => finish(false), 10000);
          officeSaveResolveRef.current = finish;
          editorRef.current.serviceCommand('forceSave');
        });
        if (saved) setFileDirty(false);
        return saved;
      } catch (error) {
        console.warn('OnlyOffice 강제 저장 실패', error);
        return false;
      } finally {
        setIsSaving(false);
      }
    }

    if (!isBinary && !isOffice && mode === 'edit' && typeof saveFile === 'function') {
      const ok = await saveFile(win, { keepEditMode: true });
      if (ok !== false) setFileDirty(false);
      return ok !== false;
    }
    return false;
  }, [editorRef, isOffice, ext, isBinary, mode, saveFile, win, setFileDirty]);

  useEffect(() => {
    saveHandlerRef.current = handleNasSave;
  }, [handleNasSave]);

  const handleNasPrint = () => {
    if (editorRef.current && isOffice) {
      // 도커 오피스 내부 인쇄 기능 강제 호출
      editorRef.current.serviceCommand('print'); 
    }
  };

  const handleRhwpSave = async ({ bytes, fileName, targetPath }) => {
    const fullPath = String(win.fullPath || '');
    const parentPath = targetPath || (fullPath.includes('/') ? (fullPath.substring(0, fullPath.lastIndexOf('/')) || '/') : '/');
    const binary = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    const file = new File([binary], fileName || name, { type: ext === 'hwpx' ? 'application/vnd.hancom.hwpx' : 'application/x-hwp' });
    const formData = new FormData();
    formData.append('path', parentPath);
    formData.append('file', file);
    await axios.post(transferUrl('/api/file'), formData, {
      withCredentials: true,
      timeout: 0,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    if (!targetPath) setFileDirty(false);
  };

  const handleRhwpDirtyChange = useCallback((dirty) => {
    setFileDirty(dirty);
  }, [setFileDirty]);

  useEffect(() => {
    if (isTextEditable && mode === 'edit') {
      setFileDirty((win.content || '') !== (win.originalContent || ''));
    }
  }, [isTextEditable, mode, win.content, win.originalContent, setFileDirty]);

  useEffect(() => {
    if (!isTextEditable || mode !== 'edit' || !dirtyRef.current) return undefined;
    const timer = window.setTimeout(() => {
      handleNasSave();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [isTextEditable, mode, win.content, handleNasSave]);

  useEffect(() => {
    window.__nasFileSaveHandlers = window.__nasFileSaveHandlers || {};
    window.__nasFileSaveHandlers[win.id] = handleNasSave;
    return () => {
      if (window.__nasFileSaveHandlers?.[win.id] === handleNasSave) {
        delete window.__nasFileSaveHandlers[win.id];
      }
    };
  }, [win.id, handleNasSave]);

  useEffect(() => {
    const tryAutosaveBeforeLeaving = () => {
      if (dirtyRef.current) handleNasSave();
    };
    const handleBeforeUnload = (event) => {
      if (!dirtyRef.current) return undefined;
      tryAutosaveBeforeLeaving();
      event.preventDefault();
      event.returnValue = '';
      return '';
    };
    window.addEventListener('pagehide', tryAutosaveBeforeLeaving);
    document.addEventListener('visibilitychange', tryAutosaveBeforeLeaving);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('pagehide', tryAutosaveBeforeLeaving);
      document.removeEventListener('visibilitychange', tryAutosaveBeforeLeaving);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [handleNasSave]);

  // 단축키 가로채기 (윈도우 포커스 기반)
  useEffect(() => {
    const handleKeydown = (e) => {
      if (focusedContext !== win.id) return;

      const isCtrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (!isCtrl) return;

      if (isPDF) {
        const zoomDirection = getPdfZoomKeyDirection(e.key);
        if (zoomDirection !== 0 || key === '0') {
          e.preventDefault();
          e.stopPropagation();
          if (key === '0') setPdfZoom(1);
          else setPdfZoom((value) => stepPdfZoom(value, zoomDirection));
          return;
        }
      }

      if (isOffice && editorRef.current && (key === 'p' || key === 's')) {
        e.preventDefault();
        e.stopPropagation();
        if (key === 'p') handleNasPrint();
        else if (key === 's') handleNasSave();
        return;
      }

      if (isPDF && key === 's') {
        e.preventDefault();
        e.stopPropagation();
        handleNasSave();
        return;
      }

      if (!isBinary && !isOffice && key === 's' && mode === 'edit') {
        e.preventDefault();
        e.stopPropagation();
        handleNasSave();
      }
    };

    window.addEventListener('keydown', handleKeydown, true);
    return () => window.removeEventListener('keydown', handleKeydown, true);
  }, [focusedContext, win.id, isOffice, isPDF, isBinary, mode, url, name, win.content]);

  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      editorRef.current = null;
      officeSaveResolveRef.current?.(false);
      officeSaveResolveRef.current = null;
      if (!isOffice || !editor || ext === 'pdf') return;

      try {
        if (dirtyRef.current) editor.serviceCommand('forceSave');
      } catch (error) {
        console.warn('OnlyOffice 종료 저장 실패', error);
      }
      setTimeout(() => editor.destroyEditor?.(), dirtyRef.current ? 500 : 0);
    };
  }, [isOffice, ext]);

  useEffect(() => {
    if (!isPDF) return undefined;

    setPdfZoom(1);

    const updatePdfWidth = () => {
      const width = pdfContainerRef.current?.clientWidth || 720;
      setPdfPageWidth(Math.max(260, Math.min(960, width - 32)));
    };

    updatePdfWidth();
    window.addEventListener('resize', updatePdfWidth);
    const timer = setTimeout(updatePdfWidth, 80);
    return () => {
      window.removeEventListener('resize', updatePdfWidth);
      clearTimeout(timer);
    };
  }, [isPDF, win.id]);

  useEffect(() => {
    const container = pdfContainerRef.current;
    if (!isPDF || !container) return undefined;

    const handlePdfWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      setPdfZoom((value) => stepPdfZoom(value, event.deltaY < 0 ? 1 : -1));
    };

    container.addEventListener('wheel', handlePdfWheel, { passive: false });
    return () => container.removeEventListener('wheel', handlePdfWheel);
  }, [isPDF, win.id]);

  useEffect(() => {
    const controller = new AbortController();
    if (!isOffice || !win.fullPath) {
      setOfficeAccessToken('');
      setOfficeDocumentRevisionKey('');
      setOfficeAccessError('');
      return () => controller.abort();
    }
    setOfficeAccessToken('');
    setOfficeDocumentRevisionKey('');
    setOfficeAccessError('');
    dirtyRef.current = false;
    axios.post('/api/onlyoffice/access', { path: win.fullPath }, {
      withCredentials: true,
      signal: controller.signal
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        setOfficeAccessToken(String(response.data?.token || ''));
        setOfficeDocumentRevisionKey(String(response.data?.documentKey || ''));
      })
      .catch((error) => {
        if (!controller.signal.aborted) setOfficeAccessError(error.response?.data?.error || 'OnlyOffice 접근 권한을 확인하지 못했습니다.');
      });
    return () => controller.abort();
  }, [isOffice, win.fullPath]);

  const officeDocumentKey = useMemo(() => {
    if (!isOffice) return '';
    return officeDocumentRevisionKey || createOnlyOfficeDocumentKey(win.fullPath || win.id);
  }, [createOnlyOfficeDocumentKey, isOffice, officeDocumentRevisionKey, win.fullPath, win.id]);

  const officeEditorId = useMemo(() => (
    `editor-${createOnlyOfficeDocumentKey(`${win.id}:${officeDocumentKey || win.fullPath || ''}`)}`
  ), [createOnlyOfficeDocumentKey, officeDocumentKey, win.fullPath, win.id]);

  const officeConfig = useMemo(() => {
    if (!isOffice || !officeAccessToken) return null;

    const officeFetchBase = (
      window.__OO_INTERNAL_BASE__ ||
      process.env.REACT_APP_ONLYOFFICE_INTERNAL_BASE ||
      'http://172.17.0.1:3030'
    ).replace(/\/$/, '');

    // 기존 url의 path 인코딩(%20 등)을 유지하기 위해 URL/searchParams 재직렬화를 피한다
    const officeFileName = encodeURIComponent(name || `document.${ext}`);
    const absoluteUrl =
      `${officeFetchBase}/api/onlyoffice/file/${officeFileName}` +
      `?path64=${encodeURIComponent(encodeBase64Url(win.fullPath || ''))}` +
      `&inline=true` +
      `&v=${encodeURIComponent(officeDocumentKey)}` +
      `&officeToken=${encodeURIComponent(officeAccessToken)}`;

    const callbackUrl =
      `${officeFetchBase}/api/onlyoffice/callback` +
      `?path=${encodeURIComponent(win.fullPath)}` +
      `&officeToken=${encodeURIComponent(officeAccessToken)}`;

    return {
      type: isMobile ? 'mobile' : 'desktop',
      document: {
        fileType: ext,
        key: officeDocumentKey,
        title: name,
        url: absoluteUrl
      },
      documentType: getOnlyOfficeDocumentType(ext),
      editorConfig: {
        callbackUrl,
        lang: "en-US",
        mode: ext === 'pdf' ? 'view' : 'edit',
        customization: {
        forcesave: true,
          autosave: true,
          compactHeader: false,
          toolbar: true
        }
      },
      events: {
        onDocumentStateChange: (event) => {
          const dirty = !!event?.data;
          setFileDirty(dirty);
          if (!dirty && officeSaveResolveRef.current) {
            const resolveSave = officeSaveResolveRef.current;
            officeSaveResolveRef.current = null;
            resolveSave(true);
          }
        },
        onRequestSaveAs: () => {
          saveHandlerRef.current?.();
        },
        onError: (event) => {
          console.warn('OnlyOffice editor error', event?.data || event);
        }
      }
    };
  }, [ext, name, win.fullPath, isOffice, isMobile, officeAccessToken, officeDocumentKey, setFileDirty]);

  const documentServerUrl = `${publicOfficeBase}/onlyoffice`;

  const renderContent = () => {
    if (isImage) return <Box component="img" src={url} alt={name} sx={{ width: '100%', height: '100%', objectFit: 'contain' }} />;
    if (isVideo) return <video src={url} controls autoPlay style={{ width: '100%', height: '100%' }} />;
    if (isAudio) return <audio src={url} controls autoPlay style={{ width: '80%', marginTop: '20px' }} />;
    if (isHwp) {
      const fullPath = String(win.fullPath || '');
      const currentFolderPath = fullPath.includes('/') ? (fullPath.substring(0, fullPath.lastIndexOf('/')) || '/') : '/';
      return <RhwpDocumentViewer name={name} previewUrl={url.includes('?') ? `${url}&inline=true` : `${url}?inline=true`} downloadUrl={url} nasPath={fullPath} onSave={handleRhwpSave} onDirtyChange={handleRhwpDirtyChange} initialFolderPath={currentFolderPath} initialMode={win.preferEditMode ? 'editor' : 'viewer'} />;
    }
    if (isOffice && !officeConfig) {
      return <Box sx={{ p: 3 }}><Typography color={officeAccessError ? 'error' : 'text.secondary'}>{officeAccessError || '문서 접근 권한을 확인하는 중입니다...'}</Typography></Box>;
    }
    if (isOffice && officeConfig) {
      return (
        <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <DocumentEditor key={officeEditorId} id={officeEditorId} documentServerUrl={documentServerUrl} config={officeConfig} onLoadComponent={(editor) => { editorRef.current = editor; }} />
        </Box>
      );
    }
    if (isPDF) {
      const pdfUrl = url.includes('?') ? `${url}&inline=true` : `${url}?inline=true`;
      return (
        <Box
          ref={pdfContainerRef}
          sx={{
            height: '100%',
            overflow: 'auto',
            bgcolor: theme.palette.mode === 'dark' ? '#0f172a' : '#e5e7eb',
            p: { xs: 1, sm: 2 },
          }}
        >
          <Document
            file={pdfUrl}
            loading={<Typography color="text.secondary">PDF를 불러오는 중입니다...</Typography>}
            error={<Typography color="error">{pdfError || 'PDF를 불러오지 못했습니다.'}</Typography>}
            onLoadSuccess={({ numPages }) => {
              setPdfPageCount(numPages || 0);
              setPdfError('');
            }}
            onLoadError={(error) => {
              setPdfPageCount(0);
              setPdfError(error?.message || 'PDF를 불러오지 못했습니다.');
            }}
          >
            {Array.from(new Array(pdfPageCount), (_, index) => (
              <Box
                key={`page_${index + 1}`}
                sx={{
                  mb: 2,
                  display: 'flex',
                  justifyContent: 'center',
                  width: 'fit-content',
                  minWidth: '100%',
                  '& canvas': {
                    maxWidth: pdfZoom <= 1 ? '100%' : 'none',
                    height: 'auto !important',
                    boxShadow: theme.palette.mode === 'dark'
                      ? '0 16px 40px rgba(0,0,0,0.35)'
                      : '0 16px 40px rgba(15,23,42,0.18)',
                  },
                }}
              >
                <Page
                  pageNumber={index + 1}
                  width={Math.round(pdfPageWidth * pdfZoom)}
                  renderAnnotationLayer
                  renderTextLayer
                />
              </Box>
            ))}
          </Document>
        </Box>
      );
    }
    if (isBinary) return <Box sx={{ textAlign: 'center', p: 4 }}><Typography>문서 ({ext.toUpperCase()})</Typography><Button onClick={() => window.open(url)}>다운로드</Button></Box>;
    if (isMarkdown && mode === 'view') return <Box sx={{ p: 3, overflow: 'auto', height: '100%' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{content || ''}</ReactMarkdown></Box>;
    return <Editor height="100%" language={ext} theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'} value={content || ''} onChange={(val) => handleContentChange(win.id, val)} options={{ readOnly: mode === 'view' }} />;
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: (isImage || isVideo || isAudio) ? '#000' : theme.palette.background.paper }}>
      {(isOffice || isTextEditable || isPDF) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.5, borderBottom: `1px solid ${theme.palette.divider}`, bgcolor: theme.palette.mode === 'dark' ? '#1e293b' : '#f8fafc', zIndex: 10 }}>
          {!isPDF && (
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={handleNasSave}
              disabled={isOffice ? isSaving : mode !== 'edit'}
            >
              {isOffice && isSaving ? '저장 중...' : '저장'}
            </Button>
          )}

          {isPDF ? (
            <>
              <IconButton size="small" onClick={() => setPdfZoom((value) => stepPdfZoom(value, -1))} aria-label="PDF 축소">
                <ZoomOutIcon fontSize="small" />
              </IconButton>
              <Typography variant="caption" sx={{ minWidth: 48, textAlign: 'center', fontWeight: 700 }}>{Math.round(pdfZoom * 100)}%</Typography>
              <IconButton size="small" onClick={() => setPdfZoom((value) => stepPdfZoom(value, 1))} aria-label="PDF 확대">
                <ZoomInIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={() => setPdfZoom(1)} aria-label="PDF 원래 크기">
                <RestartAltIcon fontSize="small" />
              </IconButton>
            </>
          ) : isOffice ? (
            <Button size="small" variant="outlined" startIcon={<PrintIcon />} onClick={handleNasPrint}>인쇄</Button>
          ) : (
            <Button
              size="small"
              variant="outlined"
              startIcon={mode === 'edit' ? <VisibilityIcon /> : <EditIcon />}
              onClick={() => toggleEditMode(win.id)}
            >
              {mode === 'edit' ? '보기' : '편집'}
            </Button>
          )}

          <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>{name}</Typography>
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
        {renderContent()}
      </Box>
    </Box>
  );
};
export default FileViewer;
