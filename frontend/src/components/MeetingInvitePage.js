import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import VideocamIcon from '@mui/icons-material/Videocam';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate, useParams } from 'react-router-dom';
import MeetingApp from './MeetingApp';
import { normalizeRoomCode, useMeetingSession } from '../contexts/MeetingContext';

const MeetingInvitePage = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const params = useParams();
  const roomCode = useMemo(() => normalizeRoomCode(params.roomCode), [params.roomCode]);
  const { guestProfile, setGuestProfile, setRoomCode } = useMeetingSession();
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');

  const signedIn = !!localStorage.getItem('user');
  const hasGuest = !!guestProfile?.nickname;

  useEffect(() => {
    if (roomCode) setRoomCode(roomCode);
  }, [roomCode, setRoomCode]);

  const handleLogin = () => {
    const next = `/meeting/${encodeURIComponent(roomCode)}`;
    navigate(`/login?next=${encodeURIComponent(next)}`);
  };

  const handleGuest = () => {
    const profile = setGuestProfile(nickname);
    if (!profile) {
      setError('회의에서 사용할 닉네임을 입력하세요.');
      return;
    }
    setError('');
  };

  if (!roomCode) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', bgcolor: 'background.default', p: 2 }}>
        <Alert severity="error">회의 링크가 올바르지 않습니다.</Alert>
      </Box>
    );
  }

  if (signedIn || hasGuest) {
    return (
      <Box sx={{ height: '100vh', bgcolor: 'background.default' }}>
        <MeetingApp initialRoomCode={roomCode} autoJoin />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'background.default',
        backgroundImage: theme.palette.mode === 'dark'
          ? 'linear-gradient(180deg, rgba(14,165,233,0.10), transparent 44%)'
          : 'linear-gradient(180deg, rgba(37,99,235,0.08), transparent 44%)',
        p: 2
      }}
    >
      <Paper elevation={0} sx={{ width: 'min(440px, 100%)', p: 3, borderRadius: 2, border: `1px solid ${theme.palette.divider}`, boxShadow: `0 24px 70px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.36 : 0.12)}` }}>
        <Stack spacing={2.5}>
          <Stack spacing={1} alignItems="center" textAlign="center">
            <Box sx={{ width: 58, height: 58, borderRadius: 2, display: 'grid', placeItems: 'center', color: 'info.main', bgcolor: alpha(theme.palette.info.main, 0.12) }}>
              <VideocamIcon sx={{ fontSize: 34 }} />
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 900 }}>회의 참가</Typography>
            <Typography variant="body2" color="text.secondary">회의 코드 {roomCode}</Typography>
          </Stack>

          {error && <Alert severity="warning">{error}</Alert>}

          <Button variant="contained" size="large" startIcon={<LoginIcon />} onClick={handleLogin}>
            NAS 계정으로 로그인
          </Button>

          <Stack spacing={1}>
            <TextField
              label="게스트 닉네임"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleGuest()}
              fullWidth
            />
            <Button variant="outlined" size="large" startIcon={<PersonOutlineIcon />} onClick={handleGuest}>
              게스트로 참가
            </Button>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            게스트는 회의와 회의 채팅만 사용할 수 있고, NAS 파일과 다른 기능에는 접근할 수 없습니다.
          </Typography>
        </Stack>
      </Paper>
    </Box>
  );
};

export default MeetingInvitePage;
