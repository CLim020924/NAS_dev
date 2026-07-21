import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Box,
  Button,
  ButtonGroup,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CallEndIcon from '@mui/icons-material/CallEnd';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import GroupsIcon from '@mui/icons-material/Groups';
import LinkIcon from '@mui/icons-material/Link';
import LockIcon from '@mui/icons-material/Lock';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PresentToAllIcon from '@mui/icons-material/PresentToAll';
import SaveIcon from '@mui/icons-material/Save';
import SearchIcon from '@mui/icons-material/Search';
import SendIcon from '@mui/icons-material/Send';
import SettingsIcon from '@mui/icons-material/Settings';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import axios from 'axios';
import { normalizeRoomCode, useMeetingSession } from '../contexts/MeetingContext';
import ChatInviteDialog from './ChatInviteDialog';

const VideoTile = ({
  label,
  stream,
  muted = false,
  audioEnabled = true,
  videoEnabled = true,
  screenSharing = false,
  local = false,
  compact = false,
  audioOutputDeviceId = ''
}) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream || null;
    }
  }, [stream]);

  useEffect(() => {
    const mediaElement = videoRef.current;
    if (!mediaElement || muted || typeof mediaElement.setSinkId !== 'function') return;
    mediaElement.setSinkId(audioOutputDeviceId || '').catch(() => {});
  }, [audioOutputDeviceId, muted, stream]);

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'relative',
        minHeight: compact ? 132 : 180,
        height: '100%',
        borderRadius: compact ? 1.5 : 2,
        overflow: 'hidden',
        bgcolor: '#0b1220',
        border: screenSharing ? '2px solid #38bdf8' : '1px solid rgba(255,255,255,0.08)',
        boxShadow: compact ? 'none' : '0 18px 46px rgba(15,23,42,0.18)'
      }}
    >
      {stream && videoEnabled ? (
        <Box
          component="video"
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          sx={{
            width: '100%',
            height: '100%',
            minHeight: compact ? 132 : 180,
            objectFit: screenSharing ? 'contain' : 'cover',
            display: 'block',
            bgcolor: '#0b1220'
          }}
        />
      ) : (
        <Box sx={{ minHeight: compact ? 132 : 180, height: '100%', display: 'grid', placeItems: 'center', color: '#fff' }}>
          <Stack spacing={compact ? 0.5 : 1} alignItems="center">
            <Avatar sx={{ width: compact ? 42 : 56, height: compact ? 42 : 56, bgcolor: 'rgba(255,255,255,0.14)', fontWeight: 900 }}>
              {label?.slice(0, 1) || '?'}
            </Avatar>
            <Typography sx={{ fontWeight: 800, fontSize: compact ? '0.82rem' : '0.95rem' }}>
              {videoEnabled ? '연결 대기' : '카메라 꺼짐'}
            </Typography>
          </Stack>
        </Box>
      )}

      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ position: 'absolute', left: compact ? 7 : 10, right: compact ? 7 : 10, bottom: compact ? 7 : 10, minWidth: 0 }}>
        <Chip
          size="small"
          label={`${label || '참가자'}${local ? ' · 나' : ''}`}
          sx={{ bgcolor: 'rgba(0,0,0,0.56)', color: '#fff', maxWidth: '100%', height: compact ? 22 : 24, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', px: compact ? 0.8 : 1 } }}
        />
        {!audioEnabled && (
          <Chip
            size="small"
            icon={<MicOffIcon />}
            label={compact ? '' : '음소거'}
            sx={{ bgcolor: 'rgba(0,0,0,0.56)', color: '#fff', height: compact ? 22 : 24, '& .MuiChip-icon': { ml: compact ? 0.5 : 0.75 } }}
          />
        )}
        {screenSharing && <Chip size="small" label={compact ? '공유' : '공유 중'} color="info" sx={{ height: compact ? 22 : 24 }} />}
      </Stack>
    </Paper>
  );
};

const MeetingApp = ({
  initialRoomCode = '',
  autoJoin = false,
  inWindow = false,
  onOpenWindow = null,
  conversationId = null,
  requireExistingRoom = false,
  initialMediaPreferences = null,
  initialAccessPassword = ''
}) => {
  const theme = useTheme();
  const compact = useMediaQuery('(max-width:900px), (max-height:650px)');
  const veryCompact = useMediaQuery('(max-width:620px), (max-height:520px)');
  const [linkedConversation, setLinkedConversation] = useState(null);
  const [inviteMenuAnchorEl, setInviteMenuAnchorEl] = useState(null);
  const [activeDrawer, setActiveDrawer] = useState(null);
  const [chatInviteOpen, setChatInviteOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [meetingTitleDraft, setMeetingTitleDraft] = useState('임시 회의');
  const [accessMode, setAccessMode] = useState('private');
  const [searchable, setSearchable] = useState(true);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [meetingPassword, setMeetingPassword] = useState('');
  const [entryMode, setEntryMode] = useState('direct');
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveMeetingTitle, setSaveMeetingTitle] = useState('');
  const [savingMeeting, setSavingMeeting] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsTitle, setSettingsTitle] = useState('');
  const [settingsPassword, setSettingsPassword] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [joinPassword, setJoinPassword] = useState('');
  const [meetingSearch, setMeetingSearch] = useState('');
  const [meetingSearchResults, setMeetingSearchResults] = useState([]);
  const [meetingSearchLoading, setMeetingSearchLoading] = useState(false);
  const [selectedConversationMeeting, setSelectedConversationMeeting] = useState(null);
  const [meetingChatDraft, setMeetingChatDraft] = useState('');
  const [audioOutputMenuAnchor, setAudioOutputMenuAnchor] = useState(null);
  const [audioInputMenuAnchor, setAudioInputMenuAnchor] = useState(null);
  const [videoInputMenuAnchor, setVideoInputMenuAnchor] = useState(null);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const autoJoinAttemptedRef = useRef(false);
  const initialMediaPreferencesRef = useRef(initialMediaPreferences);
  const initialAccessPasswordRef = useRef(initialAccessPassword);

  useEffect(() => {
    initialMediaPreferencesRef.current = initialMediaPreferences;
  }, [initialMediaPreferences]);

  useEffect(() => {
    initialAccessPasswordRef.current = initialAccessPassword;
  }, [initialAccessPassword]);

  const session = useMeetingSession();
  const {
    roomCode,
    setRoomCode,
    joinCode,
    setJoinCode,
    active,
    joining,
    error,
    setError,
    localStream,
    displayStream,
    remotePeers,
    participants,
    hostSocketId,
    isHost,
    meetingMessages,
    meetingOverview,
    overviewLoading,
    refreshMeetingOverview,
    chatSending,
    audioEnabled,
    videoEnabled,
    screenSharing,
    mediaDevices,
    selectedAudioInputId,
    selectedVideoInputId,
    selectedAudioOutputId,
    displayName,
    roomTitle,
    roomAccessPolicy,
    hostDisplayName,
    startMeeting,
    startConversationMeeting,
    saveMeetingAsConversation,
    updateMeetingSettings,
    joinMeeting,
    joinConversationMeeting,
    joinTypedMeeting,
    leaveMeeting,
    endMeeting,
    sendMeetingMessage,
    transferHost,
    kickParticipant,
    toggleAudio,
    toggleVideo,
    selectAudioInput,
    selectVideoInput,
    selectAudioOutput,
    refreshMediaDevices,
    requestDeviceAccess,
    startScreenShare,
    stopScreenShare
  } = session;

  const isActiveParticipant = useCallback((participant = {}) => (
    !participant.lobbyOnly && !participant.temporarilyDisconnected
  ), []);
  const remoteList = useMemo(() => Object.values(remotePeers || {}).filter(isActiveParticipant), [isActiveParticipant, remotePeers]);
  const previewStream = displayStream || localStream;
  const inviteLink = roomCode ? `${window.location.origin}/meeting/${encodeURIComponent(roomCode)}` : '';
  const visibleRoomCode = roomCode ? `${roomCode.slice(0, 6)}${roomCode.length > 6 ? '...' : ''}` : '-';
  const participantCount = active ? remoteList.length + 1 : 0;
  const selectedConversationRole = selectedConversationMeeting?.viewerRole || '';
  const selectedConversationCanDelete = !!selectedConversationMeeting && (
    selectedConversationMeeting.viewerCanDelete || selectedConversationRole === 'owner'
  );
  const settingsExistingPasswordEnabled = active
    ? !!roomAccessPolicy?.passwordEnabled
    : !!selectedConversationMeeting?.accessPolicy?.passwordEnabled;

  const meetingParticipantList = useMemo(() => {
    const participantMap = new Map();
    (Array.isArray(participants) ? participants : []).filter(isActiveParticipant).forEach((participant) => {
      if (participant?.socketId) participantMap.set(participant.socketId, participant);
    });
    if (!participantMap.has('local')) {
      participantMap.set('local', {
        socketId: 'local',
        displayName,
        audioEnabled,
        videoEnabled,
        screenSharing,
        local: true
      });
    }
    return Array.from(participantMap.values());
  }, [audioEnabled, displayName, isActiveParticipant, participants, screenSharing, videoEnabled]);

  const deviceLabel = useCallback((device, fallback) => (
    device?.label || fallback || 'Default'
  ), []);

  const closeDeviceMenus = useCallback(() => {
    setAudioOutputMenuAnchor(null);
    setAudioInputMenuAnchor(null);
    setVideoInputMenuAnchor(null);
  }, []);

  const handleSelectAudioInput = async (deviceId) => {
    await selectAudioInput(deviceId);
    closeDeviceMenus();
  };

  const handleSelectVideoInput = async (deviceId) => {
    await selectVideoInput(deviceId);
    closeDeviceMenus();
  };

  const handleSelectAudioOutput = async (deviceId) => {
    await selectAudioOutput(deviceId);
    closeDeviceMenus();
  };

  useEffect(() => {
    const normalized = normalizeRoomCode(initialRoomCode);
    if (normalized && normalized !== roomCode && !active) setRoomCode(normalized);
  }, [active, initialRoomCode, roomCode, setRoomCode]);

  useEffect(() => {
    if (!autoJoin || active || joining || autoJoinAttemptedRef.current) return;
    const targetRoomCode = normalizeRoomCode(initialRoomCode || roomCode);
    if (!targetRoomCode) return;
    autoJoinAttemptedRef.current = true;
    joinMeeting(targetRoomCode, {
      requireExisting: !!requireExistingRoom,
      conversationId: conversationId || null,
      mediaPreferences: initialMediaPreferencesRef.current || {},
      accessPassword: initialAccessPasswordRef.current || ''
    });
  }, [active, autoJoin, conversationId, initialRoomCode, joinMeeting, joining, requireExistingRoom, roomCode]);

  useEffect(() => {
    const query = meetingSearch.trim();
    if (!query) {
      setMeetingSearchResults([]);
      setMeetingSearchLoading(false);
      return undefined;
    }

    let cancelled = false;
    setMeetingSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await axios.get('/api/meetings/public/search', {
          params: { q: query },
          withCredentials: true
        });
        if (!cancelled) setMeetingSearchResults(Array.isArray(res.data?.rooms) ? res.data.rooms : []);
      } catch (err) {
        if (!cancelled) setMeetingSearchResults([]);
      } finally {
        if (!cancelled) setMeetingSearchLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [meetingSearch]);

  const refreshLinkedConversation = useCallback(async () => {
    if (!conversationId) {
      setLinkedConversation(null);
      return;
    }
    try {
      const res = await axios.get('/api/chat/conversations', { withCredentials: true });
      const conversations = Array.isArray(res.data?.conversations) ? res.data.conversations : [];
      setLinkedConversation(conversations.find((item) => item.conversationId === conversationId) || null);
    } catch (err) {
      setLinkedConversation(null);
    }
  }, [conversationId]);

  useEffect(() => {
    refreshLinkedConversation();
  }, [refreshLinkedConversation]);

  const copyText = async (text, fallbackLabel) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      window.prompt(`${fallbackLabel}를 복사하세요.`, text);
    }
  };

  const copyInvite = () => copyText(inviteLink, '초대 링크');
  const copyRoomCode = () => copyText(roomCode, '회의 코드');
  const closeInviteMenu = () => setInviteMenuAnchorEl(null);

  const handleCreateMeeting = async () => {
    const ok = await startMeeting({
      accessPolicy: {
        mode: accessMode,
        searchable: accessMode === 'public' && searchable,
        entryMode,
        passwordEnabled,
        password: passwordEnabled ? meetingPassword : ''
      },
      accessPassword: passwordEnabled ? meetingPassword : '',
      metadata: { title: meetingTitleDraft || '임시 회의' }
    });
    if (ok) {
      setCreateDialogOpen(false);
      setActiveDrawer(null);
    }
  };

  const handleJoinSearchResult = async (meeting) => {
    const passwordRequired = !!meeting?.accessPolicy?.passwordEnabled;
    const password = passwordRequired ? window.prompt('회의 비밀번호를 입력하세요.') || '' : '';
    if (passwordRequired && !password.trim()) return;
    if (meeting?.conversationId) {
      await startConversationMeeting(meeting.conversationId, {
        roomCode: meeting.roomId,
        accessPassword: password,
        title: meeting.title || '정규 회의방'
      });
      setActiveDrawer(null);
      setMeetingSearch('');
      return;
    }
    await joinMeeting(meeting.roomId, { requireExisting: true, accessPassword: password });
    setActiveDrawer(null);
    setMeetingSearch('');
  };

  const handleOpenSaveMeeting = () => {
    setSaveMeetingTitle(roomTitle || meetingTitleDraft || '정규 회의방');
    setSaveDialogOpen(true);
  };

  const applyPolicyDraftFromRoom = () => {
    const policy = active ? (roomAccessPolicy || {}) : selectedConversationMeeting?.accessPolicy || {
      mode: accessMode,
      searchable,
      entryMode,
      passwordEnabled
    };
    setAccessMode(policy.mode === 'public' ? 'public' : 'private');
    setSearchable(!!policy.searchable);
    setEntryMode(policy.entryMode === 'approval' ? 'approval' : 'direct');
    setPasswordEnabled(!!policy.passwordEnabled);
    setSettingsPassword(active ? '' : meetingPassword);
  };

  const handleOpenRoomSettings = () => {
    applyPolicyDraftFromRoom();
    setSettingsTitle(active
      ? (roomTitle || '화상회의')
      : (selectedConversationMeeting?.title || meetingTitleDraft || '채팅방 회의'));
    setSettingsDialogOpen(true);
  };

  const handleSaveMeeting = async () => {
    if (!isHost || !active) return;
    try {
      setSavingMeeting(true);
      const result = await saveMeetingAsConversation({
        title: saveMeetingTitle || roomTitle || '정규 회의방',
        accessPolicy: {
          mode: accessMode,
          searchable: accessMode === 'public' && searchable,
          entryMode,
          passwordEnabled,
          password: passwordEnabled ? meetingPassword : ''
        }
      });
      if (result?.success) {
        setSaveDialogOpen(false);
        setActiveDrawer('rooms');
      }
    } finally {
      setSavingMeeting(false);
    }
  };

  const handleSaveRoomSettings = async () => {
    if (!active && selectedConversationMeeting?.conversationId) {
      try {
        setSavingSettings(true);
        const res = await axios.post(`/api/meetings/conversations/${encodeURIComponent(selectedConversationMeeting.conversationId)}/settings`, {
          title: settingsTitle || selectedConversationMeeting.title || '채팅방 회의',
          roomCode: selectedConversationMeeting.defaultRoomCode,
          accessPolicy: {
            mode: accessMode,
            searchable: accessMode === 'public' && searchable,
            entryMode,
            passwordEnabled,
            password: settingsPassword.trim()
          }
        }, { withCredentials: true });
        if (res.data?.success) {
          setSelectedConversationMeeting((current) => current?.conversationId === selectedConversationMeeting.conversationId
            ? {
                ...current,
                title: res.data?.conversation?.title || settingsTitle || current.title,
                accessPolicy: res.data?.room?.accessPolicy || current.accessPolicy
              }
            : current);
          setSettingsDialogOpen(false);
        }
      } catch (err) {
        setError(err.response?.data?.message || err.message || '방 설정을 저장할 수 없습니다.');
      } finally {
        setSavingSettings(false);
      }
      return;
    }

    if (!active) {
      setMeetingTitleDraft(settingsTitle || meetingTitleDraft || '임시 회의');
      setMeetingPassword(settingsPassword);
      setSettingsDialogOpen(false);
      return;
    }

    if (!isHost) return;
    try {
      setSavingSettings(true);
      const result = await updateMeetingSettings({
        title: settingsTitle || roomTitle || '화상회의',
        accessPolicy: {
          mode: accessMode,
          searchable: accessMode === 'public' && searchable,
          entryMode,
          passwordEnabled,
          password: settingsPassword.trim()
        }
      });
      if (result?.success) setSettingsDialogOpen(false);
    } finally {
      setSavingSettings(false);
    }
  };

  const handleJoinActiveMeeting = async (meeting) => {
    const passwordRequired = !!meeting?.accessPolicy?.passwordEnabled;
    const password = passwordRequired ? window.prompt('회의 비밀번호를 입력하세요.') || '' : '';
    if (passwordRequired && !password.trim()) return;
    await joinMeeting(meeting.roomId, { requireExisting: true, accessPassword: password });
  };

  const handleJoinByCode = async () => {
    const ok = await joinTypedMeeting({ accessPassword: joinPassword });
    if (ok) setActiveDrawer(null);
  };

  const handleSendMeetingChat = async () => {
    const text = meetingChatDraft.trim();
    if (!text) return;
    const ok = await sendMeetingMessage(text);
    if (ok) setMeetingChatDraft('');
  };

  const handleEndMeeting = () => {
    if (!window.confirm('정말 회의를 종료하시겠습니까? 모든 참가자가 나가고 링크가 만료됩니다.')) return;
    endMeeting();
    setActiveDrawer(null);
  };

  const handleLeaveSelectedConversationRoom = async () => {
    if (!selectedConversationMeeting?.conversationId) return;
    const title = selectedConversationMeeting.title || '선택한 방';
    if (!window.confirm(`${title}에서 나가시겠습니까? 연결된 채팅방 목록에서도 사라집니다.`)) return;

    try {
      await axios.post(`/api/chat/group/${encodeURIComponent(selectedConversationMeeting.conversationId)}/leave`, {}, { withCredentials: true });
      const leavingActiveRoom = active && (
        selectedConversationMeeting.activeRoom?.roomId === roomCode ||
        selectedConversationMeeting.defaultRoomCode === roomCode
      );
      if (leavingActiveRoom) leaveMeeting();
      setSelectedConversationMeeting(null);
      await refreshMeetingOverview?.();
      setActiveDrawer('rooms');
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || err.message || '방 나가기에 실패했습니다.');
    }
  };

  const handleDeleteSelectedConversationRoom = async () => {
    if (!selectedConversationMeeting?.conversationId || !selectedConversationCanDelete) return;
    const title = selectedConversationMeeting.title || '선택한 방';
    if (!window.confirm(`${title} 방을 삭제하시겠습니까?`)) return;
    if (!window.confirm('이 작업은 되돌릴 수 없습니다. 연결된 채팅방, 회의방 설정, 채팅 기록도 함께 삭제됩니다. 정말 삭제할까요?')) return;

    try {
      const deletingActiveRoom = active && (
        selectedConversationMeeting.activeRoom?.roomId === roomCode ||
        selectedConversationMeeting.defaultRoomCode === roomCode
      );
      if (deletingActiveRoom && isHost) endMeeting();
      await axios.delete(`/api/chat/group/${encodeURIComponent(selectedConversationMeeting.conversationId)}`, { withCredentials: true });
      if (deletingActiveRoom) leaveMeeting();
      setSelectedConversationMeeting(null);
      await refreshMeetingOverview?.();
      setActiveDrawer('rooms');
    } catch (err) {
      setError(err.response?.data?.error || err.response?.data?.message || err.message || '방 삭제에 실패했습니다.');
    }
  };

  const handleTransferMeetingHost = (participant) => {
    if (!participant?.socketId || participant.socketId === 'local') return;
    if (!window.confirm(`${participant.displayName || participant.loginId || '참가자'}님에게 회의 방장을 위임할까요?`)) return;
    transferHost(participant.socketId);
  };

  const handleKickMeetingParticipant = (participant) => {
    if (!participant?.socketId || participant.socketId === 'local') return;
    if (!window.confirm(`${participant.displayName || participant.loginId || '참가자'}님을 회의에서 내보낼까요?`)) return;
    kickParticipant(participant.socketId);
  };

  const handleConversationMeeting = async (meeting) => {
    if (!meeting?.conversationId) return;
    setSelectedConversationMeeting(meeting);
    if (meeting.activeRoom?.roomId) {
      await joinConversationMeeting(meeting);
    } else {
      await startConversationMeeting(meeting.conversationId, {
        roomCode: meeting.defaultRoomCode,
        metadata: { title: meeting.title || '채팅방 회의' }
      });
    }
    setActiveDrawer(null);
  };

  const handleSelectConversationMeeting = (meeting) => {
    setSelectedConversationMeeting(meeting || null);
    if (meeting?.defaultRoomCode) setJoinCode(meeting.defaultRoomCode);
  };

  const handleOpenChatInvite = () => {
    closeInviteMenu();
    setChatInviteOpen(true);
  };

  const handleChatInviteComplete = (conversation) => {
    if (conversation?.conversationId) setLinkedConversation(conversation);
    else refreshLinkedConversation();
  };

  const openDrawer = (drawerName) => {
    setActiveDrawer((current) => current === drawerName ? null : drawerName);
  };

  const renderWaitingState = () => (
    <Paper
      elevation={0}
      sx={{
        height: '100%',
        minHeight: compact ? 280 : 420,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 2,
        border: `1px solid ${theme.palette.divider}`,
        bgcolor: '#0b1220',
        color: '#fff',
        overflow: 'hidden'
      }}
    >
      <Stack spacing={1.5} alignItems="center" sx={{ px: 2, textAlign: 'center' }}>
        <Avatar sx={{ width: 64, height: 64, bgcolor: 'rgba(255,255,255,0.14)' }}>
          <VideocamIcon />
        </Avatar>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>회의 대기 중</Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.68)', mt: 0.5 }}>
            중앙 화면은 회의 영상만 표시합니다. 방 선택과 검색은 우측 상단의 방 목록에서 관리하세요.
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <Button variant="contained" startIcon={<VideocamIcon />} onClick={() => setCreateDialogOpen(true)} disabled={joining}>
            새 회의 만들기
          </Button>
          <Button variant="outlined" color="inherit" startIcon={<MeetingRoomIcon />} onClick={() => setActiveDrawer('rooms')}>
            방 목록 열기
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );

  const renderVideoGrid = () => {
    const tileCount = remoteList.length + 1;
    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gap: compact ? 0.75 : 1,
          gridTemplateColumns: tileCount > 2 ? { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' } : '1fr',
          gridAutoRows: tileCount > 2 ? 'minmax(150px, 1fr)' : 'minmax(240px, 1fr)',
          overflow: 'auto',
          pr: 0.25
        }}
      >
        <VideoTile
          label={displayName}
          stream={previewStream}
          muted
          local
          audioEnabled={audioEnabled}
          videoEnabled={screenSharing || videoEnabled}
          screenSharing={screenSharing}
          compact={compact}
        />
        {remoteList.map((peer) => (
          <VideoTile
            key={peer.socketId}
            label={peer.displayName || peer.loginId || '참가자'}
            stream={peer.stream}
            muted={speakerMuted}
            audioEnabled={peer.audioEnabled !== false}
            videoEnabled={peer.videoEnabled !== false}
            screenSharing={!!peer.screenSharing}
            compact={compact}
            audioOutputDeviceId={selectedAudioOutputId}
          />
        ))}
      </Box>
    );
  };

  const renderControls = () => (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 2,
        border: `1px solid ${theme.palette.divider}`,
        p: compact ? 0.75 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 0.75,
        flexWrap: 'wrap',
        bgcolor: 'background.paper'
      }}
    >
      <Stack direction="row" spacing={0.5}>
        <ButtonGroup size={compact ? 'small' : 'medium'} variant="outlined">
          <Tooltip title={speakerMuted ? '스피커 음소거 해제' : '스피커 음소거'}>
            <span>
              <IconButton disabled={!active} onClick={() => setSpeakerMuted((prev) => !prev)} color={speakerMuted ? 'error' : 'default'}>
                {speakerMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
              </IconButton>
            </span>
          </Tooltip>
          <IconButton
            disabled={!active}
            onClick={(event) => {
              refreshMediaDevices();
              setAudioOutputMenuAnchor(event.currentTarget);
            }}
            size={compact ? 'small' : 'medium'}
          >
            <ArrowDropDownIcon />
          </IconButton>
        </ButtonGroup>
        <Tooltip title={audioEnabled ? '마이크 끄기' : '마이크 켜기'}>
          <span>
            <IconButton disabled={!active} onClick={toggleAudio} color={audioEnabled ? 'default' : 'error'}>
              {audioEnabled ? <MicIcon /> : <MicOffIcon />}
            </IconButton>
            <IconButton
              disabled={!active}
              onClick={(event) => {
                refreshMediaDevices();
                setAudioInputMenuAnchor(event.currentTarget);
              }}
              size={compact ? 'small' : 'medium'}
            >
              <ArrowDropDownIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={screenSharing ? '화면공유 중에는 카메라 전환이 제한됩니다.' : (videoEnabled ? '카메라 끄기' : '카메라 켜기')}>
          <span>
            <IconButton disabled={!active || screenSharing} onClick={toggleVideo} color={videoEnabled ? 'default' : 'error'}>
              {videoEnabled ? <VideocamIcon /> : <VideocamOffIcon />}
            </IconButton>
            <IconButton
              disabled={!active || screenSharing}
              onClick={(event) => {
                refreshMediaDevices();
                setVideoInputMenuAnchor(event.currentTarget);
              }}
              size={compact ? 'small' : 'medium'}
            >
              <ArrowDropDownIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={screenSharing ? '화면공유 중지' : '화면공유'}>
          <span>
            <IconButton disabled={!active && joining} onClick={screenSharing ? stopScreenShare : startScreenShare} color={screenSharing ? 'info' : 'default'}>
              {screenSharing ? <StopScreenShareIcon /> : <PresentToAllIcon />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'center', flex: 1 }}>
        <Button size={compact ? 'small' : 'medium'} variant={activeDrawer === 'chat' ? 'contained' : 'outlined'} startIcon={<ChatBubbleOutlineIcon />} onClick={() => openDrawer('chat')}>
          채팅
        </Button>
        <Button size={compact ? 'small' : 'medium'} variant={activeDrawer === 'people' ? 'contained' : 'outlined'} startIcon={<GroupsIcon />} onClick={() => openDrawer('people')}>
          참가자
        </Button>
      </Stack>

      <Button color="error" variant="outlined" startIcon={<CallEndIcon />} onClick={leaveMeeting} disabled={!active && !joining}>
        나가기
      </Button>
    </Paper>
  );

  const renderRoomsPanel = () => (
    <Stack spacing={1.25}>
      <Stack direction="row" spacing={1}>
        <Button fullWidth variant="contained" startIcon={<VideocamIcon />} onClick={() => setCreateDialogOpen(true)} disabled={joining}>
          새 회의
        </Button>
        <Button fullWidth variant="outlined" startIcon={<ContentCopyIcon />} onClick={copyInvite} disabled={!roomCode}>
          링크 복사
        </Button>
      </Stack>
      {active && isHost && !conversationId && (
        <Button fullWidth variant="outlined" startIcon={<SaveIcon />} onClick={handleOpenSaveMeeting}>
          회의방 저장
        </Button>
      )}

      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>코드로 참여</Typography>
        <Stack spacing={1}>
          <TextField size="small" label="회의 코드" value={joinCode} onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))} fullWidth />
          <TextField size="small" type="password" label="비밀번호" value={joinPassword} onChange={(event) => setJoinPassword(event.target.value)} fullWidth />
          <Button variant="outlined" onClick={handleJoinByCode} disabled={joining}>참가</Button>
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.25 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>공개 회의 검색</Typography>
        <TextField
          size="small"
          placeholder="방 이름, 방장, 코드"
          value={meetingSearch}
          onChange={(event) => setMeetingSearch(event.target.value)}
          fullWidth
          InputProps={{ startAdornment: <SearchIcon sx={{ fontSize: 18, mr: 0.75, color: 'text.secondary' }} /> }}
        />
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {meetingSearchLoading && <Typography variant="caption" color="text.secondary">검색 중...</Typography>}
          {!meetingSearchLoading && meetingSearch.trim() && meetingSearchResults.length === 0 && (
            <Typography variant="caption" color="text.secondary">검색 결과가 없습니다.</Typography>
          )}
          {meetingSearchResults.map((meeting) => (
            <Paper key={meeting.roomId} elevation={0} sx={{ p: 1, border: `1px solid ${theme.palette.divider}`, borderRadius: 1.5 }}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Typography sx={{ fontWeight: 900, flex: 1, minWidth: 0 }} noWrap>{meeting.title || '공개 회의'}</Typography>
                {meeting.accessPolicy?.passwordEnabled && <LockIcon sx={{ fontSize: 16 }} color="action" />}
                <Chip size="small" label={`${meeting.participantCount || 0}명`} sx={{ height: 22 }} />
              </Stack>
              <Typography variant="caption" color="text.secondary" noWrap>
                방장 {meeting.hostDisplayName || '-'} · 코드 {meeting.roomId}
              </Typography>
              <Button size="small" sx={{ mt: 0.75 }} onClick={() => handleJoinSearchResult(meeting)}>참가</Button>
            </Paper>
          ))}
        </Stack>
      </Paper>

      {overviewLoading && <Typography variant="caption" color="text.secondary">회의 목록을 불러오는 중...</Typography>}
      {Array.isArray(meetingOverview.activeMeetings) && meetingOverview.activeMeetings.length > 0 && (
        <Stack spacing={0.75}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900 }}>참여 중인 회의</Typography>
          {meetingOverview.activeMeetings.map((meeting) => (
            <Paper key={meeting.roomId} variant="outlined" sx={{ p: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 900 }} noWrap>{meeting.title || '회의'}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>코드 {meeting.roomId} · {meeting.participantCount || 0}명</Typography>
              <Button size="small" sx={{ mt: 0.75 }} onClick={() => handleJoinActiveMeeting(meeting)}>열기</Button>
            </Paper>
          ))}
        </Stack>
      )}

      {selectedConversationMeeting && (
        <Paper variant="outlined" sx={{ p: 1.25, borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
          <Stack spacing={1}>
            <Box>
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }} noWrap>
                {selectedConversationMeeting.title || '채팅방 회의'}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {selectedConversationMeeting.activeRoom
                  ? `진행 중 · ${selectedConversationMeeting.activeRoom.participantCount || 0}명`
                  : `대기 중 · 멤버 ${selectedConversationMeeting.participantCount || 0}명`}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.75} flexWrap="wrap">
              <Chip size="small" label={selectedConversationMeeting.accessPolicy?.mode === 'public' ? '공개' : '비공개'} />
              {selectedConversationMeeting.accessPolicy?.searchable && <Chip size="small" color="info" label="검색 허용" />}
              {selectedConversationMeeting.accessPolicy?.passwordEnabled && <Chip size="small" icon={<LockIcon />} label="비밀번호" />}
              <Chip size="small" label={selectedConversationMeeting.accessPolicy?.entryMode === 'approval' ? '방장 허가' : '바로 입장'} />
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button
                size="small"
                variant="contained"
                onClick={() => handleConversationMeeting(selectedConversationMeeting)}
                disabled={joining}
              >
                {selectedConversationMeeting.activeRoom ? '회의 참가' : '회의 시작'}
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => {
                  if (selectedConversationMeeting.defaultRoomCode) copyText(selectedConversationMeeting.defaultRoomCode, '회의 코드');
                }}
              >
                코드 복사
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      <Stack spacing={0.75}>
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900 }}>채팅방 회의</Typography>
        {Array.isArray(meetingOverview.conversationMeetings) && meetingOverview.conversationMeetings.length > 0 ? (
          meetingOverview.conversationMeetings.map((meeting) => (
            <Paper
              key={meeting.conversationId}
              variant="outlined"
              onClick={() => handleSelectConversationMeeting(meeting)}
              sx={{
                p: 1,
                cursor: 'pointer',
                borderColor: selectedConversationMeeting?.conversationId === meeting.conversationId ? 'primary.main' : undefined,
                bgcolor: selectedConversationMeeting?.conversationId === meeting.conversationId ? alpha(theme.palette.primary.main, 0.04) : undefined,
                '&:hover': { bgcolor: 'action.hover' }
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 900 }} noWrap>{meeting.title || '채팅방'}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {meeting.activeRoom ? `진행 중 · ${meeting.activeRoom.participantCount || 0}명` : `멤버 ${meeting.participantCount || 0}명`}
              </Typography>
              <Button
                size="small"
                variant={meeting.activeRoom ? 'contained' : 'outlined'}
                sx={{ mt: 0.75 }}
                onClick={(event) => {
                  event.stopPropagation();
                  handleConversationMeeting(meeting);
                }}
                disabled={joining}
              >
                {meeting.activeRoom ? '참가' : '시작'}
              </Button>
            </Paper>
          ))
        ) : (
          <Typography variant="caption" color="text.secondary">참여 가능한 채팅방 회의가 없습니다.</Typography>
        )}
      </Stack>
    </Stack>
  );

  const renderPeoplePanel = () => (
    <Stack spacing={1}>
      {isHost && active && <Alert severity="info" sx={{ py: 0.5 }}>방장 권한으로 참가자를 관리할 수 있습니다.</Alert>}
      {meetingParticipantList.map((participant) => {
        const isLocal = participant.local || participant.socketId === 'local' || participant.socketId === session.socketId;
        const participantName = participant.displayName || participant.loginId || '참가자';
        const participantIsHost = participant.socketId === hostSocketId || (isLocal && session.socketId === hostSocketId);
        return (
          <Paper key={participant.socketId || participantName} variant="outlined" sx={{ p: 1 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Avatar sx={{ width: 30, height: 30, fontSize: 13 }}>{participantName.slice(0, 1)}</Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 900 }} noWrap>{participantName}{isLocal ? ' · 나' : ''}</Typography>
                <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap">
                  {participantIsHost && <Chip size="small" label="방장" sx={{ height: 20 }} />}
                  {participant.audioEnabled === false && <Chip size="small" label="음소거" sx={{ height: 20 }} />}
                  {participant.screenSharing && <Chip size="small" color="info" label="공유" sx={{ height: 20 }} />}
                </Stack>
              </Box>
            </Stack>
            {isHost && !isLocal && active && (
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.75 }}>
                <Button size="small" variant="text" onClick={() => handleTransferMeetingHost(participant)}>방장위임</Button>
                <Button size="small" color="error" variant="text" onClick={() => handleKickMeetingParticipant(participant)}>내보내기</Button>
              </Stack>
            )}
          </Paper>
        );
      })}
      {isHost && active && (
        <Button color="error" variant="outlined" startIcon={<CallEndIcon />} onClick={handleEndMeeting}>
          회의 종료
        </Button>
      )}
    </Stack>
  );

  const renderChatPanel = () => (
    <Stack spacing={1} sx={{ height: '100%' }}>
      <Box sx={{ flex: 1, minHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {meetingMessages.length === 0 ? (
          <Typography variant="caption" color="text.secondary">아직 회의 채팅이 없습니다.</Typography>
        ) : meetingMessages.map((message) => (
          <Paper key={message.messageId || message.createdAt} variant="outlined" sx={{ p: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 800 }}>
              {message.displayName || message.senderName || '참가자'}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {message.content || message.text}
            </Typography>
          </Paper>
        ))}
      </Box>
      <Stack direction="row" spacing={0.75}>
        <TextField
          size="small"
          fullWidth
          placeholder={active ? '회의 채팅 메시지' : '회의 시작 후 채팅 가능'}
          value={meetingChatDraft}
          disabled={!active}
          onChange={(event) => setMeetingChatDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              handleSendMeetingChat();
            }
          }}
        />
        <IconButton color="primary" disabled={!active || chatSending || !meetingChatDraft.trim()} onClick={handleSendMeetingChat}>
          <SendIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Stack>
  );

  const drawerTitle = activeDrawer === 'rooms' ? '방 목록' : activeDrawer === 'people' ? '참가자' : '회의 채팅';

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: theme.palette.mode === 'dark' ? '#0f172a' : '#f8fafc', overflow: 'hidden' }}>
      <Box sx={{ px: compact ? 1.25 : 2, py: compact ? 1 : 1.5, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexShrink: 0, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box sx={{ width: compact ? 30 : 38, height: compact ? 30 : 38, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.info.main, 0.12), color: 'info.main', flexShrink: 0 }}>
            <VideocamIcon fontSize={compact ? 'small' : 'medium'} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, lineHeight: 1.15 }} noWrap>{roomTitle || '화상회의'}</Typography>
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
              <Typography variant="caption" color="text.secondary" noWrap>
                {hostDisplayName ? `${hostDisplayName} · ` : ''}코드 {visibleRoomCode}
              </Typography>
              <Tooltip title="회의 코드 복사">
                <span>
                  <IconButton size="small" onClick={copyRoomCode} disabled={!roomCode} sx={{ width: 22, height: 22 }}>
                    <ContentCopyIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          </Box>
        </Box>

        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ flexShrink: 0 }}>
          {!inWindow && onOpenWindow && (
            veryCompact ? (
              <Tooltip title="창으로 열기">
                <IconButton size="small" onClick={() => onOpenWindow({ roomCode, autoJoin: active })}>
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : (
              <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => onOpenWindow({ roomCode, autoJoin: active })}>
                창으로 열기
              </Button>
            )
          )}
          <Tooltip title="방 목록">
            <IconButton color={activeDrawer === 'rooms' ? 'primary' : 'default'} onClick={() => openDrawer('rooms')}>
              <MeetingRoomIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="채팅">
            <IconButton color={activeDrawer === 'chat' ? 'primary' : 'default'} onClick={() => openDrawer('chat')}>
              <Badge color="primary" badgeContent={meetingMessages.length || 0} max={99}>
                <ChatBubbleOutlineIcon fontSize="small" />
              </Badge>
            </IconButton>
          </Tooltip>
          <Tooltip title="참가자">
            <IconButton color={activeDrawer === 'people' ? 'primary' : 'default'} onClick={() => openDrawer('people')}>
              <Badge color="primary" badgeContent={participantCount || 0} max={99}>
                <GroupsIcon fontSize="small" />
              </Badge>
            </IconButton>
          </Tooltip>
          <Tooltip title="회의 메뉴">
            <IconButton size="small" onClick={(event) => setInviteMenuAnchorEl(event.currentTarget)}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, p: compact ? 1 : 1.5, display: 'flex', flexDirection: 'column', gap: compact ? 1 : 1.25, overflow: 'hidden' }}>
        {error && <Alert severity="warning" onClose={() => setError('')}>{error}</Alert>}
        {active ? renderVideoGrid() : renderWaitingState()}
        {renderControls()}
      </Box>

      <Drawer
        anchor="right"
        open={Boolean(activeDrawer)}
        onClose={() => setActiveDrawer(null)}
        PaperProps={{ sx: { width: { xs: '100%', sm: 380 }, maxWidth: '100vw' } }}
      >
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontWeight: 900 }} noWrap>{drawerTitle}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {linkedConversation ? `${linkedConversation.title || '채팅방'} 연결됨` : '회의 도구'}
                </Typography>
              </Box>
              <IconButton size="small" onClick={() => setActiveDrawer(null)}>×</IconButton>
            </Stack>
          </Box>
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1.5 }}>
            {activeDrawer === 'rooms' && renderRoomsPanel()}
            {activeDrawer === 'people' && renderPeoplePanel()}
            {activeDrawer === 'chat' && renderChatPanel()}
          </Box>
        </Box>
      </Drawer>

      <Menu anchorEl={audioOutputMenuAnchor} open={Boolean(audioOutputMenuAnchor)} onClose={closeDeviceMenus}>
        <MenuItem selected={!selectedAudioOutputId} onClick={() => handleSelectAudioOutput('')}>
          기본 출력 장치
        </MenuItem>
        {(mediaDevices?.speakers || []).map((device, index) => (
          <MenuItem
            key={device.deviceId || `speaker-${index}`}
            selected={selectedAudioOutputId === device.deviceId}
            onClick={() => handleSelectAudioOutput(device.deviceId)}
          >
            {deviceLabel(device, `스피커 ${index + 1}`)}
          </MenuItem>
        ))}
        <MenuItem
          onClick={async () => {
            await refreshMediaDevices();
            closeDeviceMenus();
          }}
        >
          장치 추가/새로고침
        </MenuItem>
        {typeof HTMLMediaElement !== 'undefined' && !HTMLMediaElement.prototype.setSinkId && (
          <MenuItem disabled>이 브라우저는 출력 장치 선택을 지원하지 않습니다.</MenuItem>
        )}
      </Menu>

      <Menu anchorEl={audioInputMenuAnchor} open={Boolean(audioInputMenuAnchor)} onClose={closeDeviceMenus}>
        <MenuItem selected={!selectedAudioInputId} onClick={() => handleSelectAudioInput('')}>
          기본 마이크
        </MenuItem>
        {(mediaDevices?.microphones || []).map((device, index) => (
          <MenuItem
            key={device.deviceId || `mic-${index}`}
            selected={selectedAudioInputId === device.deviceId}
            onClick={() => handleSelectAudioInput(device.deviceId)}
          >
            {deviceLabel(device, `마이크 ${index + 1}`)}
          </MenuItem>
        ))}
        <MenuItem
          onClick={async () => {
            await requestDeviceAccess('audioinput');
            closeDeviceMenus();
          }}
        >
          장치 추가/권한 허용
        </MenuItem>
      </Menu>

      <Menu anchorEl={videoInputMenuAnchor} open={Boolean(videoInputMenuAnchor)} onClose={closeDeviceMenus}>
        <MenuItem selected={!selectedVideoInputId} onClick={() => handleSelectVideoInput('')}>
          기본 카메라
        </MenuItem>
        {(mediaDevices?.cameras || []).map((device, index) => (
          <MenuItem
            key={device.deviceId || `camera-${index}`}
            selected={selectedVideoInputId === device.deviceId}
            onClick={() => handleSelectVideoInput(device.deviceId)}
          >
            {deviceLabel(device, `카메라 ${index + 1}`)}
          </MenuItem>
        ))}
        <MenuItem
          onClick={async () => {
            await requestDeviceAccess('videoinput');
            closeDeviceMenus();
          }}
        >
          장치 추가/권한 허용
        </MenuItem>
      </Menu>

      <Menu anchorEl={inviteMenuAnchorEl} open={Boolean(inviteMenuAnchorEl)} onClose={closeInviteMenu}>
        <MenuItem onClick={() => { closeInviteMenu(); copyInvite(); }} disabled={!roomCode}>
          <LinkIcon fontSize="small" sx={{ mr: 1 }} />
          링크 복사
        </MenuItem>
        <MenuItem onClick={handleOpenChatInvite}>
          <PersonAddIcon fontSize="small" sx={{ mr: 1 }} />
          친구/아이디 초대
        </MenuItem>
        {(active || selectedConversationMeeting) && (
          <MenuItem onClick={() => { closeInviteMenu(); handleOpenRoomSettings(); }}>
            <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
            방 설정
          </MenuItem>
        )}
        {selectedConversationMeeting?.conversationId && (
          <MenuItem onClick={() => { closeInviteMenu(); handleLeaveSelectedConversationRoom(); }} sx={{ color: 'warning.main' }}>
            <CallEndIcon fontSize="small" sx={{ mr: 1 }} />
            방 나가기
          </MenuItem>
        )}
        {selectedConversationCanDelete && (
          <MenuItem onClick={() => { closeInviteMenu(); handleDeleteSelectedConversationRoom(); }} sx={{ color: 'error.main' }}>
            <DeleteForeverIcon fontSize="small" sx={{ mr: 1 }} />
            방 삭제하기
          </MenuItem>
        )}
        {isHost && active && (
          <MenuItem onClick={() => { closeInviteMenu(); handleEndMeeting(); }} sx={{ color: 'error.main' }}>
            <CallEndIcon fontSize="small" sx={{ mr: 1 }} />
            회의 종료
          </MenuItem>
        )}
      </Menu>

      <ChatInviteDialog
        open={chatInviteOpen}
        onClose={() => setChatInviteOpen(false)}
        conversation={linkedConversation || (conversationId ? {
          conversationId,
          type: 'direct',
          title: '회의 채팅방',
        } : null)}
        directUserUid={linkedConversation?.otherUser?.userUid || null}
        defaultTitle={`${linkedConversation?.title || linkedConversation?.otherUser?.displayName || linkedConversation?.otherUser?.username || '회의'} 그룹`}
        onComplete={handleChatInviteComplete}
      />

      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>새 회의 만들기</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField label="회의 이름" size="small" value={meetingTitleDraft} onChange={(event) => setMeetingTitleDraft(event.target.value)} inputProps={{ maxLength: 60 }} fullWidth />
            <Stack direction="row" spacing={1}>
              <Button variant={accessMode === 'private' ? 'contained' : 'outlined'} onClick={() => setAccessMode('private')} fullWidth>비공개</Button>
              <Button variant={accessMode === 'public' ? 'contained' : 'outlined'} onClick={() => setAccessMode('public')} fullWidth>공개</Button>
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button variant={entryMode === 'direct' ? 'contained' : 'outlined'} onClick={() => setEntryMode('direct')} fullWidth>바로 입장</Button>
              <Button variant={entryMode === 'approval' ? 'contained' : 'outlined'} onClick={() => setEntryMode('approval')} fullWidth>방장 허가</Button>
            </Stack>
            {accessMode === 'public' && (
              <FormControlLabel control={<Switch checked={searchable} onChange={(event) => setSearchable(event.target.checked)} />} label="검색 결과에 표시" />
            )}
            <FormControlLabel control={<Switch checked={passwordEnabled} onChange={(event) => setPasswordEnabled(event.target.checked)} />} label="입장 비밀번호 사용" />
            {passwordEnabled && (
              <TextField label="비밀번호" size="small" type="password" value={meetingPassword} onChange={(event) => setMeetingPassword(event.target.value)} fullWidth />
            )}
            <Typography variant="caption" color="text.secondary">
              공개 회의는 검색으로 찾을 수 있고, 비공개 회의는 링크나 코드로만 입장합니다.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)}>취소</Button>
          <Button variant="contained" onClick={handleCreateMeeting} disabled={joining || (passwordEnabled && !meetingPassword.trim())}>시작</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>회의방 저장</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <TextField label="채팅방 이름" size="small" value={saveMeetingTitle} onChange={(event) => setSaveMeetingTitle(event.target.value)} inputProps={{ maxLength: 60 }} fullWidth />
            <Stack direction="row" spacing={1}>
              <Button variant={accessMode === 'private' ? 'contained' : 'outlined'} onClick={() => setAccessMode('private')} fullWidth>비공개</Button>
              <Button variant={accessMode === 'public' ? 'contained' : 'outlined'} onClick={() => setAccessMode('public')} fullWidth>공개</Button>
            </Stack>
            {accessMode === 'public' && (
              <FormControlLabel control={<Switch checked={searchable} onChange={(event) => setSearchable(event.target.checked)} />} label="검색 결과에 표시" />
            )}
            <Stack direction="row" spacing={1}>
              <Button variant={entryMode === 'direct' ? 'contained' : 'outlined'} onClick={() => setEntryMode('direct')} fullWidth>바로 입장</Button>
              <Button variant={entryMode === 'approval' ? 'contained' : 'outlined'} onClick={() => setEntryMode('approval')} fullWidth>방장 허가</Button>
            </Stack>
            <FormControlLabel control={<Switch checked={passwordEnabled} onChange={(event) => setPasswordEnabled(event.target.checked)} />} label="입장 비밀번호 사용" />
            {passwordEnabled && (
              <TextField label="비밀번호" size="small" type="password" value={meetingPassword} onChange={(event) => setMeetingPassword(event.target.value)} fullWidth />
            )}
            <Typography variant="caption" color="text.secondary">
              저장하면 현재 임시 회의가 정규 채팅방과 연결되고, 이후 참가자가 없어도 방 목록과 검색에서 다시 열 수 있습니다.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>취소</Button>
          <Button variant="contained" onClick={handleSaveMeeting} disabled={savingMeeting || (passwordEnabled && !meetingPassword.trim())}>저장</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={settingsDialogOpen} onClose={() => setSettingsDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>방 설정</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            {active && !isHost && <Alert severity="info">방 설정은 확인할 수 있지만 저장은 방장만 할 수 있습니다.</Alert>}
            <TextField label="방 이름" size="small" value={settingsTitle} onChange={(event) => setSettingsTitle(event.target.value)} inputProps={{ maxLength: 60 }} fullWidth />
            <Stack direction="row" spacing={1}>
              <Button variant={accessMode === 'private' ? 'contained' : 'outlined'} onClick={() => setAccessMode('private')} fullWidth>비공개</Button>
              <Button variant={accessMode === 'public' ? 'contained' : 'outlined'} onClick={() => setAccessMode('public')} fullWidth>공개</Button>
            </Stack>
            {accessMode === 'public' && (
              <FormControlLabel control={<Switch checked={searchable} onChange={(event) => setSearchable(event.target.checked)} />} label="검색 결과에 표시" />
            )}
            <Stack direction="row" spacing={1}>
              <Button variant={entryMode === 'direct' ? 'contained' : 'outlined'} onClick={() => setEntryMode('direct')} fullWidth>바로 입장</Button>
              <Button variant={entryMode === 'approval' ? 'contained' : 'outlined'} onClick={() => setEntryMode('approval')} fullWidth>방장 허가</Button>
            </Stack>
            <FormControlLabel control={<Switch checked={passwordEnabled} onChange={(event) => setPasswordEnabled(event.target.checked)} />} label="입장 비밀번호 사용" />
            {passwordEnabled && (
              <TextField
                label={settingsExistingPasswordEnabled ? '새 비밀번호(비워두면 유지)' : '비밀번호'}
                size="small"
                type="password"
                value={settingsPassword}
                onChange={(event) => setSettingsPassword(event.target.value)}
                fullWidth
              />
            )}
            <Typography variant="caption" color="text.secondary">
              변경 내용은 현재 회의에 즉시 적용됩니다. 정규 회의방이면 검색과 다음 입장에도 같은 설정이 사용됩니다.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSettingsDialogOpen(false)}>취소</Button>
          <Button variant="contained" onClick={handleSaveRoomSettings} disabled={(active && !isHost) || savingSettings || (passwordEnabled && !settingsExistingPasswordEnabled && !settingsPassword.trim())}>저장</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default MeetingApp;
