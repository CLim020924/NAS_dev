import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import Editor from '@monaco-editor/react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, IconButton, List, ListItemButton, ListItemIcon, ListItemText,
  Menu, MenuItem, Paper, Select, Stack, TextField, ToggleButton, Tooltip, Typography
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ArchiveIcon from '@mui/icons-material/Archive';
import CodeIcon from '@mui/icons-material/Code';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DescriptionIcon from '@mui/icons-material/Description';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import HistoryIcon from '@mui/icons-material/History';
import NotesIcon from '@mui/icons-material/Notes';
import RedoIcon from '@mui/icons-material/Redo';
import RestoreIcon from '@mui/icons-material/Restore';
import SearchIcon from '@mui/icons-material/Search';
import UndoIcon from '@mui/icons-material/Undo';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { alpha, useTheme } from '@mui/material/styles';
import { useWindows } from '../../contexts/WindowContext';
import NasItemPickerDialog from '../NasItemPickerDialog';
import { BLOCK_COMMANDS, filterCommands, flattenNoteTree } from './noteStudioCommands';
import './NoteStudio.css';

const TYPE_OPTIONS = [
  { type: 'block', label: '블록 노트', detail: '문단·목록·제목을 자유롭게 구성', Icon: NotesIcon },
  { type: 'markdown', label: 'Markdown', detail: '가벼운 문서와 README 작성', Icon: DescriptionIcon },
  { type: 'text', label: 'TXT', detail: '서식 없는 빠른 메모', Icon: DescriptionIcon },
  { type: 'code', label: '코드 노트', detail: 'Monaco 편집기와 언어 선택', Icon: CodeIcon }
];

const languageOptions = ['plaintext', 'javascript', 'typescript', 'python', 'json', 'html', 'css', 'sql', 'shell', 'yaml', 'markdown'];
const errorMessage = (error, fallback) => error.response?.data?.error || error.message || fallback;
const formatTime = (value) => value ? new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '';

const BlockToolbar = ({ editor }) => {
  if (!editor) return null;
  const actions = [
    ['굵게', <FormatBoldIcon fontSize="small" />, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold')],
    ['기울임', <FormatItalicIcon fontSize="small" />, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic')],
    ['글머리표', <FormatListBulletedIcon fontSize="small" />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList')],
    ['번호 목록', <FormatListNumberedIcon fontSize="small" />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList')]
  ];
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ px: 1.25, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', overflowX: 'auto' }}>
      <Tooltip title="실행 취소"><span><IconButton size="small" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><UndoIcon fontSize="small" /></IconButton></span></Tooltip>
      <Tooltip title="다시 실행"><span><IconButton size="small" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><RedoIcon fontSize="small" /></IconButton></span></Tooltip>
      <Divider flexItem orientation="vertical" />
      {actions.map(([label, icon, action, active]) => <Tooltip key={label} title={label}><ToggleButton size="small" value={label} selected={active} onClick={action} sx={{ border: 0, borderRadius: 1.25 }}>{icon}</ToggleButton></Tooltip>)}
      <Divider flexItem orientation="vertical" />
      <Button size="small" color={editor.isActive('heading', { level: 1 }) ? 'primary' : 'inherit'} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>제목 1</Button>
      <Button size="small" color={editor.isActive('heading', { level: 2 }) ? 'primary' : 'inherit'} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>제목 2</Button>
    </Stack>
  );
};

const NoteStudio = () => {
  const theme = useTheme();
  const { openFileWindowByPath, openFolderWindowByPath } = useWindows();
  const [notes, setNotes] = useState([]);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [trashMode, setTrashMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [savingState, setSavingState] = useState('idle');
  const [message, setMessage] = useState(null);
  const [createAnchor, setCreateAnchor] = useState(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState([]);
  const [plainContent, setPlainContent] = useState('');
  const [attachmentPickerOpen, setAttachmentPickerOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [pendingParentId, setPendingParentId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const selectedRef = useRef(null);
  const saveTimerRef = useRef(null);
  const pendingContentRef = useRef(null);
  const loadingNoteRef = useRef(false);
  const importInputRef = useRef(null);
  const editGenerationRef = useRef(0);
  const savingRef = useRef(false);

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: "'/'를 누르거나 내용을 입력하세요." })],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: false,
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          setCommandQuery('');
          setTimeout(() => setCommandOpen(true), 0);
        }
        return false;
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (loadingNoteRef.current || selectedRef.current?.type !== 'block') return;
      pendingContentRef.current = currentEditor.getJSON();
      editGenerationRef.current += 1;
      setSavingState('dirty');
    }
  });

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const loadList = useCallback(async ({ keepSelection = true } = {}) => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/note-studio/notes', { params: { deleted: trashMode, q: query }, withCredentials: true });
      setNotes(data.notes || []);
      if (!keepSelection || (selectedRef.current && !(data.notes || []).some((note) => note.id === selectedRef.current.id))) setSelected(null);
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '노트 목록을 불러오지 못했습니다.') }); }
    finally { setLoading(false); }
  }, [query, trashMode]);

  useEffect(() => {
    const timer = setTimeout(() => loadList(), 220);
    return () => clearTimeout(timer);
  }, [loadList]);

  const openNote = useCallback(async (meta) => {
    if (!meta?.id) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSavingState('idle');
    try {
      const { data } = await axios.get(`/api/note-studio/notes/${encodeURIComponent(meta.id)}`, { params: { includeDeleted: trashMode }, withCredentials: true });
      const note = data.note;
      loadingNoteRef.current = true;
      setSelected(note);
      selectedRef.current = note;
      if (note.type === 'block') editor?.commands.setContent(note.content, false);
      else setPlainContent(String(note.content || ''));
      pendingContentRef.current = note.content;
      editGenerationRef.current = 0;
      queueMicrotask(() => { loadingNoteRef.current = false; });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '노트를 열지 못했습니다.') }); }
  }, [editor, trashMode]);

  const saveNow = useCallback(async (reason = 'autosave') => {
    const current = selectedRef.current;
    if (!current || current.deletedAt || savingRef.current) return;
    const content = current.type === 'block' ? (pendingContentRef.current ?? editor?.getJSON()) : pendingContentRef.current;
    const savedGeneration = editGenerationRef.current;
    savingRef.current = true;
    setSavingState('saving');
    try {
      const { data } = await axios.patch(`/api/note-studio/notes/${encodeURIComponent(current.id)}`, {
        expectedRevision: current.revision,
        title: current.title,
        language: current.language,
        content,
        reason
      }, { withCredentials: true });
      const currentAfterSave = selectedRef.current;
      const editedDuringSave = editGenerationRef.current !== savedGeneration;
      const mergedNote = editedDuringSave && currentAfterSave?.id === data.note.id
        ? { ...data.note, title: currentAfterSave.title, language: currentAfterSave.language, content: pendingContentRef.current }
        : data.note;
      selectedRef.current = mergedNote;
      setSelected(mergedNote);
      setNotes((items) => items.map((item) => item.id === data.note.id ? { ...item, ...data.note, content: undefined } : item).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
      setSavingState(editedDuringSave ? 'dirty' : 'saved');
      if (editedDuringSave) setTimeout(() => saveNow('autosave'), 80);
    } catch (error) {
      if (error.response?.status === 409) {
        setSavingState('conflict');
        setMessage({ severity: 'warning', text: '다른 창에서 수정된 내용이 있어 자동 저장을 멈췄습니다. 현재 입력은 그대로 보존됩니다. 목록에서 노트를 다시 열어 최신본을 확인하세요.' });
      } else {
        setSavingState('error');
        setMessage({ severity: 'error', text: errorMessage(error, '자동 저장하지 못했습니다. 입력 내용은 이 창에 남아 있습니다.') });
      }
    } finally {
      savingRef.current = false;
    }
  }, [editor]);

  useEffect(() => {
    if (savingState !== 'dirty') return undefined;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNow('autosave'), 850);
    return () => clearTimeout(saveTimerRef.current);
  }, [saveNow, savingState]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveNow('manual');
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && selectedRef.current?.type === 'block') {
        event.preventDefault();
        setCommandQuery('');
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [saveNow]);

  const updatePlain = (value) => {
    setPlainContent(value);
    pendingContentRef.current = value;
    editGenerationRef.current += 1;
    setSavingState('dirty');
  };

  const updateMeta = (patch) => {
    setSelected((current) => {
      const next = { ...current, ...patch };
      selectedRef.current = next;
      return next;
    });
    editGenerationRef.current += 1;
    setSavingState('dirty');
  };

  const createNote = async (option) => {
    setCreateAnchor(null);
    try {
      const { data } = await axios.post('/api/note-studio/notes', { title: `새 ${option.label}`, type: option.type, language: option.type === 'code' ? 'plaintext' : '', parentId: pendingParentId }, { withCredentials: true });
      setPendingParentId(null);
      setTrashMode(false);
      await loadList({ keepSelection: false });
      await openNote(data.note);
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '새 노트를 만들지 못했습니다.') }); }
  };

  const trashSelected = async () => {
    const current = selectedRef.current;
    if (!current) return;
    try {
      await axios.delete(`/api/note-studio/notes/${encodeURIComponent(current.id)}`, { data: { expectedRevision: current.revision }, withCredentials: true });
      setSelected(null);
      selectedRef.current = null;
      await loadList({ keepSelection: false });
      setMessage({ severity: 'success', text: '노트를 휴지통으로 이동했습니다.' });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '노트를 삭제하지 못했습니다.') }); }
  };

  const restoreSelected = async () => {
    const current = selectedRef.current;
    try {
      await axios.post(`/api/note-studio/notes/${encodeURIComponent(current.id)}/restore`, {}, { withCredentials: true });
      setSelected(null); selectedRef.current = null;
      await loadList({ keepSelection: false });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '노트를 복원하지 못했습니다.') }); }
  };

  const permanentlyDelete = async () => {
    const current = selectedRef.current;
    if (!window.confirm(`“${current.title}” 노트를 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      await axios.delete(`/api/note-studio/notes/${encodeURIComponent(current.id)}/permanent`, { withCredentials: true });
      setSelected(null); selectedRef.current = null;
      await loadList({ keepSelection: false });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '노트를 영구 삭제하지 못했습니다.') }); }
  };

  const openVersions = async () => {
    if (!selected) return;
    try {
      const { data } = await axios.get(`/api/note-studio/notes/${encodeURIComponent(selected.id)}/versions`, { withCredentials: true });
      setVersions(data.versions || []);
      setVersionsOpen(true);
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '버전 기록을 불러오지 못했습니다.') }); }
  };

  const restoreVersion = async (version) => {
    try {
      const current = selectedRef.current;
      const { data } = await axios.post(`/api/note-studio/notes/${encodeURIComponent(current.id)}/versions/${encodeURIComponent(version.versionId)}/restore`, { expectedRevision: current.revision }, { withCredentials: true });
      setVersionsOpen(false);
      await openNote(data.note);
      setMessage({ severity: 'success', text: `버전 ${version.revision}의 내용을 새 버전으로 복원했습니다.` });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '버전을 복원하지 못했습니다.') }); }
  };

  const addAttachment = async (item) => {
    const current = selectedRef.current;
    if (!current || !item?.fullPath) return;
    setAttachmentPickerOpen(false);
    try {
      const { data } = await axios.post(`/api/note-studio/notes/${encodeURIComponent(current.id)}/attachments`, { path: item.fullPath, expectedRevision: current.revision }, { withCredentials: true });
      selectedRef.current = { ...current, ...data.note };
      setSelected(selectedRef.current);
      setNotes((items) => items.map((note) => note.id === current.id ? { ...note, ...data.note } : note));
      setSavingState('saved');
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, 'NAS 항목을 첨부하지 못했습니다.') }); }
  };

  const removeAttachment = async (attachment) => {
    const current = selectedRef.current;
    try {
      const { data } = await axios.delete(`/api/note-studio/notes/${encodeURIComponent(current.id)}/attachments/${encodeURIComponent(attachment.id)}`, { data: { expectedRevision: current.revision }, withCredentials: true });
      selectedRef.current = { ...current, ...data.note };
      setSelected(selectedRef.current);
      setNotes((items) => items.map((note) => note.id === current.id ? { ...note, ...data.note } : note));
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '첨부를 제거하지 못했습니다.') }); }
  };

  const openAttachment = (attachment) => attachment.kind === 'folder'
    ? openFolderWindowByPath(attachment.path)
    : openFileWindowByPath(attachment.path, attachment.name, true);

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    try {
      const { data } = await axios.post('/api/note-studio/import', body, { withCredentials: true });
      setTrashMode(false);
      setNotes((items) => [data.note, ...items]);
      await openNote(data.note);
      setMessage({ severity: 'success', text: `${file.name}을(를) 노트로 가져왔습니다.` });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '파일을 가져오지 못했습니다.') }); }
  };

  const exportSelected = async () => {
    const current = selectedRef.current;
    if (!current) return;
    try {
      const response = await axios.get(`/api/note-studio/notes/${encodeURIComponent(current.id)}/export`, { responseType: 'blob', withCredentials: true });
      const disposition = response.headers['content-disposition'] || '';
      const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const name = encoded ? decodeURIComponent(encoded) : `${current.title}.txt`;
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '노트를 내보내지 못했습니다.') }); }
  };

  const saveLabel = useMemo(() => ({ idle: '저장됨', saved: '저장됨', dirty: '저장 대기', saving: '저장 중…', conflict: '충돌 — 재확인 필요', error: '저장 실패' }[savingState]), [savingState]);
  const treeNotes = useMemo(() => flattenNoteTree(notes), [notes]);
  const visibleCommands = useMemo(() => filterCommands(BLOCK_COMMANDS, commandQuery), [commandQuery]);

  const runBlockCommand = (commandId) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    let chain = editor.chain().focus();
    if (from > 0 && editor.state.doc.textBetween(from - 1, from) === '/') chain = chain.deleteRange({ from: from - 1, to: from });
    const actions = {
      paragraph: () => chain.setParagraph().run(),
      'heading-1': () => chain.toggleHeading({ level: 1 }).run(),
      'heading-2': () => chain.toggleHeading({ level: 2 }).run(),
      'bullet-list': () => chain.toggleBulletList().run(),
      'ordered-list': () => chain.toggleOrderedList().run(),
      quote: () => chain.toggleBlockquote().run(),
      'code-block': () => chain.toggleCodeBlock().run(),
      divider: () => chain.setHorizontalRule().run()
    };
    actions[commandId]?.();
    setCommandOpen(false);
  };

  const moveNoteToRoot = async (note) => {
    try {
      const { data } = await axios.patch(`/api/note-studio/notes/${encodeURIComponent(note.id)}`, { expectedRevision: note.revision, parentId: null, reason: 'tree-move' }, { withCredentials: true });
      setContextMenu(null);
      setNotes((items) => items.map((item) => item.id === note.id ? { ...item, ...data.note, content: undefined } : item));
      if (selectedRef.current?.id === note.id) {
        selectedRef.current = { ...selectedRef.current, ...data.note };
        setSelected(selectedRef.current);
      }
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '노트를 이동하지 못했습니다.') }); }
  };

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '270px minmax(0, 1fr)' }, bgcolor: 'background.default' }}>
      <Paper square elevation={0} sx={{ display: { xs: selected ? 'none' : 'flex', md: 'flex' }, minHeight: 0, flexDirection: 'column', borderRight: { md: '1px solid' }, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ p: 1.5 }}>
          <Box><Typography sx={{ fontWeight: 950, letterSpacing: '-0.03em' }}>노트 스튜디오</Typography><Typography variant="caption" color="text.secondary">내 NAS의 개인 작업대</Typography></Box>
          <Tooltip title="새 노트"><IconButton color="primary" onClick={(event) => { setPendingParentId(null); setCreateAnchor(event.currentTarget); }}><AddIcon /></IconButton></Tooltip>
        </Stack>
        <Box sx={{ px: 1.25, pb: 1 }}><TextField value={query} onChange={(event) => setQuery(event.target.value)} size="small" fullWidth placeholder="제목과 내용 검색" InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: 'text.secondary' }} /> }} /></Box>
        <Stack direction="row" spacing={0.75} sx={{ px: 1.25, pb: 1 }}>
          <Button size="small" variant={!trashMode ? 'contained' : 'text'} onClick={() => { setTrashMode(false); setSelected(null); }}>내 노트</Button>
          <Button size="small" startIcon={<ArchiveIcon />} variant={trashMode ? 'contained' : 'text'} color="inherit" onClick={() => { setTrashMode(true); setSelected(null); }}>휴지통</Button>
        </Stack>
        <Divider />
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {loading ? <Box sx={{ py: 5, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box> : notes.length === 0 ? <Box sx={{ p: 3, textAlign: 'center' }}><Typography color="text.secondary" variant="body2">{query ? '검색 결과가 없습니다.' : trashMode ? '휴지통이 비어 있습니다.' : '새 노트를 만들어 시작하세요.'}</Typography></Box> : <List dense disablePadding>{treeNotes.map((note) => {
            const type = TYPE_OPTIONS.find((option) => option.type === note.type) || TYPE_OPTIONS[0];
            const Icon = type.Icon;
            return <ListItemButton key={note.id} selected={selected?.id === note.id} onClick={() => openNote(note)} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6, note, anchorEl: event.currentTarget }); }} sx={{ py: 1, pl: 1 + Math.min(note.depth, 5) * 2, borderBottom: '1px solid', borderColor: alpha(theme.palette.divider, 0.7) }}>{note.depth > 0 && <KeyboardArrowRightIcon fontSize="small" color="disabled" sx={{ mr: 0.25 }} />}<ListItemIcon sx={{ minWidth: 34 }}><Icon fontSize="small" /></ListItemIcon><ListItemText primary={note.title} secondary={`${type.label} · ${formatTime(note.updatedAt)}`} primaryTypographyProps={{ noWrap: true, fontWeight: 750 }} secondaryTypographyProps={{ noWrap: true, fontSize: 11 }} /></ListItemButton>;
          })}</List>}
        </Box>
        <Box sx={{ p: 1.25, borderTop: '1px solid', borderColor: 'divider' }}><Button size="small" fullWidth startIcon={<UploadFileIcon />} onClick={() => importInputRef.current?.click()}>TXT·Markdown·코드 가져오기</Button><input ref={importInputRef} hidden type="file" accept=".txt,.md,.markdown,.js,.jsx,.ts,.tsx,.py,.json,.html,.css,.sql,.sh,.yaml,.yml" onChange={importFile} /><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>개인 공간 저장 · 변경 충돌 보호 · 최대 100개 버전</Typography></Box>
      </Paper>

      <Box sx={{ minWidth: 0, minHeight: 0, display: { xs: selected ? 'flex' : 'none', md: 'flex' }, flexDirection: 'column' }}>
        {message && <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ borderRadius: 0 }}>{message.text}</Alert>}
        {!selected ? <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 3 }}><Box sx={{ textAlign: 'center', maxWidth: 440 }}><NotesIcon sx={{ fontSize: 64, color: alpha(theme.palette.primary.main, 0.35) }} /><Typography variant="h6" sx={{ mt: 1, fontWeight: 900 }}>생각을 파일보다 가볍게 기록하세요</Typography><Typography color="text.secondary" sx={{ mt: 0.75 }}>블록 노트, Markdown, TXT, 코드 노트를 한곳에서 만들고 자동 저장합니다.</Typography><Button sx={{ mt: 2 }} variant="contained" startIcon={<AddIcon />} onClick={(event) => { setPendingParentId(null); setCreateAnchor(event.currentTarget); }}>새 노트</Button></Box></Box> : <>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 0.85, minHeight: 55, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
            <Button sx={{ display: { md: 'none' }, minWidth: 0 }} onClick={() => setSelected(null)}>BACK</Button>
            <TextField variant="standard" value={selected.title} onChange={(event) => updateMeta({ title: event.target.value })} disabled={!!selected.deletedAt} fullWidth inputProps={{ 'aria-label': '노트 제목' }} InputProps={{ disableUnderline: true, sx: { fontWeight: 900, fontSize: 18 } }} />
            {selected.type === 'code' && <Select size="small" value={selected.language || 'plaintext'} onChange={(event) => updateMeta({ language: event.target.value })} sx={{ minWidth: 118 }}>{languageOptions.map((language) => <MenuItem key={language} value={language}>{language}</MenuItem>)}</Select>}
            <Chip size="small" label={saveLabel} color={savingState === 'error' || savingState === 'conflict' ? 'warning' : savingState === 'saved' || savingState === 'idle' ? 'success' : 'default'} variant="outlined" />
            {!selected.deletedAt && <Tooltip title="버전 기록"><IconButton onClick={openVersions}><HistoryIcon /></IconButton></Tooltip>}
            {!selected.deletedAt && <Tooltip title="파일로 내보내기"><IconButton onClick={exportSelected}><DownloadIcon /></IconButton></Tooltip>}
            {!selected.deletedAt && <Tooltip title={savingState === 'dirty' || savingState === 'saving' ? '저장이 끝난 뒤 첨부할 수 있습니다.' : 'NAS 파일 또는 폴더 첨부'}><span><IconButton disabled={savingState === 'dirty' || savingState === 'saving'} onClick={() => setAttachmentPickerOpen(true)}><AttachFileIcon /></IconButton></span></Tooltip>}
            {!selected.deletedAt ? <Tooltip title="휴지통으로 이동"><IconButton color="error" onClick={trashSelected}><DeleteOutlineIcon /></IconButton></Tooltip> : <><Tooltip title="복원"><IconButton color="primary" onClick={restoreSelected}><RestoreIcon /></IconButton></Tooltip><Tooltip title="영구 삭제"><IconButton color="error" onClick={permanentlyDelete}><DeleteForeverIcon /></IconButton></Tooltip></>}
          </Stack>
          {selected.type === 'block' && <BlockToolbar editor={editor} />}
          {(selected.attachments || []).length > 0 && <Stack direction="row" spacing={0.75} sx={{ px: 1.25, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', overflowX: 'auto' }}>{selected.attachments.map((attachment) => <Chip key={attachment.id} icon={<AttachFileIcon />} label={attachment.name} onClick={() => openAttachment(attachment)} onDelete={selected.deletedAt ? undefined : () => removeAttachment(attachment)} deleteIcon={<CloseIcon />} sx={{ flex: '0 0 auto' }} />)}</Stack>}
          <Box sx={{ flex: 1, minHeight: 0, position: 'relative', bgcolor: 'background.paper' }}>
            {selected.deletedAt && <Alert severity="warning" sx={{ borderRadius: 0 }}>휴지통의 노트는 읽기 전용입니다. 편집하려면 먼저 복원하세요.</Alert>}
            {selected.type === 'block' ? <Box className="note-studio-editor" sx={{ height: '100%', pointerEvents: selected.deletedAt ? 'none' : 'auto', opacity: selected.deletedAt ? 0.72 : 1 }}><EditorContent editor={editor} /></Box> : <Editor key={selected.id} height="100%" language={selected.type === 'markdown' ? 'markdown' : selected.type === 'text' ? 'plaintext' : selected.language || 'plaintext'} value={plainContent} onChange={(value) => !selected.deletedAt && updatePlain(value ?? '')} theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'} options={{ readOnly: !!selected.deletedAt, minimap: { enabled: false }, wordWrap: selected.type === 'code' ? 'off' : 'on', fontSize: 15, padding: { top: 24 }, automaticLayout: true, scrollBeyondLastLine: false }} />}
          </Box>
        </>}
      </Box>

      <Menu anchorEl={createAnchor} open={!!createAnchor} onClose={() => { setCreateAnchor(null); setPendingParentId(null); }}>{pendingParentId && <MenuItem disabled sx={{ fontSize: 12 }}>“{notes.find((note) => note.id === pendingParentId)?.title || '선택한 노트'}” 아래에 만들기</MenuItem>}{TYPE_OPTIONS.map((option) => <MenuItem key={option.type} onClick={() => createNote(option)} sx={{ py: 1.25, minWidth: 250 }}><ListItemIcon><option.Icon fontSize="small" /></ListItemIcon><ListItemText primary={option.label} secondary={option.detail} /></MenuItem>)}</Menu>
      <Menu open={!!contextMenu} onClose={() => setContextMenu(null)} anchorReference="anchorPosition" anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}>
        <MenuItem onClick={() => { const target = contextMenu.note; setContextMenu(null); openNote(target); }}>열기</MenuItem>
        {!trashMode && <MenuItem onClick={() => { const target = contextMenu; setContextMenu(null); setPendingParentId(target.note.id); setCreateAnchor(target.anchorEl); }}>하위 노트 만들기</MenuItem>}
        {!trashMode && contextMenu?.note?.parentId && <MenuItem onClick={() => moveNoteToRoot(contextMenu.note)}>최상위로 이동</MenuItem>}
      </Menu>
      <Dialog open={commandOpen} onClose={() => setCommandOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>블록 명령</DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <Box sx={{ p: 1.25 }}><TextField autoFocus fullWidth size="small" placeholder="제목, 목록, 인용, 코드…" value={commandQuery} onChange={(event) => setCommandQuery(event.target.value)} /></Box>
          <List dense disablePadding>{visibleCommands.map((command) => <ListItemButton key={command.id} onClick={() => runBlockCommand(command.id)}><ListItemText primary={command.label} secondary={command.keywords} /></ListItemButton>)}</List>
          {visibleCommands.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>일치하는 명령이 없습니다.</Typography>}
        </DialogContent>
        <DialogActions><Typography variant="caption" color="text.secondary" sx={{ mr: 'auto', ml: 1 }}>본문에서 / 또는 Ctrl+K</Typography><Button onClick={() => setCommandOpen(false)}>닫기</Button></DialogActions>
      </Dialog>
      <Dialog open={versionsOpen} onClose={() => setVersionsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>버전 기록</DialogTitle>
        <DialogContent dividers>{versions.length === 0 ? <Typography color="text.secondary">아직 이전 버전이 없습니다. 첫 저장 이후부터 기록됩니다.</Typography> : <List disablePadding>{versions.map((version) => <ListItemButton key={version.versionId} onClick={() => restoreVersion(version)}><ListItemIcon><HistoryIcon /></ListItemIcon><ListItemText primary={`버전 ${version.revision} · ${version.title}`} secondary={`${formatTime(version.createdAt)} · ${version.reason === 'manual' ? '직접 저장' : version.reason === 'version-restore' ? '버전 복원' : '자동 저장'}`} /><RestoreIcon fontSize="small" /></ListItemButton>)}</List>}</DialogContent>
        <DialogActions><Button onClick={() => setVersionsOpen(false)}>닫기</Button></DialogActions>
      </Dialog>
      <NasItemPickerDialog open={attachmentPickerOpen} onClose={() => setAttachmentPickerOpen(false)} onSelect={addAttachment} title="노트에 NAS 항목 첨부" confirmLabel="첨부" allowCurrentFolder />
    </Box>
  );
};

export default NoteStudio;
