const fs = require('fs');

// 1. ThemeContext.js 파일을 직접 읽어서 정확한 Provider 이름을 찾아냅니다.
let providerName = 'CustomThemeProvider'; 
try {
    const content = fs.readFileSync('./src/contexts/ThemeContext.js', 'utf8');
    const match = content.match(/export\s+(?:default\s+)?(?:const|function|let|class)\s+([A-Za-z0-9_]*Provider)/);
    if (match) {
        providerName = match[1];
    } else if (content.includes('export const ThemeProvider')) {
        providerName = 'ThemeProvider';
    }
} catch(e) {
    console.log("ThemeContext.js 읽기 실패, 기본값 사용");
}

// 2. 찾아낸 정확한 이름으로 App.js를 다시 작성합니다.
const code = `import React, { useState, useEffect, useMemo } from 'react';
import { ThemeProvider as MUIThemeProvider, createTheme, CssBaseline, Box, Toolbar, Snackbar, Alert } from '@mui/material';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import socketIOClient from 'socket.io-client';

import ServicePlatform from './components/ServicePlatform';
import TopBar from './components/TopBar';
import Settings from './components/Settings';
import NAS from './components/NAS';
import Login from './components/Login';
import Signup from './components/Signup';
import MessageSidebar from './components/MessageSidebar';

// 🔥 스크립트가 찾아낸 정확한 Provider 이름으로 가져옵니다!
import { \${providerName}, useCustomTheme } from './contexts/ThemeContext';

const PrivateRoute = ({ children }) => {
  const token = document.cookie.split('; ').find(row => row.startsWith('token='));
  return token ? children : <Navigate to="/login" />;
};

function AppContent() {
  // 테마 보따리에서 정보를 꺼냅니다. (없을 경우를 대비한 안전 장치 추가)
  const themeCtx = useCustomTheme() || {};
  const themeName = themeCtx.themeName || 'light';

  const [messagesOpen, setMessagesOpen] = useState(false);
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));
  const [alertMsg, setAlertMsg] = useState(null);

  useEffect(() => {
    const socket = socketIOClient("https://filemanager-nas.com", { withCredentials: true });
    socket.on("force_logout", () => {
      alert("관리자로 인해 계정정보가 변경되어 로그아웃 됩니다. 다시 로그인 하세요.");
      document.cookie = "token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      localStorage.removeItem('user');
      window.location.href = '/login';
    });
    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    const handleStorageChange = () => setUser(JSON.parse(localStorage.getItem('user')));
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const isManager = user?.role === 'MASTER' || user?.role === 'MANAGER' || user?.Masters || user?.Managers;

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
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/*" element={
            <PrivateRoute>
              <Box sx={{ display: 'flex', height: '100vh', flexDirection: 'column', overflow: 'hidden' }}>
                <TopBar onOpenMessages={() => setMessagesOpen(true)} />
                <MessageSidebar open={messagesOpen} onClose={() => setMessagesOpen(false)} />
                <Box component="main" sx={{ flexGrow: 1, height: '100%', overflow: 'hidden' }}>
                  <Toolbar size="small" sx={{ minHeight: '48px !important' }} />
                  <Routes>
                    <Route path="/" element={<ServicePlatform />} />
                    <Route path="/nas/*" element={<NAS />} />
                    {isManager && <Route path="/settings" element={<Settings />} />}
                    <Route path="*" element={<Navigate to="/" />} />
                  </Routes>
                </Box>
              </Box>
            </PrivateRoute>
          } />
        </Routes>
      </BrowserRouter>
      <Snackbar open={Boolean(alertMsg)} autoHideDuration={5000} onClose={() => setAlertMsg(null)}>
        <Alert onClose={() => setAlertMsg(null)} severity={alertMsg?.severity || 'info'} sx={{ width: '100%' }}>
          {alertMsg?.message}
        </Alert>
      </Snackbar>
    </MUIThemeProvider>
  );
}

// 🔥 앱 전체를 정확한 테마 Provider로 감싸줍니다!
export default function App() {
  return (
    <\${providerName}>
      <AppContent />
    </\${providerName}>
  );
}
\`;

fs.writeFileSync('./src/App.js', code);
console.log("✅ App.js 완벽 복구 완료! (적용된 테마 Provider: " + providerName + ")");
