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
import useMediaQuery from '@mui/material/useMediaQuery';
import { normalizeRoomCode, useMeetingSession } from '../contexts/MeetingContext';

const VideoTile = ({ label, stream, muted = false, audioEnabled = true, videoEnabled = true, screenSharing = false, local = false, compact = false }) => {
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
        minHeight: compact ? 132 : 180,
        height: '100%',
        borderRadius: compact ? 1.5 : 2,
        overflow: 'hidden',
        position: 'relative',
        bgcolor: '#0b1220',
        border: '1px solid rgba(255,255,255,0.08)',
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
          sx={{ width: '100%', height: '100%', minHeight: compact ? 132 : 180, objectFit: screenSharing ? 'contain' : 'cover', display: 'block', bgcolor: '#0b1220' }}
        />
      ) : (
        <Box sx={{ minHeight: compact ? 132 : 180, height: '100%', display: 'grid', placeItems: 'center', color: '#fff' }}>
          <Stack spacing={compact ? 0.5 : 1} alignItems="center">
            <Avatar sx={{ width: compact ? 42 : 56, height: compact ? 42 : 56, bgcolor: 'rgba(255,255,255,0.14)', fontWeight: 900 }}>
              {label?.slice(0, 1) || '?'}
            </Avatar>
            <Typography sx={{ fontWeight: 800, fontSize: compact ? '0.82rem' : '0.95rem' }}>{videoEnabled ? '연결 대기' : '카메라 꺼짐'}</Typography>
          </Stack>
        </Box>
      )}

      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ position: 'absolute', left: compact ? 7 : 10, right: compact ? 7 : 10, bottom: compact ? 7 : 10, minWidth: 0 }}>
        <Chip
          size="small"
          label={`${label || '참가자'}${local ? ' · 나' : ''}`}
          sx={{ bgcolor: 'rgba(0,0,0,0.56)', color: '#fff', maxWidth: '100%', height: compact ? 22 : 24, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis', px: compact ? 0.8 : 1 } }}
        />
        {!audioEnabled && <Chip size="small" icon={<MicOffIcon />} label={compact ? '' : '음소거'} sx={{ bgcolor: 'rgba(0,0,0,0.56)', color: '#fff', height: compact ? 22 : 24, '& .MuiChip-icon': { ml: compact ? 0.5 : 0.75 } }} />}
        {screenSharing && <Chip size="small" label={compact ? '공유' : '공유 중'} color="info" sx={{ height: compact ? 22 : 24 }} />}
      </Stack>
    </Paper>
  );
};

const MeetingApp = ({ initialRoomCode = '', autoJoin = false, inWindow = false, onOpenWindow = null }) => {
  const theme = useTheme();
  const compact = useMediaQuery('(max-width:900px), (max-height:650px)');
  const veryCompact = useMediaQuery('(max-width:620px), (max-height:520px)');
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
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: theme.palette.mode === 'dark' ? '#0f172a' : '#f8fafc', overflow: 'hidden' }}>
      <Box sx={{ px: compact ? 1.25 : 2, py: compact ? 1 : 1.5, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexShrink: 0, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
          <Box sx={{ width: compact ? 30 : 38, height: compact ? 30 : 38, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: alpha(theme.palette.info.main, 0.12), color: 'info.main', flexShrink: 0 }}>
            <VideocamIcon fontSize={compact ? 'small' : 'medium'} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, lineHeight: 1.15 }} noWrap>화상회의</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>코드 {roomCode}</Typography>
          </Box>
        </Box>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexShrink: 0 }}>
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
          <Chip size="small" color={active ? 'success' : 'default'} label={active ? `${remoteList.length + 1}명` : '대기'} sx={{ height: compact ? 24 : 26 }} />
          {screenSharing && !veryCompact && <Chip size="small" color="info" label="화면공유" />}
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', lg: compact ? '1fr 238px' : '1fr 280px' }, overflow: 'hidden' }}>
        <Box sx={{ p: compact ? 1 : 1.5, display: 'flex', flexDirection: 'column', gap: compact ? 1 : 1.25, overflow: 'hidden', minWidth: 0 }}>
          {error && <Alert severity="warning" onClose={() => setError('')}>{error}</Alert>}

          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gap: compact ? 0.75 : 1,
              gridTemplateColumns: remoteList.length > 1 ? { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' } : '1fr',
              gridAutoRows: remoteList.length > 1 ? 'minmax(132px, 1fr)' : 'minmax(180px, 1fr)',
              alignContent: 'stretch',
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
                audioEnabled={peer.audioEnabled !== false}
                videoEnabled={peer.videoEnabled !== false}
                screenSharing={!!peer.screenSharing}
                compact={compact}
              />
            ))}
          </Box>

          <Paper elevation={0} sx={{ borderRadius: 2, border: `1px solid ${theme.palette.divider}`, p: compact ? 0.75 : 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75, flexWrap: 'wrap', bgcolor: 'background.paper' }}>
            <Stack direction="row" spacing={0.5}>
              <Tooltip title={audioEnabled ? '마이크 끄기' : '마이크 켜기'}>
                <span>
                  <IconButton size={compact ? 'small' : 'medium'} disabled={!active} onClick={toggleAudio} color={audioEnabled ? 'default' : 'error'}>
                    {audioEnabled ? <MicIcon fontSize={compact ? 'small' : 'medium'} /> : <MicOffIcon fontSize={compact ? 'small' : 'medium'} />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={screenSharing ? '화면공유 중에는 카메라 전환이 잠깐 고정됩니다.' : (videoEnabled ? '카메라 끄기' : '카메라 켜기')}>
                <span>
                  <IconButton size={compact ? 'small' : 'medium'} disabled={!active || screenSharing} onClick={toggleVideo} color={videoEnabled ? 'default' : 'error'}>
                    {videoEnabled ? <VideocamIcon fontSize={compact ? 'small' : 'medium'} /> : <VideocamOffIcon fontSize={compact ? 'small' : 'medium'} />}
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={screenSharing ? '화면공유 중지' : '화면공유'}>
                <span>
                  <IconButton size={compact ? 'small' : 'medium'} disabled={!active && joining} onClick={screenSharing ? stopScreenShare : startScreenShare} color={screenSharing ? 'info' : 'default'}>
                    {screenSharing ? <StopScreenShareIcon fontSize={compact ? 'small' : 'medium'} /> : <PresentToAllIcon fontSize={compact ? 'small' : 'medium'} />}
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>

            <Stack direction="row" spacing={0.75} sx={{ flex: 1, justifyContent: { xs: 'flex-start', sm: 'center' }, minWidth: veryCompact ? '100%' : 220, order: { xs: 3, sm: 0 } }}>
              {!active && (
                <>
                  <Button size={compact ? 'small' : 'medium'} variant="contained" startIcon={<VideocamIcon />} onClick={startMeeting} disabled={joining}>
                    회의 시작
                  </Button>
                  <TextField
                    size="small"
                    placeholder="회의 코드"
                    value={joinCode}
                    onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
                    sx={{ maxWidth: veryCompact ? 118 : 150 }}
                  />
                  <Button size={compact ? 'small' : 'medium'} variant="outlined" onClick={joinTypedMeeting} disabled={joining}>
                    참가
                  </Button>
                </>
              )}
            </Stack>

            <Button size={compact ? 'small' : 'medium'} color="error" variant="outlined" startIcon={<CallEndIcon />} onClick={leaveMeeting} disabled={!active && !joining}>
              {veryCompact ? '나가기' : '종료'}
            </Button>
          </Paper>
        </Box>

        <Box sx={{ borderLeft: { lg: `1px solid ${theme.palette.divider}` }, borderTop: { xs: `1px solid ${theme.palette.divider}`, lg: 'none' }, p: compact ? 1 : 1.5, overflow: 'auto', bgcolor: 'background.paper', maxHeight: { xs: veryCompact ? 132 : 190, lg: 'none' } }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900, lineHeight: 1 }}>Invite</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, mb: compact ? 1 : 1.5 }}>
            <TextField size="small" value={inviteLink} fullWidth InputProps={{ readOnly: true }} />
            <IconButton onClick={copyInvite} aria-label="초대 링크 복사"><ContentCopyIcon fontSize="small" /></IconButton>
          </Box>

          <Divider sx={{ my: compact ? 1 : 1.5 }} />

          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900 }}>Participants</Typography>
          <Stack spacing={0.75} sx={{ mt: 0.75 }}>
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
