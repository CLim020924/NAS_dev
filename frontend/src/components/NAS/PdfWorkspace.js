import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import PanToolAltOutlinedIcon from '@mui/icons-material/PanToolAltOutlined';
import BorderColorOutlinedIcon from '@mui/icons-material/BorderColorOutlined';
import DrawOutlinedIcon from '@mui/icons-material/DrawOutlined';
import TextFieldsOutlinedIcon from '@mui/icons-material/TextFieldsOutlined';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { Document, Page } from 'react-pdf';
import axios from 'axios';
import { collectPdfTextItems, getPdfHighlightRects, normalizeDragRect, reconstructPdfPlainText, reconstructPdfRegionText } from './pdfSelection';
import { getPdfZoomKeyDirection, stepPdfZoom } from './pdfZoom';

const TOOL_DEFINITIONS = [
  ['select', '선택', PanToolAltOutlinedIcon],
  ['highlight', '형광펜', BorderColorOutlinedIcon],
  ['ink', '펜', DrawOutlinedIcon],
  ['text', '텍스트 상자', TextFieldsOutlinedIcon],
  ['copy-layout', '서식 유지 복사', ContentCopyOutlinedIcon],
  ['copy-plain', '일반 텍스트 복사', ContentCopyOutlinedIcon],
  ['eraser', '주석 지우기', DeleteOutlineIcon],
];

const createId = () => `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const pointFromEvent = (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height };
};
const normalizedPoint = (point) => ({ x: point.x / Math.max(1, point.width), y: point.y / Math.max(1, point.height) });

const PdfWorkspace = ({ win, isActive, onDirtyChange, onRegisterSave }) => {
  const theme = useTheme();
  const [pageCount, setPageCount] = useState(0);
  const [pageWidth, setPageWidth] = useState(720);
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState('select');
  const [color, setColor] = useState('#dc2626');
  const [history, setHistory] = useState({ past: [], present: [], future: [] });
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('주석 불러오는 중');
  const [preview, setPreview] = useState(null);
  const [textDraft, setTextDraft] = useState(null);
  const containerRef = useRef(null);
  const pageRefs = useRef(new Map());
  const gestureRef = useRef(null);
  const savingRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const dirtyRef = useRef(false);
  const annotationsRef = useRef([]);
  const revisionRef = useRef(0);
  const changeSequenceRef = useRef(0);
  const cancelTextDraftRef = useRef(false);

  const annotations = history.present;
  const pdfUrl = win.url.includes('?') ? `${win.url}&inline=true` : `${win.url}?inline=true`;

  const markDirty = useCallback((value) => {
    dirtyRef.current = value;
    if (value && savingRef.current) saveQueuedRef.current = true;
    setDirty(value);
    onDirtyChange?.(win.id, value);
  }, [onDirtyChange, win.id]);

  const replaceAnnotations = useCallback((next) => {
    changeSequenceRef.current += 1;
    annotationsRef.current = next;
    if (savingRef.current) saveQueuedRef.current = true;
    setHistory((current) => ({ past: [...current.past, current.present].slice(-100), present: next, future: [] }));
    markDirty(true);
  }, [markDirty]);

  useEffect(() => {
    let canceled = false;
    setStatus('주석 불러오는 중');
    axios.get('/api/file/pdf-annotations', { params: { path: win.fullPath }, withCredentials: true })
      .then((response) => {
        if (canceled) return;
        const loadedRevision = Number(response.data?.revision || 0);
        const loadedAnnotations = Array.isArray(response.data?.annotations) ? response.data.annotations : [];
        revisionRef.current = loadedRevision;
        annotationsRef.current = loadedAnnotations;
        changeSequenceRef.current = 0;
        setHistory({ past: [], present: loadedAnnotations, future: [] });
        markDirty(false);
        setStatus('저장됨');
      })
      .catch((error) => {
        if (!canceled) setStatus(error.response?.data?.error || '주석을 불러오지 못했습니다.');
      });
    return () => { canceled = true; };
  }, [win.fullPath, markDirty]);

  const saveAnnotations = useCallback(async () => {
    if (!dirtyRef.current) return true;
    if (savingRef.current) {
      saveQueuedRef.current = true;
      return true;
    }
    savingRef.current = true;
    try {
      do {
        saveQueuedRef.current = false;
        const savedSequence = changeSequenceRef.current;
        const expectedRevision = revisionRef.current;
        const snapshot = annotationsRef.current;
        setStatus('저장 중');
        const response = await axios.put('/api/file/pdf-annotations', JSON.stringify({
          path: win.fullPath,
          expectedRevision,
          annotations: snapshot,
        }), { withCredentials: true, headers: { 'Content-Type': 'application/vnd.nas-pdf-annotations+json' } });
        const nextRevision = Number(response.data?.revision || expectedRevision + 1);
        revisionRef.current = nextRevision;
        if (savedSequence === changeSequenceRef.current) {
          markDirty(false);
          setStatus('저장됨');
        } else {
          saveQueuedRef.current = true;
          setStatus('새 변경사항 저장 중');
        }
      } while (saveQueuedRef.current);
      return true;
    } catch (error) {
      setStatus(error.response?.data?.error || '주석 저장 실패');
      return false;
    } finally {
      savingRef.current = false;
    }
  }, [markDirty, win.fullPath]);

  const reloadAnnotations = useCallback(async () => {
    if (dirty && !window.confirm('저장하지 않은 PDF 주석을 버리고 서버의 최신 내용을 다시 불러올까요?')) return;
    setStatus('주석 다시 불러오는 중');
    try {
      const response = await axios.get('/api/file/pdf-annotations', { params: { path: win.fullPath }, withCredentials: true });
      const loadedRevision = Number(response.data?.revision || 0);
      const loadedAnnotations = Array.isArray(response.data?.annotations) ? response.data.annotations : [];
      revisionRef.current = loadedRevision;
      annotationsRef.current = loadedAnnotations;
      changeSequenceRef.current = 0;
      setHistory({ past: [], present: loadedAnnotations, future: [] });
      markDirty(false);
      setStatus('최신 주석을 불러왔습니다.');
    } catch (error) {
      setStatus(error.response?.data?.error || '주석을 다시 불러오지 못했습니다.');
    }
  }, [dirty, markDirty, win.fullPath]);

  useEffect(() => {
    onRegisterSave?.(saveAnnotations);
    return () => onRegisterSave?.(null);
  }, [onRegisterSave, saveAnnotations]);

  useEffect(() => {
    if (!dirty) return undefined;
    setStatus('저장되지 않은 변경');
    const timer = window.setTimeout(saveAnnotations, 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, annotations, saveAnnotations]);

  useEffect(() => {
    const updateWidth = () => {
      const width = containerRef.current?.clientWidth || 720;
      setPageWidth(Math.max(260, Math.min(960, width - 32)));
    };
    updateWidth();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateWidth) : null;
    if (containerRef.current) observer?.observe(containerRef.current);
    window.addEventListener('resize', updateWidth);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, [win.id]);

  const printPdf = useCallback(() => {
    const frame = document.createElement('iframe');
    frame.title = `${win.name || 'PDF'} 인쇄`;
    frame.src = pdfUrl;
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.onload = () => window.setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        window.setTimeout(() => frame.remove(), 1000);
      }
    }, 250);
    document.body.appendChild(frame);
  }, [pdfUrl, win.name]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!isActive) return;
      const ctrl = event.ctrlKey || event.metaKey;
      if (!ctrl) return;
      const key = event.key.toLowerCase();
      const zoomDirection = getPdfZoomKeyDirection(event.key);
      if (zoomDirection || key === '0') {
        event.preventDefault();
        event.stopPropagation();
        setZoom((value) => key === '0' ? 1 : stepPdfZoom(value, zoomDirection));
      } else if (key === 's') {
        event.preventDefault();
        event.stopPropagation();
        saveAnnotations();
      } else if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        setHistory((current) => {
          if (!current.past.length) return current;
          const next = {
            past: current.past.slice(0, -1),
            present: current.past[current.past.length - 1],
            future: [current.present, ...current.future],
          };
          annotationsRef.current = next.present;
          return next;
        });
        if (history.past.length) { changeSequenceRef.current += 1; markDirty(true); }
      } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
        event.preventDefault();
        setHistory((current) => {
          if (!current.future.length) return current;
          const next = {
            past: [...current.past, current.present],
            present: current.future[0],
            future: current.future.slice(1),
          };
          annotationsRef.current = next.present;
          return next;
        });
        if (history.future.length) { changeSequenceRef.current += 1; markDirty(true); }
      } else if (key === 'p') {
        event.preventDefault();
        event.stopPropagation();
        printPdf();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [history.future.length, history.past.length, isActive, markDirty, printPdf, saveAnnotations]);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const handleWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      setZoom((value) => stepPdfZoom(value, event.deltaY < 0 ? 1 : -1));
    };
    node.addEventListener('wheel', handleWheel, { passive: false });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [win.id]);

  const undo = () => {
    if (!history.past.length) return;
    changeSequenceRef.current += 1;
    setHistory((current) => {
      const next = { past: current.past.slice(0, -1), present: current.past[current.past.length - 1], future: [current.present, ...current.future] };
      annotationsRef.current = next.present;
      return next;
    });
    markDirty(true);
  };
  const redo = () => {
    if (!history.future.length) return;
    changeSequenceRef.current += 1;
    setHistory((current) => {
      const next = { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) };
      annotationsRef.current = next.present;
      return next;
    });
    markDirty(true);
  };

  const copyText = async (page, rect, preserveLayout) => {
    const pageElement = pageRefs.current.get(page);
    const items = collectPdfTextItems(pageElement);
    const text = preserveLayout ? reconstructPdfRegionText(items, rect) : reconstructPdfPlainText(items, rect);
    if (!text) {
      setStatus('선택 영역에서 텍스트를 찾지 못했습니다. 스캔 PDF는 OCR이 필요합니다.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
    setStatus(preserveLayout
      ? `${text.split('\n').length}줄을 띄어쓰기·들여쓰기와 함께 복사했습니다.`
      : `${text.split('\n').length}줄의 일반 텍스트를 복사했습니다.`);
  };

  const handlePointerDown = (event, page) => {
    if (event.button !== 0 || tool === 'eraser') return;
    const point = pointFromEvent(event);
    if (tool === 'text') {
      setTextDraft({ page, ...normalizedPoint(point), width: 0.28, height: 0.09, text: '' });
      return;
    }
    gestureRef.current = { page, tool, start: point, points: [normalizedPoint(point)] };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreview(tool === 'ink' ? { page, tool, points: [normalizedPoint(point)] } : { page, tool, rect: { left: point.x, top: point.y, width: 0, height: 0 } });
  };

  const handlePointerMove = (event) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const point = pointFromEvent(event);
    if (gesture.tool === 'ink') {
      gesture.points.push(normalizedPoint(point));
      setPreview({ page: gesture.page, tool: 'ink', points: [...gesture.points] });
    } else {
      const rect = normalizeDragRect(gesture.start, point, { width: point.width, height: point.height });
      setPreview({ page: gesture.page, tool: gesture.tool, rect });
    }
  };

  const handlePointerUp = async (event) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const point = pointFromEvent(event);
    gestureRef.current = null;
    setPreview(null);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    if (gesture.tool === 'ink' && gesture.points.length > 1) {
      replaceAnnotations([...annotations, { id: createId(), type: 'ink', page: gesture.page, points: gesture.points, width: 2.5, color, opacity: 1, createdAt: new Date().toISOString() }]);
      return;
    }
    const rect = normalizeDragRect(gesture.start, point, { width: point.width, height: point.height });
    if (rect.width < 3 || rect.height < 3) return;
    if (gesture.tool === 'copy-layout' || gesture.tool === 'copy-plain') {
      await copyText(gesture.page, rect, gesture.tool === 'copy-layout');
      return;
    }
    if (gesture.tool === 'highlight') {
      const textRects = getPdfHighlightRects(collectPdfTextItems(pageRefs.current.get(gesture.page)), rect);
      const targets = textRects.length ? textRects : [rect];
      replaceAnnotations([...annotations, ...targets.map((target) => ({
        id: createId(), type: 'highlight', page: gesture.page,
        x: target.left / point.width, y: target.top / point.height,
        width: target.width / point.width, height: target.height / point.height,
        color: '#fde047', opacity: 0.38, createdAt: new Date().toISOString(),
      }))]);
    }
  };

  const commitText = () => {
    if (!textDraft) return;
    if (cancelTextDraftRef.current) {
      cancelTextDraftRef.current = false;
      setTextDraft(null);
      return;
    }
    const text = textDraft.text.trim();
    if (text) replaceAnnotations([...annotations, { id: createId(), type: 'text', ...textDraft, text, color, background: '#ffffff', opacity: 1, fontSize: 16, createdAt: new Date().toISOString() }]);
    setTextDraft(null);
  };

  const removeAnnotation = (id) => replaceAnnotations(annotations.filter((annotation) => annotation.id !== id));
  const pageAnnotations = useMemo(() => {
    const grouped = new Map();
    annotations.forEach((annotation) => grouped.set(annotation.page, [...(grouped.get(annotation.page) || []), annotation]));
    return grouped;
  }, [annotations]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      <Box sx={{ minHeight: 42, display: 'flex', alignItems: 'center', gap: 0.5, px: 1, borderBottom: `1px solid ${theme.palette.divider}`, overflowX: 'auto', flex: '0 0 auto' }}>
        {TOOL_DEFINITIONS.map(([id, label, Icon]) => (
          <Tooltip key={id} title={label}>
            <Button aria-pressed={tool === id} onClick={() => setTool(id)} size="small" variant={tool === id ? 'contained' : 'text'} startIcon={<Icon fontSize="small" />} sx={{ minWidth: 'auto', whiteSpace: 'nowrap' }}>{label}</Button>
          </Tooltip>
        ))}
        <Box component="input" type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="펜과 텍스트 색상" sx={{ width: 26, height: 26, p: 0, border: 0, bgcolor: 'transparent' }} />
        <Tooltip title="실행 취소"><span><IconButton size="small" onClick={undo} disabled={!history.past.length}><UndoIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="다시 실행"><span><IconButton size="small" onClick={redo} disabled={!history.future.length}><RedoIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="PDF 주석 저장"><IconButton size="small" onClick={saveAnnotations}><SaveOutlinedIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="서버 주석 다시 불러오기"><IconButton size="small" onClick={reloadAnnotations}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
        <Tooltip title="PDF 인쇄"><IconButton size="small" onClick={printPdf}><PrintOutlinedIcon fontSize="small" /></IconButton></Tooltip>
        <Box sx={{ width: 1, height: 22, bgcolor: 'divider', mx: 0.5 }} />
        <IconButton size="small" onClick={() => setZoom((value) => stepPdfZoom(value, -1))} aria-label="PDF 축소"><ZoomOutIcon fontSize="small" /></IconButton>
        <Typography variant="caption" sx={{ minWidth: 42, textAlign: 'center', fontWeight: 700 }}>{Math.round(zoom * 100)}%</Typography>
        <IconButton size="small" onClick={() => setZoom((value) => stepPdfZoom(value, 1))} aria-label="PDF 확대"><ZoomInIcon fontSize="small" /></IconButton>
        <IconButton size="small" onClick={() => setZoom(1)} aria-label="PDF 원래 크기"><RestartAltIcon fontSize="small" /></IconButton>
        <Typography variant="caption" color={dirty ? 'warning.main' : status.includes('실패') || status.includes('못') ? 'error.main' : 'text.secondary'} sx={{ ml: 'auto', whiteSpace: 'nowrap' }}>{status}</Typography>
      </Box>

      <Box ref={containerRef} sx={{ flex: 1, minHeight: 0, overflow: 'auto', bgcolor: theme.palette.mode === 'dark' ? '#0f172a' : '#e5e7eb', p: { xs: 1, sm: 2 } }}>
        <Document file={pdfUrl} loading={<Typography color="text.secondary">PDF를 불러오는 중입니다...</Typography>} error={<Typography color="error">PDF를 불러오지 못했습니다.</Typography>} onLoadSuccess={({ numPages }) => setPageCount(numPages || 0)}>
          {Array.from({ length: pageCount }, (_, pageIndex) => {
            const page = pageIndex + 1;
            return (
              <Box key={page} sx={{ mb: 2, display: 'flex', justifyContent: 'center', width: 'fit-content', minWidth: '100%' }}>
                <Box ref={(node) => node ? pageRefs.current.set(page, node) : pageRefs.current.delete(page)} sx={{ position: 'relative', width: 'fit-content', lineHeight: 0, '& canvas': { maxWidth: zoom <= 1 ? '100%' : 'none', height: 'auto !important', boxShadow: theme.palette.mode === 'dark' ? '0 12px 32px rgba(0,0,0,.35)' : '0 12px 32px rgba(15,23,42,.16)' } }}>
                  <Page pageNumber={page} width={Math.round(pageWidth * zoom)} renderAnnotationLayer renderTextLayer />
                  <Box onPointerDown={(event) => handlePointerDown(event, page)} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={() => { gestureRef.current = null; setPreview(null); }} sx={{ position: 'absolute', inset: 0, zIndex: 4, pointerEvents: tool === 'select' ? 'none' : 'auto', cursor: tool === 'ink' ? 'crosshair' : tool === 'text' ? 'text' : tool === 'eraser' ? 'not-allowed' : 'crosshair', touchAction: tool === 'select' ? 'auto' : 'none' }}>
                    {(pageAnnotations.get(page) || []).map((annotation) => annotation.type === 'ink' ? (
                      <Box key={annotation.id} component="svg" viewBox="0 0 1 1" preserveAspectRatio="none" onPointerDown={(event) => { if (tool === 'eraser') { event.stopPropagation(); removeAnnotation(annotation.id); } }} sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: tool === 'eraser' ? 'auto' : 'none' }}>
                        <polyline points={annotation.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={annotation.color} strokeOpacity={annotation.opacity} strokeWidth={annotation.width / 1000} strokeLinecap="round" strokeLinejoin="round" />
                      </Box>
                    ) : (
                      <Box key={annotation.id} onPointerDown={(event) => { if (tool === 'eraser') { event.stopPropagation(); removeAnnotation(annotation.id); } }} sx={{ position: 'absolute', left: `${annotation.x * 100}%`, top: `${annotation.y * 100}%`, width: `${annotation.width * 100}%`, height: `${annotation.height * 100}%`, bgcolor: annotation.type === 'highlight' ? annotation.color : annotation.background, opacity: annotation.opacity, color: annotation.color, fontSize: annotation.type === 'text' ? `${annotation.fontSize * zoom}px` : undefined, lineHeight: 1.25, whiteSpace: 'pre-wrap', overflow: 'hidden', p: annotation.type === 'text' ? 0.35 : 0, border: annotation.type === 'text' ? `1px solid ${annotation.color}` : 0, mixBlendMode: annotation.type === 'highlight' ? 'multiply' : 'normal', pointerEvents: tool === 'eraser' ? 'auto' : 'none' }}>{annotation.type === 'text' ? annotation.text : ''}</Box>
                    ))}
                    {preview?.page === page && preview.tool === 'ink' && <Box component="svg" viewBox="0 0 1 1" preserveAspectRatio="none" sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}><polyline points={preview.points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth={0.0025} strokeLinecap="round" strokeLinejoin="round" /></Box>}
                    {preview?.page === page && preview.rect && <Box sx={{ position: 'absolute', left: preview.rect.left, top: preview.rect.top, width: preview.rect.width, height: preview.rect.height, border: `1px solid ${preview.tool.startsWith('copy-') ? theme.palette.primary.main : '#ca8a04'}`, bgcolor: preview.tool === 'highlight' ? 'rgba(253,224,71,.32)' : 'rgba(37,99,235,.08)', pointerEvents: 'none' }} />}
                    {textDraft?.page === page && <Box component="textarea" autoFocus value={textDraft.text} onChange={(event) => setTextDraft((draft) => ({ ...draft, text: event.target.value }))} onBlur={commitText} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); commitText(); } if (event.key === 'Escape') { event.preventDefault(); cancelTextDraftRef.current = true; event.currentTarget.blur(); } }} sx={{ position: 'absolute', left: `${textDraft.x * 100}%`, top: `${textDraft.y * 100}%`, width: `${textDraft.width * 100}%`, minHeight: 54, resize: 'both', zIndex: 6, bgcolor: 'rgba(255,255,255,.94)', color, border: `1px solid ${color}`, font: '16px/1.3 sans-serif', p: 0.75 }} />}
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Document>
      </Box>
    </Box>
  );
};

export default PdfWorkspace;
