import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import AddIcon from '@mui/icons-material/Add';
import ArticleIcon from '@mui/icons-material/Article';
import AutoAwesomeMotionIcon from '@mui/icons-material/AutoAwesomeMotion';
import DescriptionIcon from '@mui/icons-material/Description';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import SlideshowIcon from '@mui/icons-material/Slideshow';
import TableChartIcon from '@mui/icons-material/TableChart';
import { alpha, useTheme } from '@mui/material/styles';
import { useWindows } from '../../contexts/WindowContext';
import NasItemPickerDialog from '../NasItemPickerDialog';

const SUPPORTED_EXTENSIONS = new Set([
  'doc', 'docx', 'docm', 'odt', 'rtf',
  'xls', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv',
  'ppt', 'pptx', 'pptm', 'odp',
  'hwp', 'hwpx'
]);

const DOCUMENT_TYPES = [
  { format: 'docx', label: '글 문서', detail: 'DOCX · OnlyOffice', color: '#2563eb', Icon: DescriptionIcon, defaultName: '새 글 문서' },
  { format: 'xlsx', label: '스프레드시트', detail: 'XLSX · OnlyOffice', color: '#16805d', Icon: TableChartIcon, defaultName: '새 스프레드시트' },
  { format: 'pptx', label: '프레젠테이션', detail: 'PPTX · OnlyOffice', color: '#d95d2b', Icon: SlideshowIcon, defaultName: '새 프레젠테이션' },
  { format: 'hwpx', label: '한글 문서', detail: 'HWPX · RHWP', color: '#7c3aed', Icon: ArticleIcon, defaultName: '새 한글 문서' },
  { format: 'hwp', label: '한글 97–2022', detail: 'HWP · RHWP', color: '#8b5cf6', Icon: ArticleIcon, defaultName: '새 한글 문서' }
];

const extensionOf = (name = '') => String(name).split('.').pop().toLowerCase();
const isEditableDocument = (item) => item?.type === 'file' && SUPPORTED_EXTENSIONS.has(extensionOf(item.name));
const formatModified = (value) => {
  const timestamp = Date.parse(value || '');
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
};

const DocumentWorkspace = () => {
  const theme = useTheme();
  const { openFileWindowByPath, openAppWindow } = useWindows();
  const [recentItems, setRecentItems] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedType, setSelectedType] = useState(DOCUMENT_TYPES[0]);
  const [fileName, setFileName] = useState(DOCUMENT_TYPES[0].defaultName);
  const [targetPath, setTargetPath] = useState('/문서 스튜디오');
  const [creating, setCreating] = useState(false);

  const loadRecent = useCallback(async () => {
    setLoadingRecent(true);
    setError('');
    try {
      const { data } = await axios.get('/api/recent?limit=80', { withCredentials: true });
      const documents = (Array.isArray(data?.items) ? data.items : []).filter(isEditableDocument).slice(0, 12);
      setRecentItems(documents);
    } catch (requestError) {
      setError(requestError.response?.data?.error || '최근 문서를 불러오지 못했습니다.');
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  const openDocument = useCallback(async (item) => {
    if (!item?.fullPath) return;
    setError('');
    await openFileWindowByPath(item.fullPath, item.name || null, true);
  }, [openFileWindowByPath]);

  const beginCreate = (type) => {
    setSelectedType(type);
    setFileName(type.defaultName);
    setNotice('');
    setError('');
    setCreateOpen(true);
  };

  const createDocument = async () => {
    const trimmedName = fileName.trim();
    if (!trimmedName) {
      setError('새 문서 이름을 입력해 주세요.');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const { data } = await axios.post('/api/document-workspace/documents', {
        format: selectedType.format,
        fileName: trimmedName,
        path: targetPath
      }, { withCredentials: true });
      setCreateOpen(false);
      setNotice(`${data.name} 문서를 만들었습니다. 편집기를 여는 중입니다.`);
      await loadRecent();
      await openFileWindowByPath(data.fullPath, data.name, true);
    } catch (requestError) {
      setError(requestError.response?.data?.error || '새 문서를 만들지 못했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const openConverter = () => openAppWindow({
    id: 'document-studio',
    title: '문서 변환',
    width: 1120,
    height: 760
  });

  const typeByExtension = useMemo(() => new Map(DOCUMENT_TYPES.map((item) => [item.format, item])), []);

  return (
    <Box sx={{ height: '100%', overflow: 'auto', bgcolor: 'background.default' }}>
      <Box sx={{ px: { xs: 2, md: 3 }, py: { xs: 2.5, md: 3.5 }, background: theme.palette.mode === 'dark' ? 'linear-gradient(135deg, #161a25 0%, #20243b 100%)' : 'linear-gradient(135deg, #f7f5ff 0%, #eef5ff 100%)', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
          <Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.secondary.main, 0.14), color: 'secondary.main' }}><ArticleIcon /></Box>
              <Box>
                <Typography variant="h5" sx={{ fontWeight: 950, letterSpacing: '-0.03em' }}>문서 스튜디오</Typography>
                <Typography variant="body2" color="text.secondary">NAS 문서를 만들고, 찾아서, 바로 편집하는 나만의 작업대</Typography>
              </Box>
            </Stack>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button variant="contained" startIcon={<FolderOpenIcon />} onClick={() => setFilePickerOpen(true)}>NAS 문서 열기</Button>
            <Button variant="outlined" startIcon={<AutoAwesomeMotionIcon />} onClick={openConverter}>문서 변환</Button>
          </Stack>
        </Stack>
      </Box>

      <Box sx={{ p: { xs: 2, md: 3 } }}>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice('')}>{notice}</Alert>}

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Box>
            <Typography sx={{ fontWeight: 950 }}>새 문서</Typography>
            <Typography variant="caption" color="text.secondary">선택하면 NAS에 안전하게 만든 뒤 바로 편집기로 엽니다.</Typography>
          </Box>
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))' }, gap: 1.25 }}>
          {DOCUMENT_TYPES.map((type) => {
            const Icon = type.Icon;
            return (
              <Paper
                key={type.format}
                component="button"
                type="button"
                elevation={0}
                onClick={() => beginCreate(type)}
                sx={{ p: 1.75, minHeight: 126, textAlign: 'left', cursor: 'pointer', border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary', borderRadius: 2.5, transition: 'transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease', '&:hover': { transform: 'translateY(-2px)', borderColor: alpha(type.color, 0.7), boxShadow: `0 10px 26px ${alpha(type.color, 0.14)}` }, '&:focus-visible': { outline: `3px solid ${alpha(type.color, 0.35)}`, outlineOffset: 2 } }}
              >
                <Box sx={{ width: 40, height: 40, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(type.color, 0.12), color: type.color, mb: 1.25 }}><Icon /></Box>
                <Typography sx={{ fontWeight: 900, lineHeight: 1.2 }}>{type.label}</Typography>
                <Typography variant="caption" color="text.secondary">{type.detail}</Typography>
              </Paper>
            );
          })}
        </Box>

        <Divider sx={{ my: 3 }} />

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AccessTimeIcon color="action" />
            <Box>
              <Typography sx={{ fontWeight: 950 }}>최근 문서</Typography>
              <Typography variant="caption" color="text.secondary">최근 수정된 편집 가능 문서만 모았습니다.</Typography>
            </Box>
          </Stack>
          <Tooltip title="최근 문서 새로고침"><span><IconButton onClick={loadRecent} disabled={loadingRecent}><RefreshIcon /></IconButton></span></Tooltip>
        </Stack>

        {loadingRecent ? (
          <Box sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}><CircularProgress size={28} /></Box>
        ) : recentItems.length === 0 ? (
          <Paper elevation={0} sx={{ p: 4, border: '1px dashed', borderColor: 'divider', borderRadius: 2.5, textAlign: 'center' }}>
            <ArticleIcon sx={{ fontSize: 42, color: 'text.disabled', mb: 1 }} />
            <Typography sx={{ fontWeight: 850 }}>아직 최근 문서가 없습니다.</Typography>
            <Typography variant="body2" color="text.secondary">새 문서를 만들거나 NAS 문서를 열면 여기에 나타납니다.</Typography>
          </Paper>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 1 }}>
            {recentItems.map((item) => {
              const ext = extensionOf(item.name);
              const exactType = typeByExtension.get(ext);
              const Icon = exactType?.Icon || ArticleIcon;
              const color = exactType?.color || theme.palette.primary.main;
              return (
                <Paper key={item.fullPath} elevation={0} sx={{ p: 1.35, display: 'flex', alignItems: 'center', gap: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 2, minWidth: 0 }}>
                  <Box sx={{ width: 42, height: 42, borderRadius: 1.75, flex: '0 0 auto', display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.11), color }}><Icon /></Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 850 }}>{item.name}</Typography>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      <Chip size="small" label={ext.toUpperCase()} sx={{ height: 19, fontSize: 10, fontWeight: 900 }} />
                      <Typography variant="caption" color="text.secondary" noWrap>{formatModified(item.modified)}</Typography>
                    </Stack>
                  </Box>
                  <Tooltip title="편집기로 열기"><IconButton size="small" onClick={() => openDocument(item)}><OpenInNewIcon fontSize="small" /></IconButton></Tooltip>
                </Paper>
              );
            })}
          </Box>
        )}
      </Box>

      <NasItemPickerDialog
        open={filePickerOpen}
        onClose={() => setFilePickerOpen(false)}
        title="편집할 NAS 문서 선택"
        confirmLabel="편집기로 열기"
        itemFilter={isEditableDocument}
        onSelect={(item) => {
          if (!isEditableDocument(item)) return;
          setFilePickerOpen(false);
          openDocument(item);
        }}
      />

      <Dialog open={createOpen} onClose={() => !creating && setCreateOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 950 }}>{selectedType.label} 만들기</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Alert severity="info" icon={<AddIcon />}>{selectedType.detail} 형식으로 만들고 즉시 편집기를 엽니다.</Alert>
            <TextField label="문서 이름" value={fileName} onChange={(event) => setFileName(event.target.value)} autoFocus fullWidth helperText={`확장자 .${selectedType.format}는 자동으로 붙습니다.`} />
            <Stack direction="row" spacing={1} alignItems="center">
              <TextField label="NAS 저장 위치" value={targetPath} fullWidth InputProps={{ readOnly: true }} />
              <Button variant="outlined" startIcon={<FolderOpenIcon />} onClick={() => setFolderPickerOpen(true)} sx={{ whiteSpace: 'nowrap' }}>위치 선택</Button>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button color="inherit" onClick={() => setCreateOpen(false)} disabled={creating}>취소</Button>
          <Button variant="contained" onClick={createDocument} disabled={creating} startIcon={creating ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}>{creating ? '만드는 중...' : '만들고 편집하기'}</Button>
        </DialogActions>
      </Dialog>

      <NasItemPickerDialog
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        initialPath={targetPath}
        title="새 문서 저장 위치"
        confirmLabel="이 위치 선택"
        folderOnly
        allowCurrentFolder
        onSelect={(item) => {
          if (item?.type !== 'folder' && item?.type !== 'linked-device' && !item?.isCurrentFolder) return;
          setTargetPath(item.fullPath || '/');
          setFolderPickerOpen(false);
        }}
      />
    </Box>
  );
};

export default DocumentWorkspace;
