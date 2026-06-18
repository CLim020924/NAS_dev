import React, { useState } from 'react';
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import HistoryIcon from '@mui/icons-material/History';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import SettingsIcon from '@mui/icons-material/Settings';
import VideocamIcon from '@mui/icons-material/Videocam';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { useWindows } from '../contexts/WindowContext';
import MeetingApp from './MeetingApp';

const appOpenMode = () => localStorage.getItem('platform_app_open_mode') || 'window';

function ServicePlatform() {
  const navigate = useNavigate();
  const theme = useTheme();
  const [inlineApp, setInlineApp] = useState(null);
  const {
    openAppWindow
  } = useWindows();
  const user = JSON.parse(localStorage.getItem('user')) || {};
  const canOpenBackup = user.role === 'MASTER' || user.Masters || user.globalAccess;
  const openApp = (app) => {
    const mode = appOpenMode();
    if (mode !== 'window' && app.component) {
      setInlineApp(app);
      return;
    }
    if (app.route && mode !== 'window') {
      navigate(app.route);
      return;
    }
    if (app.id === 'files') {
      navigate(app.route || '/nas');
      return;
    }
    if (app.route && !app.component) {
      navigate(app.route);
      return;
    }
    openAppWindow(app);
  };

  const apps = [
    { id: 'files', title: '파일 관리자', icon: FolderIcon, route: '/nas', color: theme.palette.primary.main },
    { id: 'pc-sync', title: 'PC 연동', icon: DesktopWindowsIcon, route: '/nas', color: theme.palette.secondary.main },
    { id: 'meeting', title: '화상회의', icon: VideocamIcon, component: MeetingApp, color: theme.palette.info.main, width: 920, height: 640 },
    { id: 'settings', title: '설정', icon: SettingsIcon, route: '/settings', color: theme.palette.text.secondary }
  ];

  if (canOpenBackup) {
    apps.push({ id: 'backup', title: '백업', icon: HistoryIcon, route: '/nas/backup', color: theme.palette.error.main });
  }

  if (inlineApp) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
        <Box sx={{ height: 54, px: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper', flexShrink: 0 }}>
          <Typography sx={{ fontWeight: 900 }}>{inlineApp.title}</Typography>
          <Button variant="text" onClick={() => setInlineApp(null)}>바탕화면</Button>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {inlineApp.id === 'meeting' ? (
            <MeetingApp
              onOpenWindow={(payload) => {
                openAppWindow({ ...inlineApp, payload });
                setInlineApp(null);
              }}
            />
          ) : null}
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', overflow: 'hidden', position: 'relative', bgcolor: 'background.default', background: theme.palette.mode === 'dark' ? 'linear-gradient(180deg, #101418 0%, #151b22 100%)' : 'linear-gradient(180deg, #eef2f6 0%, #f8fafc 100%)' }}>
      <Box sx={{ position: 'absolute', left: 16, top: 18, bottom: 18, width: 62, borderRadius: 2, bgcolor: alpha(theme.palette.background.paper, 0.86), border: `1px solid ${theme.palette.divider}`, display: 'flex', flexDirection: 'column', alignItems: 'center', py: 1, gap: 0.75, boxShadow: `0 18px 48px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.30 : 0.09)}` }}>
        {apps.map((app) => {
          const Icon = app.icon;
          return (
            <Tooltip key={app.id} title={app.title} placement="right">
              <IconButton onClick={() => openApp(app)} sx={{ width: 44, height: 44, color: app.color, bgcolor: alpha(app.color, 0.08), '&:hover': { bgcolor: alpha(app.color, 0.16) } }}>
                <Icon />
              </IconButton>
            </Tooltip>
          );
        })}
      </Box>

      <Box sx={{ position: 'absolute', left: 100, top: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 92px)', gap: 2, width: { xs: 'calc(100% - 116px)', sm: 440 } }}>
        {apps.map((app) => {
          const Icon = app.icon;
          return (
            <Box key={`desktop_${app.id}`} onDoubleClick={() => openApp(app)} onClick={() => openApp(app)} sx={{ cursor: 'pointer', textAlign: 'center', color: 'text.primary' }}>
              <Box sx={{ width: 58, height: 58, mx: 'auto', borderRadius: 2, display: 'grid', placeItems: 'center', color: app.color, bgcolor: alpha(theme.palette.background.paper, 0.82), border: `1px solid ${theme.palette.divider}`, boxShadow: `0 10px 28px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.22 : 0.08)}` }}>
                <Icon sx={{ fontSize: 30 }} />
              </Box>
              <Typography variant="caption" sx={{ display: 'block', mt: 0.75, fontWeight: 800, lineHeight: 1.2 }}>{app.title}</Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

export default ServicePlatform;
