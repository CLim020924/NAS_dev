import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import axios from 'axios';
import { useChat } from '../contexts/ChatContext';

const parseInvitees = (value) =>
  String(value || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

const ChatInviteDialog = ({
  open,
  onClose,
  conversation = null,
  directUserUid = null,
  defaultTitle = '',
  onComplete = () => {},
}) => {
  const theme = useTheme();
  const {
    createGroupConversation,
    inviteToConversation,
    loadConversations,
  } = useChat();

  const isGroup = conversation?.type === 'group' || conversation?.conversationType === 'group';
  const [friendOptions, setFriendOptions] = useState([]);
  const [selectedInviteUids, setSelectedInviteUids] = useState([]);
  const [inviteText, setInviteText] = useState('');
  const [roomTitle, setRoomTitle] = useState(defaultTitle || '그룹 채팅');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRoomTitle(defaultTitle || '그룹 채팅');
    setSelectedInviteUids([]);
    setInviteText('');
  }, [defaultTitle, open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    axios.get('/api/friends/sidebar', { withCredentials: true })
      .then((res) => {
        if (cancelled) return;
        setFriendOptions(Array.isArray(res.data?.friends) ? res.data.friends : []);
      })
      .catch(() => {
        if (!cancelled) setFriendOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectableFriends = useMemo(() => {
    const existing = new Set([
      ...(Array.isArray(conversation?.participantUids) ? conversation.participantUids : []),
      ...(Array.isArray(conversation?.pendingInviteUids) ? conversation.pendingInviteUids : []),
      directUserUid,
    ].filter(Boolean));

    return friendOptions.filter((friend) => !existing.has(friend.userUid));
  }, [conversation, directUserUid, friendOptions]);

  const handleToggleInviteUid = (userUid) => {
    setSelectedInviteUids((prev) =>
      prev.includes(userUid)
        ? prev.filter((uid) => uid !== userUid)
        : [...prev, userUid]
    );
  };

  const handleSubmit = async () => {
    const typedInvitees = parseInvitees(inviteText);
    const baseInviteUids = isGroup ? [] : [directUserUid].filter(Boolean);
    const inviteeUids = Array.from(new Set([...baseInviteUids, ...selectedInviteUids]));

    if (selectedInviteUids.length === 0 && typedInvitees.length === 0) {
      alert('초대할 친구나 아이디를 하나 이상 입력하세요.');
      return;
    }

    setSubmitting(true);
    try {
      const updatedConversation = isGroup
        ? await inviteToConversation(conversation.conversationId, {
            inviteeUids: selectedInviteUids,
            invitees: typedInvitees,
          })
        : await createGroupConversation({
            title: roomTitle || defaultTitle || '그룹 채팅',
            inviteeUids,
            invitees: typedInvitees,
          });

      await loadConversations({ silent: true });
      onComplete(updatedConversation);
      onClose();
    } catch (err) {
      alert(err.response?.data?.error || '초대에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{isGroup ? '인원 추가' : '그룹 채팅으로 초대'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {!isGroup && (
          <TextField
            label="채팅방 이름"
            value={roomTitle}
            onChange={(event) => setRoomTitle(event.target.value)}
            fullWidth
            size="small"
          />
        )}
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
            친구 초대
          </Typography>
          <Box sx={{ maxHeight: 170, overflowY: 'auto', border: `1px solid ${theme.palette.divider}`, borderRadius: 1, p: 1 }}>
            {selectableFriends.length === 0 ? (
              <Typography variant="body2" color="text.secondary">추가할 수 있는 친구가 없습니다.</Typography>
            ) : (
              selectableFriends.map((friend) => (
                <FormControlLabel
                  key={friend.userUid}
                  control={
                    <Checkbox
                      checked={selectedInviteUids.includes(friend.userUid)}
                      onChange={() => handleToggleInviteUid(friend.userUid)}
                    />
                  }
                  label={`${friend.displayName || friend.username} (${friend.username})`}
                  sx={{ display: 'flex', mr: 0 }}
                />
              ))
            )}
          </Box>
        </Box>
        <TextField
          label="아이디 또는 닉네임으로 초대"
          value={inviteText}
          onChange={(event) => setInviteText(event.target.value)}
          placeholder="쉼표 또는 줄바꿈으로 여러 명 입력"
          fullWidth
          multiline
          minRows={2}
          size="small"
        />
        <Typography variant="caption" color="text.secondary">
          초대받은 사용자가 수락하면 이 채팅방과 연결된 화상회의에 참가할 수 있습니다.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>취소</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting}>
          {isGroup ? '초대' : '그룹 만들기'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ChatInviteDialog;
