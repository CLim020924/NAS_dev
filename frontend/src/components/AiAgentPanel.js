import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Drawer,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SettingsIcon from '@mui/icons-material/Settings';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import axios from 'axios';

const DEFAULT_PREFERENCES = { approvalMode: 'ask_each', dailyTokenLimit: 50000 };
const ACTIVE_ACTION_STATUSES = new Set(['pending', 'recovery_required']);

const AiAgentPanel = ({ open, onClose }) => {
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [actions, setActions] = useState([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [usage, setUsage] = useState({ days: {} });
  const [toolEvents, setToolEvents] = useState([]);
  const [showLatestButton, setShowLatestButton] = useState(false);
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const followLatestRef = useRef(true);

  const scrollToLatest = (behavior = 'smooth') => {
    followLatestRef.current = true;
    setShowLatestButton(false);
    endRef.current?.scrollIntoView({ block: 'end', behavior });
  };

  const handleScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 72;
    followLatestRef.current = nearBottom;
    setShowLatestButton(!nearBottom);
  };

  const loadHistory = async () => {
    const [statusRes, historyRes] = await Promise.all([
      axios.get('/api/ai/status', { withCredentials: true }),
      axios.get('/api/ai/history', { withCredentials: true }),
    ]);
    setStatus(statusRes.data);
    setMessages(historyRes.data?.messages || []);
    setActions(historyRes.data?.actions || []);
    setPreferences(historyRes.data?.preferences || DEFAULT_PREFERENCES);
    setUsage(historyRes.data?.usage || { days: {} });
    requestAnimationFrame(() => scrollToLatest('auto'));
  };

  useEffect(() => {
    if (!open) return;
    setError('');
    followLatestRef.current = true;
    loadHistory().catch((err) => setError(err.response?.data?.error || 'AI 상태를 불러오지 못했습니다.'));
  }, [open]);

  useEffect(() => {
    if (!open || !followLatestRef.current) return;
    requestAnimationFrame(() => scrollToLatest(loading ? 'smooth' : 'auto'));
  }, [open, loading, messages.length, actions.length, toolEvents.length]);

  const run = async (fn) => {
    setLoading(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.response?.data?.error || err.message || '요청에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = () => {
    const text = message.trim();
    if (!text || loading) return;
    followLatestRef.current = true;
    setShowLatestButton(false);
    run(async () => {
      setMessage('');
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text, createdAt: now },
        { role: 'assistant', content: '요청을 확인하고 있습니다…', createdAt: now, pending: true },
      ]);
      const res = await axios.post('/api/ai/chat', {
        message: text,
        context: { currentPath: '/' },
      }, { withCredentials: true });
      const nextMessages = res.data?.messages || [];
      if (nextMessages.length) {
        setMessages(nextMessages);
      } else {
        setMessages((prev) => prev
          .filter((item) => !item.pending)
          .concat({ role: 'assistant', content: res.data?.answer || '응답이 비어 있습니다.', createdAt: new Date().toISOString() }));
      }
      setActions(res.data?.actions || []);
      setToolEvents(res.data?.toolEvents || []);
      if (res.data?.usage) setUsage(res.data.usage);
    });
  };

  const executeAction = (actionId) => run(async () => {
    followLatestRef.current = true;
    const res = await axios.post(`/api/ai/actions/${actionId}/execute`, {}, { withCredentials: true });
    if (res.data?.actions) setActions(res.data.actions);
    if (res.data?.messages?.length) setMessages(res.data.messages);
    if (res.data?.usage) setUsage(res.data.usage);
    if (res.data?.continuation?.error) setError(res.data.continuation.error);
  });

  const rejectAction = (actionId) => run(async () => {
    followLatestRef.current = true;
    const res = await axios.post(`/api/ai/actions/${actionId}/reject`, {}, { withCredentials: true });
    if (res.data?.actions) setActions(res.data.actions);
    if (res.data?.messages?.length) setMessages(res.data.messages);
    if (res.data?.usage) setUsage(res.data.usage);
    if (res.data?.continuation?.error) setError(res.data.continuation.error);
  });

  const resumeRun = (runId) => run(async () => {
    followLatestRef.current = true;
    const res = await axios.post(`/api/ai/runs/${runId}/resume`, {}, { withCredentials: true });
    if (res.data?.messages?.length) setMessages(res.data.messages);
    if (res.data?.actions) setActions(res.data.actions);
    if (res.data?.usage) setUsage(res.data.usage);
    if (res.data?.continuation?.error) setError(res.data.continuation.error);
  });

  const savePreferences = () => run(async () => {
    const res = await axios.patch('/api/ai/preferences', preferences, { withCredentials: true });
    setPreferences(res.data.preferences);
    setSettingsOpen(false);
  });

  const visibleActions = useMemo(() => actions.filter((action) => (
    ACTIVE_ACTION_STATUSES.has(action.status) || action.continuationStatus === 'response_pending'
  )), [actions]);
  const firstModernMessageIndex = messages.findIndex((item) => item.agentRunId);
  const hasLegacyMessages = messages.some((item) => !item.agentRunId);
  const today = new Date().toISOString().slice(0, 10);
  const todayUsage = usage.days?.[today] || { totalTokens: 0, requests: 0 };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 480 }, maxWidth: '100vw' } }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}>
          <SmartToyIcon color="primary" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>AI 에이전트</Typography>
            <Typography variant="caption" color="text.secondary">
              {status?.configured ? `${status.provider} · ${status.model}` : 'AI 설정 필요'}
            </Typography>
          </Box>
          <Chip size="small" color={status?.enabled ? 'success' : 'default'} label={status?.enabled ? '활성' : '비활성'} />
          <Tooltip title="AI 설정">
            <IconButton size="small" aria-label="AI 설정" aria-pressed={settingsOpen} onClick={() => setSettingsOpen((value) => !value)}>
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton size="small" aria-label="AI 에이전트 닫기" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </Box>
        {loading && <LinearProgress aria-label="AI 요청 처리 중" />}
        {error && <Alert severity="error" sx={{ borderRadius: 0 }}>{error}</Alert>}

        <Collapse in={settingsOpen} unmountOnExit>
          <Box sx={{ p: 2, borderBottom: (theme) => `1px solid ${theme.palette.divider}`, bgcolor: 'background.default' }}>
            <Stack spacing={1.25}>
              <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>AI 설정</Typography>
              <Alert severity="info">자동 승인도 현재 계정 권한 안에서만 동작합니다. 영구 삭제·계정 및 보안 설정·임의 코드 실행은 자동 승인되지 않습니다.</Alert>
              <TextField select SelectProps={{ native: true }} size="small" label="작업 승인 방식" value={preferences.approvalMode || 'ask_each'} onChange={(e) => setPreferences((prev) => ({ ...prev, approvalMode: e.target.value }))}>
                <option value="ask_each">모든 변경 작업마다 승인</option>
                <option value="auto_safe">폴더·텍스트 작업 자동 승인</option>
                <option value="auto_reversible">복사·이동·휴지통까지 자동 승인</option>
                <option value="auto_all">채팅·친구·차단까지 자동 승인</option>
              </TextField>
              <TextField size="small" type="number" label="하루 토큰 상한" value={preferences.dailyTokenLimit || 50000} inputProps={{ min: 1000, max: 1000000, step: 1000 }} onChange={(e) => setPreferences((prev) => ({ ...prev, dailyTokenLimit: Number(e.target.value) }))} />
              <Typography variant="caption" color="text.secondary">
                오늘 {Number(todayUsage.totalTokens || 0).toLocaleString()} 토큰 · {Number(todayUsage.requests || 0).toLocaleString()}회 요청
              </Typography>
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button color="inherit" onClick={() => setSettingsOpen(false)}>취소</Button>
                <Button variant="contained" disabled={loading} onClick={savePreferences}>저장</Button>
              </Stack>
            </Stack>
          </Box>
        </Collapse>

        <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
          <Box
            ref={scrollRef}
            onScroll={handleScroll}
            sx={{
              position: 'absolute',
              inset: 0,
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              scrollbarGutter: 'stable',
              p: 2,
            }}
          >
            <Stack spacing={1.25} aria-live="polite">
              {messages.length === 0 && (
                <Box sx={{ py: 5, px: 2, textAlign: 'center' }}>
                  <SmartToyIcon color="disabled" sx={{ fontSize: 38 }} />
                  <Typography variant="subtitle1" sx={{ mt: 1, fontWeight: 900 }}>무엇을 도와드릴까요?</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    파일 찾기·읽기·복사·정리, 사용자에게 전송, 채팅과 친구 관리까지 문장으로 요청하세요.
                  </Typography>
                </Box>
              )}

              {messages.map((item, index) => (
                <React.Fragment key={`${item.messageId || item.createdAt || index}-${index}`}>
                  {hasLegacyMessages && ((firstModernMessageIndex === -1 && index === 0) || index === firstModernMessageIndex) && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
                      <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
                      <Typography variant="caption" color="text.secondary">이전 AI 응답 · 실행형 에이전트 도입 전 기록</Typography>
                      <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
                    </Box>
                  )}
                  <Box sx={{ display: 'flex', justifyContent: item.role === 'user' ? 'flex-end' : 'flex-start' }}>
                    <Paper
                      variant="outlined"
                      sx={{
                        p: 1.25,
                        maxWidth: '88%',
                        borderRadius: 2,
                        bgcolor: item.role === 'user' ? 'primary.main' : 'background.paper',
                        color: item.role === 'user' ? 'primary.contrastText' : 'text.primary',
                        opacity: item.pending ? 0.7 : 1,
                      }}
                    >
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.content}</Typography>
                    </Paper>
                  </Box>
                </React.Fragment>
              ))}

              {visibleActions.map((action) => (
                <Paper key={action.actionId} variant="outlined" sx={{ p: 1.5, borderColor: action.status === 'recovery_required' ? 'warning.main' : 'primary.main' }}>
                  <Typography variant="caption" color="text.secondary">AI가 확인을 기다리는 작업</Typography>
                  <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 900 }}>{action.title}</Typography>
                  {action.targetPath && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>대상: {action.targetPath}</Typography>}
                  {action.sourcePath && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>원본: {action.sourcePath}</Typography>}
                  {action.destinationPath && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>이동 위치: {action.destinationPath}</Typography>}
                  {action.destinationFolder && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>대상 폴더: {action.destinationFolder}</Typography>}
                  {(action.targetUserDisplayName || action.targetUser) && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>사용자: {action.targetUserDisplayName || action.targetUser}</Typography>}
                  {action.preview?.itemCount !== undefined && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>승인 대상: {action.preview.itemCount}개</Typography>}
                  {action.recoveryReason && <Alert severity="warning" sx={{ mt: 1 }}>{action.recoveryReason}</Alert>}
                  {action.status === 'pending' && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                      <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} disabled={loading} onClick={() => executeAction(action.actionId)}>승인·실행</Button>
                      <Button size="small" color="inherit" disabled={loading} onClick={() => rejectAction(action.actionId)}>거절</Button>
                    </Stack>
                  )}
                  {action.continuationStatus === 'response_pending' && action.agentRunId && (
                    <Button size="small" sx={{ mt: 1 }} disabled={loading} onClick={() => resumeRun(action.agentRunId)}>작업 재실행 없이 답변 이어받기</Button>
                  )}
                </Paper>
              ))}

              {toolEvents.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center', py: 0.5 }}>
                  최근 실제 작업 {toolEvents.filter((event) => event.ok).length}/{toolEvents.length}개 완료
                </Typography>
              )}
              <Box ref={endRef} sx={{ height: 1 }} />
            </Stack>
          </Box>

          {showLatestButton && (
            <Button
              size="small"
              variant="contained"
              startIcon={<ArrowDownwardIcon />}
              onClick={() => scrollToLatest('smooth')}
              sx={{ position: 'absolute', right: 16, bottom: 12, borderRadius: 99, boxShadow: 3 }}
            >
              최신으로
            </Button>
          )}
        </Box>

        <Box sx={{ p: 1.5, borderTop: (theme) => `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper' }}>
          <Stack direction="row" spacing={1} alignItems="flex-end">
            <TextField
              fullWidth
              multiline
              minRows={1}
              maxRows={5}
              placeholder="파일 찾기, 정리, 전송 등 원하는 작업을 말씀해 주세요"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onFocus={() => { followLatestRef.current = true; }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              inputProps={{ 'aria-label': 'AI에게 요청' }}
            />
            <Button variant="contained" disabled={loading || !message.trim()} onClick={sendMessage} sx={{ minHeight: 40 }}>전송</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Enter 전송 · Shift+Enter 줄바꿈
          </Typography>
        </Box>
      </Box>
    </Drawer>
  );
};

export default AiAgentPanel;
