import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import HistoryIcon from '@mui/icons-material/History';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import SettingsIcon from '@mui/icons-material/Settings';
import VideocamIcon from '@mui/icons-material/Videocam';
import AutoAwesomeMotionIcon from '@mui/icons-material/AutoAwesomeMotion';
import ArticleIcon from '@mui/icons-material/Article';
import { alpha, useTheme } from '@mui/material/styles';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWindows } from '../contexts/WindowContext';
import socket from '../socket';
import MeetingApp from './MeetingApp';
import DocumentStudio from './DocumentStudio/DocumentStudio';
import DocumentWorkspace from './DocumentWorkspace/DocumentWorkspace';

const appOpenMode = () => localStorage.getItem('platform_app_open_mode') || 'window';
const DEVICE_OFFLINE_AFTER_MS = 30000;

const getPcConnectionState = (liveState) => {
  if (liveState === 'offline' || liveState === 'revoked') return 'offline';
  if (liveState === 'connecting') return 'connecting';
  return 'online';
};

const getDeviceLiveState = (device, now = Date.now()) => {
  if (!device || device.status === 'revoked' || device.relationshipState === 'revoked' || device.connectionState === 'revoked') return 'revoked';
  if (device.connectionState === 'offline') return 'offline';
  if (device.connectionState === 'connecting') return 'connecting';
  const lastSeen = Date.parse(device.lastSeenAt || 0) || 0;
  const offlineAfterMs = Math.max(1000, Number(device.offlineAfterMs || DEVICE_OFFLINE_AFTER_MS));
  if (!lastSeen) return device.syncState === 'connecting' ? 'connecting' : 'offline';
  if (now - lastSeen > offlineAfterMs) return 'offline';
  if (device.syncPaused || device.syncState === 'paused') return 'paused';
  return ['connecting', 'syncing', 'up-to-date', 'updating', 'error'].includes(device.syncState) ? device.syncState : 'connecting';
};

const preferNewerDevice = (current, incoming) => {
  if (!current) return incoming;
  const currentRevision = Number(current.stateRevision || 0);
  const incomingRevision = Number(incoming.stateRevision || 0);
  if (incomingRevision < currentRevision) return current;
  if (incomingRevision > currentRevision) return incoming;
  const currentTime = Date.parse(current.lastSeenAt || current.stateChangedAt || 0) || 0;
  const incomingTime = Date.parse(incoming.lastSeenAt || incoming.stateChangedAt || 0) || 0;
  return incomingTime >= currentTime ? incoming : current;
};

const mergeDeviceSnapshots = (current, incoming) => {
  const next = new Map(current.map((device) => [device.deviceId, device]));
  for (const device of incoming) next.set(device.deviceId, preferNewerDevice(next.get(device.deviceId), device));
  return Array.from(next.values());
};

const getDeviceStatusUi = (state) => ({
  'up-to-date': { label: '파일 최신 상태', color: 'primary', iconColor: '#1976d2' },
  syncing: { label: '파일 동기화 중', color: 'info', iconColor: '#0288d1' },
  connecting: { label: '계정 연결 중', color: 'info', iconColor: '#0288d1' },
  updating: { label: 'NAS Drive 업데이트 중', color: 'info', iconColor: '#0288d1' },
  paused: { label: '동기화 일시 중지', color: 'default', iconColor: '#757575' },
  error: { label: '동기화 오류', color: 'error', iconColor: '#d32f2f' },
  offline: { label: 'PC 연결 끊김', color: 'warning', iconColor: '#ed8b00' },
  revoked: { label: '연결 해제됨', color: 'default', iconColor: '#9e9e9e' }
}[state] || { label: '상태 확인 중', color: 'default', iconColor: '#9e9e9e' });

const getDeviceConnectionUi = (device, now = Date.now()) => {
  const state = getDeviceLiveState(device, now);
  if (state === 'revoked') return { label: '연결 해제됨', color: 'default' };
  if (state === 'offline') return { label: '현재 연결 끊김', color: 'warning' };
  if (state === 'connecting') return { label: '연결 확인 중', color: 'info' };
  return { label: '현재 PC 연결됨', color: 'success' };
};

const getDeviceReasonLabel = (device, state) => {
  if (state === 'revoked') return '이 계정과 PC의 연결이 해제되었습니다.';
  if (state === 'offline') return 'PC 상태 신호가 끊겼습니다. PC 전원·인터넷·NAS Drive 실행 상태를 확인하세요.';
  return device?.reasonLabel || '';
};

const getPairingStatusUi = (state) => ({
  preparing: { label: '연동 준비 중', color: 'info' },
  'needs-install': { label: '프로그램 실행 대기', color: 'warning' },
  installing: { label: '설치·연동 대기', color: 'warning' },
  detecting: { label: 'PC 연동 요청 중', color: 'info' },
  connecting: { label: 'PC 연동 중', color: 'info' }
}[state] || null);

function ServicePlatform() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const [inlineApp, setInlineApp] = useState(null);
  const [pcSyncOpen, setPcSyncOpen] = useState(false);
  const [pcSyncState, setPcSyncState] = useState('idle');
  const [pcSyncMessage, setPcSyncMessage] = useState('');
  const [pcSyncDownload, setPcSyncDownload] = useState(null);
  const [pcLinkedHere, setPcLinkedHere] = useState(false);
  const [pcConnectionState, setPcConnectionState] = useState('not-linked');
  const [pcLiveState, setPcLiveState] = useState('not-linked');
  const [pcDevices, setPcDevices] = useState([]);
  const [statusNow, setStatusNow] = useState(Date.now());
  const [showDeviceManager, setShowDeviceManager] = useState(false);
  const pcSyncPollRef = useRef(null);
  const pcPairingTokenRef = useRef('');
  const pcPairingStartingRef = useRef(false);
  const pcAutoConnectStartedRef = useRef(false);
  const pcDevicesRef = useRef([]);
  const {
    openAppWindow
  } = useWindows();
  const user = JSON.parse(localStorage.getItem('user')) || {};
  const accountKey = String(user.userUid || user.loginId || user.id || user.username || 'unknown');
  const localLinkKey = `nas_drive_linked_here:${accountKey}`;
  const canOpenBackup = user.role === 'MASTER' || user.Masters || user.globalAccess;
  const pairingStatus = getPairingStatusUi(pcSyncState);
  const pcPairingActive = !!pairingStatus;

  const refreshPcDevices = useCallback(async () => {
    try {
      const saved = JSON.parse(localStorage.getItem(localLinkKey) || 'null');
      const response = await axios.get('/api/devices', { withCredentials: true });
      const devices = Array.isArray(response.data?.devices) ? response.data.devices : [];
      const mergedDevices = mergeDeviceSnapshots(pcDevicesRef.current, devices);
      pcDevicesRef.current = mergedDevices;
      setPcDevices(mergedDevices);
      const localDevice = saved?.deviceId ? mergedDevices.find((device) => device.deviceId === saved.deviceId) : null;
      if (localDevice && localDevice.status !== 'revoked') {
        const liveState = getDeviceLiveState(localDevice);
        setPcLinkedHere(true);
        setPcLiveState(liveState);
        setPcConnectionState(getPcConnectionState(liveState));
      } else {
        if (saved?.deviceId) localStorage.removeItem(localLinkKey);
        setPcLinkedHere(false);
        setPcConnectionState('not-linked');
        setPcLiveState('not-linked');
      }
    } catch {
      const saved = JSON.parse(localStorage.getItem(localLinkKey) || 'null');
      setPcLinkedHere(!!saved?.deviceId);
      setPcConnectionState(saved?.deviceId ? 'offline' : 'not-linked');
      setPcLiveState(saved?.deviceId ? 'offline' : 'not-linked');
    }
  }, [localLinkKey]);

  useEffect(() => {
    refreshPcDevices();
    const timer = window.setInterval(refreshPcDevices, 15000);
    return () => window.clearInterval(timer);
  }, [refreshPcDevices]);

  useEffect(() => {
    const timer = window.setInterval(() => setStatusNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleDeviceStatus = ({ device } = {}) => {
      if (!device?.deviceId) return;
      const mergedDevices = mergeDeviceSnapshots(pcDevicesRef.current, [device]);
      pcDevicesRef.current = mergedDevices;
      setPcDevices(mergedDevices);
      try {
        const saved = JSON.parse(localStorage.getItem(localLinkKey) || 'null');
        if (saved?.deviceId === device.deviceId) {
          const acceptedDevice = mergedDevices.find((item) => item.deviceId === device.deviceId) || device;
          const liveState = getDeviceLiveState(acceptedDevice);
          setPcLinkedHere(acceptedDevice.status !== 'revoked');
          setPcLiveState(liveState);
          setPcConnectionState(getPcConnectionState(liveState));
          if (liveState === 'revoked') localStorage.removeItem(localLinkKey);
        }
      } catch {}
    };
    socket.on('device:status', handleDeviceStatus);
    return () => socket.off('device:status', handleDeviceStatus);
  }, [localLinkKey]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(localLinkKey) || 'null');
      const localDevice = saved?.deviceId ? pcDevices.find((device) => device.deviceId === saved.deviceId) : null;
      if (!localDevice) return;
      const liveState = getDeviceLiveState(localDevice, statusNow);
      setPcLiveState(liveState);
      setPcConnectionState(getPcConnectionState(liveState));
    } catch {}
  }, [localLinkKey, pcDevices, statusNow]);

  const stopPcSyncPoll = useCallback(() => {
    if (pcSyncPollRef.current) window.clearInterval(pcSyncPollRef.current);
    pcSyncPollRef.current = null;
  }, []);

  useEffect(() => () => stopPcSyncPoll(), [stopPcSyncPoll]);

  const downloadPcAgent = useCallback(() => {
    if (!pcSyncDownload?.url) return;
    const anchor = document.createElement('a');
    anchor.href = pcSyncDownload.url;
    anchor.download = pcSyncDownload.name || 'NAS-Drive-Setup.exe';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setPcSyncState('installing');
    setPcSyncMessage('다운로드한 설치 파일을 실행하세요. 설치와 계정 연결이 끝나면 이 화면이 자동으로 바뀝니다.');
  }, [pcSyncDownload]);

  const startPcSyncFlow = useCallback(async () => {
    if (pcPairingStartingRef.current || pcPairingTokenRef.current) {
      setPcSyncOpen(true);
      return;
    }
    pcPairingStartingRef.current = true;
    stopPcSyncPoll();
    setPcSyncOpen(true);
    setPcSyncState('preparing');
    setPcSyncMessage('이 PC에 맞는 NAS Drive 설치 프로그램을 준비하고 있습니다.');
    setPcSyncDownload(null);

    try {
      const response = await axios.post('/api/devices/pair/start', {
        path: '/',
        driveMode: 'personal-drive',
        clientIntent: 'open-or-install'
      }, { withCredentials: true });
      const { pairingToken, agentDownloadUrl, agentDownloadName } = response.data || {};
      if (!pairingToken) throw new Error('PC 연결 토큰을 발급받지 못했습니다.');

      pcPairingTokenRef.current = pairingToken;
      pcPairingStartingRef.current = false;
      setPcSyncDownload({ url: agentDownloadUrl, name: agentDownloadName });
      setPcSyncState('needs-install');
      setPcSyncMessage('처음 설치하거나 업데이트하려면 설치 프로그램을 받으세요. 이미 최신 NAS Drive가 설치되어 있다면 아래의 계정 연결을 선택할 수 있습니다.');

      let attempts = 0;
      pcSyncPollRef.current = window.setInterval(async () => {
        attempts += 1;
        try {
          const statusResponse = await axios.get(`/api/devices/pair/status/${encodeURIComponent(pairingToken)}`, { withCredentials: true });
          const status = statusResponse.data || {};
          if (status.status === 'connected' && status.device?.deviceId) {
            const root = (status.device.syncRoots || []).find((item) => item.kind === 'personal-drive') || status.device.syncRoots?.[0] || null;
            localStorage.setItem(localLinkKey, JSON.stringify({
              deviceId: status.device.deviceId,
              syncRootId: root?.syncRootId || '',
              linkedAt: new Date().toISOString()
            }));
            setPcLinkedHere(true);
            const liveState = getDeviceLiveState(status.device);
            setPcLiveState(liveState);
            const heartbeatConfirmed = status.device.connectionState === 'online' && !!status.device.lastSeenAt;
            setPcConnectionState(heartbeatConfirmed ? 'online' : (liveState === 'offline' ? 'offline' : 'connecting'));
            if (!heartbeatConfirmed) {
              setPcSyncState('connecting');
              setPcSyncMessage(liveState === 'offline'
                ? '계정 등록은 완료되었지만 첫 연결 신호가 도착하지 않았습니다. NAS Drive가 자동 복구를 시도하고 있습니다.'
                : '계정 등록은 완료되었습니다. NAS Drive의 첫 백그라운드 연결 신호를 확인하고 있습니다.');
              return;
            }
            stopPcSyncPoll();
            pcPairingTokenRef.current = '';
            setPcSyncState('connected');
            setPcSyncMessage('이 PC의 NAS Drive 백그라운드 연결이 확인되었습니다. 파일 탐색기에서 NAS Drive를 열 수 있습니다.');
            refreshPcDevices();
            return;
          }
          if (status.status === 'agent-detected') {
            setPcSyncState('connecting');
            setPcSyncMessage('NAS Drive 프로그램이 응답했습니다. 계정과 파일 탐색기 연결을 마무리하고 있습니다.');
          }
          if (status.status === 'revoked' || status.status === 'expired') {
            stopPcSyncPoll();
            pcPairingTokenRef.current = '';
            setPcSyncState('error');
            setPcSyncMessage('연결 요청이 만료되었거나 취소되었습니다. 다시 시도해주세요.');
          }
        } catch (error) {
          if (error.response?.status === 410 || error.response?.status === 404) {
            stopPcSyncPoll();
            pcPairingTokenRef.current = '';
            setPcSyncState('error');
            setPcSyncMessage('연결 요청을 더 이상 사용할 수 없습니다. 다시 시도해주세요.');
          }
        }

        if (attempts >= 200) {
          stopPcSyncPoll();
          setPcSyncState('needs-install');
          setPcSyncMessage('자동 확인 시간이 지났습니다. 설치 파일을 실행한 뒤 다시 시도할 수 있습니다.');
        }
      }, 1500);
    } catch (error) {
      pcPairingStartingRef.current = false;
      pcPairingTokenRef.current = '';
      setPcSyncState('error');
      setPcSyncMessage(error.response?.data?.error || error.message || 'PC 연동을 시작하지 못했습니다.');
    }
  }, [localLinkKey, refreshPcDevices, stopPcSyncPoll]);

  const connectInstalledPcAgent = useCallback(() => {
    const pairingToken = pcPairingTokenRef.current;
    if (!pairingToken) {
      startPcSyncFlow();
      return;
    }
    setPcSyncState('detecting');
    setPcSyncMessage('설치된 NAS Drive에 이 계정을 연결하고 있습니다. 브라우저가 NAS Drive 열기를 확인하면 허용해주세요.');
    window.location.href = `nas-sync://drive?token=${encodeURIComponent(pairingToken)}`;
  }, [startPcSyncFlow]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('pcConnect') !== '1' || pcAutoConnectStartedRef.current) return undefined;
    pcAutoConnectStartedRef.current = true;
    startPcSyncFlow();
    navigate('/platform', { replace: true });
    return undefined;
  }, [location.search, navigate, startPcSyncFlow]);

  const openLinkedDrive = useCallback(() => {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(localLinkKey) || 'null'); } catch {}
    if (!saved?.deviceId) {
      startPcSyncFlow();
      return;
    }
    window.location.href = `nas-sync://open-drive?deviceId=${encodeURIComponent(saved.deviceId)}`;
  }, [localLinkKey, startPcSyncFlow]);

  const removeLinkedDevice = useCallback(async (device) => {
    if (!window.confirm(`'${device.deviceName || '이 PC'}' 연결을 해제하시겠습니까?\n해당 PC의 로컬 파일은 삭제되지 않습니다.`)) return;
    await axios.delete(`/api/devices/${encodeURIComponent(device.deviceId)}`, { withCredentials: true });
    try {
      const saved = JSON.parse(localStorage.getItem(localLinkKey) || 'null');
      if (saved?.deviceId === device.deviceId) localStorage.removeItem(localLinkKey);
    } catch {}
    await refreshPcDevices();
  }, [localLinkKey, refreshPcDevices]);

  const changeDeviceSync = useCallback(async (device, action) => {
    await axios.patch(`/api/devices/${encodeURIComponent(device.deviceId)}/sync`, { action }, { withCredentials: true });
    await refreshPcDevices();
  }, [refreshPcDevices]);

  const openPcManager = useCallback((event) => {
    event?.preventDefault?.();
    setPcSyncOpen(true);
    setShowDeviceManager(true);
    setPcSyncState('manager');
    setPcSyncMessage(pcConnectionState === 'online'
      ? '이 PC의 NAS Drive가 정상적으로 동기화되고 있습니다.'
      : pcConnectionState === 'connecting'
        ? '계정 등록은 완료되었으며 NAS Drive의 첫 연결 신호를 기다리고 있습니다.'
        : '연결된 PC와 최근 동기화 상태를 확인할 수 있습니다.');
    refreshPcDevices();
  }, [pcConnectionState, refreshPcDevices]);

  const openApp = useCallback((app) => {
    if (app.id === 'pc-sync') {
      if (pcPairingActive) setPcSyncOpen(true);
      else if (pcLinkedHere) openLinkedDrive();
      else startPcSyncFlow();
      return;
    }
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
  }, [navigate, openAppWindow, openLinkedDrive, pcLinkedHere, pcPairingActive, startPcSyncFlow]);

  const apps = useMemo(() => {
    const pcStatus = getDeviceStatusUi(pcLiveState);
    const baseApps = [
      { id: 'files', title: '파일 관리자', icon: FolderIcon, route: '/nas', color: theme.palette.primary.main },
      { id: 'pc-sync', title: pcLinkedHere ? (pcLiveState === 'up-to-date' ? 'NAS Drive 열기' : `NAS Drive · ${pcStatus.label}`) : (pcPairingActive ? pairingStatus.label : 'PC 연동'), icon: DesktopWindowsIcon, color: pcLinkedHere ? pcStatus.iconColor : (pcPairingActive ? theme.palette.info.main : theme.palette.text.disabled), statusState: pcLinkedHere ? pcLiveState : (pcPairingActive ? 'connecting' : 'not-linked'), statusLabel: pcLinkedHere ? pcStatus.label : (pairingStatus?.label || '설치되지 않음') },
      { id: 'meeting', title: '화상회의', icon: VideocamIcon, component: MeetingApp, color: theme.palette.info.main, width: 920, height: 640 },
      { id: 'document-workspace', title: '문서 스튜디오', icon: ArticleIcon, component: DocumentWorkspace, color: '#6d4aff', width: 1100, height: 760 },
      { id: 'document-studio', title: '문서 변환', icon: AutoAwesomeMotionIcon, component: DocumentStudio, color: theme.palette.secondary.main, width: 1120, height: 760 },
      { id: 'settings', title: '설정', icon: SettingsIcon, route: '/settings', color: theme.palette.text.secondary }
    ];

    if (canOpenBackup) {
      baseApps.push({ id: 'backup', title: '백업', icon: HistoryIcon, route: '/nas/backup', color: theme.palette.error.main });
    }

    return baseApps;
  }, [
    canOpenBackup,
    theme.palette.error.main,
    theme.palette.info.main,
    theme.palette.primary.main,
    theme.palette.secondary.main,
    pcLinkedHere,
    pcLiveState,
    pcPairingActive,
    pairingStatus,
    theme.palette.text.disabled,
    theme.palette.text.secondary
  ]);

  useEffect(() => {
    const showDesktop = () => setInlineApp(null);
    const openPlatformApp = (event) => {
      const targetId = event.detail?.id;
      const targetApp = apps.find((app) => app.id === targetId);
      if (targetApp) openApp(targetApp);
    };
    window.addEventListener('platform:show-desktop', showDesktop);
    window.addEventListener('platform:open-app', openPlatformApp);
    return () => {
      window.removeEventListener('platform:show-desktop', showDesktop);
      window.removeEventListener('platform:open-app', openPlatformApp);
    };
  }, [apps, openApp]);

  if (inlineApp) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
        <Box sx={{ height: 54, px: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper', flexShrink: 0 }}>
          <Typography sx={{ fontWeight: 900 }}>{inlineApp.title}</Typography>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          {inlineApp.id === 'meeting' ? (
            <MeetingApp
              inWindow={false}
              onOpenWindow={(payload) => {
                openAppWindow({ ...inlineApp, payload });
                setInlineApp(null);
              }}
            />
          ) : inlineApp.id === 'document-workspace' ? <DocumentWorkspace /> : inlineApp.id === 'document-studio' ? <DocumentStudio /> : null}
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
            <Tooltip key={app.id} title={app.id === 'pc-sync' ? `${app.title} · 우클릭: 연결 관리` : app.title} placement="right">
              <IconButton onClick={() => openApp(app)} onContextMenu={app.id === 'pc-sync' ? openPcManager : undefined} sx={{ width: 44, height: 44, position: 'relative', color: app.color, bgcolor: alpha(app.color, 0.08), '&:hover': { bgcolor: alpha(app.color, 0.16) } }}>
                <Icon />
                {app.id === 'pc-sync' && (pcLinkedHere || pcPairingActive) && <Box component="span" aria-label={app.statusLabel} sx={{ position: 'absolute', right: 5, top: 5, width: 10, height: 10, borderRadius: '50%', bgcolor: app.color, border: `2px solid ${theme.palette.background.paper}`, boxShadow: `0 0 0 1px ${alpha(app.color, 0.35)}`, ...(app.statusState === 'syncing' || app.statusState === 'connecting' ? { animation: 'nasStatusPulse 1.1s ease-in-out infinite', '@keyframes nasStatusPulse': { '0%, 100%': { transform: 'scale(0.8)', opacity: 0.55 }, '50%': { transform: 'scale(1.25)', opacity: 1 } } } : {}) }} />}
              </IconButton>
            </Tooltip>
          );
        })}
      </Box>

      <Box sx={{ position: 'absolute', left: 100, top: 24, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 92px)', gap: 2, width: { xs: 'calc(100% - 116px)', sm: 440 } }}>
        {apps.map((app) => {
          const Icon = app.icon;
          return (
            <Box key={`desktop_${app.id}`} onDoubleClick={() => openApp(app)} onClick={() => openApp(app)} onContextMenu={app.id === 'pc-sync' ? openPcManager : undefined} sx={{ cursor: 'pointer', textAlign: 'center', color: 'text.primary' }}>
              <Box sx={{ width: 58, height: 58, mx: 'auto', position: 'relative', borderRadius: 2, display: 'grid', placeItems: 'center', color: app.color, bgcolor: alpha(theme.palette.background.paper, 0.82), border: `1px solid ${theme.palette.divider}`, boxShadow: `0 10px 28px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.22 : 0.08)}` }}>
                <Icon sx={{ fontSize: 30 }} />
                {app.id === 'pc-sync' && (pcLinkedHere || pcPairingActive) && <Box component="span" aria-label={app.statusLabel} sx={{ position: 'absolute', right: 5, top: 5, width: 11, height: 11, borderRadius: '50%', bgcolor: app.color, border: `2px solid ${theme.palette.background.paper}`, ...(app.statusState === 'syncing' || app.statusState === 'connecting' ? { animation: 'nasStatusPulse 1.1s ease-in-out infinite', '@keyframes nasStatusPulse': { '0%, 100%': { transform: 'scale(0.8)', opacity: 0.55 }, '50%': { transform: 'scale(1.25)', opacity: 1 } } } : {}) }} />}
              </Box>
              <Typography variant="caption" sx={{ display: 'block', mt: 0.75, fontWeight: 800, lineHeight: 1.2 }}>{app.title}</Typography>
            </Box>
          );
        })}
      </Box>

      <Dialog open={pcSyncOpen} onClose={() => setPcSyncOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{pcLinkedHere ? 'NAS Drive' : 'PC에 NAS Drive 설치'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {(pcSyncState === 'preparing' || pcSyncState === 'detecting' || pcSyncState === 'installing' || pcSyncState === 'connecting') && <CircularProgress size={30} />}
            <Typography>{pcSyncMessage}</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" color={pcLinkedHere ? getDeviceStatusUi(pcLiveState).color : (pairingStatus?.color || 'default')} label={pcLinkedHere ? getDeviceStatusUi(pcLiveState).label : (pairingStatus?.label || '연결되지 않음')} />
              <Button size="small" onClick={() => setShowDeviceManager((value) => !value)}>{showDeviceManager ? '간단히 보기' : '연결된 PC 관리'}</Button>
            </Stack>
            {showDeviceManager ? (
              <Stack spacing={1.25}>
                <Divider />
                {pcDevices.length === 0 && <Typography variant="body2" color="text.secondary">연결된 PC가 없습니다.</Typography>}
                {pcDevices.map((device) => {
                  const deviceState = getDeviceLiveState(device, statusNow);
                  const deviceStatus = getDeviceStatusUi(deviceState);
                  const connectionStatus = getDeviceConnectionUi(device, statusNow);
                  const reasonLabel = getDeviceReasonLabel(device, deviceState);
                  return (
                  <Box key={device.deviceId} sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1, p: 1.25, border: `1px solid ${theme.palette.divider}`, borderRadius: 2 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Typography sx={{ fontWeight: 800 }}>{device.deviceName || 'Windows PC'}</Typography>
                        <Chip size="small" color={connectionStatus.color} label={connectionStatus.label} />
                        {deviceState !== 'offline' && deviceState !== 'revoked' && <Chip size="small" variant="outlined" color={deviceStatus.color} label={deviceStatus.label} />}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">마지막 상태 수신: {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '접속 기록 없음'}</Typography>
                      {!!reasonLabel && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{reasonLabel}</Typography>}
                      <Typography variant="caption" color="text.disabled" sx={{ display: 'block' }}>상태 순번: {Number(device.stateRevision || 0)}</Typography>
                      {!!device.lastError && <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.25 }}>{device.lastError}</Typography>}
                    </Box>
                    {device.status !== 'revoked' && (
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" onClick={() => changeDeviceSync(device, device.syncPaused ? 'resume' : 'pause')}>{device.syncPaused ? '다시 시작' : '일시 중지'}</Button>
                        <Button size="small" color="error" onClick={() => removeLinkedDevice(device)}>연결 해제</Button>
                      </Stack>
                    )}
                  </Box>
                  );
                })}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                다른 PC에서는 별도로 설치합니다. 같은 PC에서 다른 계정을 연결하면 계정별 NAS Drive가 따로 추가됩니다.
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          {(pcSyncState === 'needs-install' || pcSyncState === 'installing') && <Button variant="outlined" onClick={connectInstalledPcAgent}>이미 설치됨 · 이 계정 연결</Button>}
          {(pcSyncState === 'needs-install' || pcSyncState === 'installing') && <Button variant="contained" onClick={downloadPcAgent}>{pcSyncState === 'installing' ? '설치 프로그램 다시 받기' : '설치 프로그램 다운로드'}</Button>}
          {pcSyncState === 'error' && <Button variant="contained" onClick={startPcSyncFlow}>다시 시도</Button>}
          {pcSyncState === 'connected' && <Button variant="contained" onClick={openLinkedDrive}>파일 탐색기에서 열기</Button>}
          {pcSyncState === 'manager' && pcLinkedHere && <Button variant="contained" onClick={openLinkedDrive}>파일 탐색기에서 열기</Button>}
          <Button onClick={() => setPcSyncOpen(false)}>닫기</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default ServicePlatform;
