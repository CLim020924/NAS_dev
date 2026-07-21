import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, FormControlLabel, Paper, Stack, Switch, TextField, Typography } from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import LogoutIcon from '@mui/icons-material/Logout';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import MeetingApp from './MeetingApp';
import { normalizeRoomCode, useMeetingSession } from '../contexts/MeetingContext';

const MeetingInvitePage = () => {
  const navigate = useNavigate();
  const params = useParams();
  const roomCode = useMemo(() => normalizeRoomCode(params.roomCode), [params.roomCode]);
  const { guestProfile, setGuestProfile, clearGuestProfile, setRoomCode, active, leaveMeeting } = useMeetingSession();
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [roomStatus, setRoomStatus] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [readyToJoin, setReadyToJoin] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [meetingPassword, setMeetingPassword] = useState('');
  const readSignedInUser = () => {
    try {
      return JSON.parse(localStorage.getItem('user')) || {};
    } catch (err) {
      return {};
    }
  };
  const [signedInUser, setSignedInUser] = useState(() => readSignedInUser());
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const leaveInviteMeeting = () => {
      if (!activeRef.current) return;
      leaveMeeting();
      activeRef.current = false;
    };

    window.addEventListener('popstate', leaveInviteMeeting);
    return () => {
      window.removeEventListener('popstate', leaveInviteMeeting);
    };
  }, [leaveMeeting]);

  const signedIn = !!(signedInUser.userUid || signedInUser.loginId || signedInUser.username || signedInUser.id);
  const hasGuest = !!guestProfile?.nickname;
  const hasIdentity = signedIn || hasGuest;
  const passwordRequired = !!(roomStatus?.passwordRequired || roomStatus?.accessPolicy?.passwordEnabled);
  const identityLabel = signedIn
    ? (signedInUser.displayName || signedInUser.nickname || signedInUser.username || signedInUser.loginId || signedInUser.id || 'NAS 계정')
    : (hasGuest ? `(guest) ${guestProfile.nickname}` : '');

  const loadRoomStatus = useCallback(async () => {
    if (!roomCode) {
      setRoomStatus({ status: 'missing', participantCount: 0 });
      setStatusLoading(false);
      return;
    }
    try {
      const response = await axios.get(`/api/meetings/${encodeURIComponent(roomCode)}/status`);
      setRoomStatus(response.data);
    } catch (err) {
      setRoomStatus(err.response?.data || { status: 'missing', participantCount: 0 });
    } finally {
      setStatusLoading(false);
    }
  }, [roomCode]);

  useEffect(() => {
    if (roomCode) setRoomCode(roomCode);
    loadRoomStatus();
    const timer = setInterval(loadRoomStatus, 5000);
    return () => clearInterval(timer);
  }, [loadRoomStatus, roomCode, setRoomCode]);

  const handleLogin = () => {
    const next = `/meeting/${encodeURIComponent(roomCode)}`;
    navigate(`/login?next=${encodeURIComponent(next)}`);
  };

  const clearStoredIdentity = async ({ clearGuest = true } = {}) => {
    try {
      await axios.post('/api/logout', {}, { withCredentials: true });
    } catch (err) {
      // Local identity must still be cleared if the session has already expired.
    }
    localStorage.removeItem('user');
    localStorage.removeItem('nas_session_left_at');
    if (clearGuest) clearGuestProfile();
    setReadyToJoin(false);
    window.dispatchEvent(new Event('nas:user-updated'));
    setSignedInUser({});
  };

  const handleDifferentLogin = async () => {
    await clearStoredIdentity({ clearGuest: true });
    handleLogin();
  };

  const handleGuest = () => {
    const profile = setGuestProfile(nickname);
    if (!profile) {
      setError('회의에서 사용할 닉네임을 입력하세요.');
      return;
    }
    setError('');
  };

  const handleLogoutForGuest = async () => {
    await clearStoredIdentity({ clearGuest: true });
    setNickname('');
    setError('');
  };

  if (statusLoading) {
    return <Box sx={{ minHeight: 'var(--app-viewport-height)', display: 'grid', placeItems: 'center', bgcolor: 'background.default' }}><CircularProgress /></Box>;
  }

  if (roomStatus?.status !== 'active') {
    const ended = roomStatus?.status === 'ended';
    return (
      <Box sx={{ minHeight: 'var(--app-viewport-height)', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
        <Paper elevation={0} sx={{ width: 'min(460px, 100%)', p: 3, border: (theme) => `1px solid ${theme.palette.divider}`, textAlign: 'center' }}>
          <Stack spacing={1.5} alignItems="center">
            <VideocamOffIcon color="disabled" sx={{ fontSize: 48 }} />
            <Typography variant="h5" fontWeight={900}>{ended ? '종료된 회의입니다' : '존재하지 않는 회의 링크입니다'}</Typography>
            <Typography color="text.secondary">
              {ended ? '회의가 종료되어 링크가 만료되었습니다.' : '회의가 아직 시작되지 않았거나 링크가 더 이상 유효하지 않습니다.'}
            </Typography>
          </Stack>
        </Paper>
      </Box>
    );
  }

  if (readyToJoin && hasIdentity) {
    return (
      <Box sx={{ height: 'var(--app-viewport-height)', bgcolor: 'background.default' }}>
        <MeetingApp
          initialRoomCode={roomCode}
          autoJoin
          requireExistingRoom
          initialMediaPreferences={{ audioEnabled, videoEnabled }}
          initialAccessPassword={meetingPassword}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: 'var(--app-viewport-height)', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
      <Paper elevation={0} sx={{ width: 'min(460px, 100%)', p: { xs: 2, sm: 3 }, border: (theme) => `1px solid ${theme.palette.divider}` }}>
        <Stack spacing={2.25}>
          <Stack spacing={0.75} alignItems="center" textAlign="center">
            <VideocamIcon color="primary" sx={{ fontSize: 42 }} />
            <Typography variant="h5" fontWeight={900}>회의 참가 준비</Typography>
            <Typography variant="body2" color="text.secondary">
              현재 {roomStatus.participantCount || 0}명 참가 중 · 코드 {roomCode}
            </Typography>
          </Stack>

          {error && <Alert severity="warning">{error}</Alert>}

          {!hasIdentity && (
            <Stack spacing={1}>
              <Button variant="contained" size="large" startIcon={<LoginIcon />} onClick={handleLogin}>NAS 계정으로 로그인</Button>
              <TextField label="게스트 닉네임" value={nickname} onChange={(event) => setNickname(event.target.value)} fullWidth />
              <Button variant="outlined" size="large" startIcon={<PersonOutlineIcon />} onClick={handleGuest}>게스트로 계속</Button>
            </Stack>
          )}

          {hasIdentity && (
            <>
              <Alert severity="info" sx={{ alignItems: 'center' }}>
                현재 참가 이름: <strong>{identityLabel}</strong>
              </Alert>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
                <FormControlLabel
                  control={<Switch checked={audioEnabled} onChange={(event) => setAudioEnabled(event.target.checked)} />}
                  label={<Stack direction="row" spacing={0.75} alignItems="center">{audioEnabled ? <MicIcon fontSize="small" /> : <MicOffIcon fontSize="small" />}<span>마이크</span></Stack>}
                  sx={{ m: 0, p: 1, border: (theme) => `1px solid ${theme.palette.divider}` }}
                />
                <FormControlLabel
                  control={<Switch checked={videoEnabled} onChange={(event) => setVideoEnabled(event.target.checked)} />}
                  label={<Stack direction="row" spacing={0.75} alignItems="center">{videoEnabled ? <VideocamIcon fontSize="small" /> : <VideocamOffIcon fontSize="small" />}<span>카메라</span></Stack>}
                  sx={{ m: 0, p: 1, border: (theme) => `1px solid ${theme.palette.divider}` }}
                />
              </Box>
              {passwordRequired && (
                <TextField
                  label="회의 비밀번호"
                  type="password"
                  value={meetingPassword}
                  onChange={(event) => setMeetingPassword(event.target.value)}
                  fullWidth
                />
              )}
              <Button
                variant="contained"
                size="large"
                onClick={() => {
                  if (passwordRequired && !meetingPassword.trim()) {
                    setError('회의 비밀번호를 입력하세요.');
                    return;
                  }
                  setError('');
                  setReadyToJoin(true);
                }}
              >
                회의 참가
              </Button>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button fullWidth color="inherit" startIcon={<LoginIcon />} onClick={handleDifferentLogin}>
                  다른 NAS 계정
                </Button>
                <Button fullWidth color="inherit" startIcon={<LogoutIcon />} onClick={handleLogoutForGuest}>
                  다른 게스트 이름
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
};

export default MeetingInvitePage;
