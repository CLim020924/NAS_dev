import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import socket from '../socket';

export const makeRoomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
export const normalizeRoomCode = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const MeetingContext = createContext(null);
const GUEST_STORAGE_KEY = 'nas_meeting_guest';
const GUEST_DEVICE_KEY = 'nas_meeting_guest_device_id';
const GUEST_PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

const getGuestDeviceId = () => {
  const existing = localStorage.getItem(GUEST_DEVICE_KEY);
  if (existing) return existing;
  const created = `guest_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
  localStorage.setItem(GUEST_DEVICE_KEY, created);
  return created;
};

const readGuestProfile = () => {
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY) || sessionStorage.getItem(GUEST_STORAGE_KEY);
    const profile = raw ? JSON.parse(raw) : null;
    const savedAt = new Date(profile?.updatedAt || profile?.createdAt || 0).getTime();
    if (profile && (!savedAt || Date.now() - savedAt > GUEST_PROFILE_TTL_MS)) {
      localStorage.removeItem(GUEST_STORAGE_KEY);
      sessionStorage.removeItem(GUEST_STORAGE_KEY);
      return null;
    }
    if (profile?.guestId && !localStorage.getItem(GUEST_DEVICE_KEY)) {
      localStorage.setItem(GUEST_DEVICE_KEY, profile.guestId);
    }
    if (profile) localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(profile));
    return profile;
  } catch (err) {
    return null;
  }
};

const normalizeGuestName = (value) => String(value || '').trim().slice(0, 32);

const ensureSocketConnected = (timeoutMs = 10000) => new Promise((resolve, reject) => {
  if (socket.connected) {
    resolve();
    return;
  }

  let settled = false;
  const cleanup = () => {
    socket.off('connect', handleConnect);
    socket.off('connect_error', handleError);
    clearTimeout(timer);
  };
  const finish = (callback) => {
    if (settled) return;
    settled = true;
    cleanup();
    callback();
  };
  const handleConnect = () => finish(resolve);
  const handleError = (err) => finish(() => reject(err || new Error('회의 서버에 연결할 수 없습니다.')));
  const timer = setTimeout(() => {
    finish(() => reject(new Error('회의 서버 연결이 지연되고 있습니다.')));
  }, timeoutMs);

  socket.on('connect', handleConnect);
  socket.on('connect_error', handleError);
  if (!socket.active) socket.connect();
});

const emitWithAck = (event, payload, timeoutMs = 5000) => new Promise((resolve, reject) => {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    reject(new Error('\ud68c\uc758 \uc11c\ubc84 \uc751\ub2f5\uc774 \uc9c0\uc5f0\ub418\uace0 \uc788\uc2b5\ub2c8\ub2e4.'));
  }, timeoutMs);

  socket.emit(event, payload, (response) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (response?.success === false) {
      reject(new Error(response.message || '\ud68c\uc758 \uc694\uccad\uc744 \ucc98\ub9ac\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.'));
      return;
    }
    resolve(response || {});
  });
});

export const MeetingProvider = ({ children }) => {
  const [guestProfile, setGuestProfileState] = useState(() => readGuestProfile());
  const readSignedInUser = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem('user')) || {};
    } catch (err) {
      return {};
    }
  }, []);
  const [signedInUser, setSignedInUser] = useState(() => readSignedInUser());

  const [roomCode, setRoomCodeState] = useState(() => makeRoomCode());
  const [joinCode, setJoinCode] = useState('');
  const [active, setActive] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [roomEnded, setRoomEnded] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [displayStream, setDisplayStream] = useState(null);
  const [remotePeers, setRemotePeers] = useState({});
  const [participants, setParticipants] = useState([]);
  const [hostSocketId, setHostSocketId] = useState('');
  const [roomTitle, setRoomTitle] = useState('화상회의');
  const [roomAccessPolicy, setRoomAccessPolicy] = useState({ mode: 'private', searchable: false, entryMode: 'direct', passwordEnabled: false });
  const [hostDisplayName, setHostDisplayName] = useState('');
  const [meetingMessages, setMeetingMessages] = useState([]);
  const [chatSending, setChatSending] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [mediaDevices, setMediaDevices] = useState({
    microphones: [],
    cameras: [],
    speakers: []
  });
  const [selectedAudioInputId, setSelectedAudioInputId] = useState('');
  const [selectedVideoInputId, setSelectedVideoInputId] = useState('');
  const [selectedAudioOutputId, setSelectedAudioOutputId] = useState('');
  const [meetingOverview, setMeetingOverview] = useState({
    activeMeetings: [],
    conversationMeetings: []
  });
  const [overviewLoading, setOverviewLoading] = useState(false);

  const peersRef = useRef(new Map());
  const pendingIceRef = useRef(new Map());
  const screenPeersRef = useRef(new Map());
  const pendingScreenIceRef = useRef(new Map());
  const screenOfferTimersRef = useRef(new Set());
  const peerRecoveryTimersRef = useRef(new Map());
  const localStreamRef = useRef(null);
  const displayStreamRef = useRef(null);
  const cameraVideoTrackRef = useRef(null);
  const mediaDevicesRef = useRef({ microphones: [], cameras: [], speakers: [] });
  const lastVideoStoppedAtRef = useRef(0);
  const roomCodeRef = useRef(roomCode);
  const activeRef = useRef(false);
  const joinedRef = useRef(false);
  const reconnectingRef = useRef(false);
  const audioEnabledRef = useRef(audioEnabled);
  const videoEnabledRef = useRef(videoEnabled);
  const selectedAudioInputIdRef = useRef('');
  const selectedVideoInputIdRef = useRef('');

  const refreshMediaDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setMediaDevices({ microphones: [], cameras: [], speakers: [] });
      return { microphones: [], cameras: [], speakers: [] };
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const nextDevices = {
        microphones: devices.filter((device) => device.kind === 'audioinput'),
        cameras: devices.filter((device) => device.kind === 'videoinput'),
        speakers: devices.filter((device) => device.kind === 'audiooutput')
      };
      mediaDevicesRef.current = nextDevices;
      setMediaDevices(nextDevices);
      return nextDevices;
    } catch (err) {
      const emptyDevices = { microphones: [], cameras: [], speakers: [] };
      mediaDevicesRef.current = emptyDevices;
      setMediaDevices(emptyDevices);
      return emptyDevices;
    }
  }, []);

  useEffect(() => {
    refreshMediaDevices();
    if (!navigator.mediaDevices?.addEventListener) return undefined;
    navigator.mediaDevices.addEventListener('devicechange', refreshMediaDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshMediaDevices);
  }, [refreshMediaDevices]);

  useEffect(() => {
    selectedAudioInputIdRef.current = selectedAudioInputId;
  }, [selectedAudioInputId]);

  useEffect(() => {
    selectedVideoInputIdRef.current = selectedVideoInputId;
  }, [selectedVideoInputId]);

  useEffect(() => {
    audioEnabledRef.current = audioEnabled;
  }, [audioEnabled]);

  useEffect(() => {
    videoEnabledRef.current = videoEnabled;
  }, [videoEnabled]);

  useEffect(() => {
    const refreshSignedInUser = () => setSignedInUser(readSignedInUser());
    window.addEventListener('storage', refreshSignedInUser);
    window.addEventListener('nas:user-updated', refreshSignedInUser);
    return () => {
      window.removeEventListener('storage', refreshSignedInUser);
      window.removeEventListener('nas:user-updated', refreshSignedInUser);
    };
  }, [readSignedInUser]);

  const currentUser = useMemo(() => {
    if (signedInUser?.userUid || signedInUser?.loginId || signedInUser?.username) return signedInUser;
    if (!guestProfile?.nickname) return {};
    return {
      userUid: guestProfile.guestId,
      loginId: guestProfile.guestId,
      username: guestProfile.nickname,
      displayName: `(guest) ${guestProfile.nickname}`,
      role: 'GUEST',
      isGuest: true
    };
  }, [guestProfile, signedInUser]);

  const displayName = currentUser.displayName || currentUser.nickname || currentUser.username || currentUser.loginId || '나';

  useEffect(() => {
    if (currentUser?.isGuest || (!currentUser?.userUid && !currentUser?.loginId)) return undefined;
    let cancelled = false;
    const refresh = async () => {
      if (cancelled) return;
      try {
        setOverviewLoading(true);
        const res = await axios.get('/api/meetings/overview/current', { withCredentials: true });
        if (cancelled) return;
        setMeetingOverview({
          activeMeetings: Array.isArray(res.data?.activeMeetings) ? res.data.activeMeetings : [],
          conversationMeetings: Array.isArray(res.data?.conversationMeetings) ? res.data.conversationMeetings : []
        });
      } catch (err) {
        if (!cancelled) setMeetingOverview({ activeMeetings: [], conversationMeetings: [] });
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentUser]);

  const setGuestProfile = useCallback((nickname) => {
    const safeName = normalizeGuestName(nickname);
    if (!safeName) return null;
    const profile = {
      guestId: getGuestDeviceId(),
      nickname: safeName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    sessionStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(profile));
    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(profile));
    setGuestProfileState(profile);
    return profile;
  }, []);

  const clearGuestProfile = useCallback(() => {
    sessionStorage.removeItem(GUEST_STORAGE_KEY);
    localStorage.removeItem(GUEST_STORAGE_KEY);
    setGuestProfileState(null);
  }, []);

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

  const participantPayload = useCallback((mediaState = {}) => ({
    userUid: currentUser.userUid,
    sessionId: currentUser.currentSessionId || currentUser.sessionId || currentUser.activeSessionId || currentUser.tokenId || '',
    loginId: currentUser.loginId || currentUser.id,
    username: currentUser.username || currentUser.loginId || currentUser.id,
    displayName,
    audioEnabled: mediaState.audioEnabled ?? audioEnabled,
    videoEnabled: mediaState.videoEnabled ?? videoEnabled,
    screenSharing,
    isGuest: !!currentUser.isGuest,
    role: currentUser.role
  }), [audioEnabled, currentUser, displayName, screenSharing, videoEnabled]);

  const applyRoomState = useCallback((room = {}) => {
    const normalized = normalizeRoomCode(room.roomId);
    if (normalized && normalized !== roomCodeRef.current) return;
    const nextParticipants = Array.isArray(room.participants) ? room.participants : [];
    const activeParticipants = nextParticipants.filter((participant) => !participant?.lobbyOnly && !participant?.temporarilyDisconnected);
    const participantBySocketId = new Map(activeParticipants.map((participant) => [participant.socketId, participant]));
    const activeSocketIds = new Set(activeParticipants.map((participant) => participant.socketId).filter(Boolean));
    activeSocketIds.delete(socket.id);

    peersRef.current.forEach((peer, socketId) => {
      if (!activeSocketIds.has(socketId)) {
        peer.close();
        peersRef.current.delete(socketId);
        pendingIceRef.current.delete(socketId);
      }
    });
    screenPeersRef.current.forEach((peer, socketId) => {
      if (!activeSocketIds.has(socketId)) {
        peer.close();
        screenPeersRef.current.delete(socketId);
        pendingScreenIceRef.current.delete(socketId);
      }
    });
    setRemotePeers((prev) => Object.fromEntries(
      Object.entries(prev)
        .filter(([socketId]) => activeSocketIds.has(socketId))
        .map(([socketId, peer]) => [socketId, { ...peer, ...(participantBySocketId.get(socketId) || {}) }])
    ));
    setParticipants(nextParticipants);
    setHostSocketId(room.hostSocketId || '');
    setRoomTitle(room.title || (room.conversationId ? '채팅방 회의' : '화상회의'));
    setRoomAccessPolicy(room.accessPolicy || { mode: 'private', searchable: false, entryMode: 'direct', passwordEnabled: false });
    setHostDisplayName(room.hostDisplayName || '');
    setRoomEnded(false);
  }, []);

  const emitMediaState = useCallback((next = {}) => {
    socket.emit('meeting:media-state', {
      roomId: roomCodeRef.current,
      audioEnabled,
      videoEnabled,
      screenSharing,
      ...next
    });
  }, [audioEnabled, screenSharing, videoEnabled]);

  const requestMeetingResync = useCallback((delayMs = 250) => {
    if (!activeRef.current || !joinedRef.current) return;
    window.setTimeout(() => {
      if (!activeRef.current || !joinedRef.current || !socket.connected) return;
      socket.emit('meeting:resync', { roomId: roomCodeRef.current });
    }, delayMs);
  }, []);

  const transferHost = useCallback(async (targetSocketId) => {
    try {
      await emitWithAck('meeting:transfer-host', { roomId: roomCodeRef.current, targetSocketId });
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  const kickParticipant = useCallback(async (targetSocketId) => {
    try {
      await emitWithAck('meeting:kick', { roomId: roomCodeRef.current, targetSocketId });
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }, []);

  const registerCameraTrack = useCallback((track) => {
    cameraVideoTrackRef.current = track || null;
    if (!track) return;

    track.onended = () => {
      if (cameraVideoTrackRef.current !== track) return;
      cameraVideoTrackRef.current = null;
      setVideoEnabled(false);
      emitMediaState({ videoEnabled: false });
    };
  }, [emitMediaState]);

  const audioConstraint = useCallback((deviceId = selectedAudioInputIdRef.current) => (
    deviceId ? { deviceId: { exact: deviceId } } : true
  ), []);

  const videoConstraint = useCallback((deviceId = selectedVideoInputIdRef.current) => (
    deviceId ? { deviceId: { exact: deviceId } } : true
  ), []);

  const acquireVideoTrack = useCallback(async (deviceId = selectedVideoInputIdRef.current) => {
    const sinceStopped = Date.now() - lastVideoStoppedAtRef.current;
    if (lastVideoStoppedAtRef.current && sinceStopped < 350) {
      await new Promise((resolve) => window.setTimeout(resolve, 350 - sinceStopped));
    }

    let preferredDeviceId = deviceId || selectedVideoInputIdRef.current || '';
    if (!preferredDeviceId) {
      const devices = mediaDevicesRef.current?.cameras?.length
        ? mediaDevicesRef.current
        : await refreshMediaDevices();
      preferredDeviceId = devices.cameras?.find((device) => device.deviceId)?.deviceId || '';
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraint(preferredDeviceId) });
      const track = stream.getVideoTracks()[0] || null;
      if (track) {
        const actualDeviceId = track.getSettings?.().deviceId || preferredDeviceId || '';
        if (actualDeviceId) {
          setSelectedVideoInputId(actualDeviceId);
          selectedVideoInputIdRef.current = actualDeviceId;
        }
        return { stream, track };
      }
      stream.getTracks().forEach((item) => item.stop());
    } catch (err) {
      if (!preferredDeviceId) throw err;
    }

    const fallbackStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    const fallbackTrack = fallbackStream.getVideoTracks()[0] || null;
    if (!fallbackTrack) throw new Error('NO_CAMERA_TRACK');
    const fallbackDeviceId = fallbackTrack.getSettings?.().deviceId || '';
    setSelectedVideoInputId(fallbackDeviceId);
    selectedVideoInputIdRef.current = fallbackDeviceId;
    return { stream: fallbackStream, track: fallbackTrack };
  }, [refreshMediaDevices, videoConstraint]);

  const getLocalMedia = useCallback(async (preferences = {}) => {
    const wantsAudio = preferences.audioEnabled !== false;
    const wantsVideo = preferences.videoEnabled !== false;
    if (localStreamRef.current) {
      const stream = localStreamRef.current;
      const currentAudioTracks = stream.getAudioTracks();
      const currentVideoTracks = stream.getVideoTracks();
      let audioTrack = currentAudioTracks.find((track) => track.readyState === 'live') || null;
      let videoTrack = currentVideoTracks.find((track) => track.readyState === 'live') || null;

      if (!wantsAudio) {
        currentAudioTracks.forEach((track) => {
          stream.removeTrack(track);
          if (track.readyState === 'live') track.stop();
        });
        audioTrack = null;
      } else if (!audioTrack && navigator.mediaDevices?.getUserMedia) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint(), video: false });
          audioTrack = audioStream.getAudioTracks()[0] || null;
          if (audioTrack) stream.addTrack(audioTrack);
        } catch (err) {
          audioTrack = null;
        }
      }

      if (!wantsVideo) {
        currentVideoTracks.forEach((track) => {
          stream.removeTrack(track);
          if (track.readyState === 'live') track.stop();
        });
        lastVideoStoppedAtRef.current = Date.now();
        videoTrack = null;
        registerCameraTrack(null);
      } else if (!videoTrack && navigator.mediaDevices?.getUserMedia) {
        try {
          const videoResult = await acquireVideoTrack();
          videoTrack = videoResult.track;
          if (videoTrack) stream.addTrack(videoTrack);
        } catch (err) {
          videoTrack = null;
        }
        registerCameraTrack(videoTrack);
      } else {
        registerCameraTrack(videoTrack);
      }

      if (audioTrack) audioTrack.enabled = wantsAudio;
      if (videoTrack) videoTrack.enabled = wantsVideo;
      const nextStream = new MediaStream([
        ...stream.getAudioTracks().filter((track) => track.readyState === 'live'),
        ...stream.getVideoTracks().filter((track) => track.readyState === 'live')
      ]);
      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      setAudioEnabled(!!audioTrack && wantsAudio);
      setVideoEnabled(!!videoTrack && wantsVideo);
      return {
        stream: nextStream,
        audioEnabled: !!audioTrack && wantsAudio,
        videoEnabled: !!videoTrack && wantsVideo
      };
    }

    let stream = null;
    let warning = '';

    if (!wantsAudio && !wantsVideo) {
      stream = new MediaStream();
    } else if (navigator.mediaDevices?.getUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: wantsVideo ? videoConstraint() : false,
          audio: wantsAudio ? audioConstraint() : false
        });
      } catch (deviceError) {
        if (wantsAudio && wantsVideo) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: audioConstraint() });
            warning = '\uce74\uba54\ub77c\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc5b4 \uc74c\uc131\ub9cc \ucf1c\uc9c4 \uc0c1\ud0dc\ub85c \ud68c\uc758\uc5d0 \ucc38\uac00\ud569\ub2c8\ub2e4.';
          } catch (audioError) {
            try {
              const videoResult = await acquireVideoTrack();
              stream = videoResult.stream;
              warning = '\ub9c8\uc774\ud06c\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc5b4 \uce74\uba54\ub77c\ub9cc \ucf1c\uc9c4 \uc0c1\ud0dc\ub85c \ud68c\uc758\uc5d0 \ucc38\uac00\ud569\ub2c8\ub2e4.';
            } catch (videoError) {
              stream = new MediaStream();
            }
          }
        } else {
          stream = new MediaStream();
        }
        if (!stream) stream = new MediaStream();
        if (!warning) warning = '\uc120\ud0dd\ud55c \ubbf8\ub514\uc5b4 \uc7a5\uce58\ub97c \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc5b4 \uaebc\uc9c4 \uc0c1\ud0dc\ub85c \ucc38\uac00\ud569\ub2c8\ub2e4.';
      }
    } else {
      stream = new MediaStream();
      warning = '\uc774 \ube0c\ub77c\uc6b0\uc800\uc5d0\uc11c \ubbf8\ub514\uc5b4 \uc7a5\uce58\ub97c \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc5b4 \ubbf8\ub514\uc5b4\ub97c \ub044\uace0 \ud68c\uc758\uc5d0 \ucc38\uac00\ud569\ub2c8\ub2e4.';
    }

    const audioTrack = stream.getAudioTracks()[0] || null;
    const videoTrack = stream.getVideoTracks()[0] || null;
    const initialVideoDeviceId = videoTrack?.getSettings?.().deviceId || '';
    if (initialVideoDeviceId) {
      setSelectedVideoInputId(initialVideoDeviceId);
      selectedVideoInputIdRef.current = initialVideoDeviceId;
    }
    const initialAudioDeviceId = audioTrack?.getSettings?.().deviceId || '';
    if (initialAudioDeviceId) {
      setSelectedAudioInputId(initialAudioDeviceId);
      selectedAudioInputIdRef.current = initialAudioDeviceId;
    }
    localStreamRef.current = stream;
    registerCameraTrack(videoTrack);
    setLocalStream(stream);
    setAudioEnabled(!!audioTrack);
    setVideoEnabled(!!videoTrack);
    if (warning) setError(warning);
    refreshMediaDevices();

    return {
      stream,
      audioEnabled: !!audioTrack,
      videoEnabled: !!videoTrack
    };
  }, [acquireVideoTrack, audioConstraint, refreshMediaDevices, registerCameraTrack, videoConstraint]);


  const updateRemotePeer = useCallback((socketId, updater) => {
    setRemotePeers((prev) => {
      const current = prev[socketId] || { socketId };
      return { ...prev, [socketId]: { ...current, ...updater(current) } };
    });
  }, []);

  const removePeer = useCallback((socketId) => {
    const recoveryTimer = peerRecoveryTimersRef.current.get(socketId);
    if (recoveryTimer) clearTimeout(recoveryTimer);
    peerRecoveryTimersRef.current.delete(socketId);
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

  const closeScreenPeer = useCallback((socketId) => {
    const peer = screenPeersRef.current.get(socketId);
    if (peer) peer.close();
    screenPeersRef.current.delete(socketId);
    pendingScreenIceRef.current.delete(socketId);
    updateRemotePeer(socketId, () => ({ screenStream: null }));
  }, [updateRemotePeer]);

  const createPeerConnection = useCallback((targetSocketId, participant = {}) => {
    const existing = peersRef.current.get(targetSocketId);
    if (existing) {
      if (['closed', 'failed', 'disconnected'].includes(existing.connectionState) || existing.signalingState === 'closed') {
        existing.close();
        peersRef.current.delete(targetSocketId);
        pendingIceRef.current.delete(targetSocketId);
      } else {
        return existing;
      }
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const cameraStream = localStreamRef.current;
    const audioTracks = cameraStream?.getAudioTracks() || [];
    const videoTracks = cameraStream?.getVideoTracks() || [];

    audioTracks.forEach((track) => pc.addTrack(track, cameraStream));
    videoTracks.forEach((track) => pc.addTrack(track, cameraStream));
    if (!audioTracks.length) {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    }
    if (!videoTracks.length) {
      pc.addTransceiver('video', { direction: 'sendrecv' });
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
      const receivedTrack = event.track;
      updateRemotePeer(targetSocketId, (current) => {
        const remoteStream = event.streams[0] || current.stream || new MediaStream();
        if (!event.streams[0] && !remoteStream.getTracks().some((track) => track.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }

        receivedTrack.onunmute = () => {
          updateRemotePeer(targetSocketId, (latest) => ({
            stream: new MediaStream((latest.stream || remoteStream).getTracks())
          }));
        };
        return {
          ...participant,
          socketId: targetSocketId,
          stream: remoteStream
        };
      });
    };

    const schedulePeerRecovery = () => {
      if (!activeRef.current || !joinedRef.current) return;
      if (peerRecoveryTimersRef.current.has(targetSocketId)) return;
      const timer = window.setTimeout(() => {
        peerRecoveryTimersRef.current.delete(targetSocketId);
        const current = peersRef.current.get(targetSocketId);
        if (!current || current !== pc) return;
        if (!['failed', 'disconnected'].includes(current.connectionState) && !['failed', 'disconnected'].includes(current.iceConnectionState)) return;
        current.close();
        peersRef.current.delete(targetSocketId);
        pendingIceRef.current.delete(targetSocketId);
        updateRemotePeer(targetSocketId, () => ({ connectionState: 'reconnecting', stream: null }));
        requestMeetingResync(0);
      }, pc.connectionState === 'failed' || pc.iceConnectionState === 'failed' ? 350 : 2500);
      peerRecoveryTimersRef.current.set(targetSocketId, timer);
    };

    const clearPeerRecovery = () => {
      const timer = peerRecoveryTimersRef.current.get(targetSocketId);
      if (timer) clearTimeout(timer);
      peerRecoveryTimersRef.current.delete(targetSocketId);
    };

    pc.onconnectionstatechange = () => {
      updateRemotePeer(targetSocketId, () => ({ connectionState: pc.connectionState }));
      if (['connected', 'completed'].includes(pc.connectionState)) clearPeerRecovery();
      if (['failed', 'disconnected'].includes(pc.connectionState)) schedulePeerRecovery();
    };

    pc.oniceconnectionstatechange = () => {
      updateRemotePeer(targetSocketId, () => ({ iceConnectionState: pc.iceConnectionState }));
      if (['connected', 'completed'].includes(pc.iceConnectionState)) clearPeerRecovery();
      if (['failed', 'disconnected'].includes(pc.iceConnectionState)) schedulePeerRecovery();
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
  }, [requestMeetingResync, updateRemotePeer]);

  const createScreenPeerConnection = useCallback((targetSocketId, sendScreen = false) => {
    const existing = screenPeersRef.current.get(targetSocketId);
    if (existing) {
      if (['closed', 'failed', 'disconnected'].includes(existing.connectionState) || existing.signalingState === 'closed') {
        existing.close();
        screenPeersRef.current.delete(targetSocketId);
        pendingScreenIceRef.current.delete(targetSocketId);
      } else {
        return existing;
      }
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const screenTrack = displayStreamRef.current?.getVideoTracks()?.[0] || null;
    if (sendScreen && screenTrack) {
      pc.addTrack(screenTrack, displayStreamRef.current);
    } else {
      pc.addTransceiver('video', { direction: 'recvonly' });
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      socket.emit('meeting:signal', {
        roomId: roomCodeRef.current,
        targetSocketId,
        signal: { channel: 'screen', type: 'ice', candidate: event.candidate }
      });
    };

    pc.ontrack = (event) => {
      const screenStream = event.streams[0] || new MediaStream([event.track]);
      updateRemotePeer(targetSocketId, () => ({ screenStream }));
      event.track.onunmute = () => {
        updateRemotePeer(targetSocketId, () => ({
          screenStream: new MediaStream(screenStream.getTracks())
        }));
      };
    };

    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState)) {
        closeScreenPeer(targetSocketId);
        if (sendScreen && displayStreamRef.current) requestMeetingResync(200);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(pc.iceConnectionState)) {
        closeScreenPeer(targetSocketId);
        if (sendScreen && displayStreamRef.current) requestMeetingResync(200);
      }
    };

    screenPeersRef.current.set(targetSocketId, pc);
    return pc;
  }, [closeScreenPeer, requestMeetingResync, updateRemotePeer]);

  const flushPendingScreenIce = useCallback(async (socketId, pc) => {
    const pending = pendingScreenIceRef.current.get(socketId) || [];
    pendingScreenIceRef.current.delete(socketId);
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        console.warn('Screen ICE candidate apply failed', err);
      }
    }
  }, []);

  const offerScreenToPeer = useCallback(async (targetSocketId) => {
    if (!targetSocketId || !displayStreamRef.current) return;
    closeScreenPeer(targetSocketId);
    const pc = createScreenPeerConnection(targetSocketId, true);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('meeting:signal', {
      roomId: roomCodeRef.current,
      targetSocketId,
      signal: { channel: 'screen', type: 'offer', sdp: offer.sdp }
    });
  }, [closeScreenPeer, createScreenPeerConnection]);

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
    if (!participant?.socketId) return;
    if (!localStreamRef.current) {
      localStreamRef.current = new MediaStream();
      setLocalStream(localStreamRef.current);
    }
    const pc = createPeerConnection(participant.socketId, participant);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('meeting:signal', {
      roomId: roomCodeRef.current,
      targetSocketId: participant.socketId,
      signal: pc.localDescription
    });
  }, [createPeerConnection]);

  const leaveMeeting = useCallback((options = {}) => {
    const { notify = true, clearRoom = false } = options;
    if (notify) socket.emit('meeting:leave', { roomId: roomCodeRef.current });
    joinedRef.current = false;
    activeRef.current = false;
    setActive(false);
    setJoining(false);
    setRemotePeers({});
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    pendingIceRef.current.clear();
    screenPeersRef.current.forEach((peer) => peer.close());
    screenPeersRef.current.clear();
    pendingScreenIceRef.current.clear();
    screenOfferTimersRef.current.forEach((timer) => clearTimeout(timer));
    screenOfferTimersRef.current.clear();
    peerRecoveryTimersRef.current.forEach((timer) => clearTimeout(timer));
    peerRecoveryTimersRef.current.clear();

    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => track.stop());
      displayStreamRef.current = null;
      setDisplayStream(null);
    }

    if (localStreamRef.current) {
      const stream = localStreamRef.current;
      localStreamRef.current = null;
      cameraVideoTrackRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }

    setScreenSharing(false);
    if (clearRoom) {
      setParticipants([]);
      setHostSocketId('');
      setRoomTitle('화상회의');
      setHostDisplayName('');
    }
  }, []);

  const endMeeting = useCallback(() => {
    const endingRoomCode = roomCodeRef.current;
    socket.emit('meeting:end', { roomId: endingRoomCode });
    setRoomEnded(false);
    setError('\ud68c\uc758\uac00 \uc885\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4.');
    leaveMeeting({ notify: false, clearRoom: true });
    const nextRoomCode = makeRoomCode();
    setRoomCodeState(nextRoomCode);
    setJoinCode(nextRoomCode);
    roomCodeRef.current = nextRoomCode;
  }, [leaveMeeting]);

  const loadMeetingOverview = useCallback(async () => {
    if (currentUser?.isGuest || (!currentUser?.userUid && !currentUser?.loginId)) {
      setMeetingOverview({ activeMeetings: [], conversationMeetings: [] });
      return { activeMeetings: [], conversationMeetings: [] };
    }

    try {
      setOverviewLoading(true);
      const res = await axios.get('/api/meetings/overview/current', { withCredentials: true });
      const nextOverview = {
        activeMeetings: Array.isArray(res.data?.activeMeetings) ? res.data.activeMeetings : [],
        conversationMeetings: Array.isArray(res.data?.conversationMeetings) ? res.data.conversationMeetings : []
      };
      setMeetingOverview(nextOverview);
      return nextOverview;
    } catch (err) {
      setMeetingOverview({ activeMeetings: [], conversationMeetings: [] });
      return { activeMeetings: [], conversationMeetings: [] };
    } finally {
      setOverviewLoading(false);
    }
  }, [currentUser]);

  const joinMeeting = useCallback(async (requestedCode = roomCodeRef.current, options = {}) => {
    const nextRoomCode = normalizeRoomCode(requestedCode);
    if (!nextRoomCode || joining) return false;

    try {
      setError('');
      setRoomEnded(false);
      setJoining(true);
      setRoomCodeState(nextRoomCode);
      setJoinCode(nextRoomCode);
      roomCodeRef.current = nextRoomCode;

      await ensureSocketConnected(12000);
      const mediaState = await getLocalMedia(options.mediaPreferences || {});
      const response = await emitWithAck('meeting:join', {
        roomId: nextRoomCode,
        user: participantPayload(mediaState),
        requireExisting: !!options.requireExisting,
        conversationId: options.conversationId || null,
        accessPolicy: options.accessPolicy || null,
        accessPassword: options.accessPassword || '',
        metadata: options.metadata || {}
      }, 8000);

      activeRef.current = true;
      joinedRef.current = true;
      setActive(true);
      applyRoomState(response.room || {});
      setMeetingMessages(Array.isArray(response.messages) ? response.messages : []);
      (response.participants || []).forEach((participant) => {
        createOfferForPeer(participant);
      });
      loadMeetingOverview();
      return true;
    } catch (err) {
      setError(err.message || '\ud68c\uc758\ub97c \uc2dc\uc791\ud560 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.');
      leaveMeeting();
      return false;
    } finally {
      setJoining(false);
    }
  }, [applyRoomState, createOfferForPeer, getLocalMedia, joining, leaveMeeting, loadMeetingOverview, participantPayload]);

  const startMeeting = useCallback((options = {}) => {
    const nextRoomCode = normalizeRoomCode(options.roomId || options.roomCode) || makeRoomCode();
    return joinMeeting(nextRoomCode, {
      requireExisting: false,
      mediaPreferences: options.mediaPreferences || {},
      accessPolicy: options.accessPolicy || null,
      accessPassword: options.accessPassword || '',
      metadata: options.metadata || {}
    });
  }, [joinMeeting]);

  const startConversationMeeting = useCallback(async (conversationId, options = {}) => {
    if (!conversationId || joining) return false;
    try {
      setError('');
      setJoining(true);
      const res = await axios.post(`/api/meetings/conversations/${encodeURIComponent(conversationId)}/start`, {
        roomCode: options.roomCode || undefined,
        accessPolicy: options.accessPolicy || undefined,
        title: options.metadata?.title || options.title || undefined,
        accessPassword: options.accessPassword || ''
      }, { withCredentials: true });
      const roomId = normalizeRoomCode(res.data?.room?.roomId);
      if (!roomId) throw new Error('Invalid meeting room.');
      setJoining(false);
      return joinMeeting(roomId, {
      requireExisting: true,
      conversationId,
      mediaPreferences: options.mediaPreferences || {},
      accessPassword: options.accessPassword || ''
    });
    } catch (err) {
      setError(err.response?.data?.message || err.message || '채팅방 회의를 시작할 수 없습니다.');
      return false;
    } finally {
      setJoining(false);
      loadMeetingOverview();
    }
  }, [joinMeeting, joining, loadMeetingOverview]);

  const joinConversationMeeting = useCallback((meeting, options = {}) => {
    const roomId = normalizeRoomCode(meeting?.roomId || meeting?.activeRoom?.roomId);
    const nextConversationId = meeting?.conversationId || meeting?.activeRoom?.conversationId || options.conversationId;
    if (!roomId) return false;
    return joinMeeting(roomId, {
      requireExisting: true,
      conversationId: nextConversationId || null,
      mediaPreferences: options.mediaPreferences || {},
      accessPassword: options.accessPassword || ''
    });
  }, [joinMeeting]);

  const saveMeetingAsConversation = useCallback(async (options = {}) => {
    const targetRoomCode = normalizeRoomCode(options.roomCode || roomCodeRef.current);
    if (!targetRoomCode || !activeRef.current) return null;
    try {
      setError('');
      const res = await axios.post(`/api/meetings/${encodeURIComponent(targetRoomCode)}/save`, {
        title: options.title || roomTitle || '정규 회의방',
        accessPolicy: options.accessPolicy || null
      }, { withCredentials: true });
      if (res.data?.room) applyRoomState(res.data.room);
      await loadMeetingOverview();
      return res.data || null;
    } catch (err) {
      setError(err.response?.data?.message || err.message || '회의방을 저장할 수 없습니다.');
      return null;
    }
  }, [applyRoomState, loadMeetingOverview, roomTitle]);

  const updateMeetingSettings = useCallback(async (options = {}) => {
    const targetRoomCode = normalizeRoomCode(options.roomCode || roomCodeRef.current);
    if (!targetRoomCode || !activeRef.current) return null;
    try {
      setError('');
      const response = await emitWithAck('meeting:update-settings', {
        roomId: targetRoomCode,
        title: options.title || roomTitle || '화상회의',
        accessPolicy: options.accessPolicy || {}
      }, 8000);
      if (response?.room) applyRoomState(response.room);
      await loadMeetingOverview();
      return response || null;
    } catch (err) {
      setError(err.message || '회의방 설정을 저장할 수 없습니다.');
      return null;
    }
  }, [applyRoomState, loadMeetingOverview, roomTitle]);

  const joinTypedMeeting = useCallback((options = {}) => {
    joinMeeting(joinCode || roomCodeRef.current, {
      accessPassword: options.accessPassword || ''
    });
  }, [joinCode, joinMeeting]);

  const sendMeetingMessage = useCallback(async (content) => {
    const safeContent = String(content || '').trim();
    if (!safeContent || !activeRef.current || chatSending) return false;

    try {
      setChatSending(true);
      await emitWithAck('meeting:chat-send', {
        roomId: roomCodeRef.current,
        content: safeContent
      }, 8000);
      return true;
    } catch (err) {
      setError(err.message || '채팅 메시지를 보낼 수 없습니다.');
      return false;
    } finally {
      setChatSending(false);
    }
  }, [chatSending]);

  const replacePeerTrack = useCallback(async (kind, track) => {
    await Promise.all([...peersRef.current.values()].map(async (peer) => {
      if (peer.signalingState === 'closed') return;
      const transceiver = peer.getTransceivers().find((entry) =>
        entry.sender?.track?.kind === kind || entry.receiver?.track?.kind === kind
      );
      const sender = peer.getSenders().find((item) => item.track?.kind === kind)
        || peer.getSenders().find((item) => item === transceiver?.sender)
        || transceiver?.sender;
      if (sender) {
        await sender.replaceTrack(track || null);
        return;
      }
      if (track) {
        const stream = localStreamRef.current || new MediaStream([track]);
        try {
          peer.addTransceiver(track, { direction: 'sendrecv', streams: [stream] });
        } catch (err) {
          peer.addTrack(track, stream);
        }
      } else {
        try {
          peer.addTransceiver(kind, { direction: 'sendrecv' });
        } catch (err) {}
      }
    }));
  }, []);

  const renegotiatePeerConnections = useCallback(async () => {
    await Promise.all([...peersRef.current.entries()].map(async ([targetSocketId, peer]) => {
      if (peer.signalingState === 'closed') return;
      try {
        if (peer.signalingState !== 'stable') {
          await new Promise((resolve) => window.setTimeout(resolve, 220));
        }
        if (peer.signalingState !== 'stable' || peer.signalingState === 'closed') return;
        if (typeof peer.restartIce === 'function' && ['failed', 'disconnected'].includes(peer.iceConnectionState)) {
          peer.restartIce();
        }
        const offer = await peer.createOffer({
          iceRestart: ['failed', 'disconnected'].includes(peer.iceConnectionState)
        });
        await peer.setLocalDescription(offer);
        socket.emit('meeting:signal', {
          roomId: roomCodeRef.current,
          targetSocketId,
          signal: peer.localDescription
        });
      } catch (err) {
        console.warn('Meeting renegotiation failed', err);
      }
    }));
  }, []);

  const toggleAudio = useCallback(async () => {
    const currentStream = localStreamRef.current || new MediaStream();
    let audioTrack = currentStream.getAudioTracks().find((track) => track.readyState === 'live') || null;

    if (audioEnabled) {
      currentStream.getAudioTracks().forEach((track) => {
        currentStream.removeTrack(track);
        if (track.readyState === 'live') track.stop();
      });
      const nextStream = new MediaStream(currentStream.getVideoTracks());
      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      await replacePeerTrack('audio', null);
      await renegotiatePeerConnections();
      setAudioEnabled(false);
      emitMediaState({ audioEnabled: false });
      return;
    }

    try {
      setError('');
      if (!audioTrack) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('NO_MEDIA_DEVICES');
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint(), video: false });
        audioTrack = audioStream.getAudioTracks()[0] || null;
        if (!audioTrack) throw new Error('NO_AUDIO_TRACK');

        currentStream.getAudioTracks().forEach((track) => currentStream.removeTrack(track));
        const nextStream = new MediaStream([...currentStream.getVideoTracks(), audioTrack]);
        localStreamRef.current = nextStream;
        setLocalStream(nextStream);
      }

      audioTrack.enabled = true;
      audioTrack.onended = () => {
        setAudioEnabled(false);
        emitMediaState({ audioEnabled: false });
      };
      await replacePeerTrack('audio', audioTrack);
      await renegotiatePeerConnections();
      setAudioEnabled(true);
      emitMediaState({ audioEnabled: true });
    } catch (err) {
      setAudioEnabled(false);
      emitMediaState({ audioEnabled: false });
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      setError(denied
        ? '\ub9c8\uc774\ud06c \uc0ac\uc6a9 \uad8c\ud55c\uc774 \ud544\uc694\ud569\ub2c8\ub2e4. \ube0c\ub77c\uc6b0\uc800 \uc8fc\uc18c\ucc3d\uc758 \ub9c8\uc774\ud06c \uad8c\ud55c\uc744 \ud655\uc778\ud574\uc8fc\uc138\uc694.'
        : '\ub9c8\uc774\ud06c \uc7a5\uce58\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4.');
    }
  }, [audioConstraint, audioEnabled, emitMediaState, renegotiatePeerConnections, replacePeerTrack]);

  const activateVideoInput = useCallback(async (deviceId = selectedVideoInputIdRef.current) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('MEDIA_DEVICES_UNAVAILABLE');
    }

    const cameraResult = await acquireVideoTrack(deviceId);
    const nextTrack = cameraResult.track;
    if (!nextTrack) throw new Error('NO_CAMERA_TRACK');

    nextTrack.enabled = true;

    const previousStream = localStreamRef.current || new MediaStream();
    previousStream.getVideoTracks().forEach((track) => {
      previousStream.removeTrack(track);
      if (track.readyState === 'live') track.stop();
    });
    lastVideoStoppedAtRef.current = Date.now();
    const nextStream = new MediaStream([...previousStream.getAudioTracks(), nextTrack]);
    localStreamRef.current = nextStream;
    registerCameraTrack(nextTrack);
    setLocalStream(nextStream);

    await replacePeerTrack('video', nextTrack);
    await renegotiatePeerConnections();

    setVideoEnabled(true);
    emitMediaState({ videoEnabled: true });
    refreshMediaDevices();
    return true;
  }, [acquireVideoTrack, emitMediaState, refreshMediaDevices, registerCameraTrack, renegotiatePeerConnections, replacePeerTrack]);

  const toggleVideo = useCallback(async () => {
    if (screenSharing) return;

    if (videoEnabled) {
      const previousStream = localStreamRef.current || new MediaStream();
      previousStream.getVideoTracks().forEach((track) => {
        previousStream.removeTrack(track);
        if (track.readyState === 'live') track.stop();
      });
      lastVideoStoppedAtRef.current = Date.now();
      cameraVideoTrackRef.current = null;
      registerCameraTrack(null);
      const nextStream = new MediaStream(previousStream.getAudioTracks());
      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      await replacePeerTrack('video', null);
      await renegotiatePeerConnections();
      setVideoEnabled(false);
      emitMediaState({ videoEnabled: false });
      return;
    }

    try {
      setError('');
      await activateVideoInput(selectedVideoInputIdRef.current);
    } catch (err) {
      setVideoEnabled(false);
      emitMediaState({ videoEnabled: false });
      const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
      setError(denied
        ? '\uce74\uba54\ub77c \uc0ac\uc6a9 \uad8c\ud55c\uc774 \ud544\uc694\ud569\ub2c8\ub2e4. \ube0c\ub77c\uc6b0\uc800 \uc8fc\uc18c\ucc3d\uc758 \uce74\uba54\ub77c \uad8c\ud55c\uc744 \ud655\uc778\ud574\uc8fc\uc138\uc694.'
        : '\uce74\uba54\ub77c \uc7a5\uce58\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4. \uc7a5\uce58 \uc5f0\uacb0 \uc0c1\ud0dc\ub97c \ud655\uc778\ud574\uc8fc\uc138\uc694.');
    }
  }, [activateVideoInput, emitMediaState, registerCameraTrack, renegotiatePeerConnections, replacePeerTrack, screenSharing, videoEnabled]);

  const selectAudioInput = useCallback(async (deviceId = '') => {
    setSelectedAudioInputId(deviceId);
    selectedAudioInputIdRef.current = deviceId;
    if (!activeRef.current || !audioEnabled) {
      refreshMediaDevices();
      return true;
    }

    try {
      setError('');
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint(deviceId), video: false });
      const nextAudioTrack = audioStream.getAudioTracks()[0] || null;
      if (!nextAudioTrack) throw new Error('NO_AUDIO_TRACK');

      const currentStream = localStreamRef.current || new MediaStream();
      currentStream.getAudioTracks().forEach((track) => {
        currentStream.removeTrack(track);
        if (track.readyState === 'live') track.stop();
      });
      const nextStream = new MediaStream([...currentStream.getVideoTracks(), nextAudioTrack]);
      localStreamRef.current = nextStream;
      setLocalStream(nextStream);
      await replacePeerTrack('audio', nextAudioTrack);
      await renegotiatePeerConnections();
      setAudioEnabled(true);
      emitMediaState({ audioEnabled: true });
      refreshMediaDevices();
      return true;
    } catch (err) {
      setError('선택한 마이크를 사용할 수 없습니다.');
      refreshMediaDevices();
      return false;
    }
  }, [audioConstraint, audioEnabled, emitMediaState, refreshMediaDevices, renegotiatePeerConnections, replacePeerTrack]);

  const selectVideoInput = useCallback(async (deviceId = '') => {
    setSelectedVideoInputId(deviceId);
    selectedVideoInputIdRef.current = deviceId;
    if (screenSharing) {
      setError('화면공유 중에는 카메라 장치를 바꿀 수 없습니다.');
      return false;
    }
    if (!activeRef.current || !videoEnabled) {
      refreshMediaDevices();
      return true;
    }

    try {
      setError('');
      await activateVideoInput(deviceId);
      return true;
    } catch (err) {
      setError('선택한 카메라를 사용할 수 없습니다.');
      refreshMediaDevices();
      return false;
    }
  }, [activateVideoInput, refreshMediaDevices, screenSharing, videoEnabled]);

  const selectAudioOutput = useCallback(async (deviceId = '') => {
    setSelectedAudioOutputId(deviceId);
    refreshMediaDevices();
    return true;
  }, [refreshMediaDevices]);

  const requestDeviceAccess = useCallback(async (kind = 'audioinput') => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('이 브라우저에서는 장치 권한 요청을 지원하지 않습니다.');
        return false;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: kind === 'audioinput',
        video: kind === 'videoinput'
      });
      stream.getTracks().forEach((track) => track.stop());
      await refreshMediaDevices();
      return true;
    } catch (err) {
      setError(kind === 'videoinput' ? '카메라 장치를 추가하거나 권한을 허용해 주세요.' : '마이크 장치를 추가하거나 권한을 허용해 주세요.');
      await refreshMediaDevices();
      return false;
    }
  }, [refreshMediaDevices]);

  const stopScreenShare = useCallback(async () => {
    const cameraTrack = cameraVideoTrackRef.current;
    [...screenPeersRef.current.keys()].forEach((targetSocketId) => {
      socket.emit('meeting:signal', {
        roomId: roomCodeRef.current,
        targetSocketId,
        signal: { channel: 'screen', type: 'stop' }
      });
      closeScreenPeer(targetSocketId);
    });
    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => track.stop());
      displayStreamRef.current = null;
      setDisplayStream(null);
    }
    setScreenSharing(false);
    const cameraEnabled = !!cameraTrack && cameraTrack.enabled !== false;
    setVideoEnabled(cameraEnabled);
    emitMediaState({ screenSharing: false, videoEnabled: cameraEnabled });
  }, [closeScreenPeer, emitMediaState]);

  const startScreenShare = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('이 브라우저는 화면공유를 지원하지 않습니다.');
      }
      if (!activeRef.current) await joinMeeting(roomCodeRef.current);

      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = stream.getVideoTracks()[0];
      if (!screenTrack) return;
      screenTrack.contentHint = 'detail';

      displayStreamRef.current = stream;
      setDisplayStream(stream);

      await Promise.all([...peersRef.current.keys()].map((targetSocketId) => offerScreenToPeer(targetSocketId)));

      screenTrack.onended = () => {
        stopScreenShare();
      };

      setScreenSharing(true);
      const cameraTrack = cameraVideoTrackRef.current;
      emitMediaState({
        screenSharing: true,
        videoEnabled: !!cameraTrack && cameraTrack.enabled !== false
      });
    } catch (err) {
      if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach((track) => track.stop());
        displayStreamRef.current = null;
        setDisplayStream(null);
      }
      setScreenSharing(false);
      setError(err.message || '화면공유를 시작할 수 없습니다.');
    }
  }, [emitMediaState, joinMeeting, offerScreenToPeer, stopScreenShare]);

  const resetPeerConnections = useCallback(() => {
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    pendingIceRef.current.clear();
    screenPeersRef.current.forEach((peer) => peer.close());
    screenPeersRef.current.clear();
    pendingScreenIceRef.current.clear();
    screenOfferTimersRef.current.forEach((timer) => clearTimeout(timer));
    screenOfferTimersRef.current.clear();
    setRemotePeers({});
  }, []);

  const refreshLocalMediaAfterResume = useCallback(async () => {
    const wantsAudio = audioEnabledRef.current;
    const wantsVideo = videoEnabledRef.current;
    const currentStream = localStreamRef.current || new MediaStream();
    const liveAudio = currentStream.getAudioTracks().find((track) => track.readyState === 'live') || null;
    const liveVideo = currentStream.getVideoTracks().find((track) => track.readyState === 'live' && !track.muted) || null;
    let nextAudio = liveAudio;
    let nextVideo = liveVideo;
    const previousAudioId = liveAudio?.id || '';
    const previousVideoId = liveVideo?.id || '';

    if (wantsAudio && !nextAudio && navigator.mediaDevices?.getUserMedia) {
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        nextAudio = audioStream.getAudioTracks()[0] || null;
      } catch (err) {}
    }

    if (wantsVideo && !nextVideo && navigator.mediaDevices?.getUserMedia) {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        nextVideo = videoStream.getVideoTracks()[0] || null;
      } catch (err) {
        nextVideo = null;
      }
    }

    currentStream.getAudioTracks().forEach((track) => {
      if (track !== nextAudio && track.readyState === 'live') track.stop();
    });
    currentStream.getVideoTracks().forEach((track) => {
      if (track !== nextVideo && track.readyState === 'live') track.stop();
    });

    const nextTracks = [];
    if (nextAudio) {
      nextAudio.enabled = wantsAudio;
      nextTracks.push(nextAudio);
    }
    if (nextVideo) {
      nextVideo.enabled = wantsVideo;
      nextTracks.push(nextVideo);
      registerCameraTrack(nextVideo);
    } else {
      registerCameraTrack(null);
    }

    const nextStream = new MediaStream(nextTracks);
    localStreamRef.current = nextStream;
    setLocalStream(nextStream);

    const audioChanged = (nextAudio?.id || '') !== previousAudioId;
    const videoChanged = (nextVideo?.id || '') !== previousVideoId;
    if (audioChanged) await replacePeerTrack('audio', nextAudio || null);
    if (videoChanged) await replacePeerTrack('video', nextVideo || null);
    if (audioChanged || videoChanged) await renegotiatePeerConnections();

    setAudioEnabled(!!nextAudio && wantsAudio);
    setVideoEnabled(!!nextVideo && wantsVideo);
    emitMediaState({
      audioEnabled: !!nextAudio && wantsAudio,
      videoEnabled: !!nextVideo && wantsVideo,
      screenSharing: false
    });

    return { stream: nextStream, changed: audioChanged || videoChanged };
  }, [emitMediaState, registerCameraTrack, renegotiatePeerConnections, replacePeerTrack]);

  const recoverMeetingAfterForeground = useCallback(async () => {
    if (!joinedRef.current || !activeRef.current || reconnectingRef.current) return;
    reconnectingRef.current = true;
    try {
      if (displayStreamRef.current) {
        displayStreamRef.current.getTracks().forEach((track) => track.stop());
        displayStreamRef.current = null;
        setDisplayStream(null);
        setScreenSharing(false);
      }

      const result = await refreshLocalMediaAfterResume();
      if (result?.changed || !socket.connected) {
        resetPeerConnections();

        await joinMeeting(roomCodeRef.current, {
          requireExisting: true,
          mediaPreferences: {
            audioEnabled: audioEnabledRef.current,
            videoEnabled: videoEnabledRef.current
          }
        });
      }
    } catch (err) {
      setError(err.message || '모바일 복귀 후 회의 연결을 다시 준비하지 못했습니다.');
    } finally {
      reconnectingRef.current = false;
    }
  }, [joinMeeting, refreshLocalMediaAfterResume, resetPeerConnections]);

  useEffect(() => {
    let recoveryTimer = null;
    const scheduleRecovery = () => {
      if (document.visibilityState === 'hidden') return;
      if (!joinedRef.current || !activeRef.current) return;
      if (recoveryTimer) clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(() => {
        recoverMeetingAfterForeground();
      }, 850);
    };

    document.addEventListener('visibilitychange', scheduleRecovery);
    window.addEventListener('pageshow', scheduleRecovery);

    return () => {
      if (recoveryTimer) clearTimeout(recoveryTimer);
      document.removeEventListener('visibilitychange', scheduleRecovery);
      window.removeEventListener('pageshow', scheduleRecovery);
    };
  }, [recoverMeetingAfterForeground]);

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
        if (displayStreamRef.current) {
          const timer = setTimeout(() => {
            screenOfferTimersRef.current.delete(timer);
            if (activeRef.current && displayStreamRef.current) {
              offerScreenToPeer(participant.socketId);
            }
          }, 350);
          screenOfferTimersRef.current.add(timer);
        }
      }
    };

    const handleSignal = async ({ roomId, fromSocketId, signal }) => {
      if (roomId !== roomCodeRef.current || !activeRef.current || !signal || !fromSocketId) return;

      try {
        if (signal.channel === 'screen') {
          if (signal.type === 'stop') {
            closeScreenPeer(fromSocketId);
            return;
          }

          const screenPc = createScreenPeerConnection(fromSocketId, false);
          if (signal.type === 'offer' && signal.sdp) {
            if (screenPc.signalingState !== 'stable') {
              try {
                await screenPc.setLocalDescription({ type: 'rollback' });
              } catch (err) {}
            }
            await screenPc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
            await flushPendingScreenIce(fromSocketId, screenPc);
            const answer = await screenPc.createAnswer();
            await screenPc.setLocalDescription(answer);
            socket.emit('meeting:signal', {
              roomId,
              targetSocketId: fromSocketId,
              signal: { channel: 'screen', type: 'answer', sdp: answer.sdp }
            });
          } else if (signal.type === 'answer' && signal.sdp) {
            if (screenPc.signalingState === 'stable') return;
            await screenPc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
            await flushPendingScreenIce(fromSocketId, screenPc);
          } else if (signal.type === 'ice' && signal.candidate) {
            const candidate = new RTCIceCandidate(signal.candidate);
            if (screenPc.remoteDescription) {
              await screenPc.addIceCandidate(candidate);
            } else {
              const pending = pendingScreenIceRef.current.get(fromSocketId) || [];
              pending.push(candidate);
              pendingScreenIceRef.current.set(fromSocketId, pending);
            }
          }
          return;
        }

        const pc = createPeerConnection(fromSocketId);

        if (signal.type === 'offer') {
          if (pc.signalingState !== 'stable') {
            try {
              await pc.setLocalDescription({ type: 'rollback' });
            } catch (err) {}
          }
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
          if (pc.signalingState === 'stable') return;
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

    const handlePeerLeft = ({ socketId }) => {
      removePeer(socketId);
      closeScreenPeer(socketId);
      setParticipants((prev) => prev.filter((participant) => participant.socketId !== socketId));
    };
    const handleChatHistory = ({ roomId, messages = [] }) => {
      if (roomId !== roomCodeRef.current) return;
      setMeetingMessages(Array.isArray(messages) ? messages : []);
    };
    const handleChatMessage = ({ roomId, message }) => {
      if (roomId !== roomCodeRef.current || !message?.messageId) return;
      setMeetingMessages((prev) => {
        if (prev.some((item) => item.messageId === message.messageId)) return prev;
        return [...prev, message].slice(-500);
      });
    };
    const handleMediaState = ({ participant }) => {
      if (!participant?.socketId) return;
      updateRemotePeer(participant.socketId, () => participant);
    };
    const handleRoomState = (room) => applyRoomState(room);
    const handleEnded = ({ roomId }) => {
      if (roomId !== roomCodeRef.current) return;
      setRoomEnded(true);
      setError('\ud68c\uc758\uac00 \uc885\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \ucd08\ub300 \ub9c1\ud06c\uac00 \ub9cc\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4.');
      leaveMeeting({ notify: false, clearRoom: true });

      const signedIn = !!localStorage.getItem('user');
      if (signedIn) {
        window.alert('\ud68c\uc758\uac00 \uc885\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4. \ud604\uc7ac \ud68c\uc758 \ub9c1\ud06c\ub294 \ub9cc\ub8cc\ub418\uc5c8\uc2b5\ub2c8\ub2e4.');
        if (window.location.pathname.startsWith('/meeting/')) {
          window.location.replace('/platform');
          return;
        }

        const nextRoomCode = makeRoomCode();
        setRoomCodeState(nextRoomCode);
        setJoinCode(nextRoomCode);
        roomCodeRef.current = nextRoomCode;
        setMeetingMessages([]);
        setRoomEnded(false);
        setError('');
      }
    };
    const handleKicked = ({ roomId }) => {
      if (roomId !== roomCodeRef.current) return;
      leaveMeeting({ notify: false });
      setError('\ud68c\uc758 \ubc29\uc7a5\uc5d0 \uc758\ud574 \ud68c\uc758\uc5d0\uc11c \ub098\uac00\uc84c\uc2b5\ub2c8\ub2e4.');
    };
    const handleError = ({ message, code }) => {
      setError(message || '\ud68c\uc758 \uc5f0\uacb0 \uc911 \uc624\ub958\uac00 \ubc1c\uc0dd\ud588\uc2b5\ub2c8\ub2e4.');
      if (code === 'ROOM_EXPIRED' || code === 'INVALID_ROOM') {
        setRoomEnded(true);
        leaveMeeting({ notify: false, clearRoom: true });
      }
    };

    const handleSocketReconnect = async () => {
      if (!joinedRef.current || !activeRef.current || reconnectingRef.current) return;
      reconnectingRef.current = true;
      try {
        peersRef.current.forEach((peer) => peer.close());
        peersRef.current.clear();
        pendingIceRef.current.clear();
        screenPeersRef.current.forEach((peer) => peer.close());
        screenPeersRef.current.clear();
        pendingScreenIceRef.current.clear();
        setRemotePeers({});

        await joinMeeting(roomCodeRef.current, {
          requireExisting: true,
          mediaPreferences: { audioEnabled, videoEnabled }
        });
      } finally {
        reconnectingRef.current = false;
      }
    };

    socket.on('meeting:participants', handleParticipants);
    socket.on('meeting:peer-joined', handlePeerJoined);
    socket.on('meeting:signal', handleSignal);
    socket.on('meeting:peer-left', handlePeerLeft);
    socket.on('meeting:peer-media-state', handleMediaState);
    socket.on('meeting:chat-history', handleChatHistory);
    socket.on('meeting:chat-message', handleChatMessage);
    socket.on('meeting:room-state', handleRoomState);
    socket.on('meeting:ended', handleEnded);
    socket.on('meeting:kicked', handleKicked);
    socket.on('meeting:error', handleError);
    socket.on('connect', handleSocketReconnect);

    return () => {
      socket.off('meeting:participants', handleParticipants);
      socket.off('meeting:peer-joined', handlePeerJoined);
      socket.off('meeting:signal', handleSignal);
      socket.off('meeting:peer-left', handlePeerLeft);
      socket.off('meeting:peer-media-state', handleMediaState);
      socket.off('meeting:chat-history', handleChatHistory);
      socket.off('meeting:chat-message', handleChatMessage);
      socket.off('meeting:room-state', handleRoomState);
      socket.off('meeting:ended', handleEnded);
      socket.off('meeting:kicked', handleKicked);
      socket.off('meeting:error', handleError);
      socket.off('connect', handleSocketReconnect);
    };
  }, [applyRoomState, audioEnabled, closeScreenPeer, createOfferForPeer, createPeerConnection, createScreenPeerConnection, flushPendingIce, flushPendingScreenIce, joinMeeting, leaveMeeting, offerScreenToPeer, removePeer, updateRemotePeer, videoEnabled]);

  useEffect(() => () => {
    if (joinedRef.current) {
      socket.emit('meeting:leave', { roomId: roomCodeRef.current });
    }
    peersRef.current.forEach((peer) => peer.close());
    peersRef.current.clear();
    screenPeersRef.current.forEach((peer) => peer.close());
    screenPeersRef.current.clear();
    screenOfferTimersRef.current.forEach((timer) => clearTimeout(timer));
    screenOfferTimersRef.current.clear();
    peerRecoveryTimersRef.current.forEach((timer) => clearTimeout(timer));
    peerRecoveryTimersRef.current.clear();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const value = useMemo(() => ({
    roomCode,
    socketId: socket.id,
    setRoomCode,
    joinCode,
    setJoinCode,
    active,
    joining,
    error,
    setError,
    roomEnded,
    localStream,
    displayStream,
    remotePeers,
    participants,
    hostSocketId,
    roomTitle,
    roomAccessPolicy,
    hostDisplayName,
    meetingMessages,
    meetingOverview,
    overviewLoading,
    refreshMeetingOverview: loadMeetingOverview,
    chatSending,
    isHost: !!hostSocketId && socket.id === hostSocketId,
    audioEnabled,
    videoEnabled,
    screenSharing,
    mediaDevices,
    selectedAudioInputId,
    selectedVideoInputId,
    selectedAudioOutputId,
    currentUser,
    guestProfile,
    setGuestProfile,
    clearGuestProfile,
    displayName,
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
  }), [
    active, audioEnabled, chatSending, clearGuestProfile, currentUser, displayName, displayStream, endMeeting, error, guestProfile, hostDisplayName, hostSocketId, joinCode, joinConversationMeeting, joining, joinMeeting,
    joinTypedMeeting, leaveMeeting, localStream, meetingMessages, participants, remotePeers, roomAccessPolicy, roomCode, roomEnded, roomTitle, saveMeetingAsConversation, screenSharing, setRoomCode,
    kickParticipant, loadMeetingOverview, mediaDevices, meetingOverview, overviewLoading, refreshMediaDevices, requestDeviceAccess, selectAudioInput, selectedAudioInputId, selectAudioOutput, selectedAudioOutputId, selectVideoInput, selectedVideoInputId,
    sendMeetingMessage, setGuestProfile, startConversationMeeting, startMeeting, startScreenShare, stopScreenShare, toggleAudio, toggleVideo, transferHost, updateMeetingSettings, videoEnabled
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
