import React from 'react';
import { Box, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

const DesktopIcon = ({
  item,
  safePath,
  isEditing,
  isSelected,
  displayName,
  pos,
  isMobile,
  inlineEdit,
  handleInlineSubmit,
  setInlineEdit,
  handleDragStart,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleItemClick,
  handleContextMenu,
  openFolderWindow,
  openFileWindow,
  selectedItems,
  dragOverTarget,
  InlineInput,
}) => {
  const isDragTarget = dragOverTarget === safePath;

  return (
    <motion.div
      key={safePath}
      draggable={!isEditing && !isMobile}
      onDragStart={(e) => { if (!isEditing && !isMobile) handleDragStart(e, item, 'desktop'); }}
      onDragOver={(e) => { if (item.type === 'folder' && !isMobile) handleDragOver(e, item.fullPath); }}
      onDragLeave={(e) => { if (item.type === 'folder' && !isMobile) handleDragLeave(e, item.fullPath); }}
      onDrop={(e) => { if (item.type === 'folder' && !isMobile) handleDrop(e, item.fullPath, 'desktop'); }}
      onClick={(e) => handleItemClick(e, safePath, item)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!isEditing && !isMobile) {
          if (item.type === 'folder') openFolderWindow(item);
          else openFileWindow(item, false);
        }
      }}
      onContextMenu={(e) => { if (!isEditing) handleContextMenu(e, item.type, { item, path: '/', windowId: 'desktop' }); }}
      style={
        isMobile
          ? { textAlign: 'center', cursor: isEditing ? 'default' : 'pointer', width: '80px', zIndex: isSelected ? 20 : (isEditing ? 15 : 10) }
          : { position: 'absolute', left: pos.x, top: pos.y, textAlign: 'center', cursor: isEditing ? 'default' : 'pointer', width: '100px', zIndex: isSelected ? 20 : (isEditing ? 15 : 10) }
      }
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
        <Box sx={{
          color: 'white',
          p: 1,
          borderRadius: '6px',
          border: isDragTarget ? '2px dashed #fbbf24' : (isSelected ? '1px solid rgba(255,255,255,0.4)' : '1px solid transparent'),
          backgroundColor: isDragTarget ? 'rgba(251, 191, 36, 0.2)' : (isSelected ? 'rgba(255, 255, 255, 0.15)' : 'transparent'),
          transition: 'all 0.1s ease-in-out',
          '&:hover': { backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.08)' }
        }}>
          {item.type === 'folder'
            ? <FolderIcon sx={{ fontSize: !isMobile ? 60 : 40, color: '#fde047' }} />
            : <InsertDriveFileIcon sx={{ fontSize: !isMobile ? 60 : 40, color: '#e2e8f0' }} />}
        </Box>

        {isEditing ? (
          <InlineInput
            defaultValue={inlineEdit.name}
            isDesktop={true}
            onSubmit={(val) => handleInlineSubmit(val, inlineEdit)}
            onCancel={() => setInlineEdit(null)}
          />
        ) : (
          <Typography
            variant="body2"
            sx={{
              mt: 0.5,
              fontWeight: 'bold',
              color: 'white',
              textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
              wordBreak: 'break-all',
              maxWidth: isMobile ? '80px' : '90px',
              lineHeight: 1.2,
              fontSize: isMobile ? '0.75rem' : '0.875rem'
            }}
          >
            {displayName}
          </Typography>
        )}
      </Box>
    </motion.div>
  );
};

export default DesktopIcon;
