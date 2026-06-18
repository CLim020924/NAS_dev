import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import socket from '../socket';

export const makeRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
export const normalizeRoomCode = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const MeetingContext = createContext(null);

export const MeetingProvider = ({ children }) => {
  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user')) || {};
    } catch (err) {
      return {};
    }
  }, []);

  const [roomCode, setRoomCodeState] = useState(() => makeRoomCode());
  const [joinCode, setJoinCode] = useState('');
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

  const displayName = currentUser.displayName || currentUser.nickname || currentUser.username || currentUser.loginId || '나';

  const setRoomCode = useCallback((value) => {
    const normalized = normalizeRoomCode(value);
    if (!normalized) return;
    setRoomCodeState(normalized);
    setJoinCode(normalized);
    roomCodeRef.current = normalized;
  }, []);

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

  const joinMeeting = useCallback(async (requestedCode = roomCodeRef.current) => {
    const nextRoomCode = normalizeRoomCode(requestedCode);
    if (!nextRoomCode) return;

    try {
      setError('');
      setJoining(true);
      setRoomCodeState(nextRoomCode);
      setJoinCode(nextRoomCode);
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
  }, [getLocalMedia, leaveMeeting, participantPayload]);

  const startMeeting = useCallback(() => {
    const nextRoomCode = normalizeRoomCode(roomCodeRef.current) || makeRoomCode();
    joinMeeting(nextRoomCode);
  }, [joinMeeting]);

  const joinTypedMeeting = useCallback(() => {
    joinMeeting(joinCode || roomCodeRef.current);
  }, [joinCode, joinMeeting]);

  const toggleAudio = useCallback(() => {
    const next = !audioEnabled;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setAudioEnabled(next);
    emitMediaState({ audioEnabled: next });
  }, [audioEnabled, emitMediaState]);

  const toggleVideo = useCallback(() => {
    if (screenSharing) return;
    const next = !videoEnabled;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setVideoEnabled(next);
    emitMediaState({ videoEnabled: next });
  }, [emitMediaState, screenSharing, videoEnabled]);

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

  const startScreenShare = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('이 브라우저는 화면공유를 지원하지 않습니다.');
      }
      if (!activeRef.current) await joinMeeting(roomCodeRef.current);

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
  }, [emitMediaState, joinMeeting, stopScreenShare]);

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

  const value = useMemo(() => ({
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
    currentUser,
    displayName,
    startMeeting,
    joinMeeting,
    joinTypedMeeting,
    leaveMeeting,
    toggleAudio,
    toggleVideo,
    startScreenShare,
    stopScreenShare
  }), [
    active, audioEnabled, currentUser, displayName, displayStream, error, joinCode, joining, joinMeeting,
    joinTypedMeeting, leaveMeeting, localStream, remotePeers, roomCode, screenSharing, setRoomCode,
    startMeeting, startScreenShare, stopScreenShare, toggleAudio, toggleVideo, videoEnabled
  ]);

  return (
    <MeetingContext.Provider value={value}>
      {children}
    </MeetingContext.Provider>
  );
};

export const useMeetingSession = () => {
  const context = useContext(MeetingContext);
  if (!context) throw new Error('useMeetingSession must be used within MeetingProvider');
  return context;
};
