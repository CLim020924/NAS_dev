import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { AccountCircle, Lock, Search, Videocam, Visibility, VisibilityOff } from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import { motion } from 'framer-motion';

const Login = () => {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [meetingDialogOpen, setMeetingDialogOpen] = useState(false);
  const [meetingName, setMeetingName] = useState('');
  const [meetingSearching, setMeetingSearching] = useState(false);
  const [meetingResults, setMeetingResults] = useState([]);
  const [meetingSearchError, setMeetingSearchError] = useState('');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const theme = useTheme();

  const finishLogin = (response) => {
    localStorage.setItem('user', JSON.stringify(response.data.user));
    localStorage.removeItem('nas_session_left_at');
    window.dispatchEvent(new Event('nas:user-updated'));
    const requestedNext = searchParams.get('next');
    const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/platform';
    navigate(next);
  };

  const submitLogin = (sessionConflictAction) => {
    setError('');
    setIsLoggingIn(true);
    axios.post('/api/login', {
      id,
      password,
      ...(sessionConflictAction ? { sessionConflictAction } : {})
    }, { withCredentials: true })
      .then(finishLogin)
      .catch(err => {
        if (err.response?.status === 409 && err.response?.data?.code === 'ACTIVE_SESSION_EXISTS') {
          setConflictOpen(true);
          return;
        }
        setError(err.response?.data?.error || '로그인 정보가 올바르지 않습니다.');
      })
      .finally(() => {
        setIsLoggingIn(false);
      });
  };

  const handleLogin = () => submitLogin();
  const handleAllowConcurrentLogin = () => {
    setConflictOpen(false);
    submitLogin('allow');
  };
  const handleReplacePreviousLogin = () => {
    setConflictOpen(false);
    submitLogin('replace');
  };

  const handleMeetingSearch = async () => {
    const name = meetingName.trim();
    if (!name) {
      setMeetingSearchError('참가할 회의방 이름을 정확히 입력하세요.');
      return;
    }
    try {
      setMeetingSearching(true);
      setMeetingSearchError('');
      const res = await axios.get('/api/meetings/public/exact', { params: { name } });
      const rooms = Array.isArray(res.data?.rooms) ? res.data.rooms : [];
      setMeetingResults(rooms);
      if (rooms.length === 0) setMeetingSearchError('일치하는 공개 회의방이 없습니다.');
    } catch (err) {
      setMeetingResults([]);
      setMeetingSearchError(err.response?.data?.error || '회의방을 검색할 수 없습니다.');
    } finally {
      setMeetingSearching(false);
    }
  };

  const handleOpenMeeting = (room) => {
    if (!room?.roomId) return;
    navigate(`/meeting/${encodeURIComponent(room.roomId)}`);
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        bgcolor: 'background.default',
        backgroundImage: theme.palette.mode === 'dark'
          ? 'linear-gradient(180deg, rgba(125,211,252,0.08), transparent 42%)'
          : 'linear-gradient(180deg, rgba(37,99,235,0.07), transparent 44%)',
        px: 2,
        py: { xs: 3, sm: 6 }
      }}
    >
      <Button
        variant="outlined"
        size="small"
        startIcon={<Videocam />}
        onClick={() => setMeetingDialogOpen(true)}
        sx={{
          position: 'fixed',
          top: { xs: 12, sm: 20 },
          right: { xs: 12, sm: 20 },
          zIndex: 2,
          bgcolor: 'background.paper'
        }}
      >
        화상회의 참가
      </Button>
      <Container maxWidth="xs" disableGutters>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Paper
            elevation={0}
            sx={{
              p: { xs: 3, sm: 4 },
              borderRadius: 2,
              border: `1px solid ${theme.palette.divider}`,
              boxShadow: theme.palette.mode === 'dark'
                ? '0 24px 70px rgba(0,0,0,0.34)'
                : '0 24px 70px rgba(15,23,42,0.10)'
            }}
          >
            <Stack spacing={3}>
              <Stack spacing={1.5} alignItems="center">
                <Box
                  component="img"
                  src="/logo192.png"
                  alt="NAS"
                  sx={{
                    width: 64,
                    height: 64,
                    objectFit: 'contain',
                    borderRadius: 2,
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    p: 1
                  }}
                />
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" sx={{ color: 'text.primary' }}>
                    NAS
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    계정으로 저장소에 접속합니다
                  </Typography>
                </Box>
              </Stack>

              {error && <Alert severity="error">{error}</Alert>}

              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label="User ID"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  autoComplete="username"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <AccountCircle color="primary" />
                      </InputAdornment>
                    )
                  }}
                />

                <TextField
                  fullWidth
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  autoComplete="current-password"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Lock color="primary" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                          onClick={() => setShowPassword(!showPassword)}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    )
                  }}
                />
              </Stack>

              <Stack spacing={1.25}>
                <Button fullWidth variant="contained" size="large" onClick={handleLogin} disabled={isLoggingIn}>
                  Sign In
                </Button>
                <Button fullWidth variant="text" onClick={() => navigate('/signup')}>
                  Create an account
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </motion.div>
      </Container>
      <Dialog open={conflictOpen} onClose={() => setConflictOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>이미 로그인되어 있는 계정입니다</DialogTitle>
        <DialogContent>
          <DialogContentText>
            기존 접속을 유지한 채 이 기기에서도 로그인하거나, 기존 접속을 로그아웃하고 이 기기에서만 로그인할 수 있습니다.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={handleReplacePreviousLogin} color="inherit">
            기존 접속 로그아웃
          </Button>
          <Button onClick={handleAllowConcurrentLogin} variant="contained">
            동시 로그인
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={meetingDialogOpen} onClose={() => setMeetingDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>화상회의 참가하기</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <DialogContentText>
              보안을 위해 회의방 이름을 정확히 입력해야 검색됩니다.
            </DialogContentText>
            <TextField
              label="회의방 이름"
              value={meetingName}
              onChange={(event) => setMeetingName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleMeetingSearch()}
              fullWidth
              autoFocus
            />
            {meetingSearchError && <Alert severity="warning">{meetingSearchError}</Alert>}
            {meetingResults.map((room) => (
              <Paper key={room.roomId} variant="outlined" sx={{ p: 1.25 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 900 }} noWrap>{room.title || '회의방'}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      방장 {room.hostDisplayName || '-'}{room.accessPolicy?.passwordEnabled ? ' · 비밀번호 필요' : ''}
                    </Typography>
                  </Box>
                  <Button size="small" variant="contained" onClick={() => handleOpenMeeting(room)}>참가</Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMeetingDialogOpen(false)}>닫기</Button>
          <Button variant="contained" startIcon={<Search />} onClick={handleMeetingSearch} disabled={meetingSearching}>
            검색
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Login;
