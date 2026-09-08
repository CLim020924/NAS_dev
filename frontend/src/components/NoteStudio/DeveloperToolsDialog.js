import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  Stack, TextField, Tooltip, Typography
} from '@mui/material';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import SearchIcon from '@mui/icons-material/Search';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';

const messageOf = (error, fallback) => error.response?.data?.error || error.message || fallback;
const countLabel = (value) => new Intl.NumberFormat('ko-KR', { notation: value >= 10000 ? 'compact' : 'standard' }).format(value || 0);

const DeveloperToolsDialog = ({ open, notebook, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [recommendations, setRecommendations] = useState([]);
  const [changingId, setChangingId] = useState('');
  const [error, setError] = useState('');

  const loadRecommendations = useCallback(async () => {
    if (!open || !notebook?.id) return;
    try {
      const { data } = await axios.get(`/api/note-studio/notebooks/${encodeURIComponent(notebook.id)}/vscode-recommendations`, { withCredentials: true });
      setRecommendations(data.recommendations || []);
    } catch (requestError) { setError(messageOf(requestError, 'VS Code 권장 확장 목록을 불러오지 못했습니다.')); }
  }, [notebook?.id, open]);

  useEffect(() => {
    if (!open) return;
    setError('');
    setResults([]);
    setSelected(null);
    loadRecommendations();
  }, [loadRecommendations, open]);

  const runSearch = async () => {
    const value = query.trim();
    if (value.length < 2 || searching) return;
    setSearching(true);
    setError('');
    try {
      const { data } = await axios.get('/api/note-studio/dev-tools/search', { params: { q: value, size: 16 }, withCredentials: true });
      setResults(data.extensions || []);
      setTotal(data.total || 0);
      setSelected(null);
    } catch (requestError) { setError(messageOf(requestError, '개발 도구를 검색하지 못했습니다.')); }
    finally { setSearching(false); }
  };

  const selectExtension = async (extension) => {
    setSelected(extension);
    setDetailLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`/api/note-studio/dev-tools/extensions/${encodeURIComponent(extension.id)}`, { withCredentials: true });
      setSelected(data.extension || extension);
    } catch (requestError) { setError(messageOf(requestError, '확장 상세 정보를 불러오지 못했습니다.')); }
    finally { setDetailLoading(false); }
  };

  const addRecommendation = async () => {
    if (!selected?.id || changingId) return;
    setChangingId(selected.id);
    setError('');
    try {
      const { data } = await axios.post(`/api/note-studio/notebooks/${encodeURIComponent(notebook.id)}/vscode-recommendations`, { extensionId: selected.id }, { withCredentials: true });
      setRecommendations(data.recommendations || []);
    } catch (requestError) { setError(messageOf(requestError, '권장 확장에 추가하지 못했습니다.')); }
    finally { setChangingId(''); }
  };

  const removeRecommendation = async (extensionId) => {
    if (!extensionId || changingId) return;
    setChangingId(extensionId);
    setError('');
    try {
      const { data } = await axios.delete(`/api/note-studio/notebooks/${encodeURIComponent(notebook.id)}/vscode-recommendations/${encodeURIComponent(extensionId)}`, { withCredentials: true });
      setRecommendations(data.recommendations || []);
    } catch (requestError) { setError(messageOf(requestError, '권장 확장에서 제거하지 못했습니다.')); }
    finally { setChangingId(''); }
  };

  const recommended = selected && recommendations.includes(selected.id);
  const compatibilityLabel = selected?.nasCompatibility === 'adapter-required'
    ? '웹 확장 · NAS 어댑터 필요'
    : selected?.nasCompatibility === 'vscode-only'
      ? 'VS Code 전용'
      : '상세 확인 전';

  return <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { height: 'min(720px, 88vh)' } }}>
    <DialogTitle sx={{ pb: 1 }}>
      <Typography component="div" variant="h6" sx={{ fontWeight: 900 }}>개발 도구</Typography>
      <Typography variant="body2" color="text.secondary">Open VSX에서 찾고 “{notebook?.title || '프로젝트'}”의 VS Code 권장 확장으로 관리합니다.</Typography>
    </DialogTitle>
    <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Stack direction="row" spacing={1} sx={{ p: 1.5 }}>
        <TextField autoFocus fullWidth size="small" label="확장 검색" placeholder="예: Python, Prettier, YAML" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') runSearch(); }} inputProps={{ maxLength: 80 }} />
        <Button variant="contained" startIcon={searching ? <CircularProgress size={15} color="inherit" /> : <SearchIcon />} disabled={searching || query.trim().length < 2} onClick={runSearch}>검색</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ borderRadius: 0 }}>{error}</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 0.9fr) minmax(320px, 1.1fr)' }, flex: 1, minHeight: 0 }}>
        <Box sx={{ minHeight: 0, overflow: 'auto', borderRight: { md: '1px solid' }, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, py: 0.75 }}>{results.length ? `${countLabel(total)}개 중 ${results.length}개` : '검색 결과'}</Typography>
          <List dense disablePadding aria-label="Open VSX 검색 결과">
            {results.map((extension) => <ListItemButton key={extension.id} selected={selected?.id === extension.id} onClick={() => selectExtension(extension)} alignItems="flex-start">
              <ListItemIcon sx={{ minWidth: 34, pt: 0.5 }}><ExtensionOutlinedIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary={extension.displayName} secondary={`${extension.id} · ${countLabel(extension.downloadCount)} 다운로드`} primaryTypographyProps={{ fontWeight: 800, noWrap: true }} secondaryTypographyProps={{ noWrap: true }} />
              {recommendations.includes(extension.id) && <Chip size="small" label="권장됨" variant="outlined" color="success" />}
            </ListItemButton>)}
          </List>
          {!searching && query && results.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>검색 결과가 없습니다.</Typography>}
        </Box>
        <Box sx={{ minHeight: 0, overflow: 'auto', p: 2 }}>
          {!selected ? <>
            <Typography sx={{ fontWeight: 900 }}>프로젝트 권장 확장</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>.vscode/extensions.json에 저장되며 PC의 VS Code에서 프로젝트를 열 때 설치 여부를 사용자가 결정합니다.</Typography>
            <Stack spacing={0.5} sx={{ mt: 2 }}>{recommendations.map((id) => <Stack key={id} direction="row" alignItems="center" spacing={1} sx={{ minHeight: 36, borderBottom: '1px solid', borderColor: 'divider' }}><Typography variant="body2" sx={{ flex: 1, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}>{id}</Typography><Tooltip title="권장 목록에서 제거"><span><IconButton size="small" disabled={!!changingId} onClick={() => removeRecommendation(id)}><DeleteOutlineIcon fontSize="small" /></IconButton></span></Tooltip></Stack>)}</Stack>
            {!recommendations.length && <Alert severity="info" sx={{ mt: 2 }}>아직 추가한 권장 확장이 없습니다. 위에서 개발 도구를 검색하세요.</Alert>}
          </> : <>
            <Stack direction="row" spacing={1} alignItems="flex-start"><ExtensionOutlinedIcon sx={{ mt: 0.25 }} /><Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="h6" sx={{ fontWeight: 900 }}>{selected.displayName}</Typography><Typography variant="body2" color="text.secondary" sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}>{selected.id} · {selected.version}</Typography></Box>{selected.registryUrl && <Tooltip title="Open VSX 상세 페이지"><IconButton component="a" href={selected.registryUrl} target="_blank" rel="noreferrer"><OpenInNewIcon fontSize="small" /></IconButton></Tooltip>}</Stack>
            <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 1.5 }}><Chip size="small" variant="outlined" label={selected.verified ? '게시자 확인됨' : '게시자 미확인'} color={selected.verified ? 'success' : 'warning'} /><Chip size="small" variant="outlined" label={compatibilityLabel} />{selected.license && <Chip size="small" variant="outlined" label={`라이선스 ${selected.license}`} />}{selected.deprecated && <Chip size="small" color="warning" label="사용 중단됨" />}</Stack>
            <Typography sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>{selected.description || '설명이 없습니다.'}</Typography>
            {detailLoading && <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}><CircularProgress size={16} /><Typography variant="body2" color="text.secondary">호환성 확인 중…</Typography></Stack>}
            <Divider sx={{ my: 2 }} />
            <Alert severity="info">이 버튼은 NAS에서 VSIX 코드를 실행하지 않습니다. 프로젝트 권장 목록에 추가해 PC의 VS Code가 표준 방식으로 안내하게 합니다. NAS 자동완성은 검증된 언어 서버 어댑터를 별도로 연결해야 합니다.</Alert>
            <Button sx={{ mt: 2 }} variant={recommended ? 'outlined' : 'contained'} disabled={!!changingId || selected.deprecated} onClick={recommended ? () => removeRecommendation(selected.id) : addRecommendation}>{changingId === selected.id ? '처리 중…' : recommended ? '권장 목록에서 제거' : 'VS Code 권장에 추가'}</Button>
          </>}
        </Box>
      </Box>
    </DialogContent>
    <DialogActions><Button onClick={onClose}>닫기</Button></DialogActions>
  </Dialog>;
};

export default DeveloperToolsDialog;
