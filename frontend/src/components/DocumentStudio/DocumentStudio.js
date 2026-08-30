import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionIcon from '@mui/icons-material/Description';
import EastIcon from '@mui/icons-material/East';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SwapVertIcon from '@mui/icons-material/SwapVert';
import TransformIcon from '@mui/icons-material/Transform';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { alpha, useTheme } from '@mui/material/styles';
import { useTransfer } from '../../contexts/TransferContext';
import { useWindows } from '../../contexts/WindowContext';
import {
  DOCUMENT_STUDIO_ACCEPT,
  DOCUMENT_STUDIO_FORMAT_MATRIX,
  FORMAT_LABELS,
  getAvailableOutputFormats,
  getStudioAccept,
  getStudioExtension,
  isDocumentStudioFile,
  makeUniqueStudioNames,
  validateDocumentStudioSelection,
} from './documentStudioPolicy';

const MODE_CARDS = [
  { id: 'convert-pdf', title: '형식 변환', description: '원본 형식과 결과 형식을 먼저 고르고 여러 파일을 일괄 변환', icon: TransformIcon },
  { id: 'merge-pdf', title: 'PDF 합치기', description: '여러 PDF를 현재 순서대로 하나의 PDF로 결합', icon: PictureAsPdfIcon },
  { id: 'merge-mixed-pdf', title: '혼합 문서 합치기', description: 'PDF와 여러 문서 형식을 변환한 뒤 하나의 PDF로 결합', icon: MergeTypeIcon },
];

const ensureSlash = (value = '/') => `/${String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '/');
const joinNasPath = (base, name) => ensureSlash(`${ensureSlash(base)}/${String(name || '').replace(/^\/+/, '')}`);
const parentNasPath = (value) => {
  const parts = ensureSlash(value).split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
};

const DocumentStudio = () => {
  const theme = useTheme();
  const { startUpload } = useTransfer();
  const { openFileWindowByPath, openFolderWindowByPath } = useWindows();
  const deviceInputRef = useRef(null);
  const dragIndexRef = useRef(null);
  const [mode, setMode] = useState('convert-pdf');
  const [sourceFormat, setSourceFormat] = useState('auto');
  const [outputFormat, setOutputFormat] = useState('pdf');
  const [items, setItems] = useState([]);
  const [outputPath, setOutputPath] = useState('/문서 스튜디오/완료 파일');
  const [outputName, setOutputName] = useState('합친 문서.pdf');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  const [results, setResults] = useState([]);
  const [capabilities, setCapabilities] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerPath, setPickerPath] = useState('/');
  const [pickerItems, setPickerItems] = useState([]);
  const [pickerSelected, setPickerSelected] = useState({});
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    axios.get('/api/document-studio/capabilities', { withCredentials: true })
      .then(({ data }) => setCapabilities(data))
      .catch(() => setCapabilities({ libreoffice: false, pdfMerge: false }));
  }, []);

  const formatMatrix = capabilities?.formatMatrix || DOCUMENT_STUDIO_FORMAT_MATRIX;
  const availableOutputFormats = useMemo(
    () => getAvailableOutputFormats(sourceFormat, items, formatMatrix),
    [sourceFormat, items, formatMatrix]
  );

  useEffect(() => {
    if (!availableOutputFormats.includes(outputFormat)) setOutputFormat(availableOutputFormats[0] || '');
  }, [availableOutputFormats, outputFormat]);

  const activeSourceFilter = mode === 'merge-pdf' ? 'pdf' : (mode === 'convert-pdf' ? sourceFormat : 'auto');
  const activeAccept = getStudioAccept(activeSourceFilter, formatMatrix) || DOCUMENT_STUDIO_ACCEPT;

  const loadPickerPath = useCallback(async (nextPath) => {
    const safePath = ensureSlash(nextPath);
    setPickerLoading(true);
    try {
      const { data } = await axios.get('/api/files', { params: { path: safePath }, withCredentials: true });
      const rows = Array.isArray(data) ? data : [];
      setPickerItems(rows.filter((item) => item.type === 'folder' || item.type === 'linked-device' || isDocumentStudioFile(item.name, activeSourceFilter, formatMatrix)));
      setPickerPath(safePath);
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.error || 'NAS 파일 목록을 불러오지 못했습니다.' });
    } finally {
      setPickerLoading(false);
    }
  }, [activeSourceFilter, formatMatrix]);

  const openNasPicker = () => {
    setPickerSelected({});
    setPickerOpen(true);
    loadPickerPath('/');
  };

  const addPickerSelection = () => {
    const additions = Object.values(pickerSelected);
    setItems((current) => {
      const existing = new Set(current.map((item) => ensureSlash(item.fullPath).toLowerCase()));
      return [...current, ...additions.filter((item) => !existing.has(ensureSlash(item.fullPath).toLowerCase()))];
    });
    setPickerOpen(false);
    setMessage(additions.length ? { severity: 'success', text: `NAS 파일 ${additions.length}개를 추가했습니다.` } : null);
  };

  const ensureNasFolder = async (folderPath) => {
    const parts = ensureSlash(folderPath).split('/').filter(Boolean);
    let current = '/';
    for (const part of parts) {
      await axios.post('/api/file', { path: current, folderName: part }, { withCredentials: true });
      current = joinNasPath(current, part);
    }
  };

  const handleDeviceFiles = async (event) => {
    const selectedFiles = Array.from(event.target.files || []).filter((file) => isDocumentStudioFile(file.name, activeSourceFilter, formatMatrix));
    if (deviceInputRef.current) deviceInputRef.current.value = '';
    if (!selectedFiles.length) {
      setMessage({ severity: 'warning', text: '지원하는 문서 파일을 선택하세요.' });
      return;
    }

    setUploading(true);
    setMessage({ severity: 'info', text: '이 기기 파일을 NAS 작업공간으로 가져오는 중입니다.' });
    try {
      const jobFolder = `/문서 스튜디오/작업 파일/${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 7)}`;
      await ensureNasFolder(jobFolder);
      const uniqueNames = makeUniqueStudioNames(selectedFiles);
      await startUpload({
        uploadItems: selectedFiles.map((file, index) => ({ file, relPath: uniqueNames[index] })),
        targetPath: jobFolder,
        taskName: selectedFiles.length === 1 ? selectedFiles[0].name : `문서 스튜디오 입력 ${selectedFiles.length}개`,
      });
      const { data } = await axios.get('/api/files', { params: { path: jobFolder }, withCredentials: true });
      const uploadedNames = new Set((Array.isArray(data) ? data : []).filter((item) => item.type === 'file').map((item) => item.name.toLowerCase()));
      const missing = uniqueNames.filter((name) => !uploadedNames.has(name.toLowerCase()));
      if (missing.length) throw new Error('일부 파일의 업로드가 아직 완료되지 않았습니다. 전송 상태를 확인하고 다시 시도하세요.');
      setItems((current) => [
        ...current,
        ...uniqueNames.map((name, index) => ({
          id: `device-${Date.now()}-${index}`,
          source: 'device',
          name,
          originalName: selectedFiles[index].name,
          fullPath: joinNasPath(jobFolder, name),
          size: selectedFiles[index].size,
        })),
      ]);
      setMessage({ severity: 'success', text: `이 기기 파일 ${selectedFiles.length}개를 불러왔습니다.` });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.error || error.message || '이 기기 파일을 가져오지 못했습니다.' });
    } finally {
      setUploading(false);
    }
  };

  const moveItem = (from, to) => {
    if (to < 0 || to >= items.length) return;
    setItems((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const handleSourceFormatChange = (nextFormat) => {
    setSourceFormat(nextFormat);
    setItems([]);
    setResults([]);
    setMessage({ severity: 'info', text: `${FORMAT_LABELS[nextFormat]} 원본에 맞춰 파일 선택 조건을 변경했습니다.` });
  };

  const handleRun = async () => {
    const validation = validateDocumentStudioSelection(mode, items, { sourceFormat, outputFormat, matrix: formatMatrix });
    if (validation) {
      setMessage({ severity: 'warning', text: validation });
      return;
    }
    setBusy(true);
    setResults([]);
    setMessage({ severity: 'info', text: '문서를 처리하고 있습니다. 원본은 변경하지 않습니다.' });
    try {
      const { data } = await axios.post('/api/document-studio/run', {
        mode,
        sources: items.map(({ name, fullPath }) => ({ name, fullPath })),
        outputPath: ensureSlash(outputPath),
        outputName,
        sourceFormat,
        outputFormat,
      }, { withCredentials: true, timeout: 0 });
      const nextResults = Array.isArray(data?.results) ? data.results : [];
      setResults(nextResults);
      setMessage({ severity: 'success', text: `완료 파일 ${nextResults.length}개를 NAS에 저장했습니다.` });
    } catch (error) {
      setMessage({ severity: 'error', text: error.response?.data?.error || '문서 작업에 실패했습니다.' });
    } finally {
      setBusy(false);
    }
  };

  const selectionError = useMemo(
    () => validateDocumentStudioSelection(mode, items, { sourceFormat, outputFormat, matrix: formatMatrix }),
    [mode, items, sourceFormat, outputFormat, formatMatrix]
  );
  const runButtonLabel = useMemo(() => {
    const count = items.length;
    if (mode === 'merge-pdf') return `PDF ${count}개 합치기`;
    if (mode === 'merge-mixed-pdf') return `문서 ${count}개를 PDF로 합치기`;
    const detected = sourceFormat === 'auto' && items.length > 0
      ? [...new Set(items.map((item) => getStudioExtension(item.name)))].map((format) => FORMAT_LABELS[format] || format.toUpperCase()).join('·')
      : FORMAT_LABELS[sourceFormat];
    return `${detected || '문서'} ${count}개를 ${(FORMAT_LABELS[outputFormat] || outputFormat.toUpperCase())}로 변환`;
  }, [items, mode, sourceFormat, outputFormat]);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}>
      <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between">
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 950 }}>문서 스튜디오</Typography>
            <Typography variant="body2" color="text.secondary">NAS 파일과 이 기기 파일을 함께 변환하고 합칩니다.</Typography>
          </Box>
          <Stack direction="row" spacing={0.75}>
            <Chip size="small" color={capabilities?.libreoffice ? 'success' : 'default'} label={capabilities?.libreoffice ? '문서 변환 준비됨' : '문서 변환 확인 중'} />
            <Chip size="small" color={capabilities?.pdfMerge ? 'success' : 'default'} label={capabilities?.pdfMerge ? 'PDF 합치기 준비됨' : 'PDF 도구 확인 중'} />
          </Stack>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: { xs: 1.25, md: 2 } }}>
        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1 }}>
            {MODE_CARDS.map((card) => {
              const Icon = card.icon;
              const selected = mode === card.id;
              return (
                <Paper key={card.id} component="button" type="button" onClick={() => { setMode(card.id); setResults([]); }} elevation={0} sx={{ p: 1.5, textAlign: 'left', cursor: 'pointer', border: `1px solid ${selected ? theme.palette.primary.main : theme.palette.divider}`, borderRadius: 2, bgcolor: selected ? alpha(theme.palette.primary.main, 0.09) : 'background.paper', color: 'text.primary', '&:hover': { borderColor: theme.palette.primary.main, bgcolor: alpha(theme.palette.primary.main, 0.06) } }}>
                  <Stack direction="row" spacing={1.25} alignItems="center">
                    <Box sx={{ width: 38, height: 38, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.primary.main, selected ? 0.18 : 0.08), color: 'primary.main' }}><Icon /></Box>
                    <Box><Typography sx={{ fontWeight: 900 }}>{card.title}</Typography><Typography variant="caption" color="text.secondary">{card.description}</Typography></Box>
                  </Stack>
                </Paper>
              );
            })}
          </Box>

          {mode === 'convert-pdf' && (
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.025) }}>
              <Typography sx={{ fontWeight: 950 }}>1. 변환 형식 선택</Typography>
              <Typography variant="caption" color="text.secondary">원본 형식을 직접 고르면 파일 선택창에도 그 형식만 표시됩니다. 자동 감지는 여러 형식을 섞을 때 사용하세요.</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25} alignItems="center" sx={{ mt: 1.25 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel id="document-studio-source-format-label">원본 형식</InputLabel>
                  <Select labelId="document-studio-source-format-label" label="원본 형식" value={sourceFormat} onChange={(event) => handleSourceFormatChange(event.target.value)}>
                    <MenuItem value="auto"><strong>자동 감지</strong></MenuItem>
                    {Object.keys(FORMAT_LABELS).filter((format) => format !== 'auto').map((format) => {
                      const unavailable = (formatMatrix[format] || []).length === 0;
                      return <MenuItem key={format} value={format} disabled={unavailable}>{FORMAT_LABELS[format]}{unavailable ? ' · 변환 도구 준비 필요' : ''}</MenuItem>;
                    })}
                  </Select>
                </FormControl>
                <EastIcon color="primary" sx={{ flexShrink: 0, transform: { xs: 'rotate(90deg)', sm: 'none' } }} />
                <FormControl size="small" fullWidth disabled={availableOutputFormats.length === 0}>
                  <InputLabel id="document-studio-output-format-label">결과 형식</InputLabel>
                  <Select labelId="document-studio-output-format-label" label="결과 형식" value={outputFormat} onChange={(event) => setOutputFormat(event.target.value)}>
                    {availableOutputFormats.map((format) => <MenuItem key={format} value={format}>{FORMAT_LABELS[format] || format.toUpperCase()}</MenuItem>)}
                  </Select>
                </FormControl>
              </Stack>
              {sourceFormat === 'auto' && items.length === 0 && <Typography variant="caption" color="info.main" sx={{ display: 'block', mt: 0.75 }}>파일을 추가하면 감지된 원본들의 공통 결과 형식만 자동으로 남습니다.</Typography>}
            </Paper>
          )}

          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
              <Box><Typography sx={{ fontWeight: 900 }}>{mode === 'convert-pdf' ? '2' : '1'}. 파일 불러오기</Typography><Typography variant="caption" color="text.secondary">두 출처의 파일을 같은 목록에 추가할 수 있습니다.</Typography></Box>
              <Stack direction="row" spacing={1}>
                <Button variant="outlined" startIcon={<FolderOpenIcon />} onClick={openNasPicker}>NAS에서 불러오기</Button>
                <Button variant="contained" startIcon={uploading ? <CircularProgress size={16} color="inherit" /> : <UploadFileIcon />} disabled={uploading} onClick={() => deviceInputRef.current?.click()}>이 기기에서 불러오기</Button>
                <input ref={deviceInputRef} type="file" accept={activeAccept} multiple hidden onChange={handleDeviceFiles} />
              </Stack>
            </Stack>
            <Divider sx={{ my: 1.25 }} />
            {items.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}><DescriptionIcon sx={{ fontSize: 42, opacity: 0.4 }} /><Typography>파일을 불러오면 이곳에 순서대로 표시됩니다.</Typography></Box>
            ) : (
              <Stack spacing={0.75}>
                <Stack direction="row" justifyContent="space-between" alignItems="center"><Typography variant="caption" color="text.secondary">끌어서 놓거나 화살표로 순서를 바꿀 수 있습니다.</Typography><Button size="small" startIcon={<SwapVertIcon />} onClick={() => setItems((current) => [...current].reverse())}>순서 반전</Button></Stack>
                {items.map((item, index) => (
                  <Paper key={`${item.fullPath}-${index}`} draggable onDragStart={() => { dragIndexRef.current = index; }} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragIndexRef.current !== null) moveItem(dragIndexRef.current, index); dragIndexRef.current = null; }} elevation={0} sx={{ px: 1, py: 0.75, display: 'flex', gap: 1, alignItems: 'center', border: `1px solid ${theme.palette.divider}`, borderRadius: 1.5, cursor: 'grab' }}>
                    <Box sx={{ width: 28, height: 28, borderRadius: 1, display: 'grid', placeItems: 'center', bgcolor: 'action.hover', fontWeight: 900 }}>{index + 1}</Box>
                    <InsertDriveFileIcon color="action" fontSize="small" />
                    <Box sx={{ minWidth: 0, flex: 1 }}><Typography noWrap sx={{ fontWeight: 800, fontSize: '0.88rem' }}>{item.originalName || item.name}</Typography><Typography noWrap variant="caption" color="text.secondary">{item.source === 'device' ? '이 기기에서 불러옴' : 'NAS'} · {ensureSlash(item.fullPath)}</Typography></Box>
                    <Tooltip title="위로"><span><IconButton size="small" disabled={index === 0} onClick={() => moveItem(index, index - 1)}><ArrowUpwardIcon fontSize="small" /></IconButton></span></Tooltip>
                    <Tooltip title="아래로"><span><IconButton size="small" disabled={index === items.length - 1} onClick={() => moveItem(index, index + 1)}><ArrowDownwardIcon fontSize="small" /></IconButton></span></Tooltip>
                    <IconButton size="small" color="error" aria-label={`${item.name} 제거`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><DeleteOutlineIcon fontSize="small" /></IconButton>
                  </Paper>
                ))}
              </Stack>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
            <Typography sx={{ fontWeight: 900, mb: 1 }}>{mode === 'convert-pdf' ? '3' : '2'}. 완료 파일 저장</Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
              <TextField fullWidth size="small" label="NAS 완료 폴더" value={outputPath} onChange={(event) => setOutputPath(event.target.value)} />
              {mode !== 'convert-pdf' && <TextField fullWidth size="small" label="완료 파일 이름" value={outputName} onChange={(event) => setOutputName(event.target.value)} />}
              <Button variant="contained" size="large" startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <PlayArrowIcon />} disabled={busy || uploading || !!selectionError || !outputFormat} onClick={handleRun} sx={{ minWidth: 210, whiteSpace: 'nowrap' }}>{runButtonLabel}</Button>
            </Stack>
            {selectionError && items.length > 0 && <Typography variant="caption" color="warning.main" sx={{ display: 'block', mt: 0.75 }}>{selectionError}</Typography>}
          </Paper>

          {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}

          {results.length > 0 && (
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, borderColor: 'success.main' }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}><Stack direction="row" spacing={1} alignItems="center"><CheckCircleIcon color="success" /><Typography sx={{ fontWeight: 900 }}>완료 파일</Typography></Stack><Button startIcon={<FolderOpenIcon />} onClick={() => openFolderWindowByPath(ensureSlash(outputPath))}>완료 파일 폴더 열기</Button></Stack>
              <Stack spacing={0.75}>{results.map((result) => {
                const isPdf = (result.outputFormat || getStudioExtension(result.name)) === 'pdf';
                const compatibilityLabel = result.compatibility === 'original-pdf-merge'
                  ? '원본 PDF 결합'
                  : result.compatibility === 'original-pdf'
                    ? '원본 PDF'
                    : result.compatibility === 'original-format-copy'
                      ? '원본 형식 유지 복사'
                      : `${FORMAT_LABELS[result.sourceFormat] || result.sourceFormat?.toUpperCase() || '문서'} → ${FORMAT_LABELS[result.outputFormat] || result.outputFormat?.toUpperCase() || '결과'} 호환 변환`;
                return <Paper key={result.fullPath} elevation={0} sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover', borderRadius: 1.5 }}>{isPdf ? <PictureAsPdfIcon color="error" /> : <InsertDriveFileIcon color="primary" />}<Box sx={{ flex: 1, minWidth: 0 }}><Typography noWrap sx={{ fontWeight: 800 }}>{result.name}</Typography><Typography variant="caption" color="text.secondary">{compatibilityLabel}</Typography></Box><Button size="small" endIcon={<OpenInNewIcon />} onClick={() => openFileWindowByPath(result.fullPath)}>열기</Button></Paper>;
              })}</Stack>
            </Paper>
          )}
        </Stack>
      </Box>

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>NAS에서 파일 불러오기</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ px: 1.5, py: 1, borderBottom: `1px solid ${theme.palette.divider}` }}><IconButton size="small" disabled={pickerPath === '/'} onClick={() => loadPickerPath(parentNasPath(pickerPath))}><ArrowBackIcon fontSize="small" /></IconButton><Typography variant="body2" sx={{ fontWeight: 800 }}>{pickerPath}</Typography></Stack>
          {pickerLoading ? <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box> : <Stack divider={<Divider flexItem />}>{pickerItems.map((item) => {
            const isFolder = item.type === 'folder' || item.type === 'linked-device';
            const fullPath = ensureSlash(item.fullPath);
            const checked = !!pickerSelected[fullPath];
            return <Box key={fullPath} onDoubleClick={() => isFolder && loadPickerPath(fullPath)} sx={{ px: 1.5, py: 0.7, display: 'flex', alignItems: 'center', gap: 1, cursor: isFolder ? 'pointer' : 'default', '&:hover': { bgcolor: 'action.hover' } }}>{isFolder ? <FolderIcon color="primary" /> : <Checkbox size="small" checked={checked} onChange={(event) => setPickerSelected((current) => { const next = { ...current }; if (event.target.checked) next[fullPath] = { id: `nas-${fullPath}`, source: 'nas', name: item.name, fullPath }; else delete next[fullPath]; return next; })} />}<Typography sx={{ flex: 1, fontWeight: isFolder ? 800 : 600 }}>{item.name}</Typography>{isFolder && <IconButton size="small" onClick={() => loadPickerPath(fullPath)}><ChevronRightIcon /></IconButton>}</Box>;
          })}{pickerItems.length === 0 && <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>지원하는 문서가 없습니다.</Typography>}</Stack>}
        </DialogContent>
        <DialogActions><Button onClick={() => setPickerOpen(false)}>취소</Button><Button variant="contained" disabled={Object.keys(pickerSelected).length === 0} onClick={addPickerSelection}>선택한 파일 추가 ({Object.keys(pickerSelected).length})</Button></DialogActions>
      </Dialog>
    </Box>
  );
};

export default DocumentStudio;
