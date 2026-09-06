import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import Editor from '@monaco-editor/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { TaskItem, TaskList } from '@tiptap/extension-list';
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
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined';
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
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import MenuBookOutlinedIcon from '@mui/icons-material/MenuBookOutlined';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import ChecklistIcon from '@mui/icons-material/Checklist';
import { alpha, useTheme } from '@mui/material/styles';
import { useWindows } from '../../contexts/WindowContext';
import NasItemPickerDialog from '../NasItemPickerDialog';
import { BLOCK_COMMANDS, filterCommands, flattenNoteTree, parseSlashQuery, tabShortcutForParagraph } from './noteStudioCommands';
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

const NoteLinkNode = Node.create({
  name: 'noteLink', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({ noteId: { default: '' }, label: { default: '하위 페이지' } }),
  parseHTML: () => [{ tag: 'div[data-note-link-id]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', {
    'data-note-link-id': HTMLAttributes.noteId,
    class: 'note-studio-reference-link',
    role: 'button', tabindex: '0'
  }, ['span', { class: 'note-studio-reference-icon', 'aria-hidden': 'true' }, '↳'], ['span', {}, HTMLAttributes.label]]
});

const NasResourceLinkNode = Node.create({
  name: 'nasResourceLink', group: 'block', atom: true, draggable: true,
  addAttributes: () => ({ attachmentId: { default: '' }, label: { default: 'NAS 문서' } }),
  parseHTML: () => [{ tag: 'div[data-nas-attachment-id]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', {
    'data-nas-attachment-id': HTMLAttributes.attachmentId,
    class: 'note-studio-reference-link',
    role: 'button', tabindex: '0'
  }, ['span', { class: 'note-studio-reference-icon', 'aria-hidden': 'true' }, '□'], ['span', {}, HTMLAttributes.label]]
});

const BlockToolbar = ({ editor }) => {
  if (!editor) return null;
  const actions = [
    ['굵게', <FormatBoldIcon fontSize="small" />, () => editor.chain().focus().toggleBold().run(), editor.isActive('bold')],
    ['기울임', <FormatItalicIcon fontSize="small" />, () => editor.chain().focus().toggleItalic().run(), editor.isActive('italic')],
    ['밑줄', <FormatUnderlinedIcon fontSize="small" />, () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline')],
    ['글머리표', <FormatListBulletedIcon fontSize="small" />, () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList')],
    ['번호 목록', <FormatListNumberedIcon fontSize="small" />, () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList')],
    ['할 일', <ChecklistIcon fontSize="small" />, () => editor.chain().focus().toggleTaskList().run(), editor.isActive('taskList')]
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
      <Button size="small" color={editor.isActive('heading', { level: 3 }) ? 'primary' : 'inherit'} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>제목 3</Button>
    </Stack>
  );
};

const NoteStudio = () => {
  const theme = useTheme();
  const { openFileWindowByPath, openFolderWindowByPath } = useWindows();
  const [notebooks, setNotebooks] = useState([]);
  const [activeNotebookId, setActiveNotebookId] = useState(null);
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
  const [commandPosition, setCommandPosition] = useState({ top: 0, left: 0 });
  const [commandIndex, setCommandIndex] = useState(0);
  const [pendingParentId, setPendingParentId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [notebookDialogOpen, setNotebookDialogOpen] = useState(false);
  const [notebookTitle, setNotebookTitle] = useState('');
  const [officeMenu, setOfficeMenu] = useState(null);
  const [officeCreating, setOfficeCreating] = useState(false);
  const [officeLocationDialogOpen, setOfficeLocationDialogOpen] = useState(false);
  const [officeLocationPickerOpen, setOfficeLocationPickerOpen] = useState(false);
  const [officeLocationFormat, setOfficeLocationFormat] = useState('docx');
  const [pythonRunning, setPythonRunning] = useState(false);
  const [pythonResult, setPythonResult] = useState(null);
  const selectedRef = useRef(null);
  const saveTimerRef = useRef(null);
  const pendingContentRef = useRef(null);
  const loadingNoteRef = useRef(false);
  const importInputRef = useRef(null);
  const editGenerationRef = useRef(0);
  const savingRef = useRef(false);
  const slashFromRef = useRef(null);
  const commandOpenRef = useRef(false);
  const openNoteRef = useRef(null);
  const openAttachmentRef = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      NoteLinkNode,
      NasResourceLinkNode,
      Placeholder.configure({ placeholder: "'/'를 누르거나 내용을 입력하세요." })
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    immediatelyRender: false,
    editorProps: {
      handleClick: (_view, _position, event) => {
        const noteLink = event.target?.closest?.('[data-note-link-id]');
        if (noteLink?.dataset?.noteLinkId) {
          openNoteRef.current?.({ id: noteLink.dataset.noteLinkId });
          return true;
        }
        const fileLink = event.target?.closest?.('[data-nas-attachment-id]');
        if (fileLink?.dataset?.nasAttachmentId) {
          const attachment = (selectedRef.current?.attachments || []).find((item) => item.id === fileLink.dataset.nasAttachmentId);
          if (attachment) openAttachmentRef.current?.(attachment);
          return true;
        }
        return false;
      },
      handleKeyDown: (view, event) => {
        const { $from, empty } = view.state.selection;
        if (event.key === 'Tab' && !event.shiftKey && empty && $from.parent.type.name === 'paragraph') {
          const shortcut = tabShortcutForParagraph($from.parent.textContent);
          if (shortcut) {
            event.preventDefault();
            const from = $from.start();
            const to = $from.end();
            setTimeout(() => {
              let chain = editor.chain().focus().deleteRange({ from, to });
              if (shortcut === 'ordered-list') chain = chain.toggleOrderedList();
              if (shortcut === 'bullet-list') chain = chain.toggleBulletList();
              if (shortcut === 'task-list') chain = chain.toggleTaskList();
              if (shortcut === 'heading-1') chain = chain.toggleHeading({ level: 1 });
              if (shortcut === 'heading-2') chain = chain.toggleHeading({ level: 2 });
              if (shortcut === 'heading-3') chain = chain.toggleHeading({ level: 3 });
              if (shortcut === 'quote') chain = chain.toggleBlockquote();
              if (shortcut === 'code-block') chain = chain.toggleCodeBlock();
              if (shortcut === 'divider') chain = chain.setHorizontalRule();
              chain.run();
            }, 0);
            return true;
          }
        }
        if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
          slashFromRef.current = view.state.selection.from;
          setCommandQuery('');
          setCommandIndex(0);
          setTimeout(() => {
            const caret = view.coordsAtPos(view.state.selection.from);
            setCommandPosition({ top: caret.bottom + 6, left: caret.left });
            commandOpenRef.current = true;
            setCommandOpen(true);
          }, 0);
        }
        return false;
      }
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (loadingNoteRef.current || selectedRef.current?.type !== 'block') return;
      pendingContentRef.current = currentEditor.getJSON();
      editGenerationRef.current += 1;
      setSavingState('dirty');
      if (commandOpenRef.current && slashFromRef.current !== null) {
        const to = currentEditor.state.selection.from;
        const text = currentEditor.state.doc.textBetween(slashFromRef.current, to, ' ');
        const query = parseSlashQuery(text);
        if (query === null) {
          commandOpenRef.current = false;
          slashFromRef.current = null;
          setCommandOpen(false);
        } else {
          setCommandQuery(query);
          setCommandIndex(0);
          const caret = currentEditor.view.coordsAtPos(to);
          setCommandPosition({ top: caret.bottom + 6, left: caret.left });
        }
      }
    }
  });

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const loadList = useCallback(async ({ keepSelection = true } = {}) => {
    setLoading(true);
    try {
      const [{ data }, notebookResponse] = await Promise.all([
        axios.get('/api/note-studio/notes', { params: { deleted: trashMode, q: query }, withCredentials: true }),
        axios.get('/api/note-studio/notebooks', { withCredentials: true })
      ]);
      const nextNotes = data.notes || [];
      const nextNotebooks = notebookResponse.data.notebooks || [];
      setNotes(nextNotes);
      setNotebooks(nextNotebooks);
      setActiveNotebookId((current) => nextNotebooks.some((item) => item.id === current) ? current : nextNotebooks[0]?.id || null);
      if (!keepSelection || (selectedRef.current && !nextNotes.some((note) => note.id === selectedRef.current.id))) setSelected(null);
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
  useEffect(() => { openNoteRef.current = openNote; }, [openNote]);

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
        setCommandIndex(0);
        slashFromRef.current = null;
        const caret = editor?.view.coordsAtPos(editor.state.selection.from);
        if (caret) setCommandPosition({ top: caret.bottom + 6, left: caret.left });
        commandOpenRef.current = true;
        setCommandOpen(true);
      }
      if (commandOpenRef.current && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
        event.preventDefault();
        const activeCommands = filterCommands(BLOCK_COMMANDS, commandQuery);
        if (event.key === 'Escape') {
          commandOpenRef.current = false;
          slashFromRef.current = null;
          setCommandOpen(false);
        } else if (event.key === 'ArrowDown') {
          setCommandIndex((index) => (index + 1) % Math.max(activeCommands.length, 1));
        } else if (event.key === 'ArrowUp') {
          setCommandIndex((index) => (index - 1 + Math.max(activeCommands.length, 1)) % Math.max(activeCommands.length, 1));
        } else if (activeCommands[commandIndex]) {
          runBlockCommand(activeCommands[commandIndex].id);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [commandIndex, commandQuery, editor, saveNow]);

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
      const parent = pendingParentId ? notes.find((note) => note.id === pendingParentId) : null;
      const notebookId = parent ? parent.notebookId : activeNotebookId;
      if (!notebookId && !parent) {
        setNotebookDialogOpen(true);
        setMessage({ severity: 'info', text: '페이지를 만들 노트북을 먼저 생성해 주세요.' });
        return;
      }
      const { data } = await axios.post('/api/note-studio/notes', { title: `새 ${option.label}`, type: option.type, language: option.type === 'code' ? 'plaintext' : '', parentId: pendingParentId, notebookId }, { withCredentials: true });
      setPendingParentId(null);
      setTrashMode(false);
      await loadList({ keepSelection: false });
      await openNote(data.note);
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '새 노트를 만들지 못했습니다.') }); }
  };

  const createNotebook = async () => {
    try {
      const { data } = await axios.post('/api/note-studio/notebooks', { title: notebookTitle || '새 노트북' }, { withCredentials: true });
      setNotebookDialogOpen(false);
      setNotebookTitle('');
      await loadList();
      setActiveNotebookId(data.notebook.id);
      setMessage({ severity: 'success', text: `NOTE MANAGER에 “${data.notebook.title}” 노트북을 만들었습니다.` });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '새 노트북을 만들지 못했습니다.') }); }
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

  const openAttachment = async (attachment) => {
    const current = selectedRef.current;
    if (!current) return;
    if (savingState === 'dirty' || savingState === 'saving') {
      setMessage({ severity: 'info', text: '페이지 저장이 끝난 뒤 연결 파일을 열어 주세요.' });
      return;
    }
    try {
      const { data } = await axios.get(`/api/note-studio/notes/${encodeURIComponent(current.id)}/attachments/${encodeURIComponent(attachment.id)}/resolve`, {
        withCredentials: true,
        params: { expectedRevision: current.revision }
      });
      if (data.note?.revision !== current.revision) {
        selectedRef.current = { ...current, ...data.note };
        setSelected(selectedRef.current);
        setNotes((items) => items.map((note) => note.id === current.id ? { ...note, ...data.note } : note));
      }
      if (data.kind === 'folder') openFolderWindowByPath(data.path);
      else openFileWindowByPath(data.path, data.name, true);
    } catch (error) {
      setMessage({ severity: 'error', text: errorMessage(error, '연결된 NAS 항목을 열지 못했습니다.') });
    }
  };
  useEffect(() => { openAttachmentRef.current = openAttachment; });

  const createLinkedSubpage = async () => {
    const current = selectedRef.current;
    if (!current?.notebookId || current.type !== 'block' || current.deletedAt) return;
    try {
      const { data } = await axios.post('/api/note-studio/notes', {
        title: '새 하위 페이지', type: 'block', notebookId: current.notebookId, parentId: current.id
      }, { withCredentials: true });
      const inserted = editor?.chain().focus().insertContent([
        { type: 'noteLink', attrs: { noteId: data.note.id, label: data.note.title } },
        { type: 'paragraph' }
      ]).run();
      if (!inserted) {
        await axios.delete(`/api/note-studio/notes/${encodeURIComponent(data.note.id)}`, {
          data: { expectedRevision: data.note.revision },
          withCredentials: true
        }).catch(() => {});
        throw new Error('현재 위치에 링크를 삽입하지 못해 새 하위 페이지 생성을 취소했습니다.');
      }
      await loadList();
      setMessage({ severity: 'success', text: '현재 위치에 새 하위 페이지 링크를 만들었습니다.' });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '하위 페이지를 만들지 못했습니다.') }); }
  };

  const createOfficeDocument = async (format, label, directoryPath = '') => {
    const current = selectedRef.current;
    setOfficeMenu(null);
    if (!current || current.deletedAt || officeCreating) return;
    if (savingState === 'dirty' || savingState === 'saving') {
      setMessage({ severity: 'info', text: '페이지 저장이 끝난 뒤 문서를 만들어 주세요. 입력 내용은 자동 저장 중입니다.' });
      return;
    }
    setOfficeCreating(true);
    try {
      const { data } = await axios.post(`/api/note-studio/notes/${encodeURIComponent(current.id)}/office-documents`, {
        format,
        fileName: `새 ${label}`,
        expectedRevision: current.revision,
        ...(directoryPath ? { directoryPath } : {})
      }, { withCredentials: true });
      selectedRef.current = { ...current, ...data.note };
      setSelected(selectedRef.current);
      setNotes((items) => items.map((note) => note.id === current.id ? { ...note, ...data.note } : note));
      if (current.type === 'block' && data.attachment?.id) {
        editor?.chain().focus().insertContent([
          { type: 'nasResourceLink', attrs: { attachmentId: data.attachment.id, label: data.name } },
          { type: 'paragraph' }
        ]).run();
      }
      setMessage({ severity: 'success', text: `${data.name}을(를) ${directoryPath ? '선택한 NAS 폴더' : '이 페이지 폴더'}에 만들고 이 페이지에 연결했습니다.` });
      await openFileWindowByPath(data.fullPath, data.name, true);
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '페이지에 새 문서를 만들지 못했습니다.') }); }
    finally { setOfficeCreating(false); }
  };

  const chooseOfficeDestination = (item) => {
    setOfficeLocationPickerOpen(false);
    const option = {
      docx: ['docx', '글 문서'],
      xlsx: ['xlsx', '스프레드시트'],
      pptx: ['pptx', '프레젠테이션'],
      hwpx: ['hwpx', '한글 문서']
    }[officeLocationFormat];
    if (!item?.fullPath || !option) return;
    createOfficeDocument(option[0], option[1], item.fullPath);
  };

  const runPython = async () => {
    const current = selectedRef.current;
    if (!current || pythonRunning) return;
    if (savingState === 'dirty' || savingState === 'saving') {
      setMessage({ severity: 'info', text: '최신 코드 저장이 끝난 뒤 실행해 주세요.' });
      return;
    }
    setPythonRunning(true);
    setPythonResult(null);
    try {
      const { data } = await axios.post(`/api/note-studio/notes/${encodeURIComponent(current.id)}/python/run`, { expectedRevision: current.revision }, { withCredentials: true });
      setPythonResult({ ...data.result, sandbox: data.sandbox });
    } catch (error) {
      const response = error.response?.data;
      setPythonResult({ ...(response?.result || {}), error: response?.error || error.message || 'Python 실행에 실패했습니다.' });
    } finally { setPythonRunning(false); }
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!activeNotebookId) {
      setNotebookDialogOpen(true);
      setMessage({ severity: 'info', text: '파일을 가져올 노트북을 먼저 생성해 주세요.' });
      return;
    }
    const body = new FormData();
    body.append('file', file);
    body.append('notebookId', activeNotebookId);
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
  const notesByNotebook = useMemo(() => notebooks.map((notebook) => ({
    notebook,
    notes: flattenNoteTree(notes.filter((note) => note.notebookId === notebook.id))
  })), [notebooks, notes]);
  const legacyTreeNotes = useMemo(() => flattenNoteTree(notes.filter((note) => !note.notebookId)), [notes]);
  const visibleCommands = useMemo(() => filterCommands(BLOCK_COMMANDS, commandQuery), [commandQuery]);

  const runBlockCommand = (commandId) => {
    if (!editor) return;
    const { from } = editor.state.selection;
    let chain = editor.chain().focus();
    if (slashFromRef.current !== null && slashFromRef.current < from) {
      chain = chain.deleteRange({ from: slashFromRef.current, to: from });
    }
    const actions = {
      paragraph: () => chain.setParagraph().run(),
      'heading-1': () => chain.toggleHeading({ level: 1 }).run(),
      'heading-2': () => chain.toggleHeading({ level: 2 }).run(),
      'heading-3': () => chain.toggleHeading({ level: 3 }).run(),
      'bullet-list': () => chain.toggleBulletList().run(),
      'ordered-list': () => chain.toggleOrderedList().run(),
      'task-list': () => chain.toggleTaskList().run(),
      quote: () => chain.toggleBlockquote().run(),
      'code-block': () => chain.toggleCodeBlock().run(),
      divider: () => chain.setHorizontalRule().run()
    };
    if (commandId === 'subpage') {
      chain.run();
      createLinkedSubpage();
    } else {
      actions[commandId]?.();
    }
    commandOpenRef.current = false;
    slashFromRef.current = null;
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
          <Box><Typography sx={{ fontWeight: 950, letterSpacing: '-0.03em' }}>노트 스튜디오</Typography><Typography variant="caption" color="text.secondary">NOTE MANAGER의 개인 작업대</Typography></Box>
          <Stack direction="row"><Tooltip title="새 노트북"><IconButton onClick={() => setNotebookDialogOpen(true)}><CreateNewFolderOutlinedIcon /></IconButton></Tooltip><Tooltip title="새 페이지"><IconButton color="primary" onClick={(event) => { setPendingParentId(null); if (!activeNotebookId) setNotebookDialogOpen(true); else setCreateAnchor(event.currentTarget); }}><AddIcon /></IconButton></Tooltip></Stack>
        </Stack>
        <Box sx={{ px: 1.25, pb: 1 }}><TextField value={query} onChange={(event) => setQuery(event.target.value)} size="small" fullWidth placeholder="제목과 내용 검색" InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: 'text.secondary' }} /> }} /></Box>
        <Stack direction="row" spacing={0.75} sx={{ px: 1.25, pb: 1 }}>
          <Button size="small" variant={!trashMode ? 'contained' : 'text'} onClick={() => { setTrashMode(false); setSelected(null); }}>내 노트</Button>
          <Button size="small" startIcon={<ArchiveIcon />} variant={trashMode ? 'contained' : 'text'} color="inherit" onClick={() => { setTrashMode(true); setSelected(null); }}>휴지통</Button>
        </Stack>
        <Divider />
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {loading ? <Box sx={{ py: 5, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box> : notes.length === 0 && notebooks.length === 0 ? <Box sx={{ p: 3, textAlign: 'center' }}><Typography color="text.secondary" variant="body2">{query ? '검색 결과가 없습니다.' : trashMode ? '휴지통이 비어 있습니다.' : '새 노트북을 만들어 시작하세요.'}</Typography></Box> : <List dense disablePadding>{notesByNotebook.map(({ notebook, notes: notebookNotes }) => <Box key={notebook.id}><ListItemButton selected={activeNotebookId === notebook.id} onClick={() => setActiveNotebookId(notebook.id)} sx={{ py: 0.85, bgcolor: alpha(theme.palette.text.primary, 0.025) }}><ListItemIcon sx={{ minWidth: 34 }}><MenuBookOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText primary={notebook.title} secondary={notebook.available === false ? `${notebook.directoryName} · 경로 확인 필요` : notebook.directoryName} primaryTypographyProps={{ fontWeight: 900, noWrap: true }} secondaryTypographyProps={{ fontSize: 10, noWrap: true, color: notebook.available === false ? 'error' : 'text.secondary' }} /></ListItemButton>{notebookNotes.map((note) => {
            const type = TYPE_OPTIONS.find((option) => option.type === note.type) || TYPE_OPTIONS[0];
            const Icon = type.Icon;
            return <ListItemButton key={note.id} selected={selected?.id === note.id} onClick={() => { setActiveNotebookId(notebook.id); openNote(note); }} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6, note, anchorEl: event.currentTarget }); }} sx={{ py: 1, pl: 3 + Math.min(note.depth, 5) * 2, borderBottom: '1px solid', borderColor: alpha(theme.palette.divider, 0.7) }}>{note.depth > 0 && <KeyboardArrowRightIcon fontSize="small" color="disabled" sx={{ mr: 0.25 }} />}<ListItemIcon sx={{ minWidth: 34 }}><Icon fontSize="small" /></ListItemIcon><ListItemText primary={note.title} secondary={`${type.label} · ${formatTime(note.updatedAt)}`} primaryTypographyProps={{ noWrap: true, fontWeight: 750 }} secondaryTypographyProps={{ noWrap: true, fontSize: 11 }} /></ListItemButton>;
          })}</Box>)}{legacyTreeNotes.length > 0 && <Box><Typography variant="overline" color="text.secondary" sx={{ px: 1.5 }}>기존 노트</Typography>{legacyTreeNotes.map((note) => { const type = TYPE_OPTIONS.find((option) => option.type === note.type) || TYPE_OPTIONS[0]; const Icon = type.Icon; return <ListItemButton key={note.id} selected={selected?.id === note.id} onClick={() => openNote(note)} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6, note, anchorEl: event.currentTarget }); }} sx={{ pl: 3 + Math.min(note.depth, 5) * 2 }}><ListItemIcon sx={{ minWidth: 34 }}><Icon fontSize="small" /></ListItemIcon><ListItemText primary={note.title} secondary={type.label} /></ListItemButton>; })}</Box>}</List>}
        </Box>
        <Box sx={{ p: 1.25, borderTop: '1px solid', borderColor: 'divider' }}><Button size="small" fullWidth startIcon={<UploadFileIcon />} onClick={() => importInputRef.current?.click()}>TXT·Markdown·코드 가져오기</Button><input ref={importInputRef} hidden type="file" accept=".txt,.md,.markdown,.js,.jsx,.ts,.tsx,.py,.json,.html,.css,.sql,.sh,.yaml,.yml" onChange={importFile} /><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>개인 공간 저장 · 변경 충돌 보호 · 최대 100개 버전</Typography></Box>
      </Paper>

      <Box sx={{ minWidth: 0, minHeight: 0, display: { xs: selected ? 'flex' : 'none', md: 'flex' }, flexDirection: 'column' }}>
        {message && <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ borderRadius: 0 }}>{message.text}</Alert>}
        {!selected ? <Box sx={{ flex: 1, display: 'grid', placeItems: 'center', p: 3 }}><Box sx={{ textAlign: 'center', maxWidth: 440 }}><NotesIcon sx={{ fontSize: 64, color: alpha(theme.palette.text.primary, 0.22) }} /><Typography variant="h6" sx={{ mt: 1, fontWeight: 900 }}>노트북 안에 페이지를 구성하세요</Typography><Typography color="text.secondary" sx={{ mt: 0.75 }}>블록, Markdown, TXT, 코드를 같은 트리에서 관리하며 실제 NOTE MANAGER 경로에 연결합니다.</Typography><Button sx={{ mt: 2 }} variant="contained" startIcon={notebooks.length ? <AddIcon /> : <CreateNewFolderOutlinedIcon />} onClick={(event) => { setPendingParentId(null); if (!activeNotebookId) setNotebookDialogOpen(true); else setCreateAnchor(event.currentTarget); }}>{notebooks.length ? '새 페이지' : '첫 노트북 만들기'}</Button></Box></Box> : <>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 0.85, minHeight: 55, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
            <Button sx={{ display: { md: 'none' }, minWidth: 0 }} onClick={() => setSelected(null)}>BACK</Button>
            <TextField variant="standard" value={selected.title} onChange={(event) => updateMeta({ title: event.target.value })} disabled={!!selected.deletedAt} fullWidth inputProps={{ 'aria-label': '노트 제목' }} InputProps={{ disableUnderline: true, sx: { fontWeight: 900, fontSize: 18 } }} />
            {selected.type === 'code' && <Select size="small" value={selected.language || 'plaintext'} onChange={(event) => updateMeta({ language: event.target.value })} sx={{ minWidth: 118 }}>{languageOptions.map((language) => <MenuItem key={language} value={language}>{language}</MenuItem>)}</Select>}
            <Chip size="small" label={saveLabel} color={savingState === 'error' || savingState === 'conflict' ? 'warning' : savingState === 'saved' || savingState === 'idle' ? 'success' : 'default'} variant="outlined" />
            {selected.type === 'code' && selected.language === 'python' && !selected.deletedAt && <Button size="small" variant="contained" startIcon={pythonRunning ? <CircularProgress size={15} color="inherit" /> : <PlayArrowIcon />} disabled={pythonRunning || savingState === 'dirty' || savingState === 'saving'} onClick={runPython}>{pythonRunning ? '실행 중' : '격리 실행'}</Button>}
            {!selected.deletedAt && <Button size="small" variant="outlined" startIcon={<DescriptionIcon />} disabled={officeCreating || savingState === 'dirty' || savingState === 'saving'} onClick={(event) => setOfficeMenu({ anchorEl: event.currentTarget })}>문서 만들기</Button>}
            {!selected.deletedAt && <Tooltip title="버전 기록"><IconButton onClick={openVersions}><HistoryIcon /></IconButton></Tooltip>}
            {!selected.deletedAt && <Tooltip title="파일로 내보내기"><IconButton onClick={exportSelected}><DownloadIcon /></IconButton></Tooltip>}
            {!selected.deletedAt && <Tooltip title={savingState === 'dirty' || savingState === 'saving' ? '저장이 끝난 뒤 첨부할 수 있습니다.' : 'NAS 파일 또는 폴더 첨부'}><span><IconButton disabled={savingState === 'dirty' || savingState === 'saving'} onClick={() => setAttachmentPickerOpen(true)}><AttachFileIcon /></IconButton></span></Tooltip>}
            {!selected.deletedAt ? <Tooltip title="휴지통으로 이동"><IconButton color="error" onClick={trashSelected}><DeleteOutlineIcon /></IconButton></Tooltip> : <><Tooltip title="복원"><IconButton color="primary" onClick={restoreSelected}><RestoreIcon /></IconButton></Tooltip><Tooltip title="영구 삭제"><IconButton color="error" onClick={permanentlyDelete}><DeleteForeverIcon /></IconButton></Tooltip></>}
          </Stack>
          {selected.type === 'block' && <BlockToolbar editor={editor} />}
          {(selected.attachments || []).length > 0 && <Stack direction="row" spacing={0.75} sx={{ px: 1.25, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', overflowX: 'auto' }}>{selected.attachments.map((attachment) => <Chip key={attachment.id} icon={<AttachFileIcon />} label={attachment.name} onClick={() => openAttachment(attachment)} onDelete={selected.deletedAt ? undefined : () => removeAttachment(attachment)} deleteIcon={<CloseIcon />} sx={{ flex: '0 0 auto' }} />)}</Stack>}
          <Box onContextMenu={(event) => { if (selected.deletedAt || event.shiftKey) return; event.preventDefault(); setOfficeMenu({ position: { top: event.clientY, left: event.clientX } }); }} sx={{ flex: 1, minHeight: 0, position: 'relative', bgcolor: 'background.paper' }}>
            {selected.deletedAt && <Alert severity="warning" sx={{ borderRadius: 0 }}>휴지통의 노트는 읽기 전용입니다. 편집하려면 먼저 복원하세요.</Alert>}
            {selected.type === 'block' ? <Box className="note-studio-editor" sx={{ height: '100%', pointerEvents: selected.deletedAt ? 'none' : 'auto', opacity: selected.deletedAt ? 0.72 : 1 }}><EditorContent editor={editor} /></Box> : <Editor key={selected.id} height="100%" language={selected.type === 'markdown' ? 'markdown' : selected.type === 'text' ? 'plaintext' : selected.language || 'plaintext'} value={plainContent} onChange={(value) => !selected.deletedAt && updatePlain(value ?? '')} theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'} options={{ readOnly: !!selected.deletedAt, minimap: { enabled: false }, wordWrap: selected.type === 'code' ? 'off' : 'on', fontSize: 15, padding: { top: 24 }, automaticLayout: true, scrollBeyondLastLine: false }} />}
          </Box>
        </>}
      </Box>

      <Menu anchorEl={createAnchor} open={!!createAnchor} onClose={() => { setCreateAnchor(null); setPendingParentId(null); }}>{pendingParentId && <MenuItem disabled sx={{ fontSize: 12 }}>“{notes.find((note) => note.id === pendingParentId)?.title || '선택한 노트'}” 아래에 만들기</MenuItem>}{TYPE_OPTIONS.map((option) => <MenuItem key={option.type} onClick={() => createNote(option)} sx={{ py: 1.25, minWidth: 250 }}><ListItemIcon><option.Icon fontSize="small" /></ListItemIcon><ListItemText primary={option.label} secondary={option.detail} /></MenuItem>)}</Menu>
      <Menu
        open={!!officeMenu}
        onClose={() => setOfficeMenu(null)}
        anchorReference={officeMenu?.position ? 'anchorPosition' : 'anchorEl'}
        anchorPosition={officeMenu?.position}
        anchorEl={officeMenu?.anchorEl || null}
      >
        <MenuItem disabled><ListItemText primary="이 페이지 폴더에 새 문서" secondary="저장하면 페이지의 연결 항목으로 유지됩니다." /></MenuItem>
        <MenuItem onClick={() => createOfficeDocument('docx', '글 문서')}><ListItemText primary="글 문서" secondary="DOCX · OnlyOffice" /></MenuItem>
        <MenuItem onClick={() => createOfficeDocument('xlsx', '스프레드시트')}><ListItemText primary="스프레드시트" secondary="XLSX · OnlyOffice" /></MenuItem>
        <MenuItem onClick={() => createOfficeDocument('pptx', '프레젠테이션')}><ListItemText primary="프레젠테이션" secondary="PPTX · OnlyOffice" /></MenuItem>
        <MenuItem onClick={() => createOfficeDocument('hwpx', '한글 문서')}><ListItemText primary="한글 문서" secondary="HWPX · RHWP" /></MenuItem>
        <Divider />
        <MenuItem onClick={() => { setOfficeMenu(null); setOfficeLocationDialogOpen(true); }}><ListItemText primary="다른 NAS 위치에 만들기…" secondary="형식과 저장 폴더를 직접 선택" /></MenuItem>
      </Menu>
      <Menu open={!!contextMenu} onClose={() => setContextMenu(null)} anchorReference="anchorPosition" anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined}>
        <MenuItem onClick={() => { const target = contextMenu.note; setContextMenu(null); openNote(target); }}>열기</MenuItem>
        {!trashMode && <MenuItem onClick={() => { const target = contextMenu; setContextMenu(null); setPendingParentId(target.note.id); setCreateAnchor(target.anchorEl); }}>하위 노트 만들기</MenuItem>}
        {!trashMode && contextMenu?.note?.parentId && !contextMenu?.note?.storageRelativePath && <MenuItem onClick={() => moveNoteToRoot(contextMenu.note)}>최상위로 이동</MenuItem>}
      </Menu>
      <Menu
        open={commandOpen}
        onClose={() => { commandOpenRef.current = false; slashFromRef.current = null; setCommandOpen(false); editor?.commands.focus(); }}
        anchorReference="anchorPosition"
        anchorPosition={commandOpen ? commandPosition : undefined}
        autoFocus={false}
        disableAutoFocusItem
        disableEnforceFocus
        disableRestoreFocus
        MenuListProps={{ dense: true, sx: { width: 300, maxHeight: 360, py: 0.75 } }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 1.5, pb: 0.5 }}>블록 명령 · 입력해서 검색 · ↑↓ 선택 · Enter 실행</Typography>
        {visibleCommands.map((command, index) => <MenuItem key={command.id} selected={index === commandIndex} onMouseEnter={() => setCommandIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => runBlockCommand(command.id)}><ListItemText primary={command.label} secondary={command.keywords} /></MenuItem>)}
        {visibleCommands.length === 0 && <Typography color="text.secondary" variant="body2" sx={{ p: 2 }}>일치하는 명령이 없습니다.</Typography>}
      </Menu>
      <Dialog open={versionsOpen} onClose={() => setVersionsOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>버전 기록</DialogTitle>
        <DialogContent dividers>{versions.length === 0 ? <Typography color="text.secondary">아직 이전 버전이 없습니다. 첫 저장 이후부터 기록됩니다.</Typography> : <List disablePadding>{versions.map((version) => <ListItemButton key={version.versionId} onClick={() => restoreVersion(version)}><ListItemIcon><HistoryIcon /></ListItemIcon><ListItemText primary={`버전 ${version.revision} · ${version.title}`} secondary={`${formatTime(version.createdAt)} · ${version.reason === 'manual' ? '직접 저장' : version.reason === 'version-restore' ? '버전 복원' : '자동 저장'}`} /><RestoreIcon fontSize="small" /></ListItemButton>)}</List>}</DialogContent>
        <DialogActions><Button onClick={() => setVersionsOpen(false)}>닫기</Button></DialogActions>
      </Dialog>
      <Dialog open={notebookDialogOpen} onClose={() => setNotebookDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>새 노트북</DialogTitle>
        <DialogContent><TextField autoFocus fullWidth label="노트북 이름" value={notebookTitle} onChange={(event) => setNotebookTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createNotebook(); }} helperText="계정 루트의 NOTE MANAGER 아래에 실제 폴더로 생성됩니다." sx={{ mt: 1 }} /></DialogContent>
        <DialogActions><Button onClick={() => setNotebookDialogOpen(false)}>취소</Button><Button variant="contained" onClick={createNotebook}>만들기</Button></DialogActions>
      </Dialog>
      <Dialog open={officeLocationDialogOpen} onClose={() => setOfficeLocationDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>다른 NAS 위치에 문서 만들기</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>선택한 폴더에 파일을 만들고 현재 페이지에는 연결 항목을 남깁니다.</Typography>
          <Select fullWidth size="small" value={officeLocationFormat} onChange={(event) => setOfficeLocationFormat(event.target.value)}>
            <MenuItem value="docx">글 문서 · DOCX</MenuItem>
            <MenuItem value="xlsx">스프레드시트 · XLSX</MenuItem>
            <MenuItem value="pptx">프레젠테이션 · PPTX</MenuItem>
            <MenuItem value="hwpx">한글 문서 · HWPX</MenuItem>
          </Select>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setOfficeLocationDialogOpen(false)}>취소</Button>
          <Button variant="contained" onClick={() => { setOfficeLocationDialogOpen(false); setOfficeLocationPickerOpen(true); }}>저장 폴더 선택</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!pythonResult} onClose={() => setPythonResult(null)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Python 격리 실행 결과</DialogTitle>
        <DialogContent dividers>
          {pythonResult?.error && <Alert severity="error" sx={{ mb: 1.5 }}>{pythonResult.error}</Alert>}
          <Typography variant="caption" color="text.secondary">네트워크 차단 · non-root · 읽기 전용 · 15초 · RAM 256MiB · PID 64</Typography>
          <Box component="pre" sx={{ mt: 1.5, p: 1.5, minHeight: 120, maxHeight: 420, overflow: 'auto', bgcolor: 'grey.950', color: 'grey.100', borderRadius: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{pythonResult?.stdout || pythonResult?.stderr || (pythonResult?.error ? '' : '(출력 없음)')}</Box>
          {pythonResult?.stdout && pythonResult?.stderr && <Box component="pre" sx={{ mt: 1, p: 1.5, maxHeight: 180, overflow: 'auto', bgcolor: 'warning.light', color: 'warning.contrastText', borderRadius: 1, whiteSpace: 'pre-wrap' }}>{pythonResult.stderr}</Box>}
        </DialogContent>
        <DialogActions><Button onClick={() => setPythonResult(null)}>닫기</Button></DialogActions>
      </Dialog>
      <NasItemPickerDialog open={attachmentPickerOpen} onClose={() => setAttachmentPickerOpen(false)} onSelect={addAttachment} title="노트에 NAS 항목 첨부" confirmLabel="첨부" allowCurrentFolder />
      <NasItemPickerDialog open={officeLocationPickerOpen} onClose={() => setOfficeLocationPickerOpen(false)} onSelect={chooseOfficeDestination} title="새 문서를 저장할 NAS 폴더" confirmLabel="여기에 만들기" folderOnly allowCurrentFolder />
    </Box>
  );
};

export default NoteStudio;
