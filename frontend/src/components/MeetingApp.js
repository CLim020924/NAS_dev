import React, { useEffect, useMemo, useRef } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material';
import CallEndIcon from '@mui/icons-material/CallEnd';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import GroupsIcon from '@mui/icons-material/Groups';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PresentToAllIcon from '@mui/icons-material/PresentToAll';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import { alpha, useTheme } from '@mui/material/styles';
import { normalizeRoomCode, useMeetingSession } from '../contexts/MeetingContext';

const VideoTile = ({ label, stream, muted = false, audioEnabled = true, videoEnabled = true, screenSharing = false, local = false }) => {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && videoRef.current.srcObject !== stream) {
      videoRef.current.srcObject = stream || null;
    }
  }, [stream]);

  return (
    <Paper
      elevation={0}
      sx={{
        minHeight: 180,
        borderRadius: 2,
        overflow: 'hidden',
        position: 'relative',
        bgcolor: '#0b1220',
        border: '1px solid rgba(255,255,255,0.08)'
      }}
    >
      {stream && videoEnabled ? (
        <Box
          component="video"
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          sx={{ width: '100%', height: '100%', minHeight: 180, objectFit: screenSharing ? 'contain' : 'cover', display: 'block', bgcolor: '#0b1220' }}
        />
      ) : (
        <Box sx={{ minHeight: 180, height: '100%', display: 'grid', placeItems: 'center', color: '#fff' }}>
          <Stack spacing={1} alignItems="center">
            <Avatar sx={{ width: 56, height: 56, bgcolor: 'rgba(255,255,255,0.14)', fontWeight: 900 }}>
              {label?.slice(0, 1) || '?'}
            </Avatar>
            <Typography sx={{ fontWeight: 800 }}>{videoEnabled ? '연결 대기' : '카메라 꺼짐'}</Typography>
          </Stack>
        </Box>
      )}

      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ position: 'absolute', left: 10, right: 10, bottom: 10, minWidth: 0 }}>
        <Chip
          size="small"
          label={`${label || '참가자'}${local ? ' · 나' : ''}`}
          sx={{ bgcolor: 'rgba(0,0,0,0.56)', color: '#fff', maxWidth: '100%', '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
        />
        {!audioEnabled && <Chip size="small" icon={<MicOffIcon />} label="음소거" sx={{ bgcolor: 'rgba(0,0,0,0.56)', color: '#fff' }} />}
        {screenSharing && <Chip size="small" label="공유 중" color="info" />}
      </Stack>
    </Paper>
  );
};

const MeetingApp = ({ initialRoomCode = '', autoJoin = false, inWindow = false, onOpenWindow = null }) => {
  const theme = useTheme();
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
    audioEnabled,
    videoEnabled,
    screenSharing,
    displayName,
    startMeeting,
    joinMeeting,
    joinTypedMeeting,
    leaveMeeting,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare
  } = session;

  const remoteList = useMemo(() => Object.values(remotePeers), [remotePeers]);
  const previewStream = displayStream || localStream;
  const inviteLink = `${window.location.origin}/meeting/${encodeURIComponent(roomCode)}`;

  useEffect(() => {
    const normalized = normalizeRoomCode(initialRoomCode);
    if (normalized && normalized !== roomCode && !active) {
      setRoomCode(normalized);
    }
  }, [active, initialRoomCode, roomCode, setRoomCode]);

  useEffect(() => {
    if (autoJoin && !active && !joining) {
      joinMeeting(initialRoomCode || roomCode);
    }
  }, [active, autoJoin, initialRoomCode, joinMeeting, joining, roomCode]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch (err) {
      window.prompt('초대 링크를 복사하세요.', inviteLink);
    }
  };

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', overflow: 'auto' }}>
      <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.info.main, 0.12), color: 'info.main' }}>
            <VideocamIcon />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, lineHeight: 1.15 }}>화상회의</Typography>
            <Typography variant="caption" color="text.secondary">회의 코드 {roomCode}</Typography>
          </Box>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {!inWindow && onOpenWindow && (
            <Button size="small" variant="outlined" startIcon={<OpenInNewIcon />} onClick={() => onOpenWindow({ roomCode, autoJoin: active })}>
              창으로 열기
            </Button>
          )}
          <Chip size="small" color={active ? 'success' : 'default'} label={active ? `${remoteList.length + 1}명 연결` : '대기'} />
          {screenSharing && <Chip size="small" color="info" label="화면공유" />}
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minHeight: { xs: 'auto', md: 0 }, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 280px' }, overflow: { xs: 'visible', md: 'hidden' } }}>
        <Box sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5, overflow: { xs: 'visible', md: 'hidden' } }}>
          {error && <Alert severity="warning" onClose={() => setError('')}>{error}</Alert>}

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gap: 1.25,
              gridTemplateColumns: remoteList.length > 1 ? { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } : '1fr',
              alignContent: 'stretch',
              overflow: 'auto',
              pr: 0.5
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
            />
            {remoteList.map((peer) => (
              <VideoTile
                key={peer.socketId}
                label={peer.displayName || peer.loginId || '참가자'}
                stream={peer.stream}
                audioEnabled={peer.audioEnabled !== false}
                videoEnabled={peer.videoEnabled !== false}
                screenSharing={!!peer.screenSharing}
              />
            ))}
          </Box>

          <Paper elevation={0} sx={{ borderRadius: 2, border: `1px solid ${theme.palette.divider}`, p: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
            <Stack direction="row" spacing={0.75}>
              <Tooltip title={audioEnabled ? '마이크 끄기' : '마이크 켜기'}>
                <span>
                  <IconButton disabled={!active} onClick={toggleAudio} color={audioEnabled ? 'default' : 'error'}>
                    {audioEnabled ? <MicIcon /> : <MicOffIcon />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={screenSharing ? '화면공유 중에는 카메라 전환이 잠깐 고정됩니다.' : (videoEnabled ? '카메라 끄기' : '카메라 켜기')}>
                <span>
                  <IconButton disabled={!active || screenSharing} onClick={toggleVideo} color={videoEnabled ? 'default' : 'error'}>
                    {videoEnabled ? <VideocamIcon /> : <VideocamOffIcon />}
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

            <Stack direction="row" spacing={1} sx={{ flex: 1, justifyContent: { xs: 'flex-start', sm: 'center' }, minWidth: 220 }}>
              {!active && (
                <>
                  <Button variant="contained" startIcon={<VideocamIcon />} onClick={startMeeting} disabled={joining}>
                    회의 시작
                  </Button>
                  <TextField
                    size="small"
                    placeholder="회의 코드"
                    value={joinCode}
                    onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
                    sx={{ maxWidth: 150 }}
                  />
                  <Button variant="outlined" onClick={joinTypedMeeting} disabled={joining}>
                    참가
                  </Button>
                </>
              )}
            </Stack>

            <Button color="error" variant="outlined" startIcon={<CallEndIcon />} onClick={leaveMeeting} disabled={!active && !joining}>
              종료
            </Button>
          </Paper>
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <GroupsIcon fontSize="small" color="primary" />
              <Typography sx={{ fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</Typography>
              <Chip size="small" label="나" />
            </Box>
            {remoteList.map((peer) => (
              <Box key={peer.socketId} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                <Avatar sx={{ width: 24, height: 24, fontSize: 12 }}>{(peer.displayName || peer.loginId || '?').slice(0, 1)}</Avatar>
                <Typography sx={{ fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {peer.displayName || peer.loginId || '참가자'}
                </Typography>
                {peer.screenSharing && <Chip size="small" color="info" label="공유" />}
                {peer.audioEnabled === false && <MicOffIcon fontSize="small" color="error" />}
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>
    </Box>
  );
};

export default MeetingApp;
