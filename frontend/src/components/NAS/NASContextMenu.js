import React from 'react';
import { Menu, MenuItem, ListItemIcon, ListItemText, Divider, Typography } from '@mui/material';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import FolderIcon from '@mui/icons-material/Folder';
import SettingsIcon from '@mui/icons-material/Settings';
import InfoIcon from '@mui/icons-material/Info';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';

const NASContextMenu = ({ 
  contextMenu, handleContextMenuClose, refreshPath, handleCreateFolderStart, 
  handleUploadClick, openFolderWindow, openFileWindow, handleRenameStart, 
  handleDelete, handleDownload, handleShowProperties, getItemsToProcess,
  handleCopy, handlePaste, clipboard, handleCreateLinkedDeviceFolder
}) => {
  if (!contextMenu) return null;

  return (
    <Menu
      open={contextMenu !== null}
      onClose={handleContextMenuClose}
      anchorReference="anchorPosition"
      anchorPosition={contextMenu !== null ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      PaperProps={{ elevation: 8, sx: { width: 220, borderRadius: 2, p: 0.5 } }}
      disableRestoreFocus 
    >
      {contextMenu.type === 'background' && [
        <MenuItem key="refresh" onClick={() => { handleContextMenuClose(); setTimeout(() => refreshPath(contextMenu.path), 10); }}>
          <ListItemIcon><RefreshIcon fontSize="small" /></ListItemIcon><ListItemText>새로고침</ListItemText>
        </MenuItem>,
        <Divider key="d1" />,
        <MenuItem key="newFolder" onClick={() => { handleContextMenuClose(); setTimeout(() => handleCreateFolderStart(contextMenu.path, contextMenu.windowId, {x: contextMenu.mouseX - 40, y: contextMenu.mouseY - 90}), 10); }}>
          <ListItemIcon><CreateNewFolderIcon fontSize="small" color="primary" /></ListItemIcon><ListItemText>새 폴더</ListItemText>
        </MenuItem>,
        <MenuItem key="upload" onClick={() => { handleContextMenuClose(); setTimeout(() => handleUploadClick(contextMenu.path, contextMenu.windowId), 10); }}>
          <ListItemIcon><UploadFileIcon fontSize="small" color="secondary" /></ListItemIcon><ListItemText>업로드</ListItemText>
        </MenuItem>,
        <MenuItem key="linkedDeviceFolder" onClick={() => {
          console.log('[NAS PC LINK] menu clicked', { path: contextMenu.path, hasHandler: typeof handleCreateLinkedDeviceFolder });
          handleContextMenuClose();

          setTimeout(() => {
            if (typeof handleCreateLinkedDeviceFolder !== 'function') {
              console.error('[NAS PC LINK] handleCreateLinkedDeviceFolder prop is missing');
              alert('PC 연동 기능 핸들러가 연결되지 않았습니다. 프론트 빌드/props 연결을 확인해야 합니다.');
              return;
            }

            handleCreateLinkedDeviceFolder(contextMenu.path || '/');
          }, 10);
        }}>
          <ListItemIcon><DesktopWindowsIcon fontSize="small" color="info" /></ListItemIcon><ListItemText>내 PC 폴더 실시간 연동</ListItemText>
        </MenuItem>,
        <Divider key="d_settings" />,
        <MenuItem key="settings" onClick={() => { handleContextMenuClose(); setTimeout(() => window.location.href='/settings', 10); }}>
          <ListItemIcon><SettingsIcon fontSize="small" color="inherit" /></ListItemIcon><ListItemText>설정</ListItemText>
        </MenuItem>,
        <Divider key="d_paste" />,
        <MenuItem key="paste" disabled={!clipboard || clipboard.paths.length === 0} onClick={() => { handleContextMenuClose(); setTimeout(() => handlePaste(contextMenu.path), 10); }}>
          <ListItemIcon><ContentPasteIcon fontSize="small" color={(!clipboard || clipboard.paths.length === 0) ? "disabled" : "primary"} /></ListItemIcon><ListItemText>붙여넣기</ListItemText>
        </MenuItem>
      ]}

      {(contextMenu.type === 'folder' || contextMenu.type === 'linked-device') && [
        <MenuItem key="open" onClick={() => { 
          handleContextMenuClose(); 
          setTimeout(() => {
            const items = getItemsToProcess(contextMenu.item);
            items.forEach(it => { if(it.type === 'folder') openFolderWindow(it); else openFileWindow(it, false); });
          }, 10); 
        }}>
          <ListItemIcon><FolderIcon fontSize="small" color="primary" /></ListItemIcon><ListItemText>열기</ListItemText>
        </MenuItem>,
        contextMenu.type === 'linked-device' && (
          <MenuItem key="addLinkedFolder" onClick={() => {
            handleContextMenuClose();
            setTimeout(() => handleCreateLinkedDeviceFolder(contextMenu.item?.fullPath || contextMenu.path || '/'), 10);
          }}>
            <ListItemIcon><DesktopWindowsIcon fontSize="small" color="info" /></ListItemIcon><ListItemText>연동 폴더 추가</ListItemText>
          </MenuItem>
        ),
        <Divider key="d2" />,
        <MenuItem key="downloadFolder" onClick={() => { handleContextMenuClose(); setTimeout(() => { const items = getItemsToProcess(contextMenu.item); items.forEach((it, i) => setTimeout(() => handleDownload(it), i * 500)); }, 10); }}>
          <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon><ListItemText>다운로드</ListItemText>
        </MenuItem>,
        <MenuItem key="properties" onClick={() => { handleContextMenuClose(); setTimeout(() => handleShowProperties(contextMenu.item), 10); }}>
          <ListItemIcon><InfoIcon fontSize="small" color="info" /></ListItemIcon><ListItemText>폴더 정보</ListItemText>
        </MenuItem>,
        <MenuItem key="copy" onClick={() => { handleContextMenuClose(); setTimeout(() => handleCopy(getItemsToProcess(contextMenu.item)), 10); }}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon><ListItemText>복사</ListItemText>
        </MenuItem>,
        <MenuItem key="rename" onClick={() => { handleContextMenuClose(); setTimeout(() => handleRenameStart(contextMenu.item, contextMenu.path), 10); }}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon><ListItemText>이름 바꾸기</ListItemText>
        </MenuItem>,
        <MenuItem key="delete" onClick={() => { 
          handleContextMenuClose(); 
          setTimeout(() => {
            const items = getItemsToProcess(contextMenu.item);
            handleDelete(items, contextMenu.path);
          }, 10); 
        }}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon><Typography color="error">삭제</Typography>
        </MenuItem>
      ]}

      {contextMenu.type === 'file' && [
        <MenuItem key="view" onClick={() => { 
          handleContextMenuClose(); 
          setTimeout(() => {
            const items = getItemsToProcess(contextMenu.item);
            items.forEach(it => openFileWindow(it, false));
          }, 10); 
        }}>
          <ListItemIcon><VisibilityIcon fontSize="small" color="primary" /></ListItemIcon><ListItemText>보기 (뷰어)</ListItemText>
        </MenuItem>,
        <MenuItem key="edit" onClick={() => { handleContextMenuClose(); setTimeout(() => openFileWindow(contextMenu.item, true), 10); }}>
          <ListItemIcon><EditIcon fontSize="small" color="secondary" /></ListItemIcon><ListItemText>편집 (에디터)</ListItemText>
        </MenuItem>,
        <MenuItem key="download" onClick={() => { 
          handleContextMenuClose(); 
          setTimeout(() => {
            const items = getItemsToProcess(contextMenu.item);
            items.forEach((it, i) => setTimeout(() => handleDownload(it), i * 500));
          }, 10); 
        }}>
          <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon><ListItemText>다운로드</ListItemText>
        </MenuItem>,
        <MenuItem key="properties" onClick={() => { handleContextMenuClose(); setTimeout(() => handleShowProperties(contextMenu.item), 10); }}>
          <ListItemIcon><InfoIcon fontSize="small" color="info" /></ListItemIcon><ListItemText>파일 정보</ListItemText>
        </MenuItem>,
        <Divider key="d3" />,
        <MenuItem key="copy" onClick={() => { handleContextMenuClose(); setTimeout(() => handleCopy(getItemsToProcess(contextMenu.item)), 10); }}>
          <ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon><ListItemText>복사</ListItemText>
        </MenuItem>,
        <MenuItem key="rename" onClick={() => { handleContextMenuClose(); setTimeout(() => handleRenameStart(contextMenu.item, contextMenu.path), 10); }}>
          <ListItemIcon><EditIcon fontSize="small" /></ListItemIcon><ListItemText>이름 바꾸기</ListItemText>
        </MenuItem>,
        <MenuItem key="delete" onClick={() => { 
          handleContextMenuClose(); 
          setTimeout(() => {
            const items = getItemsToProcess(contextMenu.item);
            handleDelete(items, contextMenu.path);
          }, 10); 
        }}>
          <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon><Typography color="error">삭제</Typography>
        </MenuItem>
      ]}
    </Menu>
  );
};

export default NASContextMenu;
