import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Divider,
  Avatar,
} from '@mui/material';

const ChatView = ({ win }) => {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    setMessages([
      {
        id: 'welcome',
        sender: 'system',
        text: `${win.chatDisplayName || win.chatUsername || win.name}님과의 채팅창입니다. 실시간 연결은 다음 단계에서 붙이면 됩니다.`,
      },
    ]);
  }, [win.id, win.chatDisplayName, win.chatUsername, win.name]);

  const handleSend = () => {
    const value = draft.trim();
    if (!value) return;

    setMessages((prev) => [
      ...prev,
      {
        id: `msg_${Date.now()}`,
        sender: 'me',
        text: value,
      },
    ]);
    setDraft('');
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <Box
        sx={{
          px: 2,
          py: 1.25,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
          bgcolor: 'background.paper',
        }}
      >
        <Avatar
          sx={{
            width: 34,
            height: 34,
            bgcolor:
              win.chatRole === 'MASTER'
                ? 'error.main'
                : win.chatRole === 'MANAGER'
                ? 'warning.main'
                : 'primary.main',
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

      <Box sx={{ px: 2, py: 1, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}>
        <Typography variant="caption" color="text.secondary">
          여기부터는 기존 NAS 윈도우 내부 본문에 들어간 채팅 영역입니다.
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        {messages.map((msg) => (
          <Box
            key={msg.id}
            sx={{
              display: 'flex',
              justifyContent: msg.sender === 'me' ? 'flex-end' : 'flex-start',
              mb: 1,
            }}
          >
            <Box
              sx={{
                maxWidth: '80%',
                px: 1.25,
                py: 1,
                borderRadius: 2,
                bgcolor: msg.sender === 'me' ? 'primary.main' : 'background.paper',
                color: msg.sender === 'me' ? 'primary.contrastText' : 'text.primary',
                border: msg.sender === 'me' ? 'none' : (theme) => `1px solid ${theme.palette.divider}`,
                boxShadow: 1,
              }}
            >
              <Typography variant="body2">{msg.text}</Typography>
            </Box>
          </Box>
        ))}
      </Box>

      <Divider />

      <Box sx={{ p: 1.5, display: 'flex', gap: 1, alignItems: 'flex-end', bgcolor: 'background.paper' }}>
        <TextField
          fullWidth
          multiline
          minRows={2}
          maxRows={4}
          placeholder="메시지를 입력하세요"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
    </Box>
  );
};

export default ChatView;
