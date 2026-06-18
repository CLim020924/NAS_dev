import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

const ChatContext = createContext(null);

const sortMessages = (items = []) => {
  return items.slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
};

const normalizeAttachmentBundle = (bundle = {}) => ({
  ...bundle,
  items: Array.isArray(bundle.items) ? bundle.items : [],
  itemCount: Number(bundle.itemCount) || (Array.isArray(bundle.items) ? bundle.items.length : 0),
});

const normalizeMessage = (message = {}) => ({
  ...message,
  readByUids: Array.isArray(message.readByUids) ? message.readByUids : [],
  savedByUids: Array.isArray(message.savedByUids) ? message.savedByUids : [],
  attachments: Array.isArray(message.attachments)
    ? message.attachments.map(normalizeAttachmentBundle)
    : [],
  attachmentCount: Number(message.attachmentCount) || 0,
});

const mergeMessages = (existing = [], incoming = []) => {
  const map = new Map();

  [...existing, ...incoming].forEach((item) => {
    const normalized = normalizeMessage(item);
    const key = normalized.messageId || normalized.id;
    if (!key) return;
    map.set(key, normalized);
  });

  return sortMessages(Array.from(map.values()));
};

const upsertConversationList = (prev, nextConversation) => {
  if (!nextConversation?.conversationId) return prev;
  const exists = prev.some((item) => item.conversationId === nextConversation.conversationId);
  const next = exists
    ? prev.map((item) => (item.conversationId === nextConversation.conversationId ? { ...item, ...nextConversation } : item))
    : [nextConversation, ...prev];

  return next.sort((a, b) => {
    const aKey = a.lastMessageAt || a.updatedAt || a.createdAt || '';
    const bKey = b.lastMessageAt || b.updatedAt || b.createdAt || '';
    return String(bKey).localeCompare(String(aKey));
  });
};

export const ChatProvider = ({ children, user = null, socket = null }) => {
  const currentUser = useMemo(() => user || JSON.parse(localStorage.getItem('user') || 'null'), [user]);
  const currentUserUid = currentUser?.userUid || null;

  const [conversations, setConversations] = useState([]);
  const [messagesByConversation, setMessagesByConversation] = useState({});
  const [drafts, setDrafts] = useState({});
  const [attachmentDraftsByConversation, setAttachmentDraftsByConversation] = useState({});
  const [attachmentUploadStateByConversation, setAttachmentUploadStateByConversation] = useState({});
  const [loadedConversationIds, setLoadedConversationIds] = useState({});
  const [loadingConversations, setLoadingConversations] = useState(false);

  const messagesByConversationRef = React.useRef({});
  const loadedConversationIdsRef = React.useRef({});

  const upsertConversation = useCallback((conversation) => {
    if (!conversation?.conversationId) return;
    setConversations((prev) => upsertConversationList(prev, conversation));
  }, []);

  const updateDraft = useCallback((conversationId, value) => {
    if (!conversationId) return;
    setDrafts((prev) => ({ ...prev, [conversationId]: value }));
  }, []);

  useEffect(() => {
    messagesByConversationRef.current = messagesByConversation;
  }, [messagesByConversation]);

  useEffect(() => {
    loadedConversationIdsRef.current = loadedConversationIds;
  }, [loadedConversationIds]);


  const loadConversations = useCallback(async ({ silent = false } = {}) => {
    if (!currentUserUid) {
      setConversations([]);
      return [];
    }

    try {
      if (!silent) setLoadingConversations(true);
      const res = await axios.get('/api/chat/conversations', { withCredentials: true });
      const next = Array.isArray(res.data?.conversations) ? res.data.conversations : [];
      setConversations(next);
      return next;
    } catch (err) {
      console.error('대화 목록 로드 실패', err);
      return [];
    } finally {
      if (!silent) setLoadingConversations(false);
    }
  }, [currentUserUid]);

  const ensureDirectConversation = useCallback(async (targetUserUid) => {
    if (!targetUserUid) return null;

    const res = await axios.post(
      '/api/chat/direct',
      { targetUserUid },
      { withCredentials: true }
    );

    const conversation = res.data?.conversation || null;
    if (conversation) upsertConversation(conversation);
    return conversation;
  }, [upsertConversation]);

  const createGroupConversation = useCallback(async ({ title = '', inviteeUids = [], invitees = [] } = {}) => {
    const res = await axios.post(
      '/api/chat/group',
      { title, inviteeUids, invitees },
      { withCredentials: true }
    );

    const conversation = res.data?.conversation || null;
    if (conversation) upsertConversation(conversation);
    return conversation;
  }, [upsertConversation]);

  const inviteToConversation = useCallback(async (conversationId, { inviteeUids = [], invitees = [] } = {}) => {
    if (!conversationId) return null;

    const res = await axios.post(
      `/api/chat/group/${conversationId}/invite`,
      { inviteeUids, invitees },
      { withCredentials: true }
    );

    const conversation = res.data?.conversation || null;
    if (conversation) upsertConversation(conversation);
    return conversation;
  }, [upsertConversation]);

  const respondConversationInvite = useCallback(async (conversationId, accept) => {
    if (!conversationId) return null;

    const res = await axios.post(
      `/api/chat/group/${conversationId}/respond`,
      { accept: !!accept },
      { withCredentials: true }
    );

    const conversation = res.data?.conversation || null;
    if (conversation) {
      if (accept) {
        upsertConversation(conversation);
      } else {
        setConversations((prev) => prev.filter((item) => item.conversationId !== conversationId));
      }
    }
    return conversation;
  }, [upsertConversation]);

  const findDirectConversationWithUser = useCallback((targetUserUid) => {
    if (!targetUserUid) return null;

    return conversations.find((conversation) => {
      if (conversation?.type !== 'direct') return false;
      if (conversation?.otherUser?.userUid === targetUserUid) return true;

      const participantUids = Array.isArray(conversation?.participantUids)
        ? conversation.participantUids
        : [];

      return participantUids.includes(targetUserUid) && participantUids.includes(currentUserUid);
    }) || null;
  }, [conversations, currentUserUid]);

  const loadMessages = useCallback(async (conversationId, { force = false } = {}) => {
    if (!conversationId) return [];

    const loadedMap = loadedConversationIdsRef.current || {};
    const currentMessages = messagesByConversationRef.current || {};

    if (!force && loadedMap[conversationId]) {
      return currentMessages[conversationId] || [];
    }

    try {
      const res = await axios.get('/api/chat/messages', {
        params: { conversationId },
        withCredentials: true,
      });

      const incoming = Array.isArray(res.data?.messages) ? res.data.messages : [];
      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationId]: mergeMessages(prev[conversationId] || [], incoming),
      }));
      setLoadedConversationIds((prev) => ({ ...prev, [conversationId]: true }));
      return incoming;
    } catch (err) {
      console.error('대화 메시지 로드 실패', err);
      return [];
    }
  }, []);

  const appendMessage = useCallback((conversationId, message) => {
    if (!conversationId || !message) return;
    setMessagesByConversation((prev) => ({
      ...prev,
      [conversationId]: mergeMessages(prev[conversationId] || [], [message]),
    }));
    setLoadedConversationIds((prev) => ({ ...prev, [conversationId]: true }));
  }, []);

  const addAttachmentDraftBundle = useCallback((conversationId, bundle) => {
    if (!conversationId || !bundle?.bundleId) return;
    const normalized = normalizeAttachmentBundle(bundle);

    setAttachmentDraftsByConversation((prev) => {
      const current = Array.isArray(prev[conversationId]) ? prev[conversationId] : [];
      const exists = current.some((item) => item.bundleId === normalized.bundleId);
      return {
        ...prev,
        [conversationId]: exists
          ? current.map((item) => (item.bundleId === normalized.bundleId ? normalized : item))
          : [...current, normalized],
      };
    });
  }, []);

  const upsertAttachmentUploadState = useCallback((conversationId, uploadId, patch) => {
    if (!conversationId || !uploadId) return;

    setAttachmentUploadStateByConversation((prev) => {
      const current = Array.isArray(prev[conversationId]) ? prev[conversationId] : [];
      const exists = current.some((item) => item.uploadId === uploadId);

      return {
        ...prev,
        [conversationId]: exists
          ? current.map((item) => (item.uploadId === uploadId ? { ...item, ...patch } : item))
          : [...current, { uploadId, ...patch }],
      };
    });
  }, []);

  const removeAttachmentUploadState = useCallback((conversationId, uploadId) => {
    if (!conversationId || !uploadId) return;

    setAttachmentUploadStateByConversation((prev) => {
      const current = Array.isArray(prev[conversationId]) ? prev[conversationId] : [];
      return {
        ...prev,
        [conversationId]: current.filter((item) => item.uploadId !== uploadId),
      };
    });
  }, []);

  const createDeviceAttachmentBundle = useCallback(async (conversationId, { files = [], manifest = [] } = {}) => {
    if (!conversationId || !Array.isArray(files) || files.length === 0) return null;

    const uploadId = `upl_dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    upsertAttachmentUploadState(conversationId, uploadId, {
      sourceType: 'device',
      statusText: '업로드 중',
      progress: 0,
      totalCount: files.length,
    });

    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', file, file.name);
      });
      formData.append('manifest', JSON.stringify(manifest));

      const res = await axios.post('/api/chat/attachments/from-device', formData, {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          if (!event?.total) return;
          const progress = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
          upsertAttachmentUploadState(conversationId, uploadId, {
            sourceType: 'device',
            statusText: '업로드 중',
            progress,
            totalCount: files.length,
          });
        },
      });

      const bundle = res.data?.bundle || null;
      if (bundle) addAttachmentDraftBundle(conversationId, bundle);
      return bundle;
    } finally {
      removeAttachmentUploadState(conversationId, uploadId);
    }
  }, [addAttachmentDraftBundle, upsertAttachmentUploadState, removeAttachmentUploadState]);

  const createNasAttachmentBundle = useCallback(async (conversationId, paths = []) => {
    if (!conversationId || !Array.isArray(paths) || paths.length === 0) return null;

    const uploadId = `upl_nas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    upsertAttachmentUploadState(conversationId, uploadId, {
      sourceType: 'nas',
      statusText: 'NAS 복사 중',
      progress: null,
      totalCount: paths.length,
    });

    try {
      const res = await axios.post(
        '/api/chat/attachments/from-nas',
        { paths },
        { withCredentials: true }
      );

      const bundle = res.data?.bundle || null;
      if (bundle) addAttachmentDraftBundle(conversationId, bundle);
      return bundle;
    } finally {
      removeAttachmentUploadState(conversationId, uploadId);
    }
  }, [addAttachmentDraftBundle, upsertAttachmentUploadState, removeAttachmentUploadState]);

  const removeAttachmentBundle = useCallback(async (conversationId, bundleId) => {
    if (!conversationId || !bundleId) return;

    await axios.delete(`/api/chat/attachments/bundle/${bundleId}`, { withCredentials: true });

    setAttachmentDraftsByConversation((prev) => {
      const current = Array.isArray(prev[conversationId]) ? prev[conversationId] : [];
      return {
        ...prev,
        [conversationId]: current.filter((item) => item.bundleId !== bundleId),
      };
    });
  }, []);

  const clearAttachmentDrafts = useCallback((conversationId) => {
    if (!conversationId) return;
    setAttachmentDraftsByConversation((prev) => ({ ...prev, [conversationId]: [] }));
  }, []);

  const sendMessage = useCallback(async (conversationId, { text = '', attachmentBundleIds } = {}) => {
    const trimmed = String(text || '').trim();
    const draftBundles = Array.isArray(attachmentDraftsByConversation[conversationId])
      ? attachmentDraftsByConversation[conversationId]
      : [];

    const bundleIds = Array.isArray(attachmentBundleIds) && attachmentBundleIds.length > 0
      ? attachmentBundleIds
      : draftBundles.map((bundle) => bundle.bundleId).filter(Boolean);

    if (!conversationId || (!trimmed && bundleIds.length === 0)) return null;

    const res = await axios.post(
      '/api/chat/messages',
      { conversationId, text: trimmed, attachmentBundleIds: bundleIds },
      { withCredentials: true }
    );

    const conversation = res.data?.conversation || null;
    const message = res.data?.message || null;

    if (conversation) upsertConversation(conversation);
    if (message) appendMessage(conversationId, message);

    setAttachmentDraftsByConversation((prev) => ({ ...prev, [conversationId]: [] }));
    return message;
  }, [attachmentDraftsByConversation, appendMessage, upsertConversation]);

  const sendTextMessage = useCallback(async (conversationId, text) => {
    return sendMessage(conversationId, { text });
  }, [sendMessage]);

  const saveReceivedAttachments = useCallback(async (conversationId, messageId) => {
    if (!conversationId || !messageId) return null;

    const res = await axios.post(
      `/api/chat/messages/${messageId}/save`,
      {},
      { withCredentials: true }
    );

    const updatedMessage = res.data?.message || null;
    if (updatedMessage) {
      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationId]: mergeMessages(prev[conversationId] || [], [updatedMessage]),
      }));
    }

    return res.data || null;
  }, []);

  const markConversationRead = useCallback(async (conversationId) => {
    if (!conversationId || !currentUserUid) return [];

    try {
      const res = await axios.post(
        '/api/chat/read',
        { conversationId },
        { withCredentials: true }
      );

      const updatedMessageIds = Array.isArray(res.data?.updatedMessageIds) ? res.data.updatedMessageIds : [];
      if (updatedMessageIds.length === 0) return [];

      setMessagesByConversation((prev) => {
        const current = prev[conversationId] || [];
        return {
          ...prev,
          [conversationId]: current.map((message) => {
            const key = message.messageId || message.id;
            if (!updatedMessageIds.includes(key)) return message;
            const readByUids = Array.isArray(message.readByUids) ? message.readByUids : [];
            if (readByUids.includes(currentUserUid)) return message;
            return { ...message, readByUids: [...readByUids, currentUserUid] };
          }),
        };
      });

      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.conversationId === conversationId
            ? { ...conversation, unreadCount: 0 }
            : conversation
        )
      );

      return updatedMessageIds;
    } catch (err) {
      console.error('읽음 처리 실패', err);
      return [];
    }
  }, [currentUserUid]);

  useEffect(() => {
    if (!currentUserUid) {
      setConversations([]);
      setMessagesByConversation({});
      setDrafts({});
      setAttachmentDraftsByConversation({});
      setAttachmentUploadStateByConversation({});
      setLoadedConversationIds({});
      return;
    }

    loadConversations();
  }, [currentUserUid, loadConversations]);

  useEffect(() => {
    if (!socket || !currentUserUid) return undefined;

    const handleIncomingMessage = (payload = {}) => {
      const conversationId = payload.conversationId;
      const message = payload.message;
      if (!conversationId || !message) return;

      appendMessage(conversationId, message);
      loadConversations({ silent: true });
    };

    const handleReadUpdate = (payload = {}) => {
      const conversationId = payload.conversationId;
      const updatedMessageIds = Array.isArray(payload.updatedMessageIds) ? payload.updatedMessageIds : [];
      const readByUid = payload.readByUid;

      if (!conversationId || !readByUid || updatedMessageIds.length === 0) return;

      setMessagesByConversation((prev) => {
        const current = prev[conversationId] || [];
        return {
          ...prev,
          [conversationId]: current.map((message) => {
            const key = message.messageId || message.id;
            if (!updatedMessageIds.includes(key)) return message;
            const readByUids = Array.isArray(message.readByUids) ? message.readByUids : [];
            if (readByUids.includes(readByUid)) return message;
            return { ...message, readByUids: [...readByUids, readByUid] };
          }),
        };
      });
    };

    const handleConversationUpdated = (payload = {}) => {
      if (payload.conversation?.conversationId) {
        upsertConversation(payload.conversation);
      } else {
        loadConversations({ silent: true });
      }
    };

    socket.on('chat:message', handleIncomingMessage);
    socket.on('chat:read', handleReadUpdate);
    socket.on('chat:conversation-invite', handleConversationUpdated);
    socket.on('chat:conversation-updated', handleConversationUpdated);

    return () => {
      socket.off('chat:message', handleIncomingMessage);
      socket.off('chat:read', handleReadUpdate);
      socket.off('chat:conversation-invite', handleConversationUpdated);
      socket.off('chat:conversation-updated', handleConversationUpdated);
    };
  }, [socket, currentUserUid, appendMessage, loadConversations, upsertConversation]);

  const value = useMemo(() => ({
    currentUser,
    currentUserUid,
    conversations,
    messagesByConversation,
    drafts,
    attachmentDraftsByConversation,
    attachmentUploadStateByConversation,
    loadingConversations,
    setDraft: updateDraft,
    loadConversations,
    ensureDirectConversation,
    createGroupConversation,
    inviteToConversation,
    respondConversationInvite,
    findDirectConversationWithUser,
    loadMessages,
    sendMessage,
    sendTextMessage,
    saveReceivedAttachments,
    markConversationRead,
    createDeviceAttachmentBundle,
    createNasAttachmentBundle,
    removeAttachmentBundle,
    clearAttachmentDrafts,
  }), [
    currentUser,
    currentUserUid,
    conversations,
    messagesByConversation,
    drafts,
    attachmentDraftsByConversation,
    attachmentUploadStateByConversation,
    loadingConversations,
    updateDraft,
    loadConversations,
    ensureDirectConversation,
    createGroupConversation,
    inviteToConversation,
    respondConversationInvite,
    findDirectConversationWithUser,
    loadMessages,
    sendMessage,
    sendTextMessage,
    saveReceivedAttachments,
    markConversationRead,
    createDeviceAttachmentBundle,
    createNasAttachmentBundle,
    removeAttachmentBundle,
    clearAttachmentDrafts,
  ]);

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return ctx;
};

export const useOptionalChat = () => useContext(ChatContext);
