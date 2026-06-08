import React from 'react';
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
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
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
}) => {
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

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Button
              size="small"
              color="inherit"
              startIcon={<MarkEmailReadIcon />}
              onClick={onReadAll}
              disabled={unreadCount === 0}
            >
              모두 읽음
            </Button>
            <IconButton onClick={onClose} size="small">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
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
                    sx={{
                      alignItems: 'flex-start',
                      px: 2,
                      py: 1.5,
                      backgroundColor: 'action.hover',
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
                          <Chip size="small" color="error" label="NEW" sx={{ height: 20 }} />
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
                            {n.createdAt}
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
      </Box>
    </Drawer>
  );
};

export default NotificationSidebar;
