import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, TextField, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import EditIcon from '@mui/icons-material/Edit';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SaveIcon from '@mui/icons-material/Save';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import initRhwp, { HwpDocument } from '@rhwp/core';
import rhwpWasmUrl from '@rhwp/core/rhwp_bg.wasm';
import { createEditor } from '@rhwp/editor';
import NasItemPickerDialog from '../NasItemPickerDialog';

let rhwpReadyPromise = null;

const getGlobalObject = () => {
  if (typeof window !== 'undefined') return window;
  return {};
};

const ensureRhwpReady = () => {
  if (!rhwpReadyPromise) {
    const globalObject = getGlobalObject();
    let canvasContext = null;
    let lastFont = '';
    globalObject.measureTextWidth = (font, text) => {
      if (!canvasContext) canvasContext = document.createElement('canvas').getContext('2d');
      if (font !== lastFont) {
        canvasContext.font = font;
        lastFont = font;
      }
      return canvasContext.measureText(text).width;
    };
    rhwpReadyPromise = initRhwp({ module_or_path: rhwpWasmUrl });
  }
  return rhwpReadyPromise;
};

const getLocalRhwpStudioUrl = () => `${window.location.origin}/rhwp/`;

const normalizeNasPath = (path = '/') => {
  const safe = String(path || '/');
  const withSlash = safe.startsWith('/') ? safe : `/${safe}`;
  return withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash;
};

const getPreviewNasPath = (previewUrl) => {
  try {
    const url = new URL(previewUrl, window.location.origin);
    return url.searchParams.get('path') || '';
  } catch (err) {
    return '';
  }
};

const RhwpDocumentViewer = ({ name, previewUrl, downloadUrl, nasPath: explicitNasPath = '', onSave, onDirtyChange, initialFolderPath = '/', initialMode = 'viewer' }) => {
  const containerRef = useRef(null);
  const editorHostRef = useRef(null);
  const editorRef = useRef(null);
  const [mode, setMode] = useState(initialMode === 'editor' ? 'editor' : 'viewer');
  const [buffer, setBuffer] = useState(null);
  const [pages, setPages] = useState([]);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorReadyNonce, setEditorReadyNonce] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [surfaceWidth, setSurfaceWidth] = useState(720);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsFolder, setSaveAsFolder] = useState(normalizeNasPath(initialFolderPath));
  const [saveAsFileName, setSaveAsFileName] = useState(name || 'document.hwp');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const pageWidth = Math.max(280, Math.min(1200, Math.floor((surfaceWidth - 32) * zoom)));

  const markDirty = useCallback((nextDirty = true) => {
    dirtyRef.current = !!nextDirty;
    setDirty(!!nextDirty);
    onDirtyChange?.(!!nextDirty);
  }, [onDirtyChange]);

  useEffect(() => {
    setSaveAsFolder(normalizeNasPath(initialFolderPath));
  }, [initialFolderPath]);

  useEffect(() => {
    setSaveAsFileName(name || 'document.hwp');
  }, [name]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => {
      setNotice((current) => (current === notice ? '' : current));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations?.()
        .then((registrations) => {
          registrations
            .filter((registration) => String(registration.scope || '').includes('/rhwp/'))
            .forEach((registration) => registration.unregister());
        })
        .catch(() => {});
    }
    if ('caches' in window) {
      window.caches.keys()
        .then((keys) => Promise.all(keys
          .filter((key) => String(key || '').toLowerCase().includes('rhwp'))
          .map((key) => window.caches.delete(key))))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();
    let currentStage = '한글 문서 요청 준비';
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      abortController.abort();
      setError(`한글 문서 로딩이 지연되고 있습니다. 멈춘 단계: ${currentStage}`);
      setLoading(false);
    }, 25000);
    const setStage = (stage) => {
      currentStage = stage;
      if (!cancelled) setLoadingStage(stage);
      console.info('[RHWP] load stage', { stage, name, previewUrl });
    };
    setLoading(true);
    setLoadingStage('한글 문서 요청 중');
    setError('');
    setPages([]);
    setBuffer(null);
    dirtyRef.current = false;
    setDirty(false);

    const loadDocument = async () => {
      const nasPath = explicitNasPath || getPreviewNasPath(previewUrl);
      if (nasPath) {
        console.info('[RHWP_SERVER] render request', { name, nasPath });
        setStage('서버 RHWP 렌더링 요청 중');
        const renderRes = await fetch(`/api/hwp/render?path=${encodeURIComponent(nasPath)}`, {
          credentials: 'include',
          signal: abortController.signal
        });
        console.info('[RHWP_SERVER] render response', { status: renderRes.status, name, nasPath });
        setStage(`서버 RHWP 응답 수신: ${renderRes.status}`);
        if (!renderRes.ok) {
          const message = await renderRes.text().catch(() => '');
          throw new Error(message || `서버에서 한글 문서를 렌더링하지 못했습니다. (${renderRes.status})`);
        }
        const payload = await renderRes.json();
        if (cancelled) return;
        setPages(Array.isArray(payload.pages) ? payload.pages : []);
        setStage(`완료: ${Number(payload.pageCount || 0)}페이지`);

        fetch(previewUrl, { credentials: 'include' })
          .then((res) => (res.ok ? res.arrayBuffer() : null))
          .then((arrayBuffer) => {
            if (!cancelled && arrayBuffer) setBuffer(arrayBuffer);
          })
          .catch((err) => console.warn('[RHWP] background file buffer load failed', err));
        return;
      }

      const res = await fetch(previewUrl, { credentials: 'include', signal: abortController.signal });
      setStage(`응답 수신: ${res.status}`);
      if (!res.ok) throw new Error(`한글 문서를 불러오지 못했습니다. (${res.status})`);

      const arrayBuffer = await res.arrayBuffer();
      if (cancelled) return;
      setStage(`파일 수신 완료: ${arrayBuffer.byteLength.toLocaleString()} bytes`);
      setBuffer(arrayBuffer);

      const globalObject = getGlobalObject();
      globalObject.measureTextWidth = globalObject.measureTextWidth || ((font, text) => {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = font;
        return ctx.measureText(text).width;
      });

      setStage('RHWP WASM 초기화 중');
      await ensureRhwpReady();
      if (cancelled) return;

      setStage('HWP 문서 파싱 중');
      const doc = new HwpDocument(new Uint8Array(arrayBuffer));
      const count = Math.max(0, Number(doc.pageCount?.() || 0));
      if (!count) {
        setStage('표시할 페이지 없음');
        setPages([]);
        return;
      }

      const renderedPages = [];
      for (let index = 0; index < count; index += 1) {
        if (cancelled) return;
        setStage(`페이지 렌더링 중: ${index + 1}/${count}`);
        renderedPages.push(doc.renderPageSvg(index));
      }
      if (!cancelled) {
        setPages(renderedPages);
        setStage(`완료: ${count}페이지`);
      }
    };

    loadDocument()
      .catch((err) => {
        if (!cancelled && err.name !== 'AbortError') {
          console.error('[RHWP] load failed', err);
          setError(err.message || '한글 문서를 열 수 없습니다.');
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      abortController.abort();
    };
  }, [previewUrl, explicitNasPath, name]);

  useEffect(() => () => {
    editorRef.current?.destroy?.();
    editorRef.current = null;
  }, []);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return undefined;
    const node = containerRef.current;
    const update = () => {
      const width = node.clientWidth || 720;
      setSurfaceWidth(Math.max(320, width));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [mode]);

  useEffect(() => {
    if (mode !== 'editor' || !buffer || !editorHostRef.current || editorRef.current) return undefined;
    let cancelled = false;
    setEditorLoading(true);
    setError('');

    createEditor(editorHostRef.current, {
      width: '100%',
      height: '100%',
      studioUrl: getLocalRhwpStudioUrl()
    })
      .then(async (editor) => {
        if (cancelled) {
          editor.destroy();
          return;
        }
        editorRef.current = editor;
        await editor.loadFile(buffer, name || 'document.hwp');
        if (!cancelled) setEditorReadyNonce((value) => value + 1);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || '한글 에디터를 열 수 없습니다.');
      })
      .finally(() => {
        if (!cancelled) setEditorLoading(false);
      });

    return () => {
      cancelled = true;
      if (editorRef.current) {
        editorRef.current.destroy?.();
        editorRef.current = null;
      }
    };
  }, [buffer, mode, name]);

  const exportFromEditor = async (format) => {
    if (!editorRef.current) return;
    const bytes = format === 'hwpx'
      ? await editorRef.current.exportHwpx()
      : await editorRef.current.exportHwp();
    const blob = new Blob([bytes], {
      type: format === 'hwpx' ? 'application/vnd.hancom.hwpx' : 'application/x-hwp'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const baseName = String(name || 'document').replace(/\.(hwp|hwpx)$/i, '');
    a.href = url;
    a.download = `${baseName}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getPreferredFormat = useCallback(() => String(name || '').toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp', [name]);

  const saveToNas = useCallback(async ({ fileName, targetPath } = {}) => {
    if (!editorRef.current || typeof onSave !== 'function' || saving) return false;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const finalName = String(fileName || name || '').trim() || `document.${getPreferredFormat()}`;
      const format = finalName.toLowerCase().endsWith('.hwpx') ? 'hwpx' : 'hwp';
      const bytes = format === 'hwpx'
        ? await editorRef.current.exportHwpx()
        : await editorRef.current.exportHwp();
      await onSave({
        bytes,
        format,
        fileName: finalName,
        targetPath: targetPath ? normalizeNasPath(targetPath) : undefined
      });
      const nextBuffer = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
      setBuffer(nextBuffer);
      markDirty(false);
      setNotice(targetPath ? `NAS에 ${finalName} 파일로 저장되었습니다.` : 'NAS에 저장되었습니다.');
      return true;
    } catch (err) {
      setError(err.message || 'NAS 저장에 실패했습니다.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [getPreferredFormat, markDirty, name, onSave, saving]);

  useEffect(() => {
    if (mode !== 'editor' || !dirty || saving) return undefined;
    const timer = window.setTimeout(() => {
      saveToNas();
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [dirty, mode, saveToNas, saving]);

  const openSaveAsDialog = useCallback(() => {
    setSaveAsFolder(normalizeNasPath(initialFolderPath));
    setSaveAsFileName(name || `document.${getPreferredFormat()}`);
    setSaveAsOpen(true);
  }, [getPreferredFormat, initialFolderPath, name]);

  const confirmSaveAs = useCallback(async () => {
    const trimmedName = String(saveAsFileName || '').trim();
    if (!trimmedName) {
      setError('저장할 파일 이름을 입력해 주세요.');
      return;
    }
    const ok = await saveToNas({ fileName: trimmedName, targetPath: saveAsFolder });
    if (ok) setSaveAsOpen(false);
  }, [saveAsFileName, saveAsFolder, saveToNas]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      const key = String(event.key || '').toLowerCase();
      if (mode !== 'editor' || key !== 's' || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) openSaveAsDialog();
      else saveToNas();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [mode, openSaveAsDialog, saveToNas]);

  useEffect(() => {
    if (mode !== 'editor' || !editorReadyNonce || !editorRef.current?.element) return undefined;

    const iframe = editorRef.current.element;
    const handleEditorKeyDown = (event) => {
      const key = String(event.key || '').toLowerCase();
      if (!event.ctrlKey && !event.metaKey && key.length === 1) markDirty(true);
      if (key !== 's' || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) openSaveAsDialog();
      else saveToNas();
    };
    const handleEditorMenuCommand = (event) => {
      const target = event.target;
      if (!target?.closest) return;
      const command = target.closest('[data-cmd="file:save"], [data-cmd="file:save-as"]');
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const commandName = command.getAttribute('data-cmd');
      if (commandName === 'file:save-as') openSaveAsDialog();
      else saveToNas();
    };
    const handleEditorDirtyEvent = () => markDirty(true);

    const attach = () => {
      try {
        const doc = iframe.contentDocument;
        iframe.contentWindow?.addEventListener('keydown', handleEditorKeyDown, true);
        doc?.addEventListener('keydown', handleEditorKeyDown, true);
        ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((eventName) => {
          doc?.addEventListener(eventName, handleEditorMenuCommand, true);
        });
        ['input', 'paste', 'cut', 'drop', 'compositionend'].forEach((eventName) => {
          doc?.addEventListener(eventName, handleEditorDirtyEvent, true);
        });
        [
          ['file:save', 'NAS에 저장'],
          ['file:save-as', 'NAS에 다른 이름으로 저장...']
        ].forEach(([cmd, text]) => {
          const item = doc?.querySelector(`[data-cmd="${cmd}"]`);
          if (!item) return;
          item.classList.remove('disabled');
          item.removeAttribute('aria-disabled');
          item.title = text;
          const label = item.querySelector('.md-label');
          if (label) label.textContent = text;
        });
      } catch (err) {
        console.warn('Unable to attach rhwp editor shortcut handlers', err);
      }
    };

    const detach = () => {
      try {
        iframe.contentWindow?.removeEventListener('keydown', handleEditorKeyDown, true);
        iframe.contentDocument?.removeEventListener('keydown', handleEditorKeyDown, true);
        ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach((eventName) => {
          iframe.contentDocument?.removeEventListener(eventName, handleEditorMenuCommand, true);
        });
        ['input', 'paste', 'cut', 'drop', 'compositionend'].forEach((eventName) => {
          iframe.contentDocument?.removeEventListener(eventName, handleEditorDirtyEvent, true);
        });
      } catch (err) {
        // iframe may have navigated or been destroyed.
      }
    };

    attach();
    iframe.addEventListener('load', attach);
    return () => {
      iframe.removeEventListener('load', attach);
      detach();
    };
  }, [editorReadyNonce, markDirty, mode, openSaveAsDialog, saveToNas]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: '#5f6368' }}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ p: 1, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0, flexWrap: 'wrap' }}>
        <Button size="small" variant={mode === 'viewer' ? 'contained' : 'outlined'} startIcon={<VisibilityIcon />} onClick={() => setMode('viewer')}>
          뷰어
        </Button>
        <Button size="small" variant={mode === 'editor' ? 'contained' : 'outlined'} startIcon={<EditIcon />} onClick={() => setMode('editor')} disabled={!buffer}>
          에디터
        </Button>
        {mode === 'viewer' && (
          <>
            <IconButton size="small" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.15).toFixed(2))))} aria-label="축소">
              <ZoomOutIcon fontSize="small" />
            </IconButton>
            <Typography variant="caption" sx={{ minWidth: 42, textAlign: 'center', fontWeight: 800 }}>{Math.round(zoom * 100)}%</Typography>
            <IconButton size="small" onClick={() => setZoom((value) => Math.min(3, Number((value + 0.15).toFixed(2))))} aria-label="확대">
              <ZoomInIcon fontSize="small" />
            </IconButton>
            <IconButton size="small" onClick={() => setZoom(1)} aria-label="원래 크기">
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </>
        )}
        {mode === 'editor' && (
          <>
            {typeof onSave === 'function' && (
              <Button size="small" variant="contained" startIcon={<SaveIcon />} onClick={saveToNas} disabled={!editorRef.current || saving}>
                {saving ? '저장 중...' : 'NAS 저장'}
              </Button>
            )}
            <Button size="small" onClick={() => exportFromEditor('hwp')} disabled={!editorRef.current}>HWP 내보내기</Button>
            <Button size="small" onClick={() => exportFromEditor('hwpx')} disabled={!editorRef.current}>HWPX 내보내기</Button>
            {dirty && <Typography variant="caption" color="warning.main" sx={{ fontWeight: 800 }}>저장 대기 중</Typography>}
          </>
        )}
        {downloadUrl && (
          <Button size="small" href={downloadUrl} startIcon={<DownloadIcon />} sx={{ ml: 'auto' }}>
            원본 다운로드
          </Button>
        )}
      </Stack>

      {error && <Alert severity="warning" sx={{ borderRadius: 0, flexShrink: 0 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ borderRadius: 0, flexShrink: 0 }} onClose={() => setNotice('')}>{notice}</Alert>}

      {mode === 'viewer' ? (
        <Box
          ref={containerRef}
          sx={{
            flex: '1 1 auto',
            minHeight: 0,
            height: 0,
            overflow: 'auto',
            overscrollBehavior: 'contain',
            WebkitOverflowScrolling: 'touch',
            p: { xs: 1, sm: 2 }
          }}
        >
          {loading ? (
            <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', color: '#fff', textAlign: 'center', gap: 1 }}>
              <Stack spacing={1} alignItems="center">
                <CircularProgress />
                <Typography variant="body2">{loadingStage || '한글 문서를 불러오는 중입니다...'}</Typography>
              </Stack>
            </Box>
          ) : pages.length ? (
            <Stack spacing={1.5} alignItems="center" sx={{ minWidth: pageWidth + 16, pb: 2 }}>
              {pages.map((svg, index) => (
                <Box
                  key={`rhwp-page-${index + 1}`}
                  sx={{
                    bgcolor: '#fff',
                    width: pageWidth,
                    boxShadow: '0 16px 40px rgba(0,0,0,0.24)',
                    '& svg': { display: 'block', width: '100%', height: 'auto' }
                  }}
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              ))}
            </Stack>
          ) : (
            <Box sx={{ p: 4, textAlign: 'center', color: '#fff' }}>
              <Typography>표시할 페이지가 없습니다.</Typography>
            </Box>
          )}
        </Box>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, position: 'relative', bgcolor: '#fff' }}>
          {editorLoading && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 1, bgcolor: 'rgba(255,255,255,0.72)' }}>
              <CircularProgress />
            </Box>
          )}
          <Box ref={editorHostRef} sx={{ width: '100%', height: '100%' }} />
        </Box>
      )}
      <Dialog open={saveAsOpen} onClose={() => setSaveAsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>NAS에 다른 이름으로 저장</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <TextField
              label="파일 이름"
              value={saveAsFileName}
              onChange={(event) => setSaveAsFileName(event.target.value)}
              fullWidth
              size="small"
              autoFocus
            />
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                label="저장 위치"
                value={saveAsFolder}
                fullWidth
                size="small"
                InputProps={{ readOnly: true }}
              />
              <Button variant="outlined" startIcon={<FolderOpenIcon />} onClick={() => setFolderPickerOpen(true)} sx={{ whiteSpace: 'nowrap' }}>
                위치 선택
              </Button>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setSaveAsOpen(false)} color="inherit">취소</Button>
          <Button onClick={confirmSaveAs} variant="contained" disabled={saving}>
            {saving ? '저장 중...' : '저장'}
          </Button>
        </DialogActions>
      </Dialog>
      <NasItemPickerDialog
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        initialPath={saveAsFolder}
        folderOnly
        allowCurrentFolder
        confirmLabel="이 위치 선택"
        title="저장 위치 선택"
        onSelect={(item) => {
          const isFolder = item?.type === 'folder' || item?.type === 'linked-device' || item?.isCurrentFolder;
          if (isFolder) {
            setSaveAsFolder(normalizeNasPath(item.fullPath || saveAsFolder));
            setFolderPickerOpen(false);
          }
        }}
      />
    </Box>
  );
};

export default RhwpDocumentViewer;
