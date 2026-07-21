import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  Avatar,
  Button,
  TextField,
  Divider,
  useTheme,
  IconButton,
  Menu,
  MenuItem,
  Chip,
  LinearProgress,
  useMediaQuery,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ImageIcon from '@mui/icons-material/Image';
import VideocamIcon from '@mui/icons-material/Videocam';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { useChat } from '../contexts/ChatContext';
import { useWindows } from '../contexts/WindowContext';
import ChatNasPickerDialog from './ChatNasPickerDialog';
import ChatInviteDialog from './ChatInviteDialog';

const formatMessageTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
};

const getAttachmentItemIcon = (item = {}) => {
  const ext = String(item.name || '').split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
    return <ImageIcon sx={{ fontSize: 18, color: 'info.main' }} />;
  }
  if (item.type === 'folder') {
    return <FolderIcon sx={{ fontSize: 18, color: 'warning.main' }} />;
  }
  return <InsertDriveFileIcon sx={{ fontSize: 18, color: 'text.secondary' }} />;
};

const buildManifestFromFiles = (files = []) => {
  return files.map((file) => ({
    originalName: file.name,
    relativePath: file.webkitRelativePath || file.name,
  }));
};

const getConversationMeetingCode = (conversationId) =>
  `CHAT-${String(conversationId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-24).toUpperCase() || Date.now().toString(36).toUpperCase()}`;

const DockedChatPanel = ({
  sidebarWidth = 360,
  activeChat = null,
  onOpenWindow = () => {},
  onConversationReady = () => {},
  onCloseChat = () => {},
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { openFolderWindowByPath, openFileWindowByPath, openAppWindow } = useWindows();
  const messageListRef = useRef(null);
  const deviceFilesInputRef = useRef(null);
  const deviceFolderInputRef = useRef(null);

  const {
    currentUserUid,
    drafts,
    setDraft,
    messagesByConversation,
    attachmentDraftsByConversation,
    attachmentUploadStateByConversation,
    loadMessages,
    sendMessage,
    ensureDirectConversation,
    markConversationRead,
    saveReceivedAttachments,
    createDeviceAttachmentBundle,
	    createNasAttachmentBundle,
	    removeAttachmentBundle,
	    leaveConversation,
	    transferConversationOwner,
	    setConversationCoHost,
	    kickConversationParticipant,
	    deleteConversation,
	  } = useChat();

	  const [attachMenuAnchorEl, setAttachMenuAnchorEl] = useState(null);
	  const [roomMenuAnchorEl, setRoomMenuAnchorEl] = useState(null);
	  const [nasPickerOpen, setNasPickerOpen] = useState(false);
  const [savingMessageIds, setSavingMessageIds] = useState({});
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);

  useEffect(() => {
    if (deviceFolderInputRef.current) {
      deviceFolderInputRef.current.setAttribute('webkitdirectory', '');
      deviceFolderInputRef.current.setAttribute('directory', '');
      deviceFolderInputRef.current.multiple = true;
    }
  }, []);

  const [runtimeConversationId, setRuntimeConversationId] = useState(null);

  useEffect(() => {
    setRuntimeConversationId(activeChat?.conversationId || null);
  }, [activeChat?.conversationId]);

  const conversationId = runtimeConversationId || activeChat?.conversationId || null;
  const draftKey = conversationId || activeChat?.tempDraftKey || null;

  const messages = useMemo(() => {
    if (!conversationId) return [];
    return messagesByConversation[conversationId] || [];
  }, [messagesByConversation, conversationId]);

  const attachmentDrafts = useMemo(() => {
    if (!conversationId) return [];
    return attachmentDraftsByConversation[conversationId] || [];
  }, [attachmentDraftsByConversation, conversationId]);

  const attachmentUploads = useMemo(() => {
    if (!conversationId) return [];
    return attachmentUploadStateByConversation[conversationId] || [];
  }, [attachmentUploadStateByConversation, conversationId]);

  const hasUnreadFromOther = useMemo(() => {
    return messages.some((msg) =>
      msg.senderUid !== currentUserUid &&
      !msg.deleted &&
      !(Array.isArray(msg.readByUids) ? msg.readByUids : []).includes(currentUserUid)
    );
  }, [messages, currentUserUid]);

  useEffect(() => {
    if (!conversationId) return;
    loadMessages(conversationId, { force: true });
  }, [conversationId, loadMessages]);

  useEffect(() => {
    if (!conversationId || !hasUnreadFromOther) return;
    markConversationRead(conversationId);
  }, [conversationId, hasUnreadFromOther, markConversationRead]);

  useEffect(() => {
    if (!conversationId) return;
    const el = messageListRef.current;
    if (!el) return;

    const moveToBottom = () => {
      el.scrollTop = el.scrollHeight;
    };

    requestAnimationFrame(moveToBottom);
    const timer = setTimeout(moveToBottom, 0);
    return () => clearTimeout(timer);
  }, [conversationId, messages, attachmentDrafts, attachmentUploads]);

	  if (!activeChat) return null;

	  const closeAttachMenu = () => setAttachMenuAnchorEl(null);
	  const closeRoomMenu = () => setRoomMenuAnchorEl(null);
	  const isGroupChat = activeChat.conversationType === 'group';
	  const roomParticipants = Array.isArray(activeChat.participants) ? activeChat.participants : [];
	  const viewerRole = activeChat.viewerRole || 'member';
	  const viewerCanManage = !!activeChat.viewerCanManage || viewerRole === 'owner' || viewerRole === 'cohost';
	  const viewerCanDelete = !!activeChat.viewerCanDelete || viewerRole === 'owner';
	  const coHostUids = Array.isArray(activeChat.coHostUids) ? activeChat.coHostUids : [];
	  const ownerUid = activeChat.ownerUid || '';

	  const refreshAfterRoomAction = (conversation) => {
	    if (!conversation?.conversationId) {
	      onCloseChat();
	      return;
	    }
	    onConversationReady?.(conversation);
	  };

	  const handleLeaveRoom = async () => {
	    if (!conversationId) return;
	    if (!window.confirm('이 채팅방에서 나가시겠습니까?')) return;
	    try {
	      await leaveConversation(conversationId);
	      closeRoomMenu();
	      onCloseChat();
	    } catch (err) {
	      alert(err.response?.data?.error || '채팅방에서 나가지 못했습니다.');
	    }
	  };

	  const handleDeleteRoom = async () => {
	    if (!conversationId) return;
	    const first = window.confirm('채팅방을 파기하면 모든 참가자의 목록에서 사라집니다. 계속할까요?');
	    if (!first) return;
	    const second = window.prompt('정말 파기하려면 "방 파기"를 입력하세요.');
	    if (second !== '방 파기') return;
	    try {
	      await deleteConversation(conversationId);
	      closeRoomMenu();
	      onCloseChat();
	    } catch (err) {
	      alert(err.response?.data?.error || '채팅방을 파기하지 못했습니다.');
	    }
	  };

	  const handleTransferOwner = async (member) => {
	    if (!conversationId || !member?.userUid) return;
	    if (!window.confirm(`${member.displayName || member.username}님에게 방장을 위임할까요?`)) return;
	    try {
	      const conversation = await transferConversationOwner(conversationId, member.userUid);
	      refreshAfterRoomAction(conversation);
	    } catch (err) {
	      alert(err.response?.data?.error || '방장 위임에 실패했습니다.');
	    }
	  };

	  const handleToggleCoHost = async (member) => {
	    if (!conversationId || !member?.userUid) return;
	    const enabled = !coHostUids.includes(member.userUid);
	    try {
	      const conversation = await setConversationCoHost(conversationId, member.userUid, enabled);
	      refreshAfterRoomAction(conversation);
	    } catch (err) {
	      alert(err.response?.data?.error || '부방장 설정에 실패했습니다.');
	    }
	  };

	  const handleKickMember = async (member) => {
	    if (!conversationId || !member?.userUid) return;
	    if (!window.confirm(`${member.displayName || member.username}님을 채팅방에서 내보낼까요?`)) return;
	    try {
	      const conversation = await kickConversationParticipant(conversationId, member.userUid);
	      refreshAfterRoomAction(conversation);
	    } catch (err) {
	      alert(err.response?.data?.error || '내보내기에 실패했습니다.');
	    }
	  };

  const handleOpenMeeting = async () => {
    let finalConversationId = conversationId;

    if (!finalConversationId && activeChat?.userUid) {
      const conversation = await ensureDirectConversation(activeChat.userUid);
      finalConversationId = conversation?.conversationId || null;
      if (finalConversationId) {
        setRuntimeConversationId(finalConversationId);
        onConversationReady?.(conversation);
      }
    }

    if (!finalConversationId) {
      alert('채팅방이 준비된 뒤 회의를 시작할 수 있습니다.');
      return;
    }

    openAppWindow({
      id: 'meeting',
      title: '화상회의',
      width: 920,
      height: 640,
      payload: {
        roomCode: getConversationMeetingCode(finalConversationId),
        autoJoin: true,
        conversationId: finalConversationId
      }
    });
  };

  const handleInviteComplete = (conversation) => {
    if (!conversation?.conversationId) return;
    onConversationReady?.(conversation);
  };

  const handleSend = async () => {
    const value = drafts[draftKey] || '';
    if (!String(value).trim() && attachmentDrafts.length === 0) return;

    try {
      let finalConversationId = conversationId;

      if (!finalConversationId) {
        if (!activeChat?.userUid) {
          alert('이 채팅은 아직 시작할 수 없습니다.');
          return;
        }

        const conversation = await ensureDirectConversation(activeChat.userUid);
        finalConversationId = conversation?.conversationId || null;

        if (!finalConversationId) {
          throw new Error('conversation_not_created');
        }

        setRuntimeConversationId(finalConversationId);
        onConversationReady?.(conversation);
      }

      await sendMessage(finalConversationId, { text: value });
      setDraft(draftKey, '');
    } catch (err) {
      console.error('메시지 전송 실패', err);
      alert(err.response?.data?.error || '메시지 전송에 실패했습니다.');
    }
  };

  const handleDeviceInput = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (!conversationId) {
      alert('첫 메시지를 보낸 뒤 첨부를 추가할 수 있습니다.');
      return;
    }
    try {
      await createDeviceAttachmentBundle(conversationId, {
        files,
        manifest: buildManifestFromFiles(files),
      });
    } catch (err) {
      alert(err.response?.data?.error || '디바이스 첨부 추가에 실패했습니다.');
    }
  };

  const handleNasConfirm = async (paths) => {
    if (!conversationId) {
      alert('첫 메시지를 보낸 뒤 첨부를 추가할 수 있습니다.');
      return;
    }
    try {
      await createNasAttachmentBundle(conversationId, paths);
      setNasPickerOpen(false);
    } catch (err) {
      alert(err.response?.data?.error || 'NAS 첨부 추가에 실패했습니다.');
    }
  };

  const getMessageAction = (message) => {
    const entryCount = Array.isArray(message.viewerSavedEntries) ? message.viewerSavedEntries.length : 0;

    if (message.viewerSavedState === 'ready') {
      return { mode: 'open', label: entryCount > 1 ? '받은 파일 열기' : '열기' };
    }
    if (message.viewerSavedState === 'missing') {
      return { mode: 'redownload', label: '다시 다운로드' };
    }
    return { mode: 'download', label: '받은 파일에 저장' };
  };

  const handleOpenSavedTarget = async (message) => {
    const target = message?.viewerOpenTarget;
    if (!target?.relativePath) return;

    if (target.type === 'folder') {
      openFolderWindowByPath(target.relativePath, target.name || '받은 파일');
      return;
    }

    await openFileWindowByPath(target.relativePath, target.name || null, false);
  };

  const handleSaveReceived = async (messageId) => {
    if (!conversationId || !messageId) return;
    setSavingMessageIds((prev) => ({ ...prev, [messageId]: true }));
    try {
      const result = await saveReceivedAttachments(conversationId, messageId);
      const count = Array.isArray(result?.savedEntries) ? result.savedEntries.length : 0;
      if (!result?.alreadySaved) {
        alert(`받은 파일에 ${count}개 항목을 저장했습니다.`);
      }
    } catch (err) {
      alert(err.response?.data?.error || '받은 파일 저장에 실패했습니다.');
    } finally {
      setSavingMessageIds((prev) => ({ ...prev, [messageId]: false }));
    }
  };

  const renderAttachmentUploads = () => {
    if (attachmentUploads.length === 0) return null;

    return (
      <Box sx={{ px: 1.25, pt: 1.1, pb: 0.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {attachmentUploads.map((upload) => (
          <Paper
            key={upload.uploadId}
            variant="outlined"
            sx={{ p: 1, borderRadius: 2, backgroundColor: 'background.default' }}
          >
            <Typography variant="caption" sx={{ fontWeight: 800, display: 'block' }}>
              {upload.sourceType === 'nas' ? 'NAS 첨부 준비 중' : '내 PC 업로드 중'} · {upload.totalCount || 0}개
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.4 }}>
              {upload.statusText || '처리 중'}
              {typeof upload.progress === 'number' ? ` (${upload.progress}%)` : ''}
            </Typography>
            <LinearProgress
              sx={{ mt: 0.9 }}
              variant={typeof upload.progress === 'number' ? 'determinate' : 'indeterminate'}
              value={typeof upload.progress === 'number' ? upload.progress : undefined}
            />
          </Paper>
        ))}
      </Box>
    );
  };

  const renderAttachmentDrafts = () => {
    if (attachmentDrafts.length === 0) return null;

    return (
      <Box sx={{ px: 1.25, pt: 1.1, pb: 0.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {attachmentDrafts.map((bundle) => (
          <Paper
            key={bundle.bundleId}
            variant="outlined"
            sx={{ p: 1, borderRadius: 2, backgroundColor: 'background.default' }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ fontWeight: 800, display: 'block' }}>
                  {bundle.sourceType === 'nas' ? 'NAS 첨부' : '내 PC 첨부'} · {bundle.itemCount || 0}개
                </Typography>
                <Box sx={{ mt: 0.75, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {(bundle.items || []).map((item, idx) => (
                    <Chip
                      key={`${bundle.bundleId}_${idx}`}
                      size="small"
                      icon={item.type === 'folder' ? <FolderIcon /> : <InsertDriveFileIcon />}
                      label={item.relativePath || item.name}
                      sx={{ maxWidth: 260 }}
                    />
                  ))}
                </Box>
              </Box>
	          <IconButton
	            size="small"
                onClick={() => removeAttachmentBundle(conversationId, bundle.bundleId)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Paper>
        ))}
      </Box>
    );
  };

  const renderMessageAttachments = (message) => {
    const items = (message.attachments || []).flatMap((bundle) => bundle.items || []);
    if (items.length === 0) return null;

    return (
      <Box sx={{ mt: message.text ? 0.75 : 0, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
        {items.map((item, idx) => (
          <Box
            key={`${message.messageId}_${idx}`}
            sx={{
              px: 1,
              py: 0.75,
              borderRadius: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              backgroundColor: 'rgba(255,255,255,0.12)',
            }}
          >
            {getAttachmentItemIcon(item)}
            <Typography
              variant="caption"
              className="chat-text-selectable"
              sx={{
                userSelect: 'text',
                WebkitUserSelect: 'text',
                wordBreak: 'break-all',
              }}
            >
              {item.relativePath || item.name}
            </Typography>
          </Box>
        ))}
      </Box>
    );
  };

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: isMobile ? 0 : 'auto',
        right: isMobile ? 0 : '100%',
        width: isMobile ? '100%' : sidebarWidth,
        transform: 'none',
        boxSizing: 'border-box',
        borderRadius: 0,
        borderTop: `1px solid ${theme.palette.divider}`,
        borderRight: `1px solid ${theme.palette.divider}`,
        borderLeft: isMobile ? 'none' : `1px solid ${theme.palette.divider}`,
        borderBottom: `1px solid ${theme.palette.divider}`,
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: isMobile ? 3 : 0,
        pointerEvents: 'none',
      }}
    >
      <Box
        sx={{
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'auto',
        }}
      >
      <input
        ref={deviceFilesInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          handleDeviceInput(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={deviceFolderInputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          handleDeviceInput(e.target.files);
          e.target.value = '';
        }}
      />

      <Box
        sx={{
          px: 1.25,
          py: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: theme.palette.mode === 'dark' ? '#111827' : '#f8fafc',
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 1 }}>
          {isMobile && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onCloseChat();
              }}
              title="채팅 목록으로 돌아가기"
              sx={{
                border: `1px solid ${theme.palette.divider}`,
                bgcolor: 'background.paper',
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
          <Button
            size="small"
            variant="outlined"
            startIcon={<OpenInNewIcon />}
            onClick={(e) => {
              e.stopPropagation();
              if (!conversationId) {
                alert('첫 메시지를 보낸 뒤 채팅관리 창으로 이동할 수 있습니다.');
                return;
              }
              onOpenWindow();
            }}
          >
            window
          </Button>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              handleOpenMeeting();
            }}
            title="화상회의 시작"
            sx={{
              border: `1px solid ${theme.palette.divider}`,
              bgcolor: 'background.paper',
            }}
          >
            <VideocamIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setInviteDialogOpen(true);
            }}
            title="인원 추가"
            sx={{
              border: `1px solid ${theme.palette.divider}`,
              bgcolor: 'background.paper',
            }}
	          >
	            <PersonAddIcon fontSize="small" />
	          </IconButton>
	          {isGroupChat && (
	            <IconButton
	              size="small"
	              onClick={(e) => {
	                e.stopPropagation();
	                setRoomMenuAnchorEl(e.currentTarget);
	              }}
	              title="채팅방 관리"
	              sx={{
	                border: `1px solid ${theme.palette.divider}`,
	                bgcolor: 'background.paper',
	              }}
	            >
	              <MoreVertIcon fontSize="small" />
	            </IconButton>
	          )}
          <Avatar
            sx={{
              width: 28,
              height: 28,
              bgcolor:
                activeChat.conversationType === 'group'
                  ? 'secondary.main'
                  : activeChat.role === 'MASTER'
                  ? 'error.main'
                  : activeChat.role === 'MANAGER'
                  ? 'warning.main'
                  : 'primary.main',
              fontSize: '0.85rem',
              fontWeight: 'bold',
            }}
          >
            {(activeChat.title || activeChat.displayName || activeChat.username || '?')?.[0]?.toUpperCase()}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
              {activeChat.title || activeChat.username}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {activeChat.subtitle || (
                activeChat.displayName && activeChat.displayName !== activeChat.username
                  ? activeChat.displayName
                  : (activeChat.role || '채팅')
              )}
            </Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ px: 1.5, py: 1, bgcolor: 'background.default', borderBottom: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="caption" color="text.secondary">
          {conversationId
            ? '사이드 채팅은 + 버튼으로만 첨부를 추가합니다.'
            : '첫 메시지를 보내기 전까지는 첨부를 추가할 수 없습니다.'}
        </Typography>
      </Box>

      <Box
        ref={messageListRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          p: 1.5,
          bgcolor: 'background.default',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          overscrollBehavior: 'contain',
        }}
        onDragStart={(e) => e.preventDefault()}
      >
        {messages.length === 0 ? (
          <Typography variant="caption" color="text.secondary">
            아직 대화가 없습니다.
          </Typography>
        ) : messages.map((msg) => {
          const isMine = msg.senderUid === currentUserUid || msg.sender === 'me';
          const key = msg.messageId || msg.id || `${conversationId}_${msg.createdAt}`;
          const hasAttachments = Array.isArray(msg.attachments) && msg.attachments.length > 0;
          const messageAction = getMessageAction(msg);

          return (
            <Box
              key={key}
              sx={{
                display: 'flex',
                justifyContent: isMine ? 'flex-end' : 'flex-start',
                mb: 1,
              }}
              onDragStart={(e) => e.preventDefault()}
            >
              <Box
                sx={{
                  maxWidth: '80%',
                  px: 1.25,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: isMine ? 'primary.main' : 'background.paper',
                  color: isMine ? 'primary.contrastText' : 'text.primary',
                  border: isMine ? 'none' : `1px solid ${theme.palette.divider}`,
                  boxShadow: 1,
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                }}
                onDragStart={(e) => e.preventDefault()}
              >
                {!!msg.text && (
                  <Typography
                    className="chat-text-selectable"
                    variant="body2"
                    sx={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      userSelect: 'text',
                      WebkitUserSelect: 'text',
                      cursor: 'text',
                    }}
                    onDragStart={(e) => e.preventDefault()}
                  >
                    {msg.text}
                  </Typography>
                )}

                {renderMessageAttachments(msg)}

                {hasAttachments && (
                  <Box sx={{ mt: 0.9, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => messageAction.mode === 'open'
                        ? handleOpenSavedTarget(msg)
                        : handleSaveReceived(msg.messageId)}
                      disabled={messageAction.mode !== 'open' && !!savingMessageIds[msg.messageId]}
                    >
                      {messageAction.mode !== 'open' && savingMessageIds[msg.messageId]
                        ? '저장 중...'
                        : messageAction.label}
                    </Button>
                  </Box>
                )}

                <Typography
                  variant="caption"
                  sx={{
                    mt: 0.5,
                    display: 'block',
                    textAlign: 'right',
                    color: isMine ? 'rgba(255,255,255,0.82)' : 'text.secondary',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }}
                >
                  {formatMessageTime(msg.createdAt)}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>

      {renderAttachmentUploads()}
      {renderAttachmentDrafts()}

      <Divider />

      <Box sx={{ p: 1.25, pb: 'calc(10px + var(--app-safe-bottom))', display: 'flex', gap: 1, alignItems: 'flex-end', bgcolor: 'background.paper', flexShrink: 0 }}>
        <IconButton onClick={(e) => setAttachMenuAnchorEl(e.currentTarget)}>
          <AddIcon />
        </IconButton>

        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          placeholder={attachmentDrafts.length > 0 ? '첨부와 함께 보낼 메시지를 입력하세요' : '메시지를 입력하세요'}
          value={drafts[draftKey] || ''}
          onChange={(e) => setDraft(draftKey, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
        />
        <Button variant="contained" onClick={handleSend} sx={{ minWidth: 96, height: 40 }}>
          전송
        </Button>
      </Box>

	      <Menu
        anchorEl={attachMenuAnchorEl}
        open={Boolean(attachMenuAnchorEl)}
        onClose={closeAttachMenu}
      >
        <MenuItem
          onClick={() => {
            closeAttachMenu();
            deviceFilesInputRef.current?.click();
          }}
        >
          내 PC 파일 선택
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeAttachMenu();
            deviceFolderInputRef.current?.click();
          }}
        >
          내 PC 폴더 선택
        </MenuItem>
        <MenuItem
          onClick={() => {
            closeAttachMenu();
            setNasPickerOpen(true);
          }}
        >
          NAS에서 선택
        </MenuItem>
	      </Menu>

	      <Menu
	        anchorEl={roomMenuAnchorEl}
	        open={Boolean(roomMenuAnchorEl)}
	        onClose={closeRoomMenu}
	        PaperProps={{ sx: { width: 320, maxWidth: 'calc(100vw - 24px)' } }}
	      >
	        <Box sx={{ px: 1.5, py: 1 }}>
	          <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>채팅방 관리</Typography>
	          <Typography variant="caption" color="text.secondary">
	            {viewerRole === 'owner' ? '방장' : viewerRole === 'cohost' ? '부방장' : '멤버'}
	          </Typography>
	        </Box>
	        <Divider />
	        {roomParticipants.map((member) => {
	          const isOwner = member.userUid === ownerUid;
	          const isCoHost = coHostUids.includes(member.userUid);
	          const isMe = member.userUid === currentUserUid;
	          return (
	            <Box key={member.userUid} sx={{ px: 1.25, py: 0.9 }}>
	              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
	                <Avatar sx={{ width: 26, height: 26, fontSize: 12 }}>
	                  {(member.displayName || member.username || '?').slice(0, 1)}
	                </Avatar>
	                <Box sx={{ flex: 1, minWidth: 0 }}>
	                  <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
	                    {member.displayName || member.username}
	                  </Typography>
	                  <Typography variant="caption" color="text.secondary">
	                    {isOwner ? '방장' : isCoHost ? '부방장' : '멤버'}{isMe ? ' · 나' : ''}
	                  </Typography>
	                </Box>
	              </Box>
	              {!isMe && viewerCanManage && !isOwner && (
	                <Box sx={{ mt: 0.75, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
	                  {viewerCanDelete && (
	                    <>
	                      <Button size="small" variant="text" onClick={() => handleTransferOwner(member)}>
	                        방장위임
	                      </Button>
	                      <Button size="small" variant="text" onClick={() => handleToggleCoHost(member)}>
	                        {isCoHost ? '부방장 해제' : '부방장'}
	                      </Button>
	                    </>
	                  )}
	                  <Button size="small" color="error" variant="text" onClick={() => handleKickMember(member)}>
	                    내보내기
	                  </Button>
	                </Box>
	              )}
	            </Box>
	          );
	        })}
	        <Divider />
	        <MenuItem onClick={handleLeaveRoom}>채팅방 나가기</MenuItem>
	        {viewerCanDelete && (
	          <MenuItem onClick={handleDeleteRoom} sx={{ color: 'error.main', fontWeight: 900 }}>
	            채팅방 파기
	          </MenuItem>
	        )}
	      </Menu>

      <ChatNasPickerDialog
        open={nasPickerOpen}
        onClose={() => setNasPickerOpen(false)}
        onConfirm={handleNasConfirm}
      />
      <ChatInviteDialog
        open={inviteDialogOpen}
        onClose={() => setInviteDialogOpen(false)}
        conversation={{
          conversationId,
          type: activeChat.conversationType,
          title: activeChat.title,
          participantUids: activeChat.participantUids,
          pendingInviteUids: activeChat.pendingInviteUids,
        }}
        directUserUid={activeChat.userUid}
        defaultTitle={`${activeChat.title || activeChat.displayName || activeChat.username || '채팅'} 그룹`}
        onComplete={handleInviteComplete}
      />
      </Box>
    </Paper>
  );
};

export default DockedChatPanel;
