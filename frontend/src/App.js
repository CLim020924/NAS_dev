import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { ThemeProvider as MUIThemeProvider, createTheme, CssBaseline, Box, Toolbar } from '@mui/material';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import socketIOClient from 'socket.io-client';
import axios from 'axios';
import './App.css';

import ServicePlatform from './components/ServicePlatform';
import TopBar from './components/TopBar';
import Settings from './components/Settings';
import NAS from './components/NAS';
import Login from './components/Login';
import Signup from './components/Signup';
import MessageSidebar from './components/MessageSidebar';
import ChatRoomSidebar from './components/ChatRoomSidebar';
import NotificationSidebar from './components/NotificationSidebar';
import DedicatedChatWindowLayer from './components/DedicatedChatWindowLayer';
import ChatWorkspaceWindowLayer from './components/ChatWorkspaceWindowLayer';
import GlobalAppWindowLayer from './components/GlobalAppWindowLayer';
import MeetingInvitePage from './components/MeetingInvitePage';
import PublicSharePage from './components/PublicSharePage';
import AiAgentPanel from './components/AiAgentPanel';

import { WindowProvider } from './contexts/WindowContext';
import { useWindows } from './contexts/WindowContext';
import { TransferProvider } from './contexts/TransferContext';
import { ChatProvider } from './contexts/ChatContext';
import { MeetingProvider } from './contexts/MeetingContext';
import { CustomThemeProvider, useCustomTheme } from './contexts/ThemeContext';
import useNotifications from './notifications/useNotifications';

const PrivateRoute = ({ children }) => {
  const user = localStorage.getItem('user');
  return user ? children : <Navigate to="/login" />;
};

const SESSION_LEFT_AT_KEY = 'nas_session_left_at';

const SessionDepartureGuard = () => {
  useEffect(() => {
    let validating = false;

    const clearInvalidSession = () => {
      localStorage.removeItem('user');
      localStorage.removeItem(SESSION_LEFT_AT_KEY);
      window.dispatchEvent(new Event('nas:user-updated'));
      if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/signup') && !window.location.pathname.startsWith('/meeting/') && !window.location.pathname.startsWith('/share/')) {
        window.location.replace('/login');
      }
    };

    const validateSession = () => {
      if (validating) return;
      if (!localStorage.getItem('user')) return false;
      validating = true;
      axios.get('/api/auth/session', { withCredentials: true })
        .then((res) => {
          localStorage.removeItem(SESSION_LEFT_AT_KEY);
          if (res.data?.user) {
            const current = JSON.parse(localStorage.getItem('user') || '{}');
            localStorage.setItem('user', JSON.stringify({ ...current, ...res.data.user }));
            window.dispatchEvent(new Event('nas:user-updated'));
          }
        })
        .catch(() => clearInvalidSession())
        .finally(() => {
          validating = false;
        });
    };

    validateSession();

    const markDeparture = (event) => {
      if (event?.persisted || !localStorage.getItem('user')) return;
      localStorage.setItem(SESSION_LEFT_AT_KEY, String(Date.now()));
    };
    const handlePageShow = () => validateSession();

    window.addEventListener('pagehide', markDeparture);
    window.addEventListener('beforeunload', markDeparture);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      window.removeEventListener('pagehide', markDeparture);
      window.removeEventListener('beforeunload', markDeparture);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  return null;
};

const buildChatPreviewText = (payload = {}) => {
  const sender = payload.sender || {};
  const message = payload.message || {};
  const senderName = sender.displayName || sender.username || '알 수 없음';

  let content = '새 메시지가 도착했습니다.';
  switch (message.messageType) {
    case 'image':
      content = '사진을 보냈습니다.';
      break;
    case 'file':
      content = '파일을 보냈습니다.';
      break;
    case 'folder':
      content = '폴더를 보냈습니다.';
      break;
    case 'attachment':
      content = Number(message.attachmentCount) > 1
        ? `첨부 ${message.attachmentCount}개를 보냈습니다.`
        : '첨부를 보냈습니다.';
      break;
    case 'mixed': {
      const text = String(message.text || '').trim();
      content = text || '첨부를 보냈습니다.';
      break;
    }
    default: {
      const text = String(message.text || '').trim();
      content = text || '새 메시지가 도착했습니다.';
      break;
    }
  }

  return `${senderName}: ${content}`;
};


const PersistentMainRoutes = () => {
  const location = useLocation();
  const isNasRoute = location.pathname.startsWith('/nas');

  return (
    <Box sx={{ position: 'relative', width: '100%', height: '100%', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {!isNasRoute && (
        <Routes>
          <Route path="/platform" element={<ServicePlatform />} />
          <Route path="/" element={<Navigate to="/platform" replace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/platform" replace />} />
        </Routes>
      )}

      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          zIndex: isNasRoute ? 0 : 30,
          pointerEvents: isNasRoute ? 'auto' : 'none'
        }}
      >
        <NAS showWorkspace={isNasRoute} />
      </Box>
      <GlobalAppWindowLayer />
    </Box>
  );
};

function AppContent() {
  const navigate = useNavigate();
  const { openFolderWindowByPath, setFileManagerPath, setFocusedContext } = useWindows();
  const { themeName } = useCustomTheme();
  const [chatSidebarMode, setChatSidebarMode] = useState('none');
  const [activeDockedChat, setActiveDockedChat] = useState(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationNavigation, setNotificationNavigation] = useState(null);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));
  const [appSocket, setAppSocket] = useState(null);
  const [chatPreview, setChatPreview] = useState(null);
  const previewTimerRef = useRef(null);

  useEffect(() => {
    const checkUser = setInterval(() => {
      const currentUser = localStorage.getItem('user');
      if (JSON.stringify(user) !== currentUser) {
        setUser(JSON.parse(currentUser));
      }
    }, 500);
    return () => clearInterval(checkUser);
  }, [user]);

  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearPreviewTimer();
  }, [clearPreviewTimer]);

  const openFriendSidebar = useCallback(() => {
    setNotificationsOpen(false);
    setChatSidebarMode((prev) => (prev === 'friends' ? 'none' : 'friends'));
  }, []);

  const openRoomSidebar = useCallback(() => {
    setNotificationsOpen(false);
    setChatSidebarMode((prev) => (prev === 'rooms' ? 'none' : 'rooms'));
  }, []);

  const closeFriendSidebar = useCallback(() => {
    setChatSidebarMode((prev) => (prev === 'friends' ? 'none' : prev));
  }, []);

  const closeRoomSidebar = useCallback(() => {
    setChatSidebarMode((prev) => (prev === 'rooms' ? 'none' : prev));
    setActiveDockedChat(null);
  }, []);

  const openRoomSidebarWithSeedChat = useCallback((seedChat) => {
    setNotificationsOpen(false);
    setActiveDockedChat(seedChat || null);
    setChatSidebarMode('rooms');
  }, []);


  useEffect(() => {
    if (!user) {
      setAppSocket(null);
      return undefined;
    }

    const socket = socketIOClient('https://filemanager-nas.com', {
      withCredentials: true,
    });

    setAppSocket(socket);

    const handleForceLogoutTarget = (data) => {
      const currentUser = JSON.parse(localStorage.getItem('user'));
      const identifiers = [
        currentUser?.userUid,
        currentUser?.loginId,
        currentUser?.id,
        currentUser?.username,
      ].filter(Boolean);

      if (currentUser && identifiers.includes(data.targetId)) {
        alert('관리자로 인해 계정정보가 변경되어 로그아웃 됩니다. 다시 로그인 하세요.');
        document.cookie = 'token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    };

    const handleDuplicateLogin = () => {
      alert('다른 위치에서 기존 접속 종료를 선택해 현재 기기에서 로그아웃됩니다.');
      localStorage.removeItem('user');
      localStorage.setItem('last_logout_reason', 'SESSION_REPLACED');
      window.dispatchEvent(new Event('nas:user-updated'));
      window.location.href = '/login';
    };

    socket.on('force_logout_target', handleForceLogoutTarget);
    socket.on('duplicate_login', handleDuplicateLogin);

    return () => {
      socket.off('force_logout_target', handleForceLogoutTarget);
      socket.off('duplicate_login', handleDuplicateLogin);
      socket.disconnect();
      setAppSocket((current) => (current === socket ? null : current));
    };
  }, [user]);

  useEffect(() => {
    if (!appSocket || !user) return undefined;

    const handleIncomingChatMessage = (payload = {}) => {
      const previewText = buildChatPreviewText(payload);
      const sender = payload.sender || {};
      const nextPreview = {
        text: previewText,
        targetUserUid: sender.userUid || payload.message?.senderUid || null,
        targetUsername: sender.username || '',
        targetDisplayName: sender.displayName || sender.username || '',
        targetRole: sender.role || '',
        targetConversationId: payload.conversationId || null,
        ts: Date.now(),
      };

      setChatPreview(nextPreview);

      clearPreviewTimer();
      previewTimerRef.current = setTimeout(() => {
        setChatPreview((current) => (current?.ts === nextPreview.ts ? null : current));
        previewTimerRef.current = null;
      }, 2000);
    };

    appSocket.on('chat:message', handleIncomingChatMessage);

    return () => {
      appSocket.off('chat:message', handleIncomingChatMessage);
    };
  }, [appSocket, user, clearPreviewTimer]);

  const handleNotificationNavigate = useCallback((notification) => {
    if (!notification) return;
    const meta = notification.meta || {};

    if (notification.type === 'upload_complete') {
      const targetPath = meta.path || '/';
      const openMode = localStorage.getItem('platform_app_open_mode') || meta.openMode || 'window';
      setNotificationsOpen(false);

      if (openMode === 'inline') {
        setFileManagerPath(targetPath);
        setFocusedContext('desktop');
        navigate('/nas');
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent('nas_transfer_completed', { detail: { path: targetPath } }));
          window.dispatchEvent(new CustomEvent('nas_tree_refresh'));
        }, 80);
        return;
      }

      openFolderWindowByPath(targetPath);
      return;
    }

    setNotificationsOpen(false);
    setChatSidebarMode('friends');
    setNotificationNavigation({
      type: notification.type || 'system',
      targetUserUid: meta.fromUserUid || null,
      targetUsername: meta.fromUsername || '',
      targetDisplayName: meta.fromDisplayName || '',
      targetConversationId: meta.conversationId || null,
      targetRole: meta.fromRole || '',
      ts: Date.now(),
    });
  }, [navigate, openFolderWindowByPath, setFileManagerPath, setFocusedContext]);

  const notificationState = useNotifications({
    user,
    open: notificationsOpen,
    socket: appSocket,
    onNavigateFromNotification: handleNotificationNavigate,
  });

  const handleChatPreviewClick = useCallback(() => {
    if (!chatPreview) return;

    clearPreviewTimer();
    setChatPreview(null);
    setNotificationsOpen(false);
    setChatSidebarMode('friends');
    setNotificationNavigation({
      type: 'chat_message',
      targetUserUid: chatPreview.targetUserUid || null,
      targetUsername: chatPreview.targetUsername || '',
      targetDisplayName: chatPreview.targetDisplayName || '',
      targetConversationId: chatPreview.targetConversationId || null,
      targetRole: chatPreview.targetRole || '',
      ts: Date.now(),
    });
  }, [chatPreview, clearPreviewTimer]);


  const theme = useMemo(() => createTheme({
    palette: {
      mode: themeName === 'dark' ? 'dark' : 'light',
      primary: { main: themeName === 'ocean' ? '#0284c7' : '#2563eb' },
      background: { default: themeName === 'dark' ? '#0f172a' : (themeName === 'ocean' ? '#e0f2fe' : '#f1f5f9') },
    },
    typography: { fontFamily: 'Noto Sans KR, system-ui, sans-serif' },
    components: {
      MuiAppBar: { styleOverrides: { root: { boxShadow: 'none' } } },
      MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 'bold', borderRadius: 8 } } },
      MuiPaper: { styleOverrides: { root: { borderRadius: 12 } } },
    }
  }), [themeName]);

  return (
    <MUIThemeProvider theme={theme}>
      <CssBaseline />
      <SessionDepartureGuard />
      <MeetingProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/meeting/:roomCode" element={<MeetingInvitePage />} />
          <Route path="/share/:token" element={<PublicSharePage />} />
          <Route path="/*" element={
            <PrivateRoute>
              <TransferProvider>
                <Box sx={{ display: 'flex', width: '100%', height: 'var(--app-viewport-height)', minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>
                <TopBar
                  onOpenNotifications={() => setNotificationsOpen(true)}
                  onOpenFriends={openFriendSidebar}
                  onOpenRooms={openRoomSidebar}
                  unreadNotificationCount={notificationState.unreadCount}
                  chatPreview={chatPreview}
                  onChatPreviewClick={handleChatPreviewClick}
                  chatSidebarMode={chatSidebarMode}
                  onOpenAi={() => setAiPanelOpen(true)}
                />
                <AiAgentPanel open={aiPanelOpen} onClose={() => setAiPanelOpen(false)} />
                <NotificationSidebar
                  open={notificationsOpen}
                  onClose={() => setNotificationsOpen(false)}
                  loading={notificationState.loading}
                  notifications={notificationState.visibleNotifications}
                  unreadCount={notificationState.unreadCount}
                  onReadAll={notificationState.readAllNotifications}
                  onNotificationClick={notificationState.handleNotificationClick}
                  onNotificationRead={notificationState.handleReadNotification}
                  onNotificationDelete={notificationState.handleDeleteNotification}
                  onDeleteRead={notificationState.deleteReadNotifications}
                />
                <ChatProvider user={user} socket={appSocket}>
                  <MessageSidebar
                    open={chatSidebarMode === 'friends'}
                    onClose={closeFriendSidebar}
                    navigationRequest={notificationNavigation}
                    onStartRoomDraft={openRoomSidebarWithSeedChat}
                  />
                  <ChatRoomSidebar
                    open={chatSidebarMode === 'rooms'}
                    onClose={closeRoomSidebar}
                    activeChat={activeDockedChat}
                    onActiveChatChange={setActiveDockedChat}
                  />
                  <DedicatedChatWindowLayer />
                  <ChatWorkspaceWindowLayer />
                </ChatProvider>
                <Box component="main" sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <Toolbar size="small" sx={{ minHeight: '48px !important', flexShrink: 0 }} />
                  <PersistentMainRoutes />
                </Box>
                </Box>
              </TransferProvider>
            </PrivateRoute>
          } />
        </Routes>
      </MeetingProvider>
    </MUIThemeProvider>
  );
}

export default function App() {
  return (
    <CustomThemeProvider>
      <BrowserRouter>
        <WindowProvider>
          <AppContent />
        </WindowProvider>
      </BrowserRouter>
    </CustomThemeProvider>
  );
}
