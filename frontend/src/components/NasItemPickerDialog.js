import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Typography
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import SearchIcon from '@mui/icons-material/Search';
import axios from 'axios';

const ensureSlash = (path = '/') => {
  if (!path) return '/';
  const next = String(path).startsWith('/') ? String(path) : `/${path}`;
  return next.length > 1 && next.endsWith('/') ? next.slice(0, -1) : next;
};

const parentPathOf = (path = '/') => {
  const safe = ensureSlash(path);
  if (safe === '/') return '/';
  const parts = safe.split('/').filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join('/')}` : '/';
};

const NasItemPickerDialog = ({
  open,
  onClose,
  onSelect,
  initialPath = '/',
  title = 'NAS 항목 선택',
  confirmLabel = '선택',
  folderOnly = false,
  allowCurrentFolder = false,
  itemFilter = null
}) => {
  const [currentPath, setCurrentPath] = useState(ensureSlash(initialPath));
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCurrentPath(ensureSlash(initialPath || '/'));
    setSelected(null);
    setSearch('');
  }, [open, initialPath]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError('');
    axios.get(`/api/files?path=${encodeURIComponent(currentPath)}`, { withCredentials: true })
      .then((res) => setItems(Array.isArray(res.data) ? res.data : []))
      .catch((err) => setError(err.response?.data?.error || '목록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [open, currentPath]);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((item) => !itemFilter || item.type === 'folder' || item.type === 'linked-device' || itemFilter(item))
      .filter((item) => !q || String(item.name || '').toLowerCase().includes(q))
      .sort((a, b) => {
        const af = a.type === 'folder' || a.type === 'linked-device';
        const bf = b.type === 'folder' || b.type === 'linked-device';
        if (af !== bf) return af ? -1 : 1;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }, [itemFilter, items, search]);

  const handleConfirm = () => {
    if (!selected) return;
    onSelect?.(selected);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 900 }}>{title}</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <IconButton size="small" onClick={() => setCurrentPath(parentPathOf(currentPath))} disabled={currentPath === '/'}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
          <Typography noWrap sx={{ flex: 1, fontWeight: 800 }}>{currentPath}</Typography>
          {allowCurrentFolder && (
            <Button
              size="small"
              variant={selected?.isCurrentFolder ? 'contained' : 'outlined'}
              onClick={() => setSelected({ name: currentPath === '/' ? '루트' : currentPath.split('/').filter(Boolean).pop(), type: 'folder', fullPath: currentPath, isCurrentFolder: true })}
            >
              현재 위치
            </Button>
          )}
        </Box>
        <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          <TextField
            size="small"
            fullWidth
            placeholder="현재 폴더에서 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: 'text.secondary' }} /> }}
          />
        </Box>
        <Box sx={{ height: 360, overflow: 'auto' }}>
          {loading && <Typography sx={{ p: 2 }} color="text.secondary">불러오는 중...</Typography>}
          {!loading && error && <Typography sx={{ p: 2 }} color="error">{error}</Typography>}
          {!loading && !error && visibleItems.length === 0 && (
            <Typography sx={{ p: 2 }} color="text.secondary">표시할 항목이 없습니다.</Typography>
          )}
          <List dense disablePadding>
            {visibleItems.map((item) => {
              const fullPath = ensureSlash(item.fullPath);
              const isFolder = item.type === 'folder' || item.type === 'linked-device';
              if (folderOnly && !isFolder) return null;
              const active = selected?.fullPath === fullPath;
              return (
                <ListItemButton
                  key={fullPath}
                  selected={active}
                  onClick={() => setSelected({ ...item, fullPath })}
                  onDoubleClick={() => isFolder ? setCurrentPath(fullPath) : setSelected({ ...item, fullPath })}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}>
                    {isFolder ? <FolderIcon color="primary" /> : <InsertDriveFileIcon color="action" />}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.name}
                    secondary={isFolder ? '폴더' : '파일'}
                    primaryTypographyProps={{ noWrap: true, fontWeight: active ? 800 : 500 }}
                  />
                  {isFolder && (
                    <Button size="small" onClick={(e) => { e.stopPropagation(); setCurrentPath(fullPath); }}>
                      열기
                    </Button>
                  )}
                </ListItemButton>
              );
            })}
          </List>
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} color="inherit">취소</Button>
        <Button onClick={handleConfirm} variant="contained" disabled={!selected}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
};

export default NasItemPickerDialog;
