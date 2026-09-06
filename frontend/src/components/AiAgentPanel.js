import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
  Alert,
  Paper,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import SearchIcon from '@mui/icons-material/Search';
import DescriptionIcon from '@mui/icons-material/Description';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import SettingsIcon from '@mui/icons-material/Settings';
import axios from 'axios';

const formatSize = (bytes) => {
  if (bytes === null || bytes === undefined) return '';
  const value = Number(bytes);
  if (!Number.isFinite(value)) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const AiAgentPanel = ({ open, onClose }) => {
  const [tab, setTab] = useState('chat');
  const [status, setStatus] = useState(null);
  const [messages, setMessages] = useState([]);
  const [actions, setActions] = useState([]);
  const [message, setMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [readPath, setReadPath] = useState('');
  const [readResult, setReadResult] = useState(null);
  const [actionPath, setActionPath] = useState('');
  const [actionContent, setActionContent] = useState('');
  const [actionType, setActionType] = useState('write_text_file');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [agentJob, setAgentJob] = useState(null);
  const [preferences, setPreferences] = useState({ approvalMode: 'ask_each', dailyTokenLimit: 50000 });
  const [usage, setUsage] = useState({ days: {} });
  const [toolEvents, setToolEvents] = useState([]);
  const progressTimerRef = useRef(null);

  const clearProgressTimer = () => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  useEffect(() => () => clearProgressTimer(), []);

  const startAgentJob = (title, steps) => {
    clearProgressTimer();
    const safeSteps = steps.length ? steps : ['요청 준비', '처리 중', '완료'];
    setAgentJob({ title, steps: safeSteps, activeIndex: 0, completed: false });
  };

  const finishAgentJob = (ok = true, finalTitle = '') => {
    clearProgressTimer();
    setAgentJob((current) => {
      if (!current) return current;
      return {
        ...current,
        title: finalTitle || current.title,
        activeIndex: current.steps.length - 1,
        completed: true,
        ok,
      };
    });
    setTimeout(() => {
      setAgentJob((current) => current?.completed ? null : current);
    }, 1800);
  };

  const loadHistory = async () => {
    const [statusRes, historyRes] = await Promise.all([
      axios.get('/api/ai/status', { withCredentials: true }),
      axios.get('/api/ai/history', { withCredentials: true }),
    ]);
    setStatus(statusRes.data);
    setMessages(historyRes.data?.messages || []);
    setActions(historyRes.data?.actions || []);
    setPreferences(historyRes.data?.preferences || { approvalMode: 'ask_each', dailyTokenLimit: 50000 });
    setUsage(historyRes.data?.usage || { days: {} });
  };

  useEffect(() => {
    if (!open) return;
    setError('');
    loadHistory().catch((err) => setError(err.response?.data?.error || 'AI 상태를 불러오지 못했습니다.'));
  }, [open]);

  const run = async (fn, title = 'AI 에이전트 작업 중', steps = []) => {
    setLoading(true);
    setError('');
    startAgentJob(title, steps);
    try {
      await fn();
      finishAgentJob(true, '작업 완료');
    } catch (err) {
      setError(err.response?.data?.error || err.message || '요청에 실패했습니다.');
      finishAgentJob(false, '작업 실패');
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = () => run(async () => {
    const text = message.trim();
    if (!text) return;
    setMessage('');
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: text, createdAt: now },
      { role: 'assistant', content: '작업을 준비하고 있습니다...', createdAt: now, pending: true },
    ]);
    const res = await axios.post('/api/ai/chat', {
      message: text,
      context: {
        currentPath: '/',
        searchQuery: searchQuery.trim() || undefined,
        readPath: readPath.trim() || undefined,
      },
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
  }, 'AI가 요청을 처리하는 중', ['요청 확인', '계정 권한 확인', '컨텍스트 수집', 'OpenAI 응답 생성', '대화 기록 저장']);

  const searchFiles = () => run(async () => {
    const res = await axios.get('/api/ai/files/search', {
      params: { q: searchQuery, path: '/' },
      withCredentials: true,
    });
    setSearchResults(res.data?.results || []);
  }, 'AI 파일 검색 중', ['검색어 확인', '계정 루트 확인', '파일명 탐색', '결과 정리']);

  const readFile = (path) => run(async () => {
    const target = path || readPath;
    if (!target) return;
    setReadPath(target);
    const res = await axios.get('/api/ai/files/read', {
      params: { path: target },
      withCredentials: true,
    });
    setReadResult(res.data);
    setTab('read');
  }, 'AI 파일 읽기 중', ['경로 확인', '접근 권한 검사', '파일 내용 추출', '미리보기 표시']);

  const createAction = () => run(async () => {
    if (!actionPath.trim()) return;
    const res = await axios.post('/api/ai/actions', {
      actionType,
      path: actionPath,
      content: actionContent,
      title: actionType === 'create_folder' ? 'AI 폴더 생성' : 'AI 텍스트 파일 수정',
    }, { withCredentials: true });
    setActions((prev) => [res.data.action, ...prev]);
    setTab('actions');
  }, 'AI 실행 계획 생성 중', ['작업 종류 확인', '대상 경로 권한 검사', '승인 대기 작업 작성']);

  const executeAction = (actionId) => run(async () => {
    const res = await axios.post(`/api/ai/actions/${actionId}/execute`, {}, { withCredentials: true });
    setActions((prev) => prev.map((item) => item.actionId === actionId ? res.data.action : item));
  }, '승인된 AI 작업 실행 중', ['작업 불러오기', '권한 재검사', '기존 파일 백업', '파일 시스템 반영', '결과 저장']);

  const rejectAction = (actionId) => run(async () => {
    const res = await axios.post(`/api/ai/actions/${actionId}/reject`, {}, { withCredentials: true });
    setActions((prev) => prev.map((item) => item.actionId === actionId ? res.data.action : item));
  }, 'AI 작업 거절 중', ['승인 대기 상태 확인', '거절 기록 저장']);

  const savePreferences = () => run(async () => {
    const res = await axios.patch('/api/ai/preferences', preferences, { withCredentials: true });
    setPreferences(res.data.preferences);
  }, 'AI 권한 설정 저장 중', ['설정 검증', '계정별 설정 저장']);

  const today = new Date().toISOString().slice(0, 10);
  const todayUsage = usage.days?.[today] || { totalTokens: 0, requests: 0 };

  const progressValue = agentJob
    ? Math.round(((agentJob.activeIndex + 1) / agentJob.steps.length) * 100)
    : 0;

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '100%', sm: 430 }, maxWidth: '100vw' } }}>
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
          <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </Box>
        {loading && <LinearProgress />}
        {error && <Alert severity="error" sx={{ borderRadius: 0 }}>{error}</Alert>}

        {agentJob && (
          <Box sx={{ px: 2, py: 1.25, borderBottom: (theme) => `1px solid ${theme.palette.divider}`, bgcolor: 'action.hover' }}>
            <Stack spacing={0.8}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="body2" sx={{ fontWeight: 900 }}>{agentJob.title}</Typography>
                <Typography variant="caption" color="text.secondary">{progressValue}%</Typography>
              </Stack>
              <LinearProgress variant="determinate" value={progressValue} color={agentJob.completed && agentJob.ok === false ? 'error' : 'primary'} />
              <Stack spacing={0.4}>
                {agentJob.steps.map((step, index) => {
                  const done = index <= agentJob.activeIndex;
                  return (
                    <Stack key={`${step}-${index}`} direction="row" spacing={0.75} alignItems="center">
                      {done ? <CheckCircleIcon sx={{ fontSize: 15, color: agentJob.ok === false && agentJob.completed ? 'error.main' : 'primary.main' }} /> : <RadioButtonUncheckedIcon sx={{ fontSize: 15, color: 'text.disabled' }} />}
                      <Typography variant="caption" color={done ? 'text.primary' : 'text.secondary'} sx={{ fontWeight: done ? 800 : 500 }}>
                        {step}
                      </Typography>
                    </Stack>
                  );
                })}
              </Stack>
            </Stack>
          </Box>
        )}

        <Tabs value={tab} onChange={(e, value) => setTab(value)} variant="fullWidth">
          <Tab value="chat" label="대화" />
          <Tab value="files" label="파일" />
          <Tab value="read" label="읽기" />
          <Tab value="actions" label="작업" />
          <Tab value="settings" icon={<SettingsIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="설정" />
        </Tabs>

        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2 }}>
          {tab === 'chat' && (
            <Stack spacing={1.5}>
              <Alert severity="info">AI는 현재 로그인 계정 권한 안의 자료만 사용합니다. 변경 작업은 설정한 승인 방식에 따라 즉시 실행되거나 승인 대기로 남습니다.</Alert>
              {toolEvents.length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="caption" sx={{ fontWeight: 900 }}>최근 실제 작업</Typography>
                  {toolEvents.map((event) => (
                    <Typography key={event.callId} variant="caption" sx={{ display: 'block', mt: 0.5 }} color={event.ok ? 'success.main' : 'error.main'}>
                      {event.ok ? '완료' : '실패'} · {event.name} · {event.result?.status || event.result?.error || '조회 완료'}
                    </Typography>
                  ))}
                </Paper>
              )}
              {messages.map((item, index) => (
                <Paper key={`${item.createdAt || index}-${index}`} variant="outlined" sx={{ p: 1.25, bgcolor: item.role === 'user' ? 'action.hover' : 'background.paper' }}>
                  <Typography variant="caption" color="text.secondary">{item.role === 'user' ? '나' : 'AI'}</Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>{item.content}</Typography>
                </Paper>
              ))}
            </Stack>
          )}

          {tab === 'files' && (
            <Stack spacing={1.5}>
              <TextField fullWidth size="small" label="파일/폴더 이름 검색" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') searchFiles(); }} />
              <Button startIcon={<SearchIcon />} variant="contained" onClick={searchFiles}>검색</Button>
              <Divider />
              {searchResults.map((item) => (
                <Paper key={item.path} variant="outlined" sx={{ p: 1.25 }}>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <DescriptionIcon fontSize="small" color={item.type === 'folder' ? 'warning' : 'action'} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 800 }}>{item.name}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-all' }}>{item.path}</Typography>
                      <Typography variant="caption" color="text.secondary">{item.type} {formatSize(item.size)}</Typography>
                    </Box>
                    {item.type === 'file' && <Button size="small" onClick={() => readFile(item.path)}>읽기</Button>}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}

          {tab === 'read' && (
            <Stack spacing={1.5}>
              <TextField fullWidth size="small" label="읽을 파일 경로" value={readPath} onChange={(e) => setReadPath(e.target.value)} />
              <Button variant="contained" onClick={() => readFile()}>파일 읽기</Button>
              {readResult && (
                <Paper variant="outlined" sx={{ p: 1.25 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>{readResult.item?.name}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>{readResult.item?.path}</Typography>
                  {!readResult.readable && <Alert severity="warning" sx={{ mt: 1 }}>{readResult.message}</Alert>}
                  {readResult.readable && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 1 }}>{readResult.text}</Typography>}
                </Paper>
              )}
            </Stack>
          )}

          {tab === 'actions' && (
            <Stack spacing={1.5}>
              <Alert severity="warning">여기서 실행하는 작업만 실제 파일에 반영됩니다. 덮어쓰기 전에는 `.ai_backups`에 백업을 남깁니다.</Alert>
              <TextField select SelectProps={{ native: true }} size="small" label="작업 종류" value={actionType} onChange={(e) => setActionType(e.target.value)}>
                <option value="write_text_file">텍스트 파일 저장/덮어쓰기</option>
                <option value="append_text_file">텍스트 파일 끝에 추가</option>
                <option value="create_folder">폴더 생성</option>
              </TextField>
              <TextField fullWidth size="small" label="대상 경로" value={actionPath} onChange={(e) => setActionPath(e.target.value)} placeholder="/메모/ai.txt" />
              {actionType !== 'create_folder' && (
                <TextField fullWidth multiline minRows={5} label="내용" value={actionContent} onChange={(e) => setActionContent(e.target.value)} />
              )}
              <Button variant="contained" onClick={createAction}>승인 대기 작업 만들기</Button>
              <Divider />
              {actions.map((action) => (
                <Paper key={action.actionId} variant="outlined" sx={{ p: 1.25 }}>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 900 }}>{action.title}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-all' }}>{action.targetPath}</Typography>
                      <Chip size="small" label={action.status} color={action.status === 'completed' ? 'success' : 'warning'} sx={{ mt: 1 }} />
                      {action.backupPath && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>백업: {action.backupPath}</Typography>}
                    </Box>
                    {action.status === 'pending' && <Stack spacing={0.5}>
                      <Button size="small" startIcon={<PlayArrowIcon />} onClick={() => executeAction(action.actionId)}>승인·실행</Button>
                      <Button size="small" color="inherit" onClick={() => rejectAction(action.actionId)}>거절</Button>
                    </Stack>}
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}

          {tab === 'settings' && (
            <Stack spacing={1.5}>
              <Alert severity="info">전체 자동 승인도 현재 계정 권한 안에서만 동작합니다. 영구 삭제·계정/권한/보안 설정·임의 코드 실행은 자동 승인되지 않습니다.</Alert>
              <TextField select SelectProps={{ native: true }} size="small" label="작업 승인 방식" value={preferences.approvalMode || 'ask_each'} onChange={(e) => setPreferences((prev) => ({ ...prev, approvalMode: e.target.value }))}>
                <option value="ask_each">모든 변경 작업마다 승인</option>
                <option value="auto_safe">폴더·텍스트 작업 자동 승인</option>
                <option value="auto_reversible">복사·이동·휴지통까지 자동 승인</option>
                <option value="auto_all">채팅·친구·차단까지 자동 승인</option>
              </TextField>
              <TextField size="small" type="number" label="하루 토큰 상한" value={preferences.dailyTokenLimit || 50000} inputProps={{ min: 1000, max: 1000000, step: 1000 }} onChange={(e) => setPreferences((prev) => ({ ...prev, dailyTokenLimit: Number(e.target.value) }))} />
              <Paper variant="outlined" sx={{ p: 1.25 }}>
                <Typography variant="body2" sx={{ fontWeight: 900 }}>오늘 사용량</Typography>
                <Typography variant="caption" color="text.secondary">{Number(todayUsage.totalTokens || 0).toLocaleString()} 토큰 · {Number(todayUsage.requests || 0).toLocaleString()}회 요청</Typography>
              </Paper>
              <Button variant="contained" onClick={savePreferences}>설정 저장</Button>
            </Stack>
          )}
        </Box>

        {tab === 'chat' && (
          <Box sx={{ p: 1.5, borderTop: (theme) => `1px solid ${theme.palette.divider}` }}>
            <Stack direction="row" spacing={1}>
              <TextField fullWidth size="small" placeholder="AI에게 요청" value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !loading) sendMessage(); }} />
              <Button variant="contained" disabled={loading} onClick={sendMessage}>전송</Button>
            </Stack>
          </Box>
        )}
      </Box>
    </Drawer>
  );
};

export default AiAgentPanel;
