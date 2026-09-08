import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem,
  Stack, TextField, Tooltip, Typography
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
import TerminalIcon from '@mui/icons-material/Terminal';
import CloseIcon from '@mui/icons-material/Close';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import NoteAddOutlinedIcon from '@mui/icons-material/NoteAddOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { copyTextToClipboard } from '../../utils/copyTextToClipboard';

const formatBytes = (value) => {
  if (!Number.isFinite(value)) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
};

const commandError = (error) => error.response?.data?.error || error.message || '명령을 실행하지 못했습니다.';
const joinNasPath = (parent, name) => `${String(parent || '/').replace(/\/+$/, '')}/${name}`.replace(/^\/{2,}/, '/');

const NoteStudioTerminal = ({ notebook, explorerOpen, onExplorerOpenChange, onClose, onOpenFile, onOpenFolder }) => {
  const [entries, setEntries] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [collapsedDirectories, setCollapsedDirectories] = useState(() => new Set());
  const [selectedEntryId, setSelectedEntryId] = useState('');
  const [fileMenu, setFileMenu] = useState(null);
  const [editDialog, setEditDialog] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [cwd, setCwd] = useState('');
  const [ownerLabel, setOwnerLabel] = useState('사용자');
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [lines, setLines] = useState([]);
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  const virtualPath = useMemo(() => `/${ownerLabel} / NOTE MANAGER / ${notebook?.directoryName || notebook?.title || '노트북'}${cwd ? ` / ${cwd.split('/').join(' / ')}` : ''}`, [cwd, notebook, ownerLabel]);

  const loadFiles = useCallback(async () => {
    if (!notebook?.id) return;
    setFilesLoading(true);
    setFilesError('');
    try {
      const { data } = await axios.get(`/api/note-studio/notebooks/${encodeURIComponent(notebook.id)}/files`, { withCredentials: true });
      setEntries(data.entries || []);
      setTruncated(!!data.truncated);
      setOwnerLabel(data.ownerLabel || '사용자');
    } catch (error) {
      setFilesError(commandError(error));
    } finally { setFilesLoading(false); }
  }, [notebook?.id]);

  useEffect(() => {
    setCwd('');
    setLines([{ id: `${Date.now()}-welcome`, kind: 'system', text: `“${notebook?.title || '노트북'}” 전용 격리 터미널입니다. 이 노트북 폴더 밖은 보이지 않습니다.` }]);
    setHistory([]);
    setHistoryIndex(-1);
    setCollapsedDirectories(new Set());
    setSelectedEntryId('');
    setFileMenu(null);
    loadFiles();
  }, [loadFiles, notebook?.title]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines, running]);

  const visibleEntries = useMemo(() => entries.filter((entry) => {
    if (!entry.parentRelativePath) return true;
    const segments = entry.parentRelativePath.split('/');
    let ancestor = '';
    return segments.every((segment) => {
      ancestor = ancestor ? `${ancestor}/${segment}` : segment;
      return !collapsedDirectories.has(ancestor);
    });
  }), [collapsedDirectories, entries]);

  const toggleDirectory = (entry) => {
    setCollapsedDirectories((current) => {
      const next = new Set(current);
      if (next.has(entry.relativePath)) next.delete(entry.relativePath);
      else next.add(entry.relativePath);
      return next;
    });
  };

  const openFileMenu = (event, entry = null) => {
    event.preventDefault();
    event.stopPropagation();
    if (entry) setSelectedEntryId(entry.id);
    setFileMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6, entry });
  };

  const startEdit = (mode, entry = null) => {
    const parentPath = entry?.kind === 'folder' ? entry.path : entry?.path?.slice(0, Math.max(1, entry.path.lastIndexOf('/'))) || notebook.path;
    setFileMenu(null);
    setEditValue(mode === 'rename' ? entry?.name || '' : mode === 'new-file' ? '새 파일.txt' : '새 폴더');
    setEditDialog({ mode, entry, parentPath });
  };

  const submitEdit = async () => {
    const name = editValue.trim();
    if (!name || editing) return;
    setEditing(true);
    try {
      if (editDialog.mode === 'new-folder') {
        await axios.post('/api/file', { path: editDialog.parentPath, folderName: name }, { withCredentials: true });
      } else if (editDialog.mode === 'new-file') {
        const body = new FormData();
        body.append('path', editDialog.parentPath);
        body.append('file', new Blob([''], { type: 'text/plain' }), name);
        await axios.post('/api/file', body, { withCredentials: true });
      } else if (editDialog.mode === 'rename') {
        await axios.put('/api/file', { oldPath: editDialog.entry.path, newPath: joinNasPath(editDialog.parentPath, name) }, { withCredentials: true });
      }
      setEditDialog(null);
      await loadFiles();
    } catch (error) { setFilesError(commandError(error)); }
    finally { setEditing(false); }
  };

  const trashEntry = async (entry) => {
    setFileMenu(null);
    if (!window.confirm(`“${entry.name}”을(를) 휴지통으로 이동할까요?`)) return;
    try {
      await axios.delete('/api/file', { params: { path: entry.path }, data: { path: entry.path }, withCredentials: true });
      setSelectedEntryId('');
      await loadFiles();
    } catch (error) { setFilesError(commandError(error)); }
  };

  const runCommand = async () => {
    const submitted = command.trim();
    if (!submitted || running || !notebook?.id) return;
    if (submitted === 'clear') {
      setLines([]);
      setCommand('');
      setHistory((current) => [...current.filter((item) => item !== submitted), submitted].slice(-100));
      return;
    }
    const commandLine = { id: `${Date.now()}-command`, kind: 'command', text: submitted, prompt: `${ownerLabel}:${virtualPath.replaceAll(' / ', '/')}$` };
    setLines((current) => [...current, commandLine]);
    setHistory((current) => [...current.filter((item) => item !== submitted), submitted].slice(-100));
    setHistoryIndex(-1);
    setCommand('');
    setRunning(true);
    try {
      const { data } = await axios.post(`/api/note-studio/notebooks/${encodeURIComponent(notebook.id)}/terminal`, { cwd, command: submitted }, { withCredentials: true });
      setCwd(data.cwd || '');
      setOwnerLabel(data.ownerLabel || '사용자');
      const result = data.result || {};
      const additions = [];
      if (result.stdout) additions.push({ id: `${Date.now()}-stdout`, kind: 'stdout', text: result.stdout });
      if (result.stderr) additions.push({ id: `${Date.now()}-stderr`, kind: 'stderr', text: result.stderr });
      if (result.exitCode !== 0) additions.push({ id: `${Date.now()}-exit`, kind: 'stderr', text: `[종료 코드 ${result.exitCode}]` });
      setLines((current) => [...current, ...additions]);
      await loadFiles();
    } catch (error) {
      setLines((current) => [...current, { id: `${Date.now()}-error`, kind: 'stderr', text: commandError(error) }]);
    } finally {
      setRunning(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleInputKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      runCommand();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = history.length ? Math.min(history.length - 1, historyIndex < 0 ? history.length - 1 : historyIndex - 1) : -1;
      setHistoryIndex(next);
      if (next >= 0) setCommand(history[next]);
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = historyIndex < 0 ? -1 : historyIndex + 1;
      if (next >= history.length) { setHistoryIndex(-1); setCommand(''); }
      else { setHistoryIndex(next); setCommand(history[next]); }
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      setLines([]);
    }
  };

  return (
    <Box className="note-studio-terminal" data-testid="note-studio-terminal-panel" sx={{ flex: '0 1 clamp(180px, 32%, 320px)', minHeight: 150, maxHeight: '42%', display: 'flex', bgcolor: '#0d1117', color: '#d8dee9', borderTop: '1px solid #2a313c' }}>
      {explorerOpen && <Box sx={{ width: { xs: 190, sm: 250 }, minWidth: 0, display: 'flex', flexDirection: 'column', bgcolor: '#151a22', borderRight: '1px solid #2a313c' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 1.25, minHeight: 43 }}>
          <Typography variant="caption" sx={{ color: '#aeb8c5', fontWeight: 900, letterSpacing: '0.06em' }}>노트북 파일</Typography>
          <Tooltip title="파일 목록 새로고침"><IconButton size="small" onClick={loadFiles} sx={{ color: '#aeb8c5' }}><RefreshIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
        <Divider sx={{ borderColor: '#2a313c' }} />
        {filesError && <Alert severity="error" sx={{ borderRadius: 0 }}>{filesError}</Alert>}
        {truncated && <Alert severity="warning" sx={{ borderRadius: 0 }}>항목이 많아 2,000개까지만 표시합니다.</Alert>}
        <Box onContextMenu={(event) => openFileMenu(event)} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          {filesLoading ? <Box sx={{ py: 4, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box> : visibleEntries.length === 0 ? <Typography variant="body2" sx={{ p: 2, color: '#7f8a99' }}>아직 실제 파일이 없습니다.</Typography> : <List role="tree" aria-label="노트북 파일 트리" dense disablePadding>
            {visibleEntries.map((entry) => {
              const folder = entry.kind === 'folder';
              const collapsed = collapsedDirectories.has(entry.relativePath);
              return <ListItemButton className="note-file-tree-row" role="treeitem" aria-level={entry.depth + 1} aria-expanded={folder ? !collapsed : undefined} key={entry.id} selected={selectedEntryId === entry.id} onClick={() => { setSelectedEntryId(entry.id); if (folder) toggleDirectory(entry); else onOpenFile?.(entry.path); }} onDoubleClick={() => folder && onOpenFolder?.(entry.path)} onContextMenu={(event) => openFileMenu(event, entry)} sx={{ minHeight: 32, py: 0.15, pl: 0.65 + Math.min(entry.depth, 10) * 1.55, color: '#d8dee9', position: 'relative', '&:hover': { bgcolor: '#202733' }, '&.Mui-selected': { bgcolor: '#263345' }, '&.Mui-selected:hover': { bgcolor: '#2d3c50' } }}>
                {Array.from({ length: Math.min(entry.depth, 10) }).map((_, index) => <Box aria-hidden="true" key={index} sx={{ position: 'absolute', top: 0, bottom: 0, left: 13 + index * 24.8, borderLeft: '1px solid #303846', pointerEvents: 'none' }} />)}
                {folder ? (collapsed ? <ChevronRightIcon sx={{ fontSize: 17, color: '#7f8a99' }} /> : <ExpandMoreIcon sx={{ fontSize: 17, color: '#7f8a99' }} />) : <Box sx={{ width: 17 }} />}
                <ListItemIcon sx={{ minWidth: 27, color: '#9ba7b6' }}>{folder ? <FolderOutlinedIcon sx={{ fontSize: 18 }} /> : <InsertDriveFileOutlinedIcon sx={{ fontSize: 17 }} />}</ListItemIcon>
                <ListItemText primary={entry.name} secondary={folder ? '' : formatBytes(entry.size)} primaryTypographyProps={{ noWrap: true, fontSize: 12.5 }} secondaryTypographyProps={{ noWrap: true, fontSize: 9.5, color: '#737f8f' }} />
                <IconButton className="note-tree-row-actions" size="small" aria-label={`${entry.name} 작업`} onClick={(event) => openFileMenu(event, entry)} sx={{ color: '#aeb8c5' }}><MoreHorizIcon sx={{ fontSize: 17 }} /></IconButton>
              </ListItemButton>;
            })}
          </List>}
        </Box>
        <Tooltip title="NAS 파일관리자에서 노트북 폴더 열기"><Button onClick={() => onOpenFolder?.(notebook.path)} sx={{ m: 1, color: '#c4ccd6', borderColor: '#394250' }} size="small" variant="outlined">파일관리자에서 열기</Button></Tooltip>
      </Box>}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 44, px: 1.25, bgcolor: '#11161e', borderBottom: '1px solid #2a313c' }}>
          <TerminalIcon sx={{ fontSize: 18, color: '#aeb8c5' }} />
          <Typography variant="body2" noWrap sx={{ flex: 1, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', color: '#c7d0dc' }}>{virtualPath}</Typography>
          <Typography variant="caption" sx={{ display: { xs: 'none', md: 'block' }, color: '#748092' }}>네트워크 차단 · 20초 · 256MiB</Typography>
          <Tooltip title={explorerOpen ? '옆 파일 목록 숨기기' : '옆 파일 목록 보기'}><IconButton size="small" onClick={() => onExplorerOpenChange?.(!explorerOpen)} sx={{ color: explorerOpen ? '#8ab4f8' : '#aeb8c5' }}><ViewSidebarOutlinedIcon fontSize="small" /></IconButton></Tooltip>
          <Tooltip title="터미널 닫기"><IconButton size="small" onClick={onClose} sx={{ color: '#aeb8c5' }}><CloseIcon fontSize="small" /></IconButton></Tooltip>
        </Stack>
        <Box ref={outputRef} onClick={() => inputRef.current?.focus()} sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1.5, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', cursor: 'text' }}>
          {lines.map((line) => <Box key={line.id} sx={{ color: line.kind === 'stderr' ? '#ff8e8e' : line.kind === 'system' ? '#8fa1b5' : '#d8dee9', mb: line.kind === 'command' ? 0.25 : 0.75 }}>
            {line.kind === 'command' && <Box component="span" sx={{ color: '#77c995' }}>{line.prompt} </Box>}{line.text}
          </Box>)}
          {running && <Box sx={{ color: '#8fa1b5' }}>실행 중…</Box>}
        </Box>
        <Stack direction="row" alignItems="flex-start" sx={{ px: 1.5, py: 1, borderTop: '1px solid #2a313c', bgcolor: '#11161e' }}>
          <Typography component="span" sx={{ pt: 0.45, pr: 0.75, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13, color: '#77c995' }}>{ownerLabel}$</Typography>
          <Box component="textarea" ref={inputRef} autoFocus rows={1} aria-label="터미널 명령" spellCheck={false} value={command} disabled={running} onChange={(event) => setCommand(event.target.value)} onKeyDown={handleInputKeyDown} sx={{ flex: 1, resize: 'none', border: 0, outline: 0, p: '4px 0', bgcolor: 'transparent', color: '#e5e9f0', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 13 }} />
          <Button size="small" disabled={running || !command.trim()} onClick={runCommand} sx={{ color: '#b7c3d2' }}>실행</Button>
        </Stack>
      </Box>
      <Menu open={!!fileMenu} onClose={() => setFileMenu(null)} anchorReference="anchorPosition" anchorPosition={fileMenu ? { top: fileMenu.mouseY, left: fileMenu.mouseX } : undefined} MenuListProps={{ dense: true, 'aria-label': '파일 트리 작업' }}>
        {fileMenu?.entry && <MenuItem onClick={() => { const entry = fileMenu.entry; setFileMenu(null); entry.kind === 'folder' ? onOpenFolder?.(entry.path) : onOpenFile?.(entry.path); }}>열기</MenuItem>}
        {fileMenu?.entry?.kind === 'folder' && <MenuItem onClick={() => { toggleDirectory(fileMenu.entry); setFileMenu(null); }}>{collapsedDirectories.has(fileMenu.entry.relativePath) ? '펼치기' : '접기'}</MenuItem>}
        <Divider />
        <MenuItem onClick={() => startEdit('new-file', fileMenu?.entry)}><ListItemIcon><NoteAddOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>새 파일</ListItemText></MenuItem>
        <MenuItem onClick={() => startEdit('new-folder', fileMenu?.entry)}><ListItemIcon><CreateNewFolderOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText>새 폴더</ListItemText></MenuItem>
        {fileMenu?.entry && <><Divider /><MenuItem onClick={() => startEdit('rename', fileMenu.entry)}><ListItemIcon><DriveFileRenameOutlineIcon fontSize="small" /></ListItemIcon><ListItemText>이름 바꾸기</ListItemText></MenuItem><MenuItem onClick={async () => { await copyTextToClipboard(fileMenu.entry.path); setFileMenu(null); }}><ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon><ListItemText>NAS 경로 복사</ListItemText></MenuItem><Divider /><MenuItem onClick={() => trashEntry(fileMenu.entry)} sx={{ color: 'error.main' }}><ListItemIcon sx={{ color: 'error.main' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon><ListItemText>휴지통으로 이동</ListItemText></MenuItem></>}
      </Menu>
      <Dialog open={!!editDialog} onClose={() => !editing && setEditDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>{editDialog?.mode === 'rename' ? '이름 바꾸기' : editDialog?.mode === 'new-file' ? '새 파일' : '새 폴더'}</DialogTitle>
        <DialogContent><TextField autoFocus fullWidth margin="dense" label="이름" value={editValue} onChange={(event) => setEditValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitEdit(); }} helperText={editDialog?.parentPath} /></DialogContent>
        <DialogActions><Button color="inherit" onClick={() => setEditDialog(null)} disabled={editing}>취소</Button><Button variant="contained" onClick={submitEdit} disabled={editing || !editValue.trim()}>{editing ? '처리 중…' : '확인'}</Button></DialogActions>
      </Dialog>
    </Box>
  );
};

export default NoteStudioTerminal;
