import React from 'react';
import { Box, Typography } from '@mui/material';
import { motion } from 'framer-motion';
import StorageIcon from '@mui/icons-material/Storage';
import FolderIcon from '@mui/icons-material/Folder';
import DesktopIcon from './DesktopIcon';
import { ensureSlash } from '../../../utils/pathUtils';

const DesktopArea = ({
  theme,
  isMobile,
  desktopRef,
  handleDragOver,
  handleDrop,
  setFocusedContext,
  setSelectedItems,
  setInlineEdit,
  handleContextMenu,
  selectedItems,
  isAdmin,
  openFolderWindow,
  desktopItems,
  inlineEdit,
  iconPositions,
  handleInlineSubmit,
  handleDragStart,
  handleDragLeave,
  handleItemClick,
  openFileWindow,
  dragOverTarget,
  InlineInput,
}) => {
  return (
    <Box
      ref={desktopRef}
      onDragOver={(e) => handleDragOver(e, null)}
      onDrop={(e) => handleDrop(e, '/', 'desktop')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setFocusedContext('desktop');
          setSelectedItems([]);
          setInlineEdit(null);
        }
      }}
      onContextMenu={(e) => handleContextMenu(e, 'background', { path: '/', windowId: 'desktop' })}
      sx={{
        flex: 1,
        position: 'relative',
        overflowX: 'hidden',
        overflowY: 'auto',
        display: isMobile ? 'flex' : 'block',
        flexWrap: isMobile ? 'wrap' : 'nowrap',
        alignContent: 'flex-start',
        gap: isMobile ? 2 : 0,
        p: isMobile ? 2 : 0,
        background: theme.palette.mode === 'dark'
          ? 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)'
          : 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #93c5fd 100%)'
      }}
    >
      <motion.div
        onClick={(e) => {
          e.stopPropagation();
          setSelectedItems(['system_root']);
          if (isMobile) openFolderWindow({ id: 'system_root', name: isAdmin ? '서버 전체 저장소' : '내 클라우드', path: '/' });
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          if (!isMobile) openFolderWindow({ id: 'system_root', name: isAdmin ? '서버 전체 저장소' : '내 클라우드', path: '/' });
        }}
        style={
          isMobile
            ? { textAlign: 'center', width: '80px', cursor: 'pointer', zIndex: 10 }
            : { position: 'absolute', left: 20, top: 20, textAlign: 'center', cursor: 'pointer', width: '100px', zIndex: 10 }
        }
      >
        <Box sx={{
          p: 1,
          borderRadius: '6px',
          border: selectedItems.includes('system_root') ? '1px solid rgba(255,255,255,0.4)' : '1px solid transparent',
          backgroundColor: selectedItems.includes('system_root') ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
          color: 'white',
          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
        }}>
          <StorageIcon sx={{ fontSize: isMobile ? 40 : 60, color: isAdmin ? '#ef4444' : '#fde047' }} />
          <Typography variant="body2" sx={{ mt: 1, fontWeight: 'bold', fontSize: isMobile ? '0.75rem' : '0.875rem' }}>
            {isAdmin ? '전체 저장소' : '내 클라우드'}
          </Typography>
        </Box>
      </motion.div>

      {desktopItems.map((item) => {
        const safePath = ensureSlash(item.fullPath);
        const isEditing = inlineEdit?.mode === 'rename' && ensureSlash(inlineEdit.oldPath) === safePath;
        const isSelected = selectedItems.includes(safePath);
        const displayName = isSelected || isMobile ? item.name : (item.name.length > 8 ? item.name.substring(0, 8) + '...' : item.name);
        const pos = iconPositions[safePath] || { x: 0, y: 0 };

        return (
          <DesktopIcon
            key={safePath}
            item={item}
            safePath={safePath}
            isEditing={isEditing}
            isSelected={isSelected}
            displayName={displayName}
            pos={pos}
            isMobile={isMobile}
            inlineEdit={inlineEdit}
            handleInlineSubmit={handleInlineSubmit}
            setInlineEdit={setInlineEdit}
            handleDragStart={handleDragStart}
            handleDragOver={handleDragOver}
            handleDragLeave={handleDragLeave}
            handleDrop={handleDrop}
            handleItemClick={handleItemClick}
            handleContextMenu={handleContextMenu}
            openFolderWindow={openFolderWindow}
            openFileWindow={openFileWindow}
            selectedItems={selectedItems}
            dragOverTarget={dragOverTarget}
            InlineInput={InlineInput}
          />
        );
      })}

      {inlineEdit?.mode === 'new' && inlineEdit.windowId === 'desktop' && (
        <motion.div
          style={
            isMobile
              ? { textAlign: 'center', width: '80px', zIndex: 15 }
              : { position: 'absolute', left: inlineEdit.spawnPosition?.x || 200, top: inlineEdit.spawnPosition?.y || 200, textAlign: 'center', width: '100px', zIndex: 15 }
          }
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
            <FolderIcon sx={{ fontSize: isMobile ? 40 : 60, color: '#fde047' }} />
            <InlineInput
              defaultValue={inlineEdit.name}
              isDesktop={true}
              onSubmit={(val) => handleInlineSubmit(val, inlineEdit)}
              onCancel={() => setInlineEdit(null)}
            />
          </Box>
        </motion.div>
      )}
    </Box>
  );
};

export default DesktopArea;
