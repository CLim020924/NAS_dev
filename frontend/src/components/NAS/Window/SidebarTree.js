import React, { useState, useEffect, useCallback } from 'react';
import { Box, List, ListItem, ListItemIcon, ListItemText, Collapse, useTheme, Typography, LinearProgress, Tooltip, IconButton } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import KeyboardArrowRight from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import RefreshIcon from '@mui/icons-material/Refresh';
import axios from 'axios';
import InlineInput from '../InlineInput';

const normalizePath = (p) => {
  if (!p) return '/';
  let np = p.startsWith('/') ? p : '/' + p;
  if (np !== '/' && np.endsWith('/')) np = np.slice(0, -1);
  return np;
};

const formatBytes = (bytes) => {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return '0B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const size = value / (1024 ** index);
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)}${units[index]}`;
};

const TreeNode = ({
  item,
  level,
  win,
  fetchFiles,
  openFileWindow,
  handleContextMenu,
  handleItemClick,
  selectedItems,
  inlineEdit,
  handleInlineSubmit,
  setInlineEdit
}) => {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState([]);
  const [hasFetched, setHasFetched] = useState(false);

  const isFolder = item.type === 'folder' || item.type === undefined;
  const itemPath = normalizePath(item.fullPath || item.path);
  const itemName = item.name || 'Root';
  const currentPath = normalizePath(win.currentPath);

  const isCurrentDir = isFolder && currentPath === itemPath;
  const isAncestor = isFolder && currentPath !== itemPath &&
    (itemPath === '/' ? currentPath.startsWith('/') : currentPath.startsWith(itemPath + '/'));

  const isSelected = selectedItems && selectedItems.includes(itemPath);
  const [isEditing, setIsEditing] = useState(false);
  const isAddingNew =
    (inlineEdit?.mode === 'new' || inlineEdit?.mode === 'newFile') &&
    normalizePath(inlineEdit.contextPath) === itemPath &&
    inlineEdit?.windowId === win.id + '_tree';

  useEffect(() => {
    const shouldEdit =
      inlineEdit?.mode === 'rename' &&
      normalizePath(inlineEdit.oldPath) === itemPath &&
      inlineEdit?.windowId === win.id + '_tree';

    if (shouldEdit) {
      const timer = setTimeout(() => setIsEditing(true), 150);
      return () => clearTimeout(timer);
    } else {
      setIsEditing(false);
    }
  }, [inlineEdit, itemPath, win.id]);

  useEffect(() => {
    if (isFolder && (isAncestor || isCurrentDir)) {
      setExpanded(true);
    }
  }, [currentPath, itemPath, isFolder, isAncestor, isCurrentDir]);

  useEffect(() => {
    if (isAddingNew && !expanded) {
      setExpanded(true);
    }
  }, [isAddingNew, expanded]);

  useEffect(() => {
    const handleRefresh = () => {
      if (expanded) setHasFetched(false);
    };
    window.addEventListener('nas_tree_refresh', handleRefresh);
    return () => window.removeEventListener('nas_tree_refresh', handleRefresh);
  }, [expanded]);

  useEffect(() => {
    if (isFolder && expanded && !hasFetched) {
      axios.get(`/api/files?path=${encodeURIComponent(itemPath)}`, { withCredentials: true })
        .then(res => {
          const items = res.data || [];
          const folders = items.filter(f => f.type === 'folder').sort((a, b) => a.name.localeCompare(b.name));
          const files = items.filter(f => f.type !== 'folder').sort((a, b) => a.name.localeCompare(b.name));
          setChildren([...folders, ...files]);
          setHasFetched(true);
        })
        .catch(err => {
          console.error("Sidebar API Error:", err);
          setHasFetched(true);
        });
    }
  }, [expanded, itemPath, hasFetched, isFolder]);

  const hoverBg = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)';
  const selectedBg = theme.palette.mode === 'dark' ? 'rgba(125,211,252,0.18)' : 'rgba(37,99,235,0.12)';
  const currentBg = theme.palette.mode === 'dark' ? 'rgba(94,234,212,0.12)' : 'rgba(15,118,110,0.10)';

  const onClick = (e) => {
    e.stopPropagation();
    if (isEditing) return;
    if (handleItemClick) handleItemClick(e, itemPath, item);
    if (isFolder) {
      setExpanded(!expanded);
      fetchFiles(win.id, itemPath);
    }
  };

  const onDoubleClick = (e) => {
    e.stopPropagation();
    if (isEditing) return;
    if (!isFolder && openFileWindow) {
      openFileWindow(item, false);
    } else if (isFolder) {
      setExpanded(true);
      fetchFiles(win.id, itemPath);
    }
  };

  const onContextMenu = (e) => {
    e.stopPropagation();
    if (isEditing) return;
    if (handleContextMenu) {
      const parentPath = itemPath.substring(0, itemPath.lastIndexOf('/')) || '/';
      handleContextMenu(e, item.type || 'folder', { item, path: parentPath, windowId: win.id + '_tree' });
    }
  };

  return (
    <Box>
      <ListItem
        className="selectable-item"
        data-path={itemPath}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        sx={{
          pl: level * 1.5 + 1,
          py: 0.55,
          bgcolor: isSelected ? selectedBg : (isCurrentDir ? currentBg : 'transparent'),
          borderRadius: 1,
          mr: 1,
          cursor: isEditing ? 'default' : 'pointer',
          color: theme.palette.text.primary,
          '&:hover': {
            bgcolor: isSelected ? selectedBg : (isEditing ? 'transparent' : hoverBg)
          }
        }}
      >
        <Box sx={{ width: 20, display: 'flex', color: theme.palette.text.secondary }}>
          {isFolder ? (expanded ? <KeyboardArrowDown fontSize="small" /> : <KeyboardArrowRight fontSize="small" />) : null}
        </Box>

        <ListItemIcon sx={{ minWidth: 26, color: isFolder ? 'var(--nas-folder)' : 'var(--nas-file)' }}>
          {isFolder ? <FolderIcon sx={{ fontSize: 18 }} /> : <InsertDriveFileIcon sx={{ fontSize: 18 }} />}
        </ListItemIcon>

        {isEditing && inlineEdit ? (
          <Box onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} sx={{ ml: 0.5 }}>
            <InlineInput
              defaultValue={inlineEdit.name || ''}
              isDesktop={false}
              onSubmit={(val) => handleInlineSubmit(val, inlineEdit)}
              onCancel={() => setInlineEdit(null)}
            />
          </Box>
        ) : (
          <ListItemText
            primary={itemName}
            primaryTypographyProps={{
              fontSize: '0.8rem',
              fontWeight: isCurrentDir || isSelected ? 800 : 400,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: isCurrentDir ? theme.palette.primary.main : theme.palette.text.primary
            }}
          />
        )}
      </ListItem>

      {isFolder && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          <List disablePadding>
            {isAddingNew && inlineEdit && (
              <ListItem sx={{ pl: (level + 1) * 1.5 + 1, py: 0.2, color: theme.palette.text.primary }}>
                <Box sx={{ width: 20 }} />
                <ListItemIcon sx={{ minWidth: 26, color: inlineEdit.mode === 'new' ? 'var(--nas-folder)' : 'var(--nas-file)' }}>
                  {inlineEdit.mode === 'new'
                    ? <FolderIcon sx={{ fontSize: 18 }} />
                    : <InsertDriveFileIcon sx={{ fontSize: 18 }} />}
                </ListItemIcon>
                <Box onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} sx={{ ml: 0.5 }}>
                  <InlineInput
                    defaultValue={inlineEdit.name || ''}
                    isDesktop={false}
                    onSubmit={(val) => handleInlineSubmit(val, inlineEdit)}
                    onCancel={() => setInlineEdit(null)}
                  />
                </Box>
              </ListItem>
            )}

            {children.map(c => (
              <TreeNode
                key={c.fullPath || c.name}
                item={c}
                level={level + 1}
                win={win}
                fetchFiles={fetchFiles}
                openFileWindow={openFileWindow}
                handleContextMenu={handleContextMenu}
                handleItemClick={handleItemClick}
                selectedItems={selectedItems}
                inlineEdit={inlineEdit}
                handleInlineSubmit={handleInlineSubmit}
                setInlineEdit={setInlineEdit}
              />
            ))}
          </List>
        </Collapse>
      )}
    </Box>
  );
};

const SidebarTree = ({
  win,
  fetchFiles,
  openFileWindow,
  handleContextMenu,
  handleItemClick,
  selectedItems,
  inlineEdit,
  handleInlineSubmit,
  setInlineEdit
}) => {
  const theme = useTheme();
  const [pathUsage, setPathUsage] = useState(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState('');

  const currentPath = normalizePath(win.currentPath || win.basePath || '/');

  const refreshPathUsage = useCallback(() => {
    setUsageLoading(true);
    setUsageError('');
    axios.get(`/api/storage/path?path=${encodeURIComponent(currentPath)}`, { withCredentials: true })
      .then((res) => setPathUsage(res.data || null))
      .catch(() => setUsageError('계산 실패'))
      .finally(() => setUsageLoading(false));
  }, [currentPath]);

  useEffect(() => {
    refreshPathUsage();
  }, [refreshPathUsage, win.files?.length]);

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        bgcolor: theme.palette.background.default,
        color: theme.palette.text.primary,
        borderRight: `1px solid ${theme.palette.divider}`
      }}
    >
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', py: 1 }}>
        <TreeNode
          item={{ fullPath: win.basePath, name: win.name || "Root", type: 'folder' }}
          level={0}
          win={win}
          fetchFiles={fetchFiles}
          openFileWindow={openFileWindow}
          handleContextMenu={handleContextMenu}
          handleItemClick={handleItemClick}
          selectedItems={selectedItems}
          inlineEdit={inlineEdit}
          handleInlineSubmit={handleInlineSubmit}
          setInlineEdit={setInlineEdit}
        />
      </Box>

      <Box sx={{ flexShrink: 0, p: 1.25, borderTop: `1px solid ${theme.palette.divider}`, bgcolor: theme.palette.background.paper }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 800 }}>
              이 폴더 사용량
            </Typography>
            <Typography sx={{ fontWeight: 900, fontSize: '0.92rem', lineHeight: 1.2 }}>
              {usageError || (usageLoading && !pathUsage ? '계산 중' : formatBytes(pathUsage?.sizeBytes))}
            </Typography>
          </Box>
          <Tooltip title="다시 계산">
            <span>
              <IconButton size="small" onClick={refreshPathUsage} disabled={usageLoading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
        {usageLoading && <LinearProgress sx={{ mt: 1, height: 4, borderRadius: 999 }} />}
      </Box>
    </Box>
  );
};

export default SidebarTree;
