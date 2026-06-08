import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Checkbox,
  IconButton,
  CircularProgress,
  Divider,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import axios from 'axios';

const normalizePath = (value = '/') => {
  if (!value || value === 'undefined') return '/';
  const cleaned = String(value).replace(/\\/g, '/');
  return cleaned.startsWith('/') ? cleaned : `/${cleaned}`;
};

const getParentPath = (currentPath) => {
  const safe = normalizePath(currentPath);
  if (safe === '/') return '/';
  const segments = safe.split('/').filter(Boolean);
  segments.pop();
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
};

const ChatNasPickerDialog = ({
  open,
  onClose,
  onConfirm,
  title = 'NAS에서 선택',
  allowFiles = true,
  allowFolders = true,
}) => {
  const [currentPath, setCurrentPath] = useState('/');
  const [items, setItems] = useState([]);
  const [selectedPaths, setSelectedPaths] = useState([]);
  const [loading, setLoading] = useState(false);

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [items]);

  const canSelectItem = useCallback((item) => {
    if (!item) return false;
    if (item.type === 'folder') return allowFolders;
    if (item.type === 'file') return allowFiles;
    return false;
  }, [allowFiles, allowFolders]);

  const loadItems = useCallback(async (pathValue) => {
    try {
      setLoading(true);
      const safePath = normalizePath(pathValue);
      const res = await axios.get('/api/files', {
        params: { path: safePath },
        withCredentials: true,
      });
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error('NAS 선택 목록 로드 실패', err);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setCurrentPath('/');
    setSelectedPaths([]);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    loadItems(currentPath);
  }, [open, currentPath, loadItems]);

  const toggleSelect = (item) => {
    if (!canSelectItem(item)) return;
    const safePath = normalizePath(item.fullPath || '/');

    setSelectedPaths((prev) =>
      prev.includes(safePath)
        ? prev.filter((path) => path !== safePath)
        : [...prev, safePath]
    );
  };

  const handleRowClick = (item) => {
    if (item.type === 'folder') {
      setCurrentPath(normalizePath(item.fullPath));
      return;
    }
    toggleSelect(item);
  };

  const handleConfirm = () => {
    if (!selectedPaths.length) return;
    onConfirm(selectedPaths);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: { borderRadius: 3, minHeight: 480 } }}
    >
      <DialogTitle sx={{ fontWeight: 800 }}>
        {title}
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            px: 2,
            py: 1.25,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
            backgroundColor: 'background.default',
          }}
        >
          <IconButton
            size="small"
            onClick={() => setCurrentPath((prev) => getParentPath(prev))}
            disabled={currentPath === '/'}
          >
            <ArrowBackIcon fontSize="small" />
          </IconButton>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {currentPath}
          </Typography>
        </Box>

        <Box sx={{ px: 2, py: 1 }}>
          <Typography variant="caption" color="text.secondary">
            폴더는 클릭하면 진입합니다. 체크박스로 파일/폴더를 선택한 뒤 확인하세요.
          </Typography>
        </Box>

        <Divider />

        <Box sx={{ flex: 1, minHeight: 320, overflowY: 'auto' }}>
          {loading ? (
            <Box sx={{ py: 8, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={28} />
            </Box>
          ) : sortedItems.length === 0 ? (
            <Box sx={{ p: 3 }}>
              <Typography variant="body2" color="text.secondary">
                이 위치에는 선택할 항목이 없습니다.
              </Typography>
            </Box>
          ) : (
            <List disablePadding>
              {sortedItems.map((item) => {
                const safePath = normalizePath(item.fullPath);
                const checked = selectedPaths.includes(safePath);
                const selectable = canSelectItem(item);

                return (
                  <ListItemButton
                    key={safePath}
                    onClick={() => handleRowClick(item)}
                    sx={{ py: 1.1, px: 2 }}
                  >
                    <ListItemIcon sx={{ minWidth: 34 }}>
                      {item.type === 'folder' ? (
                        <FolderIcon sx={{ color: 'warning.main' }} />
                      ) : (
                        <InsertDriveFileIcon sx={{ color: 'text.secondary' }} />
                      )}
                    </ListItemIcon>

                    <ListItemText
                      primary={item.name}
                      secondary={item.type === 'folder' ? '폴더' : '파일'}
                    />

                    {selectable && (
                      <Checkbox
                        edge="end"
                        checked={checked}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleSelect(item)}
                      />
                    )}
                  </ListItemButton>
                );
              })}
            </List>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Box sx={{ mr: 'auto', pl: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            선택됨 {selectedPaths.length}개
          </Typography>
        </Box>
        <Button onClick={onClose} color="inherit">
          취소
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={selectedPaths.length === 0}
        >
          선택
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ChatNasPickerDialog;
