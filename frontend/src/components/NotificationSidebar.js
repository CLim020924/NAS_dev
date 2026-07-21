import React, { useState } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Divider,
  Chip,
  Button,
  CircularProgress,
  Menu,
  MenuItem,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';

const NotificationSidebar = ({
  open,
  onClose,
  loading = false,
  notifications = [],
  unreadCount = 0,
  onReadAll = () => {},
  onNotificationClick = () => {},
  onNotificationRead = () => {},
  onNotificationDelete = () => {},
  onDeleteRead = () => {},
}) => {
  const [contextMenu, setContextMenu] = useState(null);

  const getTypeLabel = (type) => {
    switch (type) {
      case 'friend_request':
        return '친구 요청';
      case 'friend_accept':
        return '친구 수락';
      case 'chat_message':
        return '메시지';
      default:
        return '알림';
    }
  };

  const openContextMenu = (event, notification) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      notification,
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleContextRead = () => {
    const notification = contextMenu?.notification;
    closeContextMenu();
    if (notification) onNotificationRead(notification);
  };

  const handleContextDelete = () => {
    const notification = contextMenu?.notification;
    closeContextMenu();
    if (notification) onNotificationDelete(notification);
  };

  const readCount = notifications.filter((item) => item?.isRead).length;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      sx={{ zIndex: (theme) => theme.zIndex.drawer + 3 }}
      PaperProps={{
        sx: {
          width: { xs: '86vw', sm: 340 },
          backgroundColor: 'background.paper',
          color: 'text.primary',
        }
      }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            p: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'background.default',
            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <NotificationsNoneIcon fontSize="small" />
            <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.05rem' }}>
              알림
            </Typography>
            {unreadCount > 0 && (
              <Chip
                size="small"
                color="error"
                label={unreadCount > 99 ? '99+' : unreadCount}
                sx={{ height: 22 }}
              />
            )}
          </Box>

          <IconButton onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {loading ? (
            <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={28} />
            </Box>
          ) : notifications.length === 0 ? (
            <Box sx={{ p: 3 }}>
              <Typography variant="body2" color="text.secondary">
                아직 새 알림이 없습니다.
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                친구 요청, 메세지, 파일 수신 알림이 이곳에 모이게 됩니다.
              </Typography>
            </Box>
          ) : (
            <List disablePadding>
              {notifications.map((n, idx) => (
                <React.Fragment key={n.notificationId}>
                  <ListItemButton
                    onClick={() => onNotificationClick(n)}
                    onContextMenu={(event) => openContextMenu(event, n)}
                    sx={{
                      alignItems: 'flex-start',
                      px: 2,
                      py: 1.5,
                      backgroundColor: n.isRead ? 'transparent' : 'action.hover',
                      opacity: n.isRead ? 0.62 : 1,
                      '&:hover': {
                        backgroundColor: n.isRead ? 'action.selected' : 'action.hover',
                      },
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>
                            {n.title}
                          </Typography>
                          <Chip
                            size="small"
                            variant="filled"
                            color="primary"
                            label={getTypeLabel(n.type)}
                            sx={{ height: 20 }}
                          />
                          {!n.isRead && <Chip size="small" color="error" label="NEW" sx={{ height: 20 }} />}
                          {n.type === 'chat_message' && (
                            <Chip
                              size="small"
                              color="secondary"
                              label={`${Number(n.unreadGroupCount || 1)}개`}
                              sx={{ height: 20 }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        <Box sx={{ mt: 0.5 }}>
                          <Typography variant="body2" color="text.secondary">
                            {n.message}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                            {n.createdAt}{n.isRead ? ' · 읽음' : ''}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItemButton>
                  {idx < notifications.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          )}
        </Box>
        <Box
          sx={{
            p: 1.5,
            borderTop: (theme) => `1px solid ${theme.palette.divider}`,
            display: 'flex',
            gap: 1,
            justifyContent: 'space-between',
            backgroundColor: 'background.default',
          }}
        >
          <Button
            size="small"
            color="inherit"
            startIcon={<MarkEmailReadIcon />}
            onClick={onReadAll}
            disabled={unreadCount === 0}
          >
            전체 읽음
          </Button>
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            onClick={onDeleteRead}
            disabled={readCount === 0}
          >
            읽은 알림 삭제
          </Button>
        </Box>
      </Box>
      <Menu
        open={Boolean(contextMenu)}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}
      >
        <MenuItem onClick={handleContextRead} disabled={!!contextMenu?.notification?.isRead}>
          <MarkEmailReadIcon fontSize="small" sx={{ mr: 1 }} />
          읽음 처리
        </MenuItem>
        <MenuItem onClick={handleContextDelete} sx={{ color: 'error.main' }}>
          <DeleteOutlineIcon fontSize="small" sx={{ mr: 1 }} />
          알림 삭제
        </MenuItem>
      </Menu>
    </Drawer>
  );
};

export default NotificationSidebar;
