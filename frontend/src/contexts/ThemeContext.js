import React, { createContext, useState, useMemo, useContext, useEffect } from 'react';
import { ThemeProvider, createTheme, alpha } from '@mui/material/styles';
import { GlobalStyles } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';

const sharedComponents = {
  MuiButton: {
    styleOverrides: {
      root: {
        borderRadius: 8,
        textTransform: 'none',
        fontWeight: 700,
        boxShadow: 'none',
        minHeight: 38
      },
      contained: {
        boxShadow: 'none',
        '&:hover': { boxShadow: 'none' }
      }
    }
  },
  MuiPaper: {
    styleOverrides: {
      root: {
        backgroundImage: 'none'
      }
    }
  },
  MuiIconButton: {
    styleOverrides: {
      root: {
        borderRadius: 8
      },
      sizeSmall: {
        width: 32,
        height: 32
      }
    }
  },
  MuiMenu: {
    styleOverrides: {
      paper: {
        borderRadius: 8,
        boxShadow: '0 18px 48px rgba(15, 23, 42, 0.18)'
      }
    }
  },
  MuiMenuItem: {
    styleOverrides: {
      root: {
        borderRadius: 6,
        minHeight: 38,
        fontSize: '0.9rem'
      }
    }
  },
  MuiTextField: {
    defaultProps: {
      variant: 'outlined'
    }
  },
  MuiOutlinedInput: {
    styleOverrides: {
      root: {
        borderRadius: 8
      }
    }
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        borderRadius: 8
      }
    }
  },
  MuiTableCell: {
    styleOverrides: {
      root: {
        borderBottomColor: 'var(--nas-border)'
      }
    }
  }
};

const themeConfigs = {
  light: {
    palette: {
      mode: 'light',
      primary: { main: '#2563eb', dark: '#1d4ed8', light: '#60a5fa', contrastText: '#ffffff' },
      secondary: { main: '#0f766e', dark: '#115e59', light: '#5eead4', contrastText: '#ffffff' },
      info: { main: '#0891b2' },
      success: { main: '#16a34a' },
      warning: { main: '#d97706' },
      error: { main: '#dc2626' },
      background: { default: '#f6f7f9', paper: '#ffffff' },
      text: { primary: '#151922', secondary: '#647084' },
      divider: 'rgba(100, 116, 139, 0.22)'
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: '"Inter", "Segoe UI", "Noto Sans KR", Arial, sans-serif',
      h4: { fontWeight: 800, letterSpacing: 0 },
      h5: { fontWeight: 800, letterSpacing: 0 },
      h6: { fontWeight: 800, letterSpacing: 0 },
      button: { letterSpacing: 0 }
    },
    shadows: [
      'none',
      '0 1px 2px rgba(15, 23, 42, 0.06)',
      '0 2px 8px rgba(15, 23, 42, 0.07)',
      '0 6px 18px rgba(15, 23, 42, 0.08)',
      '0 10px 28px rgba(15, 23, 42, 0.10)',
      '0 12px 32px rgba(15, 23, 42, 0.12)',
      '0 16px 40px rgba(15, 23, 42, 0.14)',
      '0 20px 52px rgba(15, 23, 42, 0.16)',
      '0 24px 64px rgba(15, 23, 42, 0.18)',
      '0 28px 72px rgba(15, 23, 42, 0.20)',
      '0 32px 80px rgba(15, 23, 42, 0.22)',
      '0 34px 84px rgba(15, 23, 42, 0.23)',
      '0 36px 88px rgba(15, 23, 42, 0.24)',
      '0 38px 92px rgba(15, 23, 42, 0.25)',
      '0 40px 96px rgba(15, 23, 42, 0.26)',
      '0 42px 100px rgba(15, 23, 42, 0.27)',
      '0 44px 104px rgba(15, 23, 42, 0.28)',
      '0 46px 108px rgba(15, 23, 42, 0.29)',
      '0 48px 112px rgba(15, 23, 42, 0.30)',
      '0 50px 116px rgba(15, 23, 42, 0.31)',
      '0 52px 120px rgba(15, 23, 42, 0.32)',
      '0 54px 124px rgba(15, 23, 42, 0.33)',
      '0 56px 128px rgba(15, 23, 42, 0.34)',
      '0 58px 132px rgba(15, 23, 42, 0.35)',
      '0 60px 136px rgba(15, 23, 42, 0.36)'
    ],
    components: sharedComponents
  },
  dark: {
    palette: {
      mode: 'dark',
      primary: { main: '#7dd3fc', dark: '#38bdf8', light: '#bae6fd', contrastText: '#082f49' },
      secondary: { main: '#5eead4', dark: '#2dd4bf', light: '#99f6e4', contrastText: '#042f2e' },
      info: { main: '#67e8f9' },
      success: { main: '#86efac' },
      warning: { main: '#fbbf24' },
      error: { main: '#f87171' },
      background: { default: '#101418', paper: '#171c22' },
      text: { primary: '#eef2f7', secondary: '#a9b4c3' },
      divider: 'rgba(148, 163, 184, 0.22)'
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: '"Inter", "Segoe UI", "Noto Sans KR", Arial, sans-serif',
      h4: { fontWeight: 800, letterSpacing: 0 },
      h5: { fontWeight: 800, letterSpacing: 0 },
      h6: { fontWeight: 800, letterSpacing: 0 },
      button: { letterSpacing: 0 }
    },
    components: sharedComponents
  },
  hacker: {
    palette: {
      mode: 'dark',
      primary: { main: '#22c55e' },
      secondary: { main: '#14b8a6' },
      background: { default: '#050805', paper: '#0b120c' },
      text: { primary: '#bbf7d0', secondary: '#86efac' },
      divider: 'rgba(34, 197, 94, 0.25)'
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: '"JetBrains Mono", "Consolas", "Noto Sans KR", monospace',
      button: { letterSpacing: 0 }
    },
    components: sharedComponents
  }
};

const ThemeContext = createContext();

export const CustomThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useState(() => localStorage.getItem('appTheme') || 'light');

  useEffect(() => {
    localStorage.setItem('appTheme', themeName);
  }, [themeName]);

  const theme = useMemo(() => createTheme(themeConfigs[themeName] || themeConfigs.light), [themeName]);

  return (
    <ThemeContext.Provider value={{ themeName, setThemeName, themeConfigs }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GlobalStyles styles={(activeTheme) => ({
          ':root': {
            '--nas-border': activeTheme.palette.divider,
            '--nas-folder': activeTheme.palette.mode === 'dark' ? '#facc15' : '#c2410c',
            '--nas-device': activeTheme.palette.mode === 'dark' ? '#67e8f9' : '#0891b2',
            '--nas-file': activeTheme.palette.mode === 'dark' ? '#cbd5e1' : '#64748b'
          },
          'html, body, #root': {
            height: '100%',
            margin: 0,
            overflow: 'hidden',
            touchAction: 'manipulation'
          },
          body: {
            WebkitUserSelect: 'none',
            MozUserSelect: 'none',
            msUserSelect: 'none',
            userSelect: 'none',
            background: activeTheme.palette.background.default,
            color: activeTheme.palette.text.primary,
            textRendering: 'optimizeLegibility'
          },
          'input, textarea, [contenteditable="true"]': {
            WebkitUserSelect: 'auto',
            MozUserSelect: 'auto',
            msUserSelect: 'auto',
            userSelect: 'auto'
          },
          '*': {
            boxSizing: 'border-box'
          },
          '*::-webkit-scrollbar': {
            width: 10,
            height: 10
          },
          '*::-webkit-scrollbar-thumb': {
            backgroundColor: alpha(activeTheme.palette.text.secondary, 0.28),
            borderRadius: 999,
            border: `3px solid ${activeTheme.palette.background.paper}`
          },
          '*::-webkit-scrollbar-track': {
            background: 'transparent'
          },
          '@media (max-width: 600px)': {
            '.desktop-only': { display: 'none' },
            '.mobile-full': {
              width: '100% !important',
              height: '100% !important',
              transform: 'none !important',
              left: '0 !important',
              top: '0 !important'
            }
          }
        })} />
        {children}
      </ThemeProvider>
    </ThemeContext.Provider>
  );
};

export const useCustomTheme = () => useContext(ThemeContext);
