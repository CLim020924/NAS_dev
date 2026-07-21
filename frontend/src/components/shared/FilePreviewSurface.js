import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, CircularProgress, IconButton, Stack, Typography, useTheme } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import Editor from '@monaco-editor/react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import RhwpDocumentViewer from './RhwpDocumentViewer';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export const getFileExtension = (name = '') => {
  const clean = String(name || '').split('?')[0].split('#')[0];
  return clean.includes('.') ? clean.split('.').pop().toLowerCase() : '';
};

export const getPreviewKind = (name = '') => {
  const ext = getFileExtension(name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic', 'heif'].includes(ext)) return 'image';
  if (['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'flac', 'm4a'].includes(ext)) return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (['hwp', 'hwpx'].includes(ext)) return 'hwp';
  if (ext === 'md') return 'markdown';
  if (['txt', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'xml', 'csv', 'log', 'yml', 'yaml'].includes(ext)) return 'text';
  return 'download';
};

const FilePreviewSurface = ({ name, previewUrl, downloadUrl, readOnly = true }) => {
  const theme = useTheme();
  const kind = useMemo(() => getPreviewKind(name), [name]);
  const ext = getFileExtension(name);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pdfPages, setPdfPages] = useState(0);
  const [surfaceWidth, setSurfaceWidth] = useState(720);

  useEffect(() => {
    if (kind !== 'text' && kind !== 'markdown') return undefined;
    setLoading(true);
    setError('');
    fetch(previewUrl, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('미리보기를 불러오지 못했습니다.');
        return res.text();
      })
      .then(setText)
      .catch((err) => setError(err.message || '미리보기를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
    return undefined;
  }, [kind, previewUrl]);

  useEffect(() => {
    setZoom(1);
    setPdfPages(0);
    setError('');
  }, [previewUrl]);

  const attachSurfaceRef = (node) => {
    if (!node || typeof ResizeObserver === 'undefined') return;
    const updateWidth = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width > 0) setSurfaceWidth(Math.max(280, Math.floor(rect.width - 32)));
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    node.__mspPreviewObserver?.disconnect?.();
    node.__mspPreviewObserver = observer;
  };

  const zoomControls = (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ position: 'sticky', top: 0, zIndex: 2, p: 1, justifyContent: 'center', bgcolor: 'rgba(15,23,42,0.78)', backdropFilter: 'blur(8px)' }}>
      <IconButton size="small" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.15).toFixed(2))))} sx={{ color: '#fff' }} aria-label="축소">
        <ZoomOutIcon fontSize="small" />
      </IconButton>
      <Typography variant="caption" sx={{ color: '#fff', minWidth: 48, textAlign: 'center', fontWeight: 800 }}>{Math.round(zoom * 100)}%</Typography>
      <IconButton size="small" onClick={() => setZoom((value) => Math.min(3, Number((value + 0.15).toFixed(2))))} sx={{ color: '#fff' }} aria-label="확대">
        <ZoomInIcon fontSize="small" />
      </IconButton>
      <IconButton size="small" onClick={() => setZoom(1)} sx={{ color: '#fff' }} aria-label="원래 크기">
        <RestartAltIcon fontSize="small" />
      </IconButton>
    </Stack>
  );

  if (!previewUrl) {
    return <Box sx={{ p: 4, textAlign: 'center' }}><Typography color="text.secondary">미리보기 주소가 없습니다.</Typography></Box>;
  }

  if (kind === 'image') {
    return (
      <Box ref={attachSurfaceRef} sx={{ width: '100%', height: '100%', overflow: 'auto', bgcolor: '#050505', WebkitOverflowScrolling: 'touch' }}>
        {zoomControls}
        <Box sx={{ minHeight: 'calc(100% - 48px)', minWidth: '100%', display: 'grid', placeItems: 'center', p: 1.5 }}>
          <Box
            component="img"
            src={previewUrl}
            alt={name}
            sx={{
              maxWidth: zoom === 1 ? '100%' : 'none',
              maxHeight: zoom === 1 ? 'calc(100vh - 180px)' : 'none',
              width: `${Math.round(surfaceWidth * zoom)}px`,
              height: 'auto',
              objectFit: 'contain',
              touchAction: 'pan-x pan-y'
            }}
          />
        </Box>
      </Box>
    );
  }

  if (kind === 'video') {
    return <Box component="video" src={previewUrl} controls sx={{ width: '100%', height: '100%', bgcolor: '#050505' }} />;
  }

  if (kind === 'audio') {
    return (
      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 3 }}>
        <Box component="audio" src={previewUrl} controls sx={{ width: 'min(620px, 100%)' }} />
      </Box>
    );
  }

  if (kind === 'pdf') {
    return (
      <Box ref={attachSurfaceRef} sx={{ width: '100%', height: '100%', overflow: 'auto', bgcolor: '#737373', WebkitOverflowScrolling: 'touch' }}>
        {zoomControls}
        <Document
          file={{ url: previewUrl, withCredentials: true }}
          loading={<Box sx={{ height: 240, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>}
          error={<Box sx={{ p: 4, textAlign: 'center', color: '#fff' }}>PDF 미리보기를 불러오지 못했습니다.</Box>}
          onLoadSuccess={({ numPages }) => setPdfPages(numPages || 0)}
          onLoadError={() => setError('PDF 미리보기를 불러오지 못했습니다.')}
        >
          <Stack spacing={1.5} alignItems="center" sx={{ p: { xs: 1, sm: 2 }, minWidth: Math.round(surfaceWidth * zoom) + 16 }}>
            {Array.from(new Array(pdfPages), (_, index) => (
              <Box key={`pdf-page-${index + 1}`} sx={{ bgcolor: '#fff', boxShadow: 3 }}>
                <Page
                  pageNumber={index + 1}
                  width={Math.round(surfaceWidth * zoom)}
                  renderAnnotationLayer
                  renderTextLayer
                  loading={<Box sx={{ width: Math.round(surfaceWidth * zoom), height: 320, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box>}
                />
              </Box>
            ))}
          </Stack>
        </Document>
      </Box>
    );
  }

  if (kind === 'hwp') {
    return <RhwpDocumentViewer name={name} previewUrl={previewUrl} downloadUrl={downloadUrl} />;
  }

  if (loading) {
    return <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
  }

  if (error) {
    return <Box sx={{ p: 4, textAlign: 'center' }}><Typography color="error">{error}</Typography></Box>;
  }

  if (kind === 'markdown') {
    return (
      <Box sx={{ height: '100%', overflow: 'auto', p: 3, bgcolor: 'background.paper' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{text || ''}</ReactMarkdown>
      </Box>
    );
  }

  if (kind === 'text') {
    return (
      <Editor
        height="100%"
        language={ext || 'text'}
        theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
        value={text || ''}
        options={{ readOnly, minimap: { enabled: false }, wordWrap: 'on' }}
      />
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 4, textAlign: 'center' }}>
      <Box>
        <Typography sx={{ fontWeight: 900, mb: 1 }}>{name}</Typography>
        <Typography color="text.secondary" sx={{ mb: 2 }}>이 파일 형식은 미리보기를 지원하지 않습니다.</Typography>
        {downloadUrl && (
          <Button href={downloadUrl} variant="contained" startIcon={<DownloadIcon />}>
            다운로드
          </Button>
        )}
      </Box>
    </Box>
  );
};

export default FilePreviewSurface;
