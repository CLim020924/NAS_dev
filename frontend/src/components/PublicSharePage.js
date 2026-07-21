import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import FilePreviewSurface from './shared/FilePreviewSurface';
import { transferUrl } from '../transferBaseUrl';

const encodePath = (path = '') => encodeURIComponent(path || '');

const parentPathOf = (path = '') => {
  const parts = String(path || '').split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
};

const breadcrumbsOf = (path = '') => {
  const parts = String(path || '').split('/').filter(Boolean);
  return parts.map((part, index) => ({
    label: part,
    path: parts.slice(0, index + 1).join('/')
  }));
};

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const size = value / (1024 ** index);
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)}${units[index]}`;
};

const PublicSharePage = () => {
  const { token } = useParams();
  const [share, setShare] = useState(null);
  const [items, setItems] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [selected, setSelected] = useState([]);
  const [selectedMenuAnchorEl, setSelectedMenuAnchorEl] = useState(null);
  const [previewItem, setPreviewItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const baseApi = `/api/public-shares/${encodeURIComponent(token || '')}`;
  const isFolderLikeShare = share?.type === 'folder' || share?.type === 'bundle';

  const loadShare = () => {
    setLoading(true);
    setError('');
    fetch(baseApi, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.status === 423 && data.requiresPassword) {
          setShare(data.share || null);
          setRequiresPassword(true);
          return;
        }
        if (!res.ok) throw new Error(data.error || '공유 링크를 열 수 없습니다.');
        setShare(data.share);
        setRequiresPassword(false);
        if (data.share?.type === 'file') {
          setPreviewItem({ name: data.share.name, relativePath: '', type: 'file', size: data.share.size });
        }
      })
      .catch((err) => setError(err.message || '공유 링크를 열 수 없습니다.'))
      .finally(() => setLoading(false));
  };

  const loadList = (path = '') => {
    setListLoading(true);
    setError('');
    return fetch(`${baseApi}/list?path=${encodePath(path)}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || '공유 폴더를 열 수 없습니다.');
        setItems(Array.isArray(data.items) ? data.items : []);
        setCurrentPath(data.path || '');
        setPreviewItem(null);
      })
      .catch((err) => setError(err.message || '공유 폴더를 열 수 없습니다.'))
      .finally(() => setListLoading(false));
  };

  useEffect(() => {
    setSelected([]);
    setSelectedMenuAnchorEl(null);
    loadShare();
  }, [token]);

  useEffect(() => {
    if (!requiresPassword && isFolderLikeShare) loadList(currentPath || '');
  }, [share?.shareId, share?.type, requiresPassword]);

  const selectedItems = useMemo(() => selected, [selected]);
  const selectedFiles = useMemo(() => selectedItems.filter((item) => item.type === 'file'), [selectedItems]);
  const selectedHasFolder = useMemo(() => selectedItems.some((item) => item.type === 'folder'), [selectedItems]);
  const breadcrumbItems = useMemo(() => breadcrumbsOf(currentPath), [currentPath]);
  const selectedPathSet = useMemo(() => new Set(selectedItems.map((item) => item.relativePath)), [selectedItems]);

  const previewUrlFor = (item) => `${baseApi}/preview?path=${encodePath(item?.relativePath || '')}`;
  const downloadUrlFor = (item) => transferUrl(`${baseApi}/download?path=${encodePath(item?.relativePath || '')}`);
  const folderDownloadUrl = transferUrl(`${baseApi}/download-folder?path=${encodePath(currentPath)}`);
  const canSelectFolder = share?.allowDownload !== false;

  const toggleSelected = (item) => {
    if (item.type === 'folder' && !canSelectFolder) return;
    setSelected((prev) => prev.some((entry) => entry.relativePath === item.relativePath)
      ? prev.filter((entry) => entry.relativePath !== item.relativePath)
      : [...prev, {
        relativePath: item.relativePath,
        name: item.name,
        type: item.type,
        size: item.size || null,
        parentPath: parentPathOf(item.relativePath)
      }]);
  };

  const triggerBlobDownload = async (url, options, filename) => {
    const res = await fetch(url, options);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '다운로드에 실패했습니다.');
    }
    const blob = await res.blob();
    const objectUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(objectUrl);
  };

  const downloadSelected = async () => {
    if (selectedItems.length === 0) return;
    setError('');
    try {
      if (selectedHasFolder || selectedItems.length > 1) {
        await triggerBlobDownload(`${baseApi}/download-selected`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: selectedItems.map((item) => item.relativePath) })
        }, `${share?.name || 'selected-items'}-selected.zip`);
        return;
      }

      const onlyFile = selectedFiles[0];
      if (onlyFile) {
        const a = document.createElement('a');
        a.href = downloadUrlFor(onlyFile);
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err) {
      setError(err.message || '선택 항목을 다운로드할 수 없습니다.');
    }
  };

  const openSelectedItem = async (item) => {
    setSelectedMenuAnchorEl(null);
    if (!item) return;
    if (item.parentPath !== currentPath) {
      await loadList(item.parentPath || '');
    }
    if (item.type === 'file') {
      setPreviewItem(item);
    }
  };

  const submitPassword = async () => {
    setPasswordError('');
    try {
      const res = await fetch(`${baseApi}/password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '비밀번호 확인에 실패했습니다.');
      setRequiresPassword(false);
      setPassword('');
      setSelected([]);
      loadShare();
    } catch (err) {
      setPasswordError(err.message || '비밀번호 확인에 실패했습니다.');
    }
  };

  if (loading) {
    return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
  }

  if (error && !share) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
        <Paper sx={{ p: 4, maxWidth: 520, textAlign: 'center' }}>
          <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>공유 링크를 열 수 없습니다</Typography>
          <Typography color="text.secondary">{error}</Typography>
        </Paper>
      </Box>
    );
  }

  if (requiresPassword) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
        <Paper sx={{ p: 4, width: '100%', maxWidth: 460 }}>
          <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>{share?.name || '보호된 공유 링크'}</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>이 공유 링크는 비밀번호가 필요합니다.</Typography>
          {passwordError && <Alert severity="error" sx={{ mb: 2 }}>{passwordError}</Alert>}
          <TextField
            autoFocus
            fullWidth
            type="password"
            label="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitPassword(); }}
            sx={{ mb: 2 }}
          />
          <Button fullWidth variant="contained" disabled={!password} onClick={submitPassword}>열기</Button>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', py: { xs: 1, md: 4 } }}>
      <Container maxWidth="lg" sx={{ px: { xs: 1, sm: 2, md: 3 } }}>
        <Paper sx={{ overflow: { xs: 'visible', md: 'hidden' }, borderRadius: { xs: 1.5, md: 2 } }}>
          <Box sx={{ p: { xs: 2, md: 3 }, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h5" sx={{ fontWeight: 900, wordBreak: 'break-word' }}>{share?.name}</Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                  <Chip size="small" label={share?.type === 'bundle' ? '묶음 공유' : (share?.type === 'folder' ? '폴더 공유' : '파일 공유')} />
                  <Chip size="small" color="primary" variant="outlined" label={`만료 ${new Date(share?.expiresAt).toLocaleDateString()}`} />
                  {share?.requiresPassword && <Chip size="small" variant="outlined" label="비밀번호 보호" />}
                  {Number(share?.maxViews || 0) > 0 && <Chip size="small" variant="outlined" label={`열람 ${share.viewCount || 0}/${share.maxViews}`} />}
                  {Number(share?.maxDownloads || 0) > 0 && <Chip size="small" variant="outlined" label={`다운로드 ${share.downloadCount || 0}/${share.maxDownloads}`} />}
                  {share?.ownerDisplayName && <Chip size="small" variant="outlined" label={`공유자 ${share.ownerDisplayName}`} />}
                </Stack>
                {share?.note && (
                  <Alert severity="info" sx={{ mt: 1.5 }}>
                    {share.note}
                  </Alert>
                )}
              </Box>
              {share?.type === 'file' && share?.allowDownload && (
                <Button href={downloadUrlFor({ relativePath: '', name: share.name })} variant="contained" startIcon={<DownloadIcon />}>
                  다운로드
                </Button>
              )}
            </Stack>
          </Box>

          {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}

          {share?.type === 'file' ? (
            <Box sx={{ height: { xs: 'calc(100dvh - 132px)', md: '76vh' }, minHeight: { xs: 420, md: '76vh' }, bgcolor: 'background.paper', overflow: 'hidden' }}>
              {share.allowPreview ? (
                <FilePreviewSurface name={share.name} previewUrl={previewUrlFor({ relativePath: '', name: share.name })} downloadUrl={downloadUrlFor({ relativePath: '', name: share.name })} />
              ) : (
                <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 3, textAlign: 'center' }}>
                  <Box>
                    <Typography sx={{ fontWeight: 900, mb: 1 }}>미리보기가 꺼져 있습니다</Typography>
                    <Typography color="text.secondary">공유자가 다운로드만 허용했습니다.</Typography>
                  </Box>
                </Box>
              )}
            </Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: previewItem ? '360px 1fr' : '1fr' }, minHeight: { xs: previewItem ? 'auto' : '70dvh', md: '70vh' } }}>
              <Box sx={{ borderRight: { md: previewItem ? '1px solid' : 'none' }, borderColor: 'divider', minWidth: 0 }}>
                <Box sx={{ p: 1.5, display: { xs: previewItem ? 'none' : 'flex', md: 'flex' }, alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}>
                  <IconButton size="small" disabled={!currentPath} onClick={() => loadList(parentPathOf(currentPath))}>
                    <ArrowBackIcon fontSize="small" />
                  </IconButton>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flex: 1, minWidth: 180, overflow: 'hidden', flexWrap: 'wrap' }}>
                    <Button size="small" variant={!currentPath ? 'contained' : 'text'} onClick={() => loadList('')}>
                      루트
                    </Button>
                    {breadcrumbItems.map((crumb) => (
                      <React.Fragment key={crumb.path}>
                        <Typography variant="body2" color="text.secondary">/</Typography>
                        <Button size="small" onClick={() => loadList(crumb.path)} sx={{ maxWidth: 160 }}>
                          <Typography noWrap variant="body2">{crumb.label}</Typography>
                        </Button>
                      </React.Fragment>
                    ))}
                  </Stack>
                  {share?.allowFolderDownload && (
                    <Button size="small" href={folderDownloadUrl} startIcon={<DownloadIcon />}>ZIP</Button>
                  )}
                  <Button
                    size="small"
                    variant={selectedItems.length ? 'outlined' : 'text'}
                    disabled={selectedItems.length === 0}
                    onClick={(event) => setSelectedMenuAnchorEl(event.currentTarget)}
                  >
                    선택한 항목 {selectedItems.length}개
                  </Button>
                  <Button size="small" disabled={selectedItems.length === 0} onClick={downloadSelected}>
                    {selectedHasFolder || selectedItems.length > 1 ? 'ZIP으로 다운로드' : '다운로드'}
                  </Button>
                </Box>
                {listLoading ? (
                  <Box sx={{ p: 3, textAlign: 'center', display: { xs: previewItem ? 'none' : 'block', md: 'block' } }}><CircularProgress /></Box>
                ) : (
                  <List disablePadding sx={{ maxHeight: { md: '70vh' }, overflow: 'auto', display: { xs: previewItem ? 'none' : 'block', md: 'block' } }}>
                    {items.map((item) => {
                      const isFolder = item.type === 'folder';
                      const checked = selectedPathSet.has(item.relativePath);
                      return (
                        <ListItemButton
                          key={item.relativePath || item.name}
                          onClick={() => isFolder ? (item.canEnter ? loadList(item.relativePath) : null) : setPreviewItem(item)}
                          onDoubleClick={() => !isFolder && share?.allowDownload && window.open(downloadUrlFor(item), '_blank')}
                          disabled={isFolder && !item.canEnter}
                        >
                          <Checkbox
                            edge="start"
                            checked={checked}
                            disabled={isFolder && !canSelectFolder}
                            onClick={(e) => { e.stopPropagation(); toggleSelected(item); }}
                          />
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            {isFolder ? <FolderIcon color="primary" /> : <InsertDriveFileIcon color="action" />}
                          </ListItemIcon>
                          <ListItemText
                            primary={item.name}
                            secondary={isFolder ? (item.canEnter ? '폴더' : '하위 폴더 제외됨') : formatBytes(item.size)}
                            primaryTypographyProps={{ noWrap: true, fontWeight: previewItem?.relativePath === item.relativePath ? 900 : 500 }}
                          />
                          {!isFolder && (
                            <IconButton size="small" href={downloadUrlFor(item)} onClick={(e) => e.stopPropagation()}>
                              <DownloadIcon fontSize="small" />
                            </IconButton>
                          )}
                        </ListItemButton>
                      );
                    })}
                    {items.length === 0 && (
                      <Typography sx={{ p: 3 }} color="text.secondary">공유된 폴더가 비어 있습니다.</Typography>
                    )}
                  </List>
                )}
              </Box>

              <Menu
                anchorEl={selectedMenuAnchorEl}
                open={Boolean(selectedMenuAnchorEl)}
                onClose={() => setSelectedMenuAnchorEl(null)}
                PaperProps={{ sx: { width: 360, maxWidth: 'calc(100vw - 32px)' } }}
              >
                {selectedItems.length === 0 ? (
                  <MenuItem disabled>선택된 항목이 없습니다</MenuItem>
                ) : (
                  selectedItems.map((item) => (
                    <MenuItem
                      key={item.relativePath}
                      onClick={() => openSelectedItem(item)}
                    >
                      <ListItemIcon sx={{ minWidth: 34 }}>
                        {item.type === 'folder' ? <FolderIcon color="primary" fontSize="small" /> : <InsertDriveFileIcon fontSize="small" />}
                      </ListItemIcon>
                      <ListItemText
                        primary={item.name}
                        secondary={item.relativePath || '/'}
                        primaryTypographyProps={{ noWrap: true }}
                        secondaryTypographyProps={{ noWrap: true }}
                      />
                      <IconButton
                        size="small"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelected((prev) => prev.filter((entry) => entry.relativePath !== item.relativePath));
                        }}
                        aria-label="선택 해제"
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </MenuItem>
                  ))
                )}
                {selectedItems.length > 0 && (
                  <>
                    <Divider />
                    <MenuItem
                      onClick={() => {
                        setSelected([]);
                        setSelectedMenuAnchorEl(null);
                      }}
                    >
                      선택 모두 해제
                    </MenuItem>
                  </>
                )}
              </Menu>

              {previewItem && (
                <Box sx={{ height: { xs: 'calc(100dvh - 136px)', md: '70vh' }, minHeight: { xs: 420, md: '70vh' }, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                    <IconButton size="small" onClick={() => setPreviewItem(null)} sx={{ display: { xs: 'inline-flex', md: 'none' } }} aria-label="목록으로 돌아가기">
                      <ArrowBackIcon fontSize="small" />
                    </IconButton>
                    <Typography noWrap sx={{ flex: 1, fontWeight: 900 }}>{previewItem.name}</Typography>
                    <Button size="small" href={downloadUrlFor(previewItem)} target="_blank" startIcon={<DownloadIcon />}>다운로드</Button>
                    <IconButton size="small" href={previewUrlFor(previewItem)} target="_blank">
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <Divider />
                  <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    {share?.allowPreview ? (
                      <FilePreviewSurface name={previewItem.name} previewUrl={previewUrlFor(previewItem)} downloadUrl={downloadUrlFor(previewItem)} />
                    ) : (
                      <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 3, textAlign: 'center' }}>
                        <Typography color="text.secondary">미리보기가 허용되지 않은 공유 링크입니다.</Typography>
                      </Box>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Paper>
      </Container>
    </Box>
  );
};

export default PublicSharePage;
