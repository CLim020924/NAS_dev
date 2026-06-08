import React from 'react';
import {
  Paper,
  Box,
  Typography,
  IconButton,
  TextField,
  InputAdornment,
  CircularProgress,
  List,
  ListItemButton,
  ListItemAvatar,
  Avatar,
  ListItemText,
  Divider,
  Button,
  Chip,
  Stack,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import DoneIcon from '@mui/icons-material/Done';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import BlockIcon from '@mui/icons-material/Block';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import StarIcon from '@mui/icons-material/Star';

const FriendManagePanel = ({
  open,
  width,
  manageSearchQuery,
  setManageSearchQuery,
  searching,
  searchResults,
  incomingRequests,
  outgoingRequests,
  blockedUsers,
  onClose,
  onRequestFriend,
  onAccept,
  onReject,
  onToggleBlock,
}) => {
  if (!open) return null;

  const renderSearchAction = (u) => {
    if (u.isBlockedByMe) {
      return (
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<LockOpenIcon />}
          onClick={(e) => {
            e.stopPropagation();
            onToggleBlock(u.userUid, false);
          }}
        >
          차단해제
        </Button>
      );
    }

    if (u.isBlockedMe) {
      return <Chip size="small" label="상대방이 차단" color="default" variant="outlined" />;
    }

    if (u.relationStatus === 'ACCEPTED') {
      return (
        <Stack direction="row" spacing={0.5}>
          {u.isFavorite && <Chip size="small" icon={<StarIcon />} label="즐겨찾기" color="warning" variant="outlined" />}
          <Chip size="small" label="친구" color="success" variant="outlined" />
        </Stack>
      );
    }

    if (u.relationStatus === 'OUTGOING') {
      return <Chip size="small" label="요청중" color="warning" variant="outlined" />;
    }

    if (u.relationStatus === 'INCOMING') {
      return (
        <Stack direction="row" spacing={0.5}>
          <Button
            size="small"
            variant="contained"
            color="primary"
            startIcon={<DoneIcon />}
            onClick={(e) => {
              e.stopPropagation();
              onAccept(u.relationId);
            }}
          >
            수락
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<CloseRoundedIcon />}
            onClick={(e) => {
              e.stopPropagation();
              onReject(u.relationId);
            }}
          >
            거절
          </Button>
        </Stack>
      );
    }

    return (
      <Button
        size="small"
        variant="contained"
        color="primary"
        startIcon={<PersonAddAlt1Icon />}
        onClick={(e) => {
          e.stopPropagation();
          onRequestFriend(u.userUid);
        }}
      >
        친구추가
      </Button>
    );
  };

  const Row = ({ user, actionSlot }) => (
    <ListItemButton sx={{ borderRadius: 2, mb: 0.5, alignItems: 'flex-start' }}>
      <ListItemAvatar>
        <Avatar
          sx={{
            width: 40,
            height: 40,
            bgcolor:
              user.role === 'MASTER'
                ? 'error.main'
                : user.role === 'MANAGER'
                ? 'warning.main'
                : 'primary.main',
            fontWeight: 'bold',
          }}
        >
          {(user.displayName || user.username)?.[0]?.toUpperCase()}
        </Avatar>
      </ListItemAvatar>
      <ListItemText
        primary={user.displayName || user.username}
        secondary={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            {user.displayName && user.displayName !== user.username && (
              <Typography variant="caption" color="text.secondary">
                @{user.username}
              </Typography>
            )}
            {user.displayName && user.displayName !== user.username && (
              <Divider orientation="vertical" flexItem sx={{ height: 10, my: 'auto' }} />
            )}
            <Typography
              variant="caption"
              sx={{ color: user.role === 'MASTER' ? 'error.main' : 'text.secondary', fontWeight: 'bold' }}
            >
              {user.role}
            </Typography>
            <Divider orientation="vertical" flexItem sx={{ height: 10, my: 'auto' }} />
            <Typography variant="caption" sx={{ color: user.isOnline ? 'success.main' : 'text.secondary' }}>
              {user.isOnline ? '온라인' : '오프라인'}
            </Typography>
          </Box>
        }
        sx={{ mr: 1 }}
      />
      <Box sx={{ ml: 1, display: 'flex', alignItems: 'center' }}>{actionSlot}</Box>
    </ListItemButton>
  );

  const Section = ({ title, emptyText, users, renderAction }) => (
    <Box sx={{ mb: 2 }}>
      <Typography variant="subtitle2" sx={{ px: 1, pb: 1, fontWeight: 800 }}>
        {title}
      </Typography>
      {users.length === 0 ? (
        <Typography variant="body2" sx={{ px: 1, py: 1, color: 'text.secondary' }}>
          {emptyText}
        </Typography>
      ) : (
        <List disablePadding>
          {users.map((u) => (
            <Row key={`${title}-${u.userUid}`} user={u} actionSlot={renderAction(u)} />
          ))}
        </List>
      )}
    </Box>
  );

  return (
    <Paper
      elevation={10}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width,
        transform: 'translateX(-100%)',
        borderRadius: 0,
        borderRight: (theme) => `1px solid ${theme.palette.divider}`,
        backgroundColor: 'background.paper',
        color: 'text.primary',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          p: 2,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'background.default',
          borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.05rem' }}>
          친구 관리
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Box sx={{ p: 2, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}>
        <TextField
          fullWidth
          size="small"
          placeholder="추가할 사용자 검색"
          value={manageSearchQuery}
          onChange={(e) => setManageSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 1.25 }}>
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ px: 1, pb: 1, fontWeight: 800 }}>
            사용자 검색
          </Typography>
          {searching ? (
            <Box sx={{ py: 2, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={22} />
            </Box>
          ) : manageSearchQuery.trim() === '' ? (
            <Typography variant="body2" sx={{ px: 1, py: 1, color: 'text.secondary' }}>
              아이디나 닉네임으로 검색해 친구 요청을 보낼 수 있습니다.
            </Typography>
          ) : searchResults.length === 0 ? (
            <Typography variant="body2" sx={{ px: 1, py: 1, color: 'text.secondary' }}>
              검색 결과가 없습니다.
            </Typography>
          ) : (
            <List disablePadding>
              {searchResults.map((u) => (
                <Row key={`search-${u.userUid}`} user={u} actionSlot={renderSearchAction(u)} />
              ))}
            </List>
          )}
        </Box>

        <Divider sx={{ my: 1 }} />

        <Section
          title="받은 친구 요청"
          emptyText="받은 친구 요청이 없습니다."
          users={incomingRequests}
          renderAction={(u) => (
            <Stack direction="row" spacing={0.5}>
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<DoneIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept(u.relationId);
                }}
              >
                수락
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<CloseRoundedIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                  onReject(u.relationId);
                }}
              >
                거절
              </Button>
            </Stack>
          )}
        />

        <Section
          title="보낸 친구 요청"
          emptyText="보낸 친구 요청이 없습니다."
          users={outgoingRequests}
          renderAction={() => <Chip size="small" label="요청중" color="warning" variant="outlined" />}
        />

        <Section
          title="차단한 사용자"
          emptyText="차단한 사용자가 없습니다."
          users={blockedUsers}
          renderAction={(u) => (
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<LockOpenIcon />}
              onClick={(e) => {
                e.stopPropagation();
                onToggleBlock(u.userUid, false);
              }}
            >
              차단해제
            </Button>
          )}
        />
      </Box>
    </Paper>
  );
};

export default FriendManagePanel;
