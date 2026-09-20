import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
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
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import SettingsIcon from '@mui/icons-material/Settings';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import axios from 'axios';
import { copyTextToClipboard } from '../utils/copyTextToClipboard';
import ChatNasPickerDialog from './ChatNasPickerDialog';

const DEFAULT_PREFERENCES = { approvalMode: 'ask_each', dailyTokenLimit: 50000 };
const ACTIVE_ACTION_STATUSES = new Set(['pending', 'recovery_required']);

const newRequestId = () => {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === 'x' ? value : ((value & 0x3) | 0x8)).toString(16);
  });
};

const AiAgentPanel = ({ open, onClose, context = {}, draftRequest = null }) => {
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
  const [activity, setActivity] = useState(null);
  const [showLatestButton, setShowLatestButton] = useState(false);
  const [copiedMessageKey, setCopiedMessageKey] = useState('');
  const [nasPickerOpen, setNasPickerOpen] = useState(false);
  const [attachedNasPaths, setAttachedNasPaths] = useState([]);
  const [localFiles, setLocalFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const localInputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const followLatestRef = useRef(true);
  const activityClearTimerRef = useRef(null);
  const copyClearTimerRef = useRef(null);
  const appliedDraftRequestRef = useRef('');

  useEffect(() => {
    if (!open || !draftRequest?.requestId || appliedDraftRequestRef.current === draftRequest.requestId) return;
    appliedDraftRequestRef.current = draftRequest.requestId;
    setMessage(String(draftRequest.draft || ''));
  }, [open, draftRequest]);

  const clearActivityLater = (delay = 1800) => {
    if (activityClearTimerRef.current) window.clearTimeout(activityClearTimerRef.current);
    activityClearTimerRef.current = window.setTimeout(() => setActivity(null), delay);
  };

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

  useEffect(() => {
    if (!open || !loading || !activity?.requestId) return undefined;
    let cancelled = false;
    let timer = null;
    const poll = async () => {
      try {
        const res = await axios.get(`/api/ai/progress/${encodeURIComponent(activity.requestId)}`, { withCredentials: true });
        if (!cancelled && res.data?.progress) setActivity(res.data.progress);
      } catch (err) {
        if (!cancelled && err.response?.status !== 404) {
          setActivity((prev) => prev ? { ...prev, detail: '진행 상태 연결을 다시 확인하고 있습니다.' } : prev);
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, 350);
    };
    timer = window.setTimeout(poll, 120);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [open, loading, activity?.requestId]);

  useEffect(() => () => {
    if (activityClearTimerRef.current) window.clearTimeout(activityClearTimerRef.current);
    if (copyClearTimerRef.current) window.clearTimeout(copyClearTimerRef.current);
  }, []);

  const copyMessage = async (content, key) => {
    const copied = await copyTextToClipboard(content);
    if (!copied) {
      setError('메시지를 복사하지 못했습니다. 텍스트를 선택한 뒤 Ctrl+C를 사용해 주세요.');
      return;
    }
    setError('');
    setCopiedMessageKey(key);
    if (copyClearTimerRef.current) window.clearTimeout(copyClearTimerRef.current);
    copyClearTimerRef.current = window.setTimeout(() => setCopiedMessageKey(''), 1800);
  };

  const addNasPaths = (paths) => {
    setAttachedNasPaths((current) => [...new Set([...current, ...paths.filter((value) => typeof value === 'string' && value.startsWith('/'))])].slice(0, 10));
  };

  const addLocalFiles = async (incoming) => {
    const prepared = [];
    for (const file of Array.from(incoming || []).slice(0, 3)) {
      let next = file;
      if (file.type.startsWith('image/') && file.size > 160 * 1024 && window.createImageBitmap) {
        const bitmap = await window.createImageBitmap(file);
        try {
          const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          for (const quality of [0.76, 0.58, 0.4]) {
            const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
            if (blob) next = new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
            if (next.size <= 300 * 1024) break;
          }
        } finally { bitmap.close?.(); }
      }
      prepared.push(next);
    }
    const merged = [...localFiles, ...prepared];
    if (merged.length > 3 || merged.reduce((sum, file) => sum + file.size, 0) > 320 * 1024) {
      setError('PC 첨부는 최대 3개, 합계 320KB입니다. 큰 PDF·이미지는 크기를 줄인 뒤 다시 첨부해 주세요.');
      return;
    }
    setError('');
    setLocalFiles(merged);
  };

  const handleNasDrop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (event.dataTransfer.files?.length) {
      addLocalFiles(event.dataTransfer.files).catch(() => setError('PC 파일을 읽지 못했습니다. 다른 파일로 다시 시도해 주세요.'));
      return;
    }
    try {
      const dropped = JSON.parse(event.dataTransfer.getData('application/json') || '{}');
      if (Array.isArray(dropped.draggedPaths)) addNasPaths(dropped.draggedPaths);
    } catch (err) {
      setError('NAS 항목을 확인할 수 없습니다. 첨부 버튼으로 다시 선택해 주세요.');
    }
  };

  const run = async (fn, options = {}) => {
    setLoading(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.response?.data?.error || err.message || '요청에 실패했습니다.');
      options.onError?.(err);
    } finally {
      setLoading(false);
      options.onFinally?.();
    }
  };

  const sendMessage = () => {
    const text = message.trim();
    if ((!text && attachedNasPaths.length === 0 && localFiles.length === 0) || loading) return;
    const promptText = text || '첨부한 항목을 확인하고 무엇인지 알려줘';
    const sendingPaths = [...attachedNasPaths];
    const sendingFiles = [...localFiles];
    followLatestRef.current = true;
    setShowLatestButton(false);
    const requestId = newRequestId();
    setActivity({
      requestId, state: 'running', phase: 'sending', title: '요청을 서버에 전달하고 있습니다',
      detail: '잠시 후 실제 처리 단계가 여기에 표시됩니다.', progress: 3, steps: [],
    });
    run(async () => {
      setMessage('');
      setAttachedNasPaths([]);
      setLocalFiles([]);
      const now = new Date().toISOString();
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: `${promptText}${sendingPaths.length ? `\nNAS 첨부: ${sendingPaths.join(', ')}` : ''}${sendingFiles.length ? `\nPC 첨부: ${sendingFiles.map((file) => file.name).join(', ')}` : ''}`, createdAt: now },
      ]);
      const payload = sendingFiles.length ? new FormData() : {
        message: promptText, context: { ...context, attachedNasPaths: sendingPaths }, requestId,
      };
      if (sendingFiles.length) {
        payload.append('message', promptText);
        payload.append('context', JSON.stringify({ ...context, attachedNasPaths: sendingPaths }));
        payload.append('requestId', requestId);
        sendingFiles.forEach((file) => payload.append('files', file, file.name));
      }
      const res = await axios.post('/api/ai/chat', payload, { withCredentials: true });
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
      const waiting = res.data?.continuation?.status === 'waiting_approval';
      setActivity((prev) => ({
        ...(prev || {}), requestId, progress: 100,
        state: waiting ? 'waiting_approval' : 'completed',
        phase: waiting ? 'waiting_approval' : 'completed',
        title: waiting ? '사용자 승인을 기다리고 있습니다' : '요청 처리가 끝났습니다',
        detail: waiting ? '아래 승인 카드에서 실행 여부를 선택해 주세요.' : '확인된 결과를 대화에 표시했습니다.',
      }));
      clearActivityLater(waiting ? 3200 : 1800);
    }, {
      onError: (err) => {
        setMessage(promptText);
        setAttachedNasPaths(sendingPaths);
        setLocalFiles(sendingFiles);
        setMessages((prev) => prev.filter((item) => !item.pending));
        setActivity((prev) => ({
          ...(prev || {}), requestId, state: 'failed', phase: 'failed', progress: 100,
          title: '요청 처리를 마치지 못했습니다',
          detail: err.response?.data?.error || err.message || '오류 내용을 확인해 주세요.',
        }));
        clearActivityLater(5000);
      },
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

  const downloadBundle = (action) => run(async () => {
    await axios.get(`${action.result.downloadUrl}/check`, { withCredentials: true });
    const anchor = document.createElement('a');
    anchor.href = action.result.downloadUrl;
    anchor.download = `${String(action.bundleName || 'NAS-files').replace(/\.zip$/i, '')}.zip`;
    anchor.click();
  });

  const visibleActions = useMemo(() => actions.filter((action) => (
    ACTIVE_ACTION_STATUSES.has(action.status) || action.continuationStatus === 'response_pending'
  )), [actions]);
  const completedBundles = useMemo(() => actions.filter((action) =>
    action.actionType === 'create_zip_bundle' && action.status === 'completed' && action.result?.downloadUrl).slice(0, 3), [actions]);
  const firstModernMessageIndex = messages.findIndex((item) => item.agentRunId);
  const hasLegacyMessages = messages.some((item) => !item.agentRunId);
  const today = new Date().toISOString().slice(0, 10);
  const todayUsage = usage.days?.[today] || { totalTokens: 0, requests: 0 };

  return (
    <Box
      component="aside"
      aria-label="AI 에이전트"
      onDragEnter={(event) => { event.preventDefault(); dragDepthRef.current += 1; setDragActive(true); }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
      onDragLeave={(event) => { event.preventDefault(); dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (dragDepthRef.current === 0) setDragActive(false); }}
      onDrop={handleNasDrop}
      onPaste={(event) => {
        const files = event.clipboardData?.files;
        if (files?.length) {
          event.preventDefault();
          addLocalFiles(files).catch(() => setError('붙여넣은 파일을 읽지 못했습니다.'));
        }
      }}
      sx={{
        display: open ? 'block' : 'none',
        width: { xs: '100%', sm: 400, lg: 440 },
        flexShrink: 0,
        minWidth: 0,
        height: '100%',
        borderLeft: (theme) => `2px solid ${dragActive ? theme.palette.primary.main : theme.palette.divider}`,
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}>
          <SmartToyIcon color="primary" />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>AI 에이전트</Typography>
            <Typography variant="caption" color="text.secondary">
              {status?.configured ? `${status.provider} · ${status.model} · ${status.toolCount || 0}개 작업 도구` : 'AI 설정 필요'}
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
        {activity && (
          <Box aria-live="polite" sx={{ borderBottom: (theme) => `1px solid ${theme.palette.divider}`, bgcolor: 'background.default' }}>
            <LinearProgress
              aria-label="AI 요청 처리 진행도"
              variant="determinate"
              value={Number(activity.progress || 0)}
              color={activity.state === 'failed' ? 'error' : 'primary'}
            />
            <Box sx={{ px: 2, py: 1.15 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Typography variant="body2" sx={{ fontWeight: 900 }}>{activity.title}</Typography>
                <Typography variant="caption" color="text.secondary">{Math.round(Number(activity.progress || 0))}%</Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                {activity.detail}
              </Typography>
              {activity.steps?.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activity.steps.slice(-4).map((step) => `${step.status === 'done' ? '✓' : step.status === 'failed' ? '!' : '•'} ${step.title}`).join('  ·  ')}
                </Typography>
              )}
            </Box>
          </Box>
        )}
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
                <option value="auto_all">외부 영향 작업까지 자동 승인 (중요 작업 제외)</option>
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
                    파일·저장공간·복원·공유·채팅·친구·알림·노트·문서 변환·연동 PC·회의·서버 상태를 대화로 조회하고 처리할 수 있습니다.
                  </Typography>
                </Box>
              )}

              {messages.map((item, index) => {
                const messageKey = `${item.messageId || item.createdAt || index}-${index}`;
                return (
                <React.Fragment key={messageKey}>
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
                        px: 1.25,
                        pt: 1.25,
                        pb: 0.5,
                        maxWidth: '88%',
                        borderRadius: 1,
                        bgcolor: item.role === 'user' ? 'primary.main' : 'background.paper',
                        color: item.role === 'user' ? 'primary.contrastText' : 'text.primary',
                        opacity: item.pending ? 0.7 : 1,
                      }}
                    >
                      <Typography
                        variant="body2"
                        sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text', WebkitUserSelect: 'text', cursor: 'text' }}
                      >
                        {item.content}
                      </Typography>
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.25 }}>
                        <Tooltip title={copiedMessageKey === messageKey ? '복사됨' : '메시지 복사'}>
                          <IconButton
                            size="small"
                            aria-label={copiedMessageKey === messageKey ? '메시지 복사됨' : '메시지 복사'}
                            onClick={() => copyMessage(item.content, messageKey)}
                            sx={{
                              width: 26,
                              height: 26,
                              color: item.role === 'user' ? 'inherit' : 'text.secondary',
                              opacity: copiedMessageKey === messageKey ? 1 : 0.72,
                            }}
                          >
                            <ContentCopyIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Paper>
                  </Box>
                </React.Fragment>
              );})}

              {visibleActions.map((action) => (
                <Paper key={action.actionId} variant="outlined" sx={{ p: 1.5, borderColor: action.status === 'recovery_required' ? 'warning.main' : 'primary.main' }}>
                  <Typography variant="caption" color="text.secondary">AI가 확인을 기다리는 작업</Typography>
                  <Typography variant="body2" sx={{ mt: 0.25, fontWeight: 900 }}>{action.title}</Typography>
                  {action.description && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{action.description}</Typography>}
                  {action.risk === 'critical' && <Alert severity="warning" sx={{ mt: 1 }}>이 작업은 자동 승인되지 않습니다. 위 대상과 영향을 확인한 뒤 실행하세요.</Alert>}
                  {action.targetPath && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>대상: {action.targetPath}</Typography>}
                  {action.sourcePath && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>원본: {action.sourcePath}</Typography>}
                  {action.destinationPath && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>이동 위치: {action.destinationPath}</Typography>}
                  {action.destinationFolder && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>대상 폴더: {action.destinationFolder}</Typography>}
                  {(action.targetUserDisplayName || action.targetUser) && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>사용자: {action.targetUserDisplayName || action.targetUser}</Typography>}
                  {action.preview?.itemCount !== undefined && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>승인 대상: {action.preview.itemCount}개</Typography>}
                  {action.actionType === 'create_zip_bundle' && Array.isArray(action.preview?.items) && (
                    <Box component="ul" sx={{ maxHeight: 150, overflowY: 'auto', mt: 0.5, pl: 2, fontSize: 12 }}>
                      {action.preview.items.map((item) => <li key={item}>{item}</li>)}
                    </Box>
                  )}
                  {action.recoveryReason && <Alert severity="warning" sx={{ mt: 1 }}>{action.recoveryReason}</Alert>}
                  {action.status === 'pending' && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1.25 }}>
                      <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} disabled={loading} onClick={() => executeAction(action.actionId)}>승인·실행</Button>
                      <Button size="small" color="inherit" disabled={loading} onClick={() => rejectAction(action.actionId)}>거절</Button>
                    </Stack>
                  )}
                  {action.continuationStatus === 'response_pending' && action.agentRunId && (
                    <Tooltip title="작업을 다시 실행하지 않고 승인 이후 답변만 이어받기">
                      <Button size="small" sx={{ mt: 1 }} disabled={loading} onClick={() => resumeRun(action.agentRunId)}>답변 이어가기</Button>
                    </Tooltip>
                  )}
                </Paper>
              ))}

              {completedBundles.map((action) => (
                <Paper key={action.actionId} variant="outlined" sx={{ p: 1.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>ZIP 다운로드 준비 완료</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    {action.result.fileCount}개 파일 · {Math.ceil(action.result.totalBytes / 1024 / 1024)}MB · 다운로드 시 원본 변경 여부 재확인
                  </Typography>
                  <Button size="small" variant="outlined" disabled={loading} onClick={() => downloadBundle(action)}>ZIP 다운로드</Button>
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
              sx={{ position: 'absolute', right: 16, bottom: 12, boxShadow: 1 }}
            >
              최신으로
            </Button>
          )}
        </Box>

        <Box sx={{ p: 1.5, borderTop: (theme) => `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper' }}>
          {attachedNasPaths.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mb: 1, flexWrap: 'wrap', gap: 0.5 }}>
              {attachedNasPaths.map((item) => (
                <Chip key={item} size="small" label={item.split('/').pop() || '/'} title={item} onDelete={() => setAttachedNasPaths((current) => current.filter((path) => path !== item))} />
              ))}
            </Stack>
          )}
          {localFiles.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mb: 1, flexWrap: 'wrap', gap: 0.5 }}>
              {localFiles.map((file, index) => (
                <Chip key={`${file.name}-${index}`} size="small" label={`PC · ${file.name}`} onDelete={() => setLocalFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
              ))}
            </Stack>
          )}
          {Array.isArray(context.selectedPaths) && context.selectedPaths.length > 0 && (
            <Button size="small" sx={{ mb: 0.75 }} onClick={() => addNasPaths(context.selectedPaths)} disabled={loading}>
              바탕화면 선택 항목 첨부 ({context.selectedPaths.length})
            </Button>
          )}
          <Stack direction="row" spacing={1} alignItems="flex-end">
            <input ref={localInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.docx,.pptx,.xlsx,.odt,.ods,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.xml,.yaml,.yml,.log" hidden onChange={(event) => { addLocalFiles(event.target.files).catch(() => setError('PC 파일을 읽지 못했습니다.')); event.target.value = ''; }} />
            <Tooltip title="PC 사진·파일 첨부">
              <IconButton aria-label="PC 사진·파일 첨부" onClick={() => localInputRef.current?.click()} disabled={loading} sx={{ mb: 0.5 }}><AttachFileIcon /></IconButton>
            </Tooltip>
            <Tooltip title="NAS 파일·폴더 첨부">
              <IconButton aria-label="NAS 파일·폴더 첨부" onClick={() => setNasPickerOpen(true)} disabled={loading} sx={{ mb: 0.5 }}><FolderOpenIcon /></IconButton>
            </Tooltip>
            <TextField
              fullWidth
              multiline
              minRows={1}
              maxRows={5}
              placeholder="NAS에서 원하는 일을 평소 말하듯 요청하세요"
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
            <Button variant="contained" disabled={loading || (!message.trim() && attachedNasPaths.length === 0 && localFiles.length === 0)} onClick={sendMessage} sx={{ minHeight: 40 }}>전송</Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Enter 전송 · Shift+Enter 줄바꿈 · PC 파일 붙여넣기/드래그 · NAS 파일 드래그 · 첨부 내용은 AI 모델로 전송됩니다
          </Typography>
        </Box>
      </Box>
      <ChatNasPickerDialog open={nasPickerOpen} onClose={() => setNasPickerOpen(false)} onConfirm={(paths) => { addNasPaths(paths); setNasPickerOpen(false); }} title="AI에 NAS 항목 첨부" />
    </Box>
  );
};

export default AiAgentPanel;
