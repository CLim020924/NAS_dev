import React, { useState, useEffect } from 'react';
import { Box, List, ListItem, ListItemIcon, ListItemText, Collapse, useTheme } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import KeyboardArrowRight from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowDown from '@mui/icons-material/KeyboardArrowDown';
import axios from 'axios';
import InlineInput from '../InlineInput';

const normalizePath = (p) => {
  if (!p) return '/';
  let np = p.startsWith('/') ? p : '/' + p;
  if (np !== '/' && np.endsWith('/')) np = np.slice(0, -1);
  return np;
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

  const hoverBg = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const selectedBg = 'rgba(25, 118, 210, 0.20)';
  const currentBg = 'rgba(25, 118, 210, 0.10)';

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
          py: 0.2,
          bgcolor: isSelected ? selectedBg : (isCurrentDir ? currentBg : 'transparent'),
          borderRadius: '0 16px 16px 0',
          mr: 1,
          cursor: isEditing ? 'default' : 'pointer',
          color: theme.palette.text.primary,
          '&:hover': {
            bgcolor: isSelected ? 'rgba(25, 118, 210, 0.30)' : (isEditing ? 'transparent' : hoverBg)
          }
        }}
      >
        <Box sx={{ width: 20, display: 'flex', color: theme.palette.text.secondary }}>
          {isFolder ? (expanded ? <KeyboardArrowDown fontSize="small" /> : <KeyboardArrowRight fontSize="small" />) : null}
        </Box>

        <ListItemIcon sx={{ minWidth: 26, color: isFolder ? '#fbbf24' : theme.palette.text.secondary }}>
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
                <ListItemIcon sx={{ minWidth: 26, color: inlineEdit.mode === 'new' ? '#fbbf24' : theme.palette.text.secondary }}>
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

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        bgcolor: theme.palette.mode === 'dark' ? '#0f172a' : '#fafafa',
        color: theme.palette.text.primary,
        py: 1
      }}
    >
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
  );
};

export default SidebarTree;
