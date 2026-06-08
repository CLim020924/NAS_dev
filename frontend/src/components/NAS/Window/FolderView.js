import React from 'react';
import { Box, List, ListItem, ListItemIcon, ListItemText, Table, TableBody, TableCell, TableContainer, TableRow, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { motion, AnimatePresence } from 'framer-motion';
import StorageIcon from '@mui/icons-material/Storage';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { ensureSlash } from '../../../utils/pathUtils';

const FolderView = ({
  win,
  theme,
  isMobile,
  fetchFiles,
  handleDragOver,
  handleDrop,
  handleContextMenu,
  setSelectedItems,
  inlineEdit,
  selectedItems,
  dragOverTarget,
  handleDragStart,
  handleDragLeave,
  handleItemClick,
  openFileWindow,
  handleInlineSubmit,
  setInlineEdit,
  InlineInput,
}) => {
  return (
    <>
      <AnimatePresence>
        {win.sidebarOpen && !isMobile && (
          <motion.div
            initial={{ x: -220 }}
            animate={{ x: 0 }}
            exit={{ x: -220 }}
            transition={{ type: 'tween', duration: 0.2 }}
            style={{
              width: 220,
              height: '100%',
              backgroundColor: theme.palette.background.default,
              borderRight: `1px solid ${theme.palette.divider}`,
              zIndex: 10
            }}
          >
            <List sx={{ pt: 1 }}>
              <ListItem button onClick={() => fetchFiles(win.id, win.basePath)}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <StorageIcon color="primary" />
                </ListItemIcon>
                <ListItemText primary={<Typography sx={{ fontWeight: 600 }}>{win.name}</Typography>} />
              </ListItem>
            </List>
          </motion.div>
        )}
      </AnimatePresence>

      <TableContainer
        onDragOver={(e) => handleDragOver(e, null)}
        onDrop={(e) => handleDrop(e, win.currentPath, win.id)}
        onContextMenu={(e) => handleContextMenu(e, 'background', { path: win.currentPath, windowId: win.id })}
        onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedItems([]); }}
        sx={{ flex: 1, background: 'transparent' }}
      >
        <Table stickyHeader size="small">
          <TableBody>
            {win.files.map((file, idx) => {
              const safePath = ensureSlash(file.fullPath);
              const isEditing = inlineEdit?.mode === 'rename' && ensureSlash(inlineEdit.oldPath) === safePath;
              const isSelected = selectedItems.includes(safePath);
              const isDragTarget = dragOverTarget === safePath;

              return (
                <TableRow
                  key={idx}
                  hover
                  draggable={!isEditing && !isMobile}
                  onDragStart={(e) => { if (!isEditing && !isMobile) handleDragStart(e, file, win.id); }}
                  onDragOver={(e) => { if (file.type === 'folder' && !isMobile) handleDragOver(e, file.fullPath); }}
                  onDragLeave={(e) => { if (file.type === 'folder' && !isMobile) handleDragLeave(e, file.fullPath); }}
                  onDrop={(e) => { if (file.type === 'folder' && !isMobile) handleDrop(e, file.fullPath, win.id); }}
                  onClick={(e) => handleItemClick(e, safePath, file)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (!isEditing && !isMobile) {
                      if (file.type === 'folder') fetchFiles(win.id, ensureSlash(file.fullPath));
                      else openFileWindow(file, false);
                    }
                  }}
                  onContextMenu={(e) => { if (!isEditing) handleContextMenu(e, file.type, { item: file, path: win.currentPath, windowId: win.id }); }}
                  sx={{
                    cursor: isEditing ? 'default' : 'pointer',
                    backgroundColor: isDragTarget ? alpha(theme.palette.warning.main, 0.2) : (isSelected ? alpha(theme.palette.primary.main, 0.1) : 'inherit'),
                    border: isDragTarget ? `2px dashed ${theme.palette.warning.main}` : 'none',
                  }}
                >
                  <TableCell sx={{ display: 'flex', alignItems: 'center', py: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
                    {file.type === 'folder'
                      ? <FolderIcon sx={{ mr: 1.5, color: '#fbbf24' }} />
                      : <InsertDriveFileIcon sx={{ mr: 1.5, color: theme.palette.text.secondary }} />}
                    {isEditing
                      ? <InlineInput defaultValue={inlineEdit.name} isDesktop={false} onSubmit={(val) => handleInlineSubmit(val, inlineEdit)} onCancel={() => setInlineEdit(null)} />
                      : <Typography>{file.name}</Typography>}
                  </TableCell>
                </TableRow>
              );
            })}

            {inlineEdit?.mode === 'new' && inlineEdit.windowId === win.id && (
              <TableRow>
                <TableCell sx={{ display: 'flex', alignItems: 'center', py: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
                  <FolderIcon sx={{ mr: 1.5, color: '#fbbf24' }} />
                  <InlineInput
                    defaultValue={inlineEdit.name}
                    isDesktop={false}
                    onSubmit={(val) => handleInlineSubmit(val, inlineEdit)}
                    onCancel={() => setInlineEdit(null)}
                  />
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
};

export default FolderView;
