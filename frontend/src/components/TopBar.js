import React, { useState, useEffect } from 'react';
import { AppBar, Toolbar, Typography, Box, IconButton, Menu, MenuItem, Avatar, Badge, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import SettingsIcon from '@mui/icons-material/Settings';
import LogoutIcon from '@mui/icons-material/Logout';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import SpaceDashboardIcon from '@mui/icons-material/SpaceDashboard';
import VideocamIcon from '@mui/icons-material/Videocam';
import axios from 'axios';
import { useWindows } from '../contexts/WindowContext';
import { alpha } from '@mui/material/styles';

const TopBar = ({
  onOpenFriends,
  onOpenRooms,
  onOpenNotifications,
  unreadNotificationCount = 0,
  chatPreview = null,
  onChatPreviewClick = () => {},
  chatSidebarMode = 'none',
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { taskbarWindows, focusWindow } = useWindows();

  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')) || { username: 'USER', role: 'USER' });
  const [anchorEl, setAnchorEl] = useState(null);
  const [folderMenuAnchorEl, setFolderMenuAnchorEl] = useState(null);
  const [fileMenuAnchorEl, setFileMenuAnchorEl] = useState(null);
  const [appMenuAnchorEl, setAppMenuAnchorEl] = useState(null);
  const [chatMenuAnchorEl, setChatMenuAnchorEl] = useState(null);
  const [appOpenMode, setAppOpenMode] = useState(localStorage.getItem('platform_app_open_mode') || 'window');

  const [profileOpen, setProfileOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    const handleStorageChange = () => setUser(JSON.parse(localStorage.getItem('user')) || { username: 'USER', role: 'USER' });
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  useEffect(() => {
    const handleSettingsChange = () => setAppOpenMode(localStorage.getItem('platform_app_open_mode') || 'window');
    window.addEventListener('nas_settings_changed', handleSettingsChange);
    window.addEventListener('storage', handleSettingsChange);
    return () => {
      window.removeEventListener('nas_settings_changed', handleSettingsChange);
      window.removeEventListener('storage', handleSettingsChange);
    };
  }, []);

  const getPageTitle = (path) => {
    if (path.startsWith('/nas')) return '파일 탐색기';
    if (path.startsWith('/settings')) return '시스템 설정';
    return '바탕화면';
  };

  const handleLogout = () => {
    document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) return alert("모든 필드를 입력해주세요.");
    if (newPassword !== confirmPassword) return alert("새 비밀번호가 일치하지 않습니다.");
    if (newPassword.length < 4) return alert("비밀번호는 최소 4자 이상이어야 합니다.");

    try {
      const res = await axios.put('/api/users/password', {
        id: user.userUid || user.loginId || user.id || user.username,
        currentPassword,
        newPassword
      }, { withCredentials: true });

      if (res.data.success) {
        alert("비밀번호가 성공적으로 변경되었습니다! 다시 로그인해주세요.");
        handleLogout();
      }
    } catch (err) {
      alert(err.response?.data?.error || "비밀번호 변경에 실패했습니다.");
    }
  };

  const taskWindows = taskbarWindows.filter(Boolean).slice().reverse();
  const minimizedFolders = appOpenMode === 'window' ? taskWindows.filter((w) => w.winType === 'folder') : [];
  const minimizedFiles = taskWindows.filter((w) => w.winType === 'file');
  const minimizedApps = taskWindows.filter((w) => w.winType === 'app');
  const minimizedChats = taskWindows.filter((w) => w.winType === 'chat');

  const restoreMinimizedWindow = (win) => {
    if (!win) return;
    focusWindow(win.id);
  };

  return (
    <>
      <AppBar position="fixed" elevation={0} sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, backgroundColor: (theme) => alpha(theme.palette.background.paper, 0.94), backdropFilter: 'blur(14px)', color: 'text.primary', borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}>
        <Toolbar size="small" sx={{ minHeight: '48px !important', gap: 1 }}>
          <Box onClick={() => navigate('/platform')} sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer', minWidth: 0 }}>
            <Box sx={{ width: 28, height: 28, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: (theme) => alpha(theme.palette.primary.main, 0.10), color: 'primary.main', border: (theme) => `1px solid ${alpha(theme.palette.primary.main, 0.18)}` }}>
              <FolderIcon sx={{ fontSize: 18 }} />
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 900, fontSize: '0.98rem', whiteSpace: 'nowrap' }}>NAS</Typography>
          </Box>
          <Box
            sx={{
              ml: 2,
              px: 1.2,
              py: 0.5,
              display: 'flex',
              alignItems: 'center',
              gap: 0.8,
              borderRadius: 1.5,
              backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.07),
              border: (theme) => `1px solid ${alpha(theme.palette.primary.main, 0.14)}`,
            }}
          >
            <SpaceDashboardIcon sx={{ fontSize: 16, color: 'primary.main' }} />
            <Typography
              variant="caption"
              sx={{
                fontWeight: 800,
                color: 'text.primary',
                lineHeight: 1,
              }}
            >
              {getPageTitle(location.pathname)}
            </Typography>
          </Box>

          {minimizedFolders.length > 0 && (
            <>
              <Chip
                label={minimizedFolders.length === 1 ? (minimizedFolders[0]?.name || '열린 폴더') : `열린 폴더 ${minimizedFolders.length}`}
                size="small"
                icon={<FolderIcon sx={{ fontSize: 16 }} />}
                onClick={(e) => {
                  if (minimizedFolders.length === 1) {
                    restoreMinimizedWindow(minimizedFolders[0]);
                  } else {
                    setFolderMenuAnchorEl(e.currentTarget);
                  }
                }}
                sx={{
                  ml: 1,
                  backgroundColor: 'action.hover',
                  color: 'text.primary',
                  cursor: 'pointer'
                }}
              />
              {minimizedFolders.length > 1 && (
                <Menu
                  anchorEl={folderMenuAnchorEl}
                  open={Boolean(folderMenuAnchorEl)}
                  onClose={() => setFolderMenuAnchorEl(null)}
                  PaperProps={{ elevation: 4, sx: { mt: 1, minWidth: 260, borderRadius: 2 } }}
                >
                  {minimizedFolders.map((win) => (
                    <MenuItem
                      key={win.id}
                      onClick={() => {
                        setFolderMenuAnchorEl(null);
                        restoreMinimizedWindow(win);
                      }}
                      sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}
                    >
                      <FolderIcon fontSize="small" sx={{ mt: 0.2, color: 'warning.main' }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                          {win.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: 'block',
                            maxWidth: 180,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {win.currentPath || win.basePath || '/'}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Menu>
              )}
            </>
          )}

          {minimizedFiles.length > 0 && (
            <>
              <Chip
                label={minimizedFiles.length === 1 ? (minimizedFiles[0]?.name || '열린 파일') : `열린 파일 ${minimizedFiles.length}`}
                size="small"
                icon={<InsertDriveFileIcon sx={{ fontSize: 16 }} />}
                onClick={(e) => {
                  if (minimizedFiles.length === 1) {
                    restoreMinimizedWindow(minimizedFiles[0]);
                  } else {
                    setFileMenuAnchorEl(e.currentTarget);
                  }
                }}
                sx={{
                  ml: 1,
                  backgroundColor: 'action.hover',
                  color: 'text.primary',
                  cursor: 'pointer'
                }}
              />
              {minimizedFiles.length > 1 && (
                <Menu
                  anchorEl={fileMenuAnchorEl}
                  open={Boolean(fileMenuAnchorEl)}
                  onClose={() => setFileMenuAnchorEl(null)}
                  PaperProps={{ elevation: 4, sx: { mt: 1, minWidth: 260, borderRadius: 2 } }}
                >
                  {minimizedFiles.map((win) => (
                    <MenuItem
                      key={win.id}
                      onClick={() => {
                        setFileMenuAnchorEl(null);
                        restoreMinimizedWindow(win);
                      }}
                      sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}
                    >
                      <InsertDriveFileIcon fontSize="small" sx={{ mt: 0.2, color: 'text.secondary' }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                          {win.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: 'block',
                            maxWidth: 180,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          {win.fullPath || ''}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Menu>
              )}
            </>
          )}

          {minimizedApps.length > 0 && (
            <>
              <Chip
                label={minimizedApps.length === 1 ? (minimizedApps[0]?.name || '실행 중인 앱') : `실행 앱 ${minimizedApps.length}`}
                size="small"
                icon={<VideocamIcon sx={{ fontSize: 16 }} />}
                onClick={(e) => {
                  if (minimizedApps.length === 1) {
                    restoreMinimizedWindow(minimizedApps[0]);
                  } else {
                    setAppMenuAnchorEl(e.currentTarget);
                  }
                }}
                sx={{
                  ml: 1,
                  backgroundColor: 'action.hover',
                  color: 'text.primary',
                  cursor: 'pointer'
                }}
              />
              {minimizedApps.length > 1 && (
                <Menu
                  anchorEl={appMenuAnchorEl}
                  open={Boolean(appMenuAnchorEl)}
                  onClose={() => setAppMenuAnchorEl(null)}
                  PaperProps={{ elevation: 4, sx: { mt: 1, minWidth: 260, borderRadius: 2 } }}
                >
                  {minimizedApps.map((win) => (
                    <MenuItem
                      key={win.id}
                      onClick={() => {
                        setAppMenuAnchorEl(null);
                        restoreMinimizedWindow(win);
                      }}
                      sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}
                    >
                      <VideocamIcon fontSize="small" sx={{ mt: 0.2, color: 'info.main' }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                          {win.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: 'block',
                            maxWidth: 180,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          실행 중
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Menu>
              )}
            </>
          )}

          {minimizedChats.length > 0 && (
            <>
              <Chip
                label={minimizedChats.length === 1 ? (minimizedChats[0]?.name || '열린 채팅') : `열린 채팅 ${minimizedChats.length}`}
                size="small"
                icon={<ChatBubbleOutlineIcon sx={{ fontSize: 16 }} />}
                onClick={(e) => {
                  if (minimizedChats.length === 1) {
                    restoreMinimizedWindow(minimizedChats[0]);
                  } else {
                    setChatMenuAnchorEl(e.currentTarget);
                  }
                }}
                sx={{
                  ml: 1,
                  backgroundColor: 'action.hover',
                  color: 'text.primary',
                  cursor: 'pointer'
                }}
              />
              {minimizedChats.length > 1 && (
                <Menu
                  anchorEl={chatMenuAnchorEl}
                  open={Boolean(chatMenuAnchorEl)}
                  onClose={() => setChatMenuAnchorEl(null)}
                  PaperProps={{ elevation: 4, sx: { mt: 1, minWidth: 260, borderRadius: 2 } }}
                >
                  {minimizedChats.map((win) => (
                    <MenuItem
                      key={win.id}
                      onClick={() => {
                        setChatMenuAnchorEl(null);
                        restoreMinimizedWindow(win);
                      }}
                      sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}
                    >
                      <ChatBubbleOutlineIcon fontSize="small" sx={{ mt: 0.2, color: 'primary.main' }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                          {win.name}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: 'block',
                            maxWidth: 180,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}
                        >
                          @{win.chatUsername || win.name}
                        </Typography>
                      </Box>
                    </MenuItem>
                  ))}
                </Menu>
              )}
            </>
          )}

          <Box sx={{ flexGrow: 1 }} />

          {chatPreview && (
            <Chip
              size="small"
              clickable
              onClick={onChatPreviewClick}
              icon={<ChatBubbleOutlineIcon sx={{ fontSize: 16, color: '#fff !important' }} />}
              label={chatPreview.text}
              sx={{
                mr: 1,
                maxWidth: { xs: 180, sm: 360 },
                backgroundColor: 'primary.main',
                color: '#fff',
                borderRadius: 1.5,
                '& .MuiChip-label': {
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: 700,
                },
              }}
            />
          )}

          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <IconButton onClick={onOpenNotifications} size="small" sx={{ color: 'text.primary', bgcolor: 'action.hover' }}>
              <Badge
                color="error"
                badgeContent={unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                invisible={!unreadNotificationCount}
              >
                <NotificationsNoneIcon fontSize="small" />
              </Badge>
            </IconButton>

            <IconButton
              onClick={onOpenRooms}
              size="small"
              sx={{
                color: 'text.primary',
                backgroundColor: chatSidebarMode === 'rooms'
                  ? 'action.selected'
                  : 'transparent',
              }}
            >
              <ChatBubbleOutlineIcon fontSize="small" />
            </IconButton>

            <IconButton
              onClick={onOpenFriends}
              size="small"
              sx={{
                color: 'text.primary',
                backgroundColor: chatSidebarMode === 'friends'
                  ? 'action.selected'
                  : 'transparent',
              }}
            >
              <ManageAccountsIcon fontSize="small" />
            </IconButton>

            <IconButton onClick={() => navigate('/nas')} size="small" sx={{ color: 'text.primary' }}> <FolderIcon fontSize="small" /> </IconButton>
            <IconButton onClick={() => navigate('/settings')} size="small" sx={{ color: 'text.primary' }}> <SettingsIcon fontSize="small" /> </IconButton>

            <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small">
              <Avatar sx={{ width: 28, height: 28, fontSize: '0.8rem', bgcolor: 'primary.main', fontWeight: 'bold' }}>
                {(user.displayName || user.username)?.[0]?.toUpperCase()}
              </Avatar>
            </IconButton>
          </Box>

          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)} PaperProps={{ elevation: 3, sx: { mt: 1, minWidth: 150, borderRadius: 2 } }}>
            <Box sx={{ px: 2, py: 1, outline: 'none' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{user.displayName || user.username}</Typography>
              <Typography variant="caption" color="text.secondary">
                {(user.displayName && user.displayName !== user.username ? `@${user.username} · ` : '')}{user.role}
              </Typography>
            </Box>
            <Box sx={{ my: 0.5, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }} />

            <MenuItem onClick={() => { setAnchorEl(null); setProfileOpen(true); }}>
              <ManageAccountsIcon fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} /> 내 정보 수정
            </MenuItem>

            <MenuItem onClick={handleLogout} sx={{ color: 'error.main' }}>
              <LogoutIcon fontSize="small" sx={{ mr: 1.5 }} /> 로그아웃
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Dialog open={profileOpen} onClose={() => setProfileOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 800, pb: 1 }}>내 정보 수정</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField label="아이디" value={user.username} disabled size="small" fullWidth />
            <TextField label="현재 권한" value={user.role} disabled size="small" fullWidth />

            <Typography variant="subtitle2" sx={{ mt: 1, fontWeight: 'bold', color: 'primary.main' }}>비밀번호 변경</Typography>
            <TextField label="현재 비밀번호" type="password" size="small" fullWidth value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            <TextField label="새 비밀번호" type="password" size="small" fullWidth value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            <TextField label="새 비밀번호 확인" type="password" size="small" fullWidth value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setProfileOpen(false)} color="inherit">취소</Button>
          <Button onClick={handlePasswordChange} variant="contained" color="primary" sx={{ borderRadius: 2 }}>변경 완료</Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default TopBar;
