import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Chip, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import StopIcon from '@mui/icons-material/Stop';
import TerminalIcon from '@mui/icons-material/Terminal';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const stateLabel = { starting: '시작 중', running: '실행 중', finished: '완료', failed: '오류', stopped: '중지됨' };

const CodeRunPanel = ({ session, events, onInput, onStop, onHide }) => {
  const [input, setInput] = useState('');
  const [expanded, setExpanded] = useState(false);
  const outputRef = useRef(null);
  const running = session?.state === 'running' || session?.state === 'starting';
  const transcript = useMemo(() => (events || []).map((event) => ({ ...event, text: String(event.text || '') })), [events]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [transcript]);

  const submit = async () => {
    if (!running || session?.state === 'starting') return;
    const value = input;
    setInput('');
    await onInput?.(value);
  };

  return <Box sx={{ flex: expanded ? '0 0 min(58vh, 560px)' : '0 0 clamp(190px, 32vh, 330px)', minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: '#0d1117', color: '#d8dee9', borderTop: '1px solid #2a313c', transition: 'flex-basis 140ms ease' }}>
    <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 40, px: 1.25, bgcolor: '#11161e', borderBottom: '1px solid #2a313c' }}>
      <TerminalIcon sx={{ fontSize: 17, color: '#aeb8c5' }} />
      <Typography variant="body2" sx={{ fontWeight: 900 }}>실행 콘솔</Typography>
      <Typography variant="caption" noWrap sx={{ maxWidth: '45%', color: '#8390a1' }}>{session?.displayName || '프로그램'} · {session?.noteTitle || '코드 페이지'} · 표준 출력/입력</Typography>
      <Box sx={{ flex: 1 }} />
      <Chip size="small" label={stateLabel[session?.state] || '준비'} color={session?.state === 'failed' ? 'error' : session?.state === 'running' ? 'success' : 'default'} variant="outlined" sx={{ color: '#cbd5e1', borderColor: '#465163', height: 24 }} />
      {session?.state === 'running' && <Tooltip title="실행 중지"><IconButton size="small" onClick={onStop} sx={{ color: '#ff9a9a' }}><StopIcon fontSize="small" /></IconButton></Tooltip>}
      <Tooltip title={expanded ? '콘솔 기본 크기' : '콘솔 크게 보기'}><IconButton size="small" onClick={() => setExpanded((current) => !current)} sx={{ color: '#aeb8c5' }}>{expanded ? <ExpandMoreIcon fontSize="small" /> : <ExpandLessIcon fontSize="small" />}</IconButton></Tooltip>
      <Tooltip title="콘솔 숨기기 · 실행 중이면 백그라운드에서 계속됩니다"><IconButton size="small" onClick={onHide} sx={{ color: '#aeb8c5' }}><CloseIcon fontSize="small" /></IconButton></Tooltip>
    </Stack>
    <Box ref={outputRef} aria-live="polite" sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: 1.5, py: 1.25, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>
      {transcript.length === 0 && <Box sx={{ color: '#788596' }}>{running ? '프로그램을 시작하고 있습니다…' : '(출력 없음)'}</Box>}
      {transcript.map((event) => <Box component="span" key={event.sequence} sx={{ color: event.stream === 'stderr' ? '#ff8e8e' : event.stream === 'input' ? '#8ab4f8' : event.stream === 'system' ? '#93a4b8' : '#d8dee9' }}>{event.text}</Box>)}
      {session?.state && !running && <Box sx={{ mt: 1, color: session.exitCode === 0 ? '#77c995' : '#ff9a9a' }}>[프로그램 종료{Number.isInteger(session.exitCode) ? ` · 코드 ${session.exitCode}` : ''}]</Box>}
    </Box>
    <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 0.75, bgcolor: '#11161e', borderTop: '1px solid #2a313c' }}>
      <Typography sx={{ color: '#8ab4f8', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }}>›</Typography>
      <TextField
        fullWidth size="small" variant="standard" placeholder={running ? '프로그램 입력 — Enter로 전송' : '실행이 종료되었습니다'}
        value={input} disabled={!running || session?.state === 'starting'} onChange={(event) => setInput(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }}
        inputProps={{ 'aria-label': '실행 중인 프로그램에 표준 입력', spellCheck: false }}
        InputProps={{ disableUnderline: true, sx: { color: '#e5e9f0', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13 } }}
      />
      <Button size="small" disabled={!running || session?.state === 'starting'} onClick={submit} sx={{ color: '#b7c3d2' }}>입력</Button>
    </Stack>
  </Box>;
};

export default CodeRunPanel;
