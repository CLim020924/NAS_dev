import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import GroupsIcon from '@mui/icons-material/Groups';
import VideocamIcon from '@mui/icons-material/Videocam';
import CallEndIcon from '@mui/icons-material/CallEnd';
import { alpha, useTheme } from '@mui/material/styles';

const makeRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const MeetingApp = () => {
  const theme = useTheme();
  const [roomCode, setRoomCode] = useState(() => makeRoomCode());
  const [joinCode, setJoinCode] = useState('');
  const [active, setActive] = useState(false);
  const currentUser = useMemo(() => JSON.parse(localStorage.getItem('user')) || {}, []);
  const inviteLink = `${window.location.origin}/platform?meeting=${roomCode}`;

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch (err) {
      window.prompt('초대 링크를 복사하세요.', inviteLink);
    }
  };

  const startMeeting = () => {
    if (!roomCode) setRoomCode(makeRoomCode());
    setActive(true);
  };

  const joinMeeting = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setRoomCode(code);
    setActive(true);
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.secondary.main, 0.10), color: 'secondary.main' }}>
            <VideocamIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, lineHeight: 1.15 }}>화상회의</Typography>
            <Typography variant="caption" color="text.secondary">회의 코드 {roomCode}</Typography>
          </Box>
        </Box>
        <Chip size="small" color={active ? 'success' : 'default'} label={active ? '회의 중' : '대기'} />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 280px' }, overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto' }}>
          <Paper elevation={0} sx={{ flex: 1, minHeight: 260, borderRadius: 2, border: `1px solid ${theme.palette.divider}`, bgcolor: theme.palette.mode === 'dark' ? '#0c1117' : '#111827', color: '#fff', display: 'grid', placeItems: 'center' }}>
            <Stack spacing={1.5} alignItems="center">
              <VideocamIcon sx={{ fontSize: 54, opacity: 0.86 }} />
              <Typography sx={{ fontWeight: 900 }}>{active ? '카메라 준비 중' : '회의를 시작하거나 참가하세요'}</Typography>
              <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.62)' }}>회의 코드로 참가자를 초대할 수 있습니다.</Typography>
            </Stack>
          </Paper>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="contained" startIcon={<VideocamIcon />} onClick={startMeeting}>회의 시작</Button>
            <TextField size="small" placeholder="회의 코드" value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
            <Button variant="outlined" onClick={joinMeeting}>참가</Button>
            {active && <Button color="error" variant="outlined" startIcon={<CallEndIcon />} onClick={() => setActive(false)}>종료</Button>}
          </Stack>
        </Box>

        <Box sx={{ borderLeft: { md: `1px solid ${theme.palette.divider}` }, borderTop: { xs: `1px solid ${theme.palette.divider}`, md: 'none' }, p: 2, overflow: 'auto' }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900 }}>Invite</Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5, mb: 2 }}>
            <TextField size="small" value={inviteLink} fullWidth InputProps={{ readOnly: true }} />
            <IconButton onClick={copyInvite} aria-label="초대 링크 복사"><ContentCopyIcon fontSize="small" /></IconButton>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900 }}>Participants</Typography>
          <Stack spacing={1} sx={{ mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <GroupsIcon fontSize="small" color="primary" />
              <Typography sx={{ fontWeight: 800 }}>{currentUser.displayName || currentUser.username || '나'}</Typography>
              <Chip size="small" label="host" />
            </Box>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
};

export default MeetingApp;
