import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import PresentToAllIcon from '@mui/icons-material/PresentToAll';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import { alpha, useTheme } from '@mui/material/styles';
import socket from '../socket';

const makeRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const normalizeRoomCode = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

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

      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        sx={{
          position: 'absolute',
          left: 10,
          right: 10,
          bottom: 10,
          minWidth: 0
        }}
      >
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

const MeetingApp = () => {
  const theme = useTheme();
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user')) || {};
    } catch (err) {
      return {};
    }
  }, []);

  const queryRoom = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return normalizeRoomCode(params.get('meeting'));
  }, []);

  const [roomCode, setRoomCode] = useState(() => queryRoom || makeRoomCode());
  const [joinCode, setJoinCode] = useState(queryRoom || '');
  const [active, setActive] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [localStream, setLocalStream] = useState(null);
  const [displayStream, setDisplayStream] = useState(null);
  const [remotePeers, setRemotePeers] = useState({});
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);

  const peersRef = useRef(new Map());
  const pendingIceRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const cameraVideoTrackRef = useRef(null);
  const roomCodeRef = useRef(roomCode);
  const activeRef = useRef(false);
  const joinedRef = useRef(false);

  const inviteLink = `${window.location.origin}/platform?meeting=${roomCode}`;
  const displayName = currentUser.displayName || currentUser.nickname || currentUser.username || currentUser.loginId || '나';

  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  const participantPayload = useCallback(() => ({
    userUid: currentUser.userUid,
    loginId: currentUser.loginId || currentUser.id,
    username: currentUser.username || currentUser.loginId || currentUser.id,
    displayName,
    audioEnabled,
    videoEnabled,
    screenSharing
  }), [audioEnabled, currentUser, displayName, screenSharing, videoEnabled]);

  const emitMediaState = useCallback((next = {}) => {
    socket.emit('meeting:media-state', {
      roomId: roomCodeRef.current,
      audioEnabled,
      videoEnabled,
      screenSharing,
      ...next
    });
  }, [audioEnabled, screenSharing, videoEnabled]);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch (err) {
      window.prompt('초대 링크를 복사하세요.', inviteLink);
    }
  };

  const getLocalMedia = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 브라우저는 카메라/마이크 접근을 지원하지 않습니다.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStreamRef.current = stream;
    cameraVideoTrackRef.current = stream.getVideoTracks()[0] || null;
    setLocalStream(stream);
    setAudioEnabled(true);
    setVideoEnabled(true);
    return stream;
  }, []);

  const updateRemotePeer = useCallback((socketId, updater) => {
    setRemotePeers((prev) => {
      const current = prev[socketId] || { socketId };
      return { ...prev, [socketId]: { ...current, ...updater(current) } };
    });
  }, []);

  const removePeer = useCallback((socketId) => {
    const peer = peersRef.current.get(socketId);
    if (peer) peer.close();
    peersRef.current.delete(socketId);
    pendingIceRef.current.delete(socketId);
    setRemotePeers((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  }, []);

  const createPeerConnection = useCallback((targetSocketId, participant = {}) => {
    const existing = peersRef.current.get(targetSocketId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const stream = localStreamRef.current;

    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit('meeting:signal', {
        roomId: roomCodeRef.current,
        targetSocketId,
        signal: { type: 'ice', candidate: event.candidate }
      });
    };

    pc.ontrack = (event) => {
      const [remoteStream] = event.streams;
      updateRemotePeer(targetSocketId, () => ({
        ...participant,
        socketId: targetSocketId,
        stream: remoteStream
      }));
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        updateRemotePeer(targetSocketId, () => ({ connectionState: pc.connectionState }));
      }
    };

    peersRef.current.set(targetSocketId, pc);
    updateRemotePeer(targetSocketId, () => ({
      ...participant,
      socketId: targetSocketId,
      audioEnabled: participant.audioEnabled !== false,
      videoEnabled: participant.videoEnabled !== false,
      screenSharing: !!participant.screenSharing
    }));
    return pc;
  }, [updateRemotePeer]);

  const flushPendingIce = useCallback(async (socketId, pc) => {
    const pending = pendingIceRef.current.get(socketId) || [];
    pendingIceRef.current.delete(socketId);
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('ICE candidate apply failed', err);
      }
    }
  }, []);

  const createOfferForPeer = useCallback(async (participant) => {
    if (!participant?.socketId || !localStreamRef.current) return;
    const pc = createPeerConnection(participant.socketId, participant);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('meeting:signal', {
      roomId: roomCodeRef.current,
      targetSocketId: participant.socketId,
      signal: pc.localDescription
    });
  }, [createPeerConnection]);

  const leaveMeeting = useCallback(() => {
    socket.emit('meeting:leave', { roomId: roomCodeRef.current });
    joinedRef.current = false;
    activeRef.current = false;
    setActive(false);
    setJoining(false);
    setRemotePeers({});
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    pendingIceRef.current.clear();

    if (displayStream) {
      displayStream.getTracks().forEach((track) => track.stop());
      setDisplayStream(null);
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      cameraVideoTrackRef.current = null;
      setLocalStream(null);
    }

    setScreenSharing(false);
  }, [displayStream]);

  const joinMeeting = useCallback(async (requestedCode = roomCode) => {
    const nextRoomCode = normalizeRoomCode(requestedCode);
    if (!nextRoomCode) return;

    try {
      setError('');
      setJoining(true);
      setRoomCode(nextRoomCode);
      roomCodeRef.current = nextRoomCode;
      await getLocalMedia();
      activeRef.current = true;
      joinedRef.current = true;
      setActive(true);
      socket.emit('meeting:join', {
        roomId: nextRoomCode,
        user: participantPayload()
      });
    } catch (err) {
      setError(err.message || '회의를 시작할 수 없습니다.');
      leaveMeeting();
    } finally {
      setJoining(false);
    }
  }, [getLocalMedia, leaveMeeting, participantPayload, roomCode]);

  const startMeeting = () => {
    const nextRoomCode = normalizeRoomCode(roomCode) || makeRoomCode();
    joinMeeting(nextRoomCode);
  };

  const joinTypedMeeting = () => {
    joinMeeting(joinCode || roomCode);
  };

  const toggleAudio = () => {
    const next = !audioEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setAudioEnabled(next);
    emitMediaState({ audioEnabled: next });
  };

  const toggleVideo = () => {
    if (screenSharing) return;
    const next = !videoEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setVideoEnabled(next);
    emitMediaState({ videoEnabled: next });
  };

  const stopScreenShare = useCallback(async () => {
    const cameraTrack = cameraVideoTrackRef.current;
    peersRef.current.forEach((peer) => {
      const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
      if (sender && cameraTrack) sender.replaceTrack(cameraTrack);
    });
    if (displayStream) {
      displayStream.getTracks().forEach((track) => track.stop());
      setDisplayStream(null);
    }
    setScreenSharing(false);
    setVideoEnabled(cameraTrack?.enabled !== false);
    emitMediaState({ screenSharing: false, videoEnabled: cameraTrack?.enabled !== false });
  }, [displayStream, emitMediaState]);

  const startScreenShare = async () => {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('이 브라우저는 화면공유를 지원하지 않습니다.');
      }
      if (!active) await joinMeeting(roomCode);

      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = stream.getVideoTracks()[0];
      if (!screenTrack) return;

      peersRef.current.forEach((peer) => {
        const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });

      screenTrack.onended = () => {
        stopScreenShare();
      };

      setDisplayStream(stream);
      setScreenSharing(true);
      setVideoEnabled(true);
      emitMediaState({ screenSharing: true, videoEnabled: true });
    } catch (err) {
      setError(err.message || '화면공유를 시작할 수 없습니다.');
    }
  };

  useEffect(() => {
    const handleParticipants = ({ roomId, participants = [] }) => {
      if (roomId !== roomCodeRef.current || !activeRef.current) return;
      participants.forEach((participant) => {
        createOfferForPeer(participant);
      });
    };

    const handlePeerJoined = ({ roomId, participant }) => {
      if (roomId !== roomCodeRef.current || !activeRef.current) return;
      if (participant?.socketId) {
        updateRemotePeer(participant.socketId, () => participant);
      }
    };

    const handleSignal = async ({ roomId, fromSocketId, signal }) => {
      if (roomId !== roomCodeRef.current || !activeRef.current || !signal || !fromSocketId) return;

      try {
        const pc = createPeerConnection(fromSocketId);

        if (signal.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          await flushPendingIce(fromSocketId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('meeting:signal', {
            roomId,
            targetSocketId: fromSocketId,
            signal: pc.localDescription
          });
        } else if (signal.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          await flushPendingIce(fromSocketId, pc);
        } else if (signal.type === 'ice' && signal.candidate) {
          const candidate = new RTCIceCandidate(signal.candidate);
          if (pc.remoteDescription) {
            await pc.addIceCandidate(candidate);
          } else {
            const pending = pendingIceRef.current.get(fromSocketId) || [];
            pending.push(candidate);
            pendingIceRef.current.set(fromSocketId, pending);
          }
        }
      } catch (err) {
        console.warn('Meeting signal failed', err);
      }
    };

    const handlePeerLeft = ({ socketId }) => removePeer(socketId);
    const handleMediaState = ({ participant }) => {
      if (!participant?.socketId) return;
      updateRemotePeer(participant.socketId, () => participant);
    };
    const handleError = ({ message }) => setError(message || '회의 연결 중 오류가 발생했습니다.');

    socket.on('meeting:participants', handleParticipants);
    socket.on('meeting:peer-joined', handlePeerJoined);
    socket.on('meeting:signal', handleSignal);
    socket.on('meeting:peer-left', handlePeerLeft);
    socket.on('meeting:peer-media-state', handleMediaState);
    socket.on('meeting:error', handleError);

    return () => {
      socket.off('meeting:participants', handleParticipants);
      socket.off('meeting:peer-joined', handlePeerJoined);
      socket.off('meeting:signal', handleSignal);
      socket.off('meeting:peer-left', handlePeerLeft);
      socket.off('meeting:peer-media-state', handleMediaState);
      socket.off('meeting:error', handleError);
    };
  }, [createOfferForPeer, createPeerConnection, flushPendingIce, removePeer, updateRemotePeer]);

  useEffect(() => () => {
    if (joinedRef.current) {
      socket.emit('meeting:leave', { roomId: roomCodeRef.current });
    }
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const remoteList = Object.values(remotePeers);
  const previewStream = displayStream || localStream;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
      <Box sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
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
          <Chip size="small" color={active ? 'success' : 'default'} label={active ? `${remoteList.length + 1}명 연결` : '대기'} />
          {screenSharing && <Chip size="small" color="info" label="화면공유" />}
        </Stack>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 280px' }, overflow: 'hidden' }}>
        <Box sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5, overflow: 'hidden' }}>
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

          <Paper
            elevation={0}
            sx={{
              borderRadius: 2,
              border: `1px solid ${theme.palette.divider}`,
              p: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
              flexWrap: 'wrap'
            }}
          >
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
