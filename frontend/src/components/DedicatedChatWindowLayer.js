import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  TextField,
  Button,
  Avatar,
  Divider,
  useTheme,
  Menu,
  MenuItem,
  Chip,
  LinearProgress,
} from '@mui/material';
import { Rnd } from 'react-rnd';
import RemoveIcon from '@mui/icons-material/Remove';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import AddIcon from '@mui/icons-material/Add';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ImageIcon from '@mui/icons-material/Image';
import VideocamIcon from '@mui/icons-material/Videocam';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useWindows } from '../contexts/WindowContext';
import { useChat } from '../contexts/ChatContext';
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

const getConversationMeetingCode = (conversationId) =>
  `CHAT-${String(conversationId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-24).toUpperCase() || Date.now().toString(36).toUpperCase()}`;

const buildManifestFromFiles = (files = []) => {
  return files.map((file) => ({
    originalName: file.name,
    relativePath: file.webkitRelativePath || file.name,
  }));
};

const readEntryRecursively = async (entry, prefix = '') => {
  if (!entry) return [];

  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{
      file,
      relativePath: `${prefix}${file.name}`,
    }];
  }

  if (entry.isDirectory) {
    const dirName = entry.name || '';
    const reader = entry.createReader();
    const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    let result = [];
    for (const child of children) {
      result = result.concat(await readEntryRecursively(child, `${prefix}${dirName}/`));
    }
    return result;
  }

  return [];
};

const extractDroppedDeviceFiles = async (dataTransfer) => {
  const items = dataTransfer?.items ? Array.from(dataTransfer.items) : [];
  if (items.length > 0 && items.some((item) => item.webkitGetAsEntry && item.webkitGetAsEntry())) {
    let out = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (!entry) continue;
      out = out.concat(await readEntryRecursively(entry, ''));
    }
    return out;
  }

  const files = Array.from(dataTransfer?.files || []);
  return files.map((file) => ({
    file,
    relativePath: file.webkitRelativePath || file.name,
  }));
};

const DedicatedChatWindowLayer = () => {
  const theme = useTheme();
  const messageViewportRefs = useRef({});
  const deviceFilesInputRefs = useRef({});
  const deviceFolderInputRefs = useRef({});

  const {
    openWindows,
    setOpenWindows,
    focusedContext,
    focusWindow,
    closeWindow,
    toggleMinimize,
    toggleMaximize,
    openFolderWindowByPath,
    openFileWindowByPath,
    openAppWindow,
  } = useWindows();

  const {
    currentUserUid,
    conversations,
    drafts,
    setDraft,
    messagesByConversation,
    attachmentDraftsByConversation,
    attachmentUploadStateByConversation,
    loadMessages,
    sendMessage,
    markConversationRead,
    saveReceivedAttachments,
    createDeviceAttachmentBundle,
    createNasAttachmentBundle,
    removeAttachmentBundle,
  } = useChat();

  const [attachMenuAnchorEl, setAttachMenuAnchorEl] = useState(null);
  const [attachMenuWindowId, setAttachMenuWindowId] = useState(null);
  const [nasPickerState, setNasPickerState] = useState({ open: false, conversationId: null });
  const [dragOverConversationId, setDragOverConversationId] = useState(null);
  const [savingMessageIds, setSavingMessageIds] = useState({});
  const [inviteWindow, setInviteWindow] = useState(null);

  const windowChats = useMemo(() => {
    const raw = openWindows.filter((w) => w.winType === 'chat' && w.chatMode === 'window');
    const deduped = new Map();
    raw.forEach((w) => {
      const key = w.chatUserUid || w.id;
      deduped.set(key, w);
    });
    return Array.from(deduped.values());
  }, [openWindows]);

  const conversationIdsKey = useMemo(
    () => windowChats.map((win) => win.chatConversationId).filter(Boolean).join('|'),
    [windowChats]
  );

  useEffect(() => {
    Object.values(deviceFolderInputRefs.current).forEach((input) => {
      if (!input) return;
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
      input.multiple = true;
    });
  }, [windowChats]);

  useEffect(() => {
    windowChats.forEach((win) => {
      if (win.chatConversationId) {
        loadMessages(win.chatConversationId, { force: true });
      }
    });
  }, [conversationIdsKey, windowChats, loadMessages]);

  useEffect(() => {
    windowChats.forEach((win) => {
      const conversationId = win.chatConversationId;
      if (!conversationId) return;

      const messages = messagesByConversation[conversationId] || [];
      const hasUnreadFromOther = messages.some((msg) =>
        msg.senderUid !== currentUserUid &&
        !msg.deleted &&
        !(Array.isArray(msg.readByUids) ? msg.readByUids : []).includes(currentUserUid)
      );

      if (hasUnreadFromOther) {
        markConversationRead(conversationId);
      }
    });
  }, [windowChats, messagesByConversation, currentUserUid, markConversationRead]);

  useEffect(() => {
    const moveToBottom = () => {
      windowChats.forEach((win) => {
        const conversationId = win.chatConversationId;
        if (!conversationId) return;
        const el = messageViewportRefs.current[conversationId];
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      });
    };

    requestAnimationFrame(moveToBottom);
    const timer = setTimeout(moveToBottom, 0);
    return () => clearTimeout(timer);
  }, [windowChats, messagesByConversation, attachmentDraftsByConversation, attachmentUploadStateByConversation]);

  if (windowChats.length === 0) return null;

  const closeAttachMenu = () => {
    setAttachMenuAnchorEl(null);
    setAttachMenuWindowId(null);
  };

  const handleSend = async (win) => {
    const conversationId = win.chatConversationId;
    if (!conversationId) return;

    const value = drafts[conversationId] || '';
    const attachmentDrafts = attachmentDraftsByConversation[conversationId] || [];
    if (!String(value).trim() && attachmentDrafts.length === 0) return;

    try {
      await sendMessage(conversationId, { text: value });
      setDraft(conversationId, '');
    } catch (err) {
      console.error('메시지 전송 실패', err);
      alert(err.response?.data?.error || '메시지 전송에 실패했습니다.');
    }
  };

  const handleDeviceInput = async (conversationId, fileList) => {
    const files = Array.from(fileList || []);
    if (!conversationId || files.length === 0) return;

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
    const conversationId = nasPickerState.conversationId;
    if (!conversationId) return;
    try {
      await createNasAttachmentBundle(conversationId, paths);
      setNasPickerState({ open: false, conversationId: null });
    } catch (err) {
      alert(err.response?.data?.error || 'NAS 첨부 추가에 실패했습니다.');
    }
  };

  const handleWindowDrop = async (e, conversationId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverConversationId(null);

    if (!conversationId) return;

    try {
      const appDragData = e.dataTransfer.getData('application/json');
      if (appDragData) {
        const parsed = JSON.parse(appDragData);
        const draggedPaths = Array.isArray(parsed.draggedPaths) ? parsed.draggedPaths : [];
        if (draggedPaths.length > 0) {
          await createNasAttachmentBundle(conversationId, draggedPaths);
          return;
        }
      }
    } catch (err) {
      console.warn('내부 드래그 데이터 파싱 실패', err);
    }

    try {
      const dropped = await extractDroppedDeviceFiles(e.dataTransfer);
      if (dropped.length === 0) return;

      await createDeviceAttachmentBundle(conversationId, {
        files: dropped.map((item) => item.file),
        manifest: dropped.map((item) => ({
          originalName: item.file.name,
          relativePath: item.relativePath,
        })),
      });
    } catch (err) {
      alert(err.response?.data?.error || '드롭 첨부 추가에 실패했습니다.');
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

  const handleOpenMeeting = (conversationId) => {
    if (!conversationId) return;
    openAppWindow({
      id: 'meeting',
      title: '화상회의',
      width: 920,
      height: 640,
      payload: {
        roomCode: getConversationMeetingCode(conversationId),
        autoJoin: true,
        conversationId,
      },
    });
  };

  const handleInviteComplete = (win, conversation) => {
    if (!win?.id || !conversation?.conversationId) return;
    setOpenWindows((prev) =>
      prev.map((item) =>
        item.id === win.id
          ? {
              ...item,
              chatConversationId: conversation.conversationId,
              chatUsername: conversation.title || item.chatUsername || '그룹 채팅',
              chatDisplayName: conversation.title || item.chatDisplayName || '그룹 채팅',
              chatRole: conversation.type === 'group' ? 'GROUP' : item.chatRole,
              chatUserUid: conversation.type === 'group' ? null : item.chatUserUid,
            }
          : item
      )
    );
  };

  const handleSaveReceived = async (conversationId, messageId) => {
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

  const renderAttachmentUploads = (conversationId) => {
    const uploadsForConversation = attachmentUploadStateByConversation[conversationId] || [];
    if (uploadsForConversation.length === 0) return null;

    return (
      <Box sx={{ px: 1.25, pt: 1.1, pb: 0.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {uploadsForConversation.map((upload) => (
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

  const renderAttachmentDrafts = (conversationId) => {
    const draftsForConversation = attachmentDraftsByConversation[conversationId] || [];
    if (draftsForConversation.length === 0) return null;

    return (
      <Box sx={{ px: 1.25, pt: 1.1, pb: 0.25, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {draftsForConversation.map((bundle) => (
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
                      sx={{ maxWidth: 320 }}
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
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 1450,
      }}
    >
      {windowChats.map((win) => {
        const isActive = focusedContext === win.id;
        const fillsParent = !!win.isMaximized;
        const conversationId = win.chatConversationId || null;
        const messages = conversationId ? (messagesByConversation[conversationId] || []) : [];
        const draftValue = conversationId ? (drafts[conversationId] || '') : '';
        const isDragOver = conversationId && dragOverConversationId === conversationId;

        return (
          <Box
            key={win.id}
            sx={{
              display: win.isMinimized ? 'none' : 'block',
              pointerEvents: 'auto',
            }}
          >
            <input
              ref={(node) => { if (node) deviceFilesInputRefs.current[win.id] = node; }}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                handleDeviceInput(conversationId, e.target.files);
                e.target.value = '';
              }}
            />
            <input
              ref={(node) => { if (node) deviceFolderInputRefs.current[win.id] = node; }}
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => {
                handleDeviceInput(conversationId, e.target.files);
                e.target.value = '';
              }}
            />

            <Rnd
              size={fillsParent ? { width: '100vw', height: 'calc(100vh - 48px)' } : { width: win.width, height: win.height }}
              position={fillsParent ? { x: 0, y: 48 } : { x: win.x, y: win.y }}
              onMouseDown={(e) => {
                e.stopPropagation();
                focusWindow(win.id);
              }}
              dragHandleClassName="dedicated-chat-window-header"
              cancel=".MuiIconButton-root,.MuiButton-root,.MuiInputBase-root,button,input,textarea"
              enableUserSelectHack={true}
              bounds="window"
              disableDragging={fillsParent}
              enableResizing={!fillsParent}
              onDragStart={() => {
                document.body.style.userSelect = 'none';
                document.body.style.webkitUserSelect = 'none';
              }}
              onDrag={(e, d) => {
                setOpenWindows((prev) =>
                  prev.map((w) => (w.id === win.id ? { ...w, x: d.x, y: d.y } : w))
                );
              }}
              onDragStop={(e, d) => {
                document.body.style.userSelect = '';
                document.body.style.webkitUserSelect = '';
                setOpenWindows((prev) =>
                  prev.map((w) => (w.id === win.id ? { ...w, x: d.x, y: d.y } : w))
                );
              }}
              onResizeStop={(e, direction, ref, delta, position) => {
                setOpenWindows((prev) =>
                  prev.map((w) =>
                    w.id === win.id
                      ? {
                          ...w,
                          width: ref.style.width,
                          height: ref.style.height,
                          x: position.x,
                          y: position.y,
                        }
                      : w
                  )
                );
              }}
              style={{ zIndex: fillsParent ? 99999 : win.zIndex }}
            >
              <Paper
                elevation={isActive ? 12 : 4}
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  height: '100%',
                  overflow: 'hidden',
                  border: isActive ? `2px solid ${theme.palette.primary.main}` : `1px solid ${theme.palette.divider}`,
                  borderRadius: fillsParent ? 0 : 2,
                  bgcolor: 'background.paper',
                }}
              >
                <Box
                  className="dedicated-chat-window-header"
                  sx={{
                    px: 1.25,
                    py: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    bgcolor: theme.palette.mode === 'dark' ? '#111827' : '#f8fafc',
                    borderBottom: `1px solid ${theme.palette.divider}`,
                    cursor: fillsParent ? 'default' : 'move',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: 1 }}>
                    <Avatar
                      sx={{
                        width: 28,
                        height: 28,
                        bgcolor:
                          win.chatRole === 'MASTER'
                            ? 'error.main'
                            : win.chatRole === 'MANAGER'
                            ? 'warning.main'
                            : 'primary.main',
                        fontSize: '0.85rem',
                        fontWeight: 'bold',
                      }}
                    >
                      {(win.chatUsername || win.name || '?')[0]?.toUpperCase()}
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 800 }} noWrap>
                        {win.chatUsername || win.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {win.chatDisplayName && win.chatDisplayName !== win.chatUsername
                          ? win.chatDisplayName
                          : (win.chatRole || '채팅')}
                      </Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleOpenMeeting(conversationId); }} title="화상회의 시작">
                      <VideocamIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); setInviteWindow(win); }} title="인원 추가">
                      <PersonAddIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleMinimize(win.id); }} title="최소화">
                      <RemoveIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleMaximize(win.id); }} title="최대화">
                      <CropSquareIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); closeWindow(win.id); }} title="닫기">
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Box>

                <Box
                  ref={(node) => {
                    if (conversationId) {
                      if (node) messageViewportRefs.current[conversationId] = node;
                      else delete messageViewportRefs.current[conversationId];
                    }
                  }}
                  sx={{
                    flex: 1,
                    overflowY: 'auto',
                    p: 1.5,
                    bgcolor: isDragOver ? 'action.hover' : 'background.default',
                    userSelect: 'text',
                    WebkitUserSelect: 'text',
                    overscrollBehavior: 'contain',
                    border: isDragOver ? `2px dashed ${theme.palette.primary.main}` : 'none',
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (conversationId) setDragOverConversationId(conversationId);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverConversationId((prev) => (prev === conversationId ? null : prev));
                  }}
                  onDrop={(e) => handleWindowDrop(e, conversationId)}
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
                                  : handleSaveReceived(conversationId, msg.messageId)}
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

                {conversationId && renderAttachmentUploads(conversationId)}
                {conversationId && renderAttachmentDrafts(conversationId)}

                <Divider />

                <Box sx={{ p: 1.25, display: 'flex', gap: 1, alignItems: 'flex-end', bgcolor: 'background.paper' }}>
                  <IconButton
                    onClick={(e) => {
                      setAttachMenuAnchorEl(e.currentTarget);
                      setAttachMenuWindowId(win.id);
                    }}
                  >
                    <AddIcon />
                  </IconButton>

                  <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={4}
                    placeholder="메시지를 입력하세요"
                    value={draftValue}
                    onChange={(e) => {
                      if (conversationId) setDraft(conversationId, e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend(win);
                      }
                    }}
                  />
                  <Button
                    variant="contained"
                    onClick={() => handleSend(win)}
                    sx={{ minWidth: 96, height: 40 }}
                    endIcon={<SendIcon />}
                  >
                    전송
                  </Button>
                </Box>
              </Paper>
            </Rnd>
          </Box>
        );
      })}

      <Menu
        anchorEl={attachMenuAnchorEl}
        open={Boolean(attachMenuAnchorEl)}
        onClose={closeAttachMenu}
      >
        <MenuItem
          onClick={() => {
            const win = windowChats.find((item) => item.id === attachMenuWindowId);
            closeAttachMenu();
            if (win?.id) deviceFilesInputRefs.current[win.id]?.click();
          }}
        >
          내 PC 파일 선택
        </MenuItem>
        <MenuItem
          onClick={() => {
            const win = windowChats.find((item) => item.id === attachMenuWindowId);
            closeAttachMenu();
            if (win?.id) deviceFolderInputRefs.current[win.id]?.click();
          }}
        >
          내 PC 폴더 선택
        </MenuItem>
        <MenuItem
          onClick={() => {
            const win = windowChats.find((item) => item.id === attachMenuWindowId);
            closeAttachMenu();
            if (win?.chatConversationId) {
              setNasPickerState({ open: true, conversationId: win.chatConversationId });
            }
          }}
        >
          NAS에서 선택
        </MenuItem>
      </Menu>

      <ChatNasPickerDialog
        open={nasPickerState.open}
        onClose={() => setNasPickerState({ open: false, conversationId: null })}
        onConfirm={handleNasConfirm}
      />
      <ChatInviteDialog
        open={!!inviteWindow}
        onClose={() => setInviteWindow(null)}
        conversation={
          inviteWindow
            ? (
                conversations.find((item) => item.conversationId === inviteWindow.chatConversationId) || {
                  conversationId: inviteWindow.chatConversationId,
                  type: inviteWindow.chatRole === 'GROUP' ? 'group' : 'direct',
                  title: inviteWindow.chatDisplayName || inviteWindow.chatUsername,
                }
              )
            : null
        }
        directUserUid={inviteWindow?.chatUserUid || null}
        defaultTitle={`${inviteWindow?.chatDisplayName || inviteWindow?.chatUsername || '채팅'} 그룹`}
        onComplete={(conversation) => handleInviteComplete(inviteWindow, conversation)}
      />
    </Box>
  );
};

export default DedicatedChatWindowLayer;
