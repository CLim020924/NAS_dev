import React, { createContext, useState, useMemo, useContext, useEffect } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles'; // 여기서 GlobalStyles 제거
import { GlobalStyles } from '@mui/material'; // [수정] 올바른 위치에서 GlobalStyles 불러오기
import CssBaseline from '@mui/material/CssBaseline';

// 1. 테마 환경설정 
const themeConfigs = {
  light: {
    palette: {
      mode: 'light',
      primary: { main: '#1e3a8a' }, 
      background: { default: '#f4f7f6', paper: '#ffffff' },
      divider: 'rgba(30, 58, 138, 0.15)', 
    },
  },
  dark: {
    palette: {
      mode: 'dark',
      primary: { main: '#60a5fa' },
      background: { default: '#0f172a', paper: '#1e293b' },
      divider: 'rgba(96, 165, 250, 0.25)', 
    },
  },
  hacker: {
    palette: {
      mode: 'dark',
      primary: { main: '#22c55e' }, 
      background: { default: '#000000', paper: '#0a0a0a' },
      text: { primary: '#22c55e', secondary: '#16a34a' },
      divider: 'rgba(34, 197, 94, 0.3)', 
    },
  }
};

const ThemeContext = createContext();

export const CustomThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useState(() => localStorage.getItem('appTheme') || 'light');

  useEffect(() => {
    localStorage.setItem('appTheme', themeName);
  }, [themeName]);

  const theme = useMemo(() => createTheme(themeConfigs[themeName]), [themeName]);

  return (
    <ThemeContext.Provider value={{ themeName, setThemeName, themeConfigs }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/* 전역 CSS: 모든 곳에서 글자 드래그 방지 (단, input, textarea 등 입력창은 제외) */}
        <GlobalStyles styles={{
          'body': {
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none',
            userSelect: 'none',
          },
          'input, textarea': {
            WebkitUserSelect: 'auto',
            MozUserSelect: 'auto',
            msUserSelect: 'auto',
            userSelect: 'auto',
          }
        }} />
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  );
};

export const useCustomTheme = () => useContext(ThemeContext);
