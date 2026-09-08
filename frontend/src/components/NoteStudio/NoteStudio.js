import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import Editor from '@monaco-editor/react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension, Node } from '@tiptap/core';
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
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import CreateNewFolderOutlinedIcon from '@mui/icons-material/CreateNewFolderOutlined';
import ChecklistIcon from '@mui/icons-material/Checklist';
import TerminalIcon from '@mui/icons-material/Terminal';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { alpha, useTheme } from '@mui/material/styles';
import { useWindows } from '../../contexts/WindowContext';
import NasItemPickerDialog from '../NasItemPickerDialog';
import { BLOCK_COMMANDS, filterCommands, nextBlockIndent, normalizeBlockIndent, noteChildCounts, parseSlashQuery, tabShortcutForParagraph, visibleNoteTree } from './noteStudioCommands';
import { createWorkspaceViewStateQueue, loadWorkspaceViewState } from '../../utils/workspaceViewState';
import { copyTextToClipboard } from '../../utils/copyTextToClipboard';
import { BLOCK_BACKGROUNDS, BLOCK_COLORS, BLOCK_TRANSFORMS, blockTextStats, findContextBlock } from './noteStudioBlockMenu';
import NoteStudioTerminal from './NoteStudioTerminal';
import CodeRunPanel from './CodeRunPanel';
import CodePreviewDialog from './CodePreviewDialog';
import DeveloperToolsDialog from './DeveloperToolsDialog';
import './NoteStudio.css';

const BlockIndent = Extension.create({
  name: 'blockIndent',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'codeBlock'],
      attributes: {
        indentLevel: {
          default: 0,
          parseHTML: (element) => normalizeBlockIndent(element.getAttribute('data-indent-level')),
          renderHTML: ({ indentLevel }) => {
            const level = normalizeBlockIndent(indentLevel);
            return level ? { 'data-indent-level': level, style: `margin-left: ${level * 1.5}rem` } : {};
          }
        },
        blockColor: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-note-color') || null,
          renderHTML: ({ blockColor }) => blockColor ? { 'data-note-color': blockColor } : {}
        },
        blockBackground: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-note-background') || null,
          renderHTML: ({ blockBackground }) => blockBackground ? { 'data-note-background': blockBackground } : {}
        }
      }
    }];
  }
});

const TYPE_OPTIONS = [
  { type: 'block', label: '블록 노트', detail: '문단·목록·제목을 자유롭게 구성', Icon: NotesIcon },
  { type: 'markdown', label: 'Markdown', detail: '가벼운 문서와 README 작성', Icon: DescriptionIcon },
  { type: 'text', label: 'TXT', detail: '서식 없는 빠른 메모', Icon: DescriptionIcon },
  { type: 'code', label: '코드 노트', detail: 'Monaco 편집기와 언어 선택', Icon: CodeIcon }
];

const languageOptions = [
  { id: 'plaintext', label: 'Plain text', mode: 'edit' },
  { id: 'javascript', label: 'JavaScript', mode: 'execute', interactive: true },
  { id: 'typescript', label: 'TypeScript', mode: 'execute', interactive: true },
  { id: 'python', label: 'Python', mode: 'execute', interactive: true },
  { id: 'json', label: 'JSON', mode: 'validate' },
  { id: 'html', label: 'HTML', mode: 'preview' },
  { id: 'css', label: 'CSS', mode: 'preview' },
  { id: 'sql', label: 'SQL', mode: 'execute' },
  { id: 'shell', label: 'Shell', mode: 'execute', interactive: true },
  { id: 'yaml', label: 'YAML', mode: 'validate' },
  { id: 'markdown', label: 'Markdown', mode: 'preview' },
];
const languageById = Object.fromEntries(languageOptions.map((item) => [item.id, item]));
const detectCodeLanguage = (title, source) => {
  const extension = String(title || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  const byExtension = { '.js': 'javascript', '.mjs': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.py': 'python', '.json': 'json', '.html': 'html', '.htm': 'html', '.css': 'css', '.sql': 'sql', '.sh': 'shell', '.yaml': 'yaml', '.yml': 'yaml', '.md': 'markdown' };
  if (byExtension[extension]) return byExtension[extension];
  const head = String(source || '').slice(0, 4096).trimStart();
  if (/^#!.*\bpython(?:3)?\b/m.test(head) || (/\b(?:def|import|from)\s+[A-Za-z_]/.test(head) && /:\s*(?:\r?\n|$)/.test(head))) return 'python';
  if (/^#!.*\b(?:bash|sh|zsh)\b/m.test(head)) return 'shell';
  if (/^\s*(?:<!doctype\s+html|<html\b)/i.test(head)) return 'html';
  if (/\b(?:const|let|var|function|console\.)\b/.test(head)) return 'javascript';
  if (/^\s*[\[{]/.test(head)) { try { JSON.parse(head); return 'json'; } catch {} }
  return '';
};
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
  const [sidebarNotebookId, setSidebarNotebookId] = useState(null);
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
  const [notebookMenu, setNotebookMenu] = useState(null);
  const [notebookDialogOpen, setNotebookDialogOpen] = useState(false);
  const [notebookTitle, setNotebookTitle] = useState('');
  const [notebookKind, setNotebookKind] = useState('notes');
  const [officeMenu, setOfficeMenu] = useState(null);
  const [pageMenuAnchor, setPageMenuAnchor] = useState(null);
  const [blockMenu, setBlockMenu] = useState(null);
  const [officeCreating, setOfficeCreating] = useState(false);
  const [officeLocationDialogOpen, setOfficeLocationDialogOpen] = useState(false);
  const [officeLocationPickerOpen, setOfficeLocationPickerOpen] = useState(false);
  const [officeLocationFormat, setOfficeLocationFormat] = useState('docx');
  const [codeRunning, setCodeRunning] = useState(false);
  const [codeSession, setCodeSession] = useState(null);
  const [codeEvents, setCodeEvents] = useState([]);
  const [codePanelOpen, setCodePanelOpen] = useState(false);
  const [executionJob, setExecutionJob] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pythonRuntimeOpen, setPythonRuntimeOpen] = useState(false);
  const [pythonRuntime, setPythonRuntime] = useState(null);
  const [pythonRuntimeLoading, setPythonRuntimeLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [expandedOverviewNotebookIds, setExpandedOverviewNotebookIds] = useState(() => new Set());
  const [collapsedPageIds, setCollapsedPageIds] = useState(() => new Set());
  const [renameNote, setRenameNote] = useState(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renamingNote, setRenamingNote] = useState(false);
  const [renameNotebook, setRenameNotebook] = useState(null);
  const [renameNotebookTitle, setRenameNotebookTitle] = useState('');
  const [renamingNotebook, setRenamingNotebook] = useState(false);
  const [devToolsNotebook, setDevToolsNotebook] = useState(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalNotebookId, setTerminalNotebookId] = useState(null);
  const [terminalExplorerOpen, setTerminalExplorerOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  const noteScrollRef = useRef(null);
  const noteMonacoRef = useRef(null);
  const noteMonacoSubscriptionsRef = useRef([]);
  const noteViewStateQueueRef = useRef(null);
  if (!noteViewStateQueueRef.current) noteViewStateQueueRef.current = createWorkspaceViewStateQueue();
  const sessionViewStateQueueRef = useRef(null);
  if (!sessionViewStateQueueRef.current) sessionViewStateQueueRef.current = createWorkspaceViewStateQueue();
  const noteViewHydratedRef = useRef(false);
  const sessionHydratedRef = useRef(false);
  const pendingNoteViewStateRef = useRef(null);
  const resumeSessionRef = useRef(null);
  const openNoteSequenceRef = useRef(0);
  const codeSessionCursorRef = useRef(0);
  const codePollTimerRef = useRef(null);
  const jobPollTimerRef = useRef(null);
  const codePollFailureRef = useRef(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      BlockIndent,
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
        if (event.key === 'Tab') {
          if (!event.shiftKey && empty && $from.parent.type.name === 'paragraph') {
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

          event.preventDefault();
          const listItemType = [...Array($from.depth).keys()].reverse()
            .map((offset) => $from.node(offset + 1)?.type?.name)
            .find((name) => name === 'taskItem' || name === 'listItem');
          if (listItemType) {
            setTimeout(() => {
              const chain = editor.chain().focus();
              if (event.shiftKey) chain.liftListItem(listItemType).run();
              else chain.sinkListItem(listItemType).run();
            }, 0);
            return true;
          }

          const block = $from.parent;
          if (['paragraph', 'heading', 'codeBlock'].includes(block.type.name)) {
            const position = $from.before($from.depth);
            const indentLevel = nextBlockIndent(block.attrs.indentLevel, event.shiftKey);
            if (indentLevel !== normalizeBlockIndent(block.attrs.indentLevel)) {
              view.dispatch(view.state.tr.setNodeMarkup(position, undefined, { ...block.attrs, indentLevel }));
            }
          }
          return true;
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
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const note = selectedRef.current;
      if (!note || note.type !== 'block' || !noteViewHydratedRef.current) return;
      noteViewStateQueueRef.current.schedule({ kind: 'note-block', noteId: note.id }, {
        selection: currentEditor.state.selection.toJSON(),
        scrollTop: noteScrollRef.current?.scrollTop || 0,
      }, note.revision);
    },
  });

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    const controller = new AbortController();
    sessionHydratedRef.current = false;
    loadWorkspaceViewState({ kind: 'note-studio-session' }, controller.signal).then((record) => {
      resumeSessionRef.current = record?.state || null;
      if (record?.state?.activeNotebookId) setActiveNotebookId(record.state.activeNotebookId);
      if (record?.state?.sidebarNotebookId) setSidebarNotebookId(record.state.sidebarNotebookId);
      if (Array.isArray(record?.state?.expandedOverviewNotebookIds)) setExpandedOverviewNotebookIds(new Set(record.state.expandedOverviewNotebookIds));
      if (Array.isArray(record?.state?.collapsedPageIds)) setCollapsedPageIds(new Set(record.state.collapsedPageIds));
      if (record?.state?.terminalNotebookId) setTerminalNotebookId(record.state.terminalNotebookId);
      setTerminalOpen(!!record?.state?.terminalOpen);
      if (typeof record?.state?.terminalExplorerOpen === 'boolean') setTerminalExplorerOpen(record.state.terminalExplorerOpen);
      if (typeof record?.state?.sidebarOpen === 'boolean') setSidebarOpen(record.state.sidebarOpen);
    }).catch(() => {}).finally(() => {
      if (!controller.signal.aborted) {
        sessionHydratedRef.current = true;
        setSessionReady(true);
      }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!sessionHydratedRef.current || !sessionReady) return;
    sessionViewStateQueueRef.current.schedule({ kind: 'note-studio-session' }, {
      activeNotebookId: activeNotebookId || '', selectedNoteId: selected?.id || '',
      sidebarNotebookId: sidebarNotebookId || '',
      expandedOverviewNotebookIds: [...expandedOverviewNotebookIds], collapsedPageIds: [...collapsedPageIds], terminalOpen,
      terminalNotebookId: terminalNotebookId || '', terminalExplorerOpen, sidebarOpen,
    });
  }, [activeNotebookId, collapsedPageIds, expandedOverviewNotebookIds, selected?.id, sessionReady, sidebarNotebookId, sidebarOpen, terminalExplorerOpen, terminalNotebookId, terminalOpen]);

  useEffect(() => {
    const resume = resumeSessionRef.current;
    if (!resume?.selectedNoteId || selectedRef.current || !notes.some((note) => note.id === resume.selectedNoteId)) return;
    if (openNoteRef.current) {
      openNoteRef.current({ id: resume.selectedNoteId });
      resumeSessionRef.current = null;
    }
  }, [notes]);

  const loadList = useCallback(async ({ keepSelection = true } = {}) => {
    setLoading(true);
    try {
      const [{ data }, notebookResponse] = await Promise.all([
        axios.get('/api/note-studio/notes', { params: { deleted: trashMode, q: sidebarNotebookId ? query : '' }, withCredentials: true }),
        axios.get('/api/note-studio/notebooks', { withCredentials: true })
      ]);
      const nextNotes = data.notes || [];
      const nextNotebooks = notebookResponse.data.notebooks || [];
      setNotes(nextNotes);
      setNotebooks(nextNotebooks);
      setActiveNotebookId((current) => nextNotebooks.some((item) => item.id === current) ? current : nextNotebooks[0]?.id || null);
      setSidebarNotebookId((current) => current && nextNotebooks.some((item) => item.id === current) ? current : null);
      if (!keepSelection || (selectedRef.current && !nextNotes.some((note) => note.id === selectedRef.current.id))) setSelected(null);
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '노트 목록을 불러오지 못했습니다.') }); }
    finally { setLoading(false); }
  }, [query, sidebarNotebookId, trashMode]);

  useEffect(() => {
    const timer = setTimeout(() => loadList(), 220);
    return () => clearTimeout(timer);
  }, [loadList]);

  const openNote = useCallback(async (meta) => {
    if (!meta?.id) return;
    const sequence = ++openNoteSequenceRef.current;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSavingState('idle');
    try {
      const { data } = await axios.get(`/api/note-studio/notes/${encodeURIComponent(meta.id)}`, { params: { includeDeleted: trashMode }, withCredentials: true });
      if (sequence !== openNoteSequenceRef.current) return;
      const note = data.note;
      loadingNoteRef.current = true;
      if (note.notebookId) {
        setActiveNotebookId(note.notebookId);
        setSidebarNotebookId(note.notebookId);
      }
      setSelected(note);
      selectedRef.current = note;
      if (note.type === 'block') editor?.commands.setContent(note.content, false);
      else setPlainContent(String(note.content || ''));
      pendingContentRef.current = note.content;
      editGenerationRef.current = 0;
      noteViewHydratedRef.current = false;
      pendingNoteViewStateRef.current = null;
      const descriptor = { kind: note.type === 'block' ? 'note-block' : 'note-monaco', noteId: note.id };
      loadWorkspaceViewState(descriptor).then((record) => {
        if (sequence !== openNoteSequenceRef.current || selectedRef.current?.id !== note.id) return;
        pendingNoteViewStateRef.current = record?.state || null;
        if (note.type === 'block' && record?.state) {
          window.setTimeout(() => {
            const selection = record.state.selection;
            const max = editor?.state.doc.content.size || 0;
            if (selection && max) {
              const from = Math.max(1, Math.min(max, Number(selection.anchor) || 1));
              const to = Math.max(1, Math.min(max, Number(selection.head) || from));
              try { editor.commands.setTextSelection({ from, to }); } catch {}
            }
            if (noteScrollRef.current && Number.isFinite(record.state.scrollTop)) noteScrollRef.current.scrollTop = record.state.scrollTop;
            noteViewHydratedRef.current = true;
          }, 80);
        } else {
          if (record?.state?.editor && noteMonacoRef.current) {
            try { noteMonacoRef.current.restoreViewState(record.state.editor); } catch {}
          }
          noteViewHydratedRef.current = true;
        }
      }).catch(() => { if (sequence === openNoteSequenceRef.current) noteViewHydratedRef.current = true; });
      queueMicrotask(() => { loadingNoteRef.current = false; });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '노트를 열지 못했습니다.') }); }
  }, [editor, trashMode]);
  useEffect(() => { openNoteRef.current = openNote; }, [openNote]);

  const saveNoteMonacoViewState = useCallback(() => {
    const note = selectedRef.current;
    if (!note || note.type === 'block' || !noteViewHydratedRef.current || !noteMonacoRef.current) return;
    noteViewStateQueueRef.current.schedule({ kind: 'note-monaco', noteId: note.id }, { editor: noteMonacoRef.current.saveViewState() }, note.revision);
  }, []);

  const handleNoteMonacoMount = useCallback((instance) => {
    noteMonacoSubscriptionsRef.current.forEach((item) => item.dispose?.());
    noteMonacoRef.current = instance;
    const state = pendingNoteViewStateRef.current?.editor;
    if (state) { try { instance.restoreViewState(state); } catch {} }
    noteMonacoSubscriptionsRef.current = [instance.onDidScrollChange(saveNoteMonacoViewState), instance.onDidChangeCursorSelection(saveNoteMonacoViewState)];
  }, [saveNoteMonacoViewState]);

  const saveBlockViewState = useCallback(() => {
    const note = selectedRef.current;
    if (!note || note.type !== 'block' || !noteViewHydratedRef.current || !editor) return;
    noteViewStateQueueRef.current.schedule({ kind: 'note-block', noteId: note.id }, {
      selection: editor.state.selection.toJSON(),
      scrollTop: noteScrollRef.current?.scrollTop || 0,
    }, note.revision);
  }, [editor]);

  useEffect(() => () => {
    noteMonacoSubscriptionsRef.current.forEach((item) => item.dispose?.());
    noteViewStateQueueRef.current.dispose();
    sessionViewStateQueueRef.current.dispose();
  }, []);

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b' && !event.target?.closest?.('input, textarea, [contenteditable="true"], .monaco-editor')) {
        event.preventDefault();
        setSidebarOpen((current) => !current);
      }
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
    const current = selectedRef.current;
    if (current?.type === 'code' && (!current.language || current.language === 'plaintext')) {
      const detected = detectCodeLanguage(current.title, value);
      if (detected) updateMeta({ language: detected });
    }
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
      const { data } = await axios.post('/api/note-studio/notebooks', { title: notebookTitle || (notebookKind === 'project' ? '새 프로젝트' : '새 노트북'), kind: notebookKind }, { withCredentials: true });
      setNotebookDialogOpen(false);
      setNotebookTitle('');
      setNotebookKind('notes');
      await loadList();
      setActiveNotebookId(data.notebook.id);
      setSidebarNotebookId(data.notebook.id);
      if (data.notebook.kind === 'project') {
        setTerminalNotebookId(data.notebook.id);
        setTerminalOpen(true);
      }
      setMessage({ severity: 'success', text: `NOTE MANAGER에 “${data.notebook.title}” ${data.notebook.kind === 'project' ? '프로젝트' : '노트북'}을 만들었습니다.` });
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

  const runCode = async () => {
    const current = selectedRef.current;
    const language = String(current?.language || '').toLowerCase();
    const info = languageById[language];
    if (!current || codeRunning || !['execute', 'validate'].includes(info?.mode)) return;
    if (savingState === 'dirty' || savingState === 'saving') {
      setMessage({ severity: 'info', text: '최신 코드 저장이 끝난 뒤 실행해 주세요.' });
      return;
    }
    const displayName = info.label;
    setCodeRunning(true);
    setTerminalOpen(false);
    setCodePanelOpen(true);
    setCodeEvents([]);
    codeSessionCursorRef.current = 0;
    codePollFailureRef.current = 0;
    setCodeSession({ state: 'starting', language, displayName, noteId: current.id, noteTitle: current.title });
    try {
      const { data } = await axios.post(`/api/note-studio/notes/${encodeURIComponent(current.id)}/${language}/session`, { expectedRevision: current.revision }, { withCredentials: true });
      setExecutionJob({ ...data.job, sandbox: data.sandbox, language, displayName, noteId: current.id, noteTitle: current.title, interactive: !!info.interactive });
      setCodeSession({ state: 'queued', jobId: data.job?.jobId, position: data.job?.position, language, displayName, noteId: current.id, noteTitle: current.title, interactive: !!info.interactive, sandbox: data.sandbox });
    } catch (error) {
      const response = error.response?.data;
      setCodeEvents([{ sequence: `error-${Date.now()}`, stream: 'stderr', text: `${response?.error || error.message || `${displayName} 실행에 실패했습니다.`}\n` }]);
      setCodeSession({ state: 'failed', language, displayName, noteId: current.id, noteTitle: current.title, exitCode: null });
      setCodeRunning(false);
    }
  };

  useEffect(() => {
    if (!executionJob?.jobId || !['queued', 'starting'].includes(executionJob.state)) return undefined;
    let cancelled = false;
    const pollJob = async () => {
      try {
        const { data } = await axios.get(`/api/note-studio/execution-jobs/${encodeURIComponent(executionJob.jobId)}`, { withCredentials: true });
        if (cancelled) return;
        const job = data.job;
        if (job.session?.sessionId) {
          codeSessionCursorRef.current = job.session.cursor || 0;
          setCodeEvents(job.session.events || []);
          setCodeSession({ ...job.session, language: executionJob.language, displayName: executionJob.displayName, noteId: executionJob.noteId, noteTitle: executionJob.noteTitle, interactive: executionJob.interactive, sandbox: executionJob.sandbox });
          setExecutionJob(null);
          return;
        }
        if (['blocked', 'failed', 'cancelled'].includes(job.state)) {
          setCodeEvents([{ sequence: `queue-${Date.now()}`, stream: job.state === 'cancelled' ? 'system' : 'stderr', text: `${job.error || (job.state === 'cancelled' ? '대기 중인 실행을 취소했습니다.' : '실행 대기 작업을 시작하지 못했습니다.')}\n` }]);
          setCodeSession((current) => ({ ...current, state: job.state, position: 0 }));
          setCodeRunning(false);
          setExecutionJob(null);
          return;
        }
        setExecutionJob((current) => current?.jobId === job.jobId ? { ...current, ...job } : current);
        setCodeSession((current) => ({ ...current, state: job.state, position: job.position, reasons: job.reasons }));
        jobPollTimerRef.current = window.setTimeout(pollJob, 500);
      } catch (error) {
        if (!cancelled) jobPollTimerRef.current = window.setTimeout(pollJob, 1500);
      }
    };
    jobPollTimerRef.current = window.setTimeout(pollJob, 100);
    return () => {
      cancelled = true;
      if (jobPollTimerRef.current) window.clearTimeout(jobPollTimerRef.current);
    };
  }, [executionJob?.jobId, executionJob?.state]);

  useEffect(() => {
    if (codeSession?.state !== 'running' || !codeSession.sessionId) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await axios.get(`/api/note-studio/code-sessions/${encodeURIComponent(codeSession.sessionId)}`, { params: { cursor: codeSessionCursorRef.current }, withCredentials: true });
        if (cancelled) return;
        const incoming = data.session?.events || [];
        if (incoming.length) setCodeEvents((current) => [...current, ...incoming]);
        codePollFailureRef.current = 0;
        codeSessionCursorRef.current = data.session?.cursor || codeSessionCursorRef.current;
        setCodeSession((current) => current?.sessionId === data.session?.sessionId ? { ...current, ...data.session } : current);
        if (data.session?.state === 'running') codePollTimerRef.current = window.setTimeout(poll, 300);
        else setCodeRunning(false);
      } catch (error) {
        if (cancelled) return;
        codePollFailureRef.current += 1;
        if (codePollFailureRef.current === 5) {
          setCodeEvents((current) => [...current, { sequence: `poll-error-${Date.now()}`, stream: 'system', text: `\n${errorMessage(error, '실행 상태 연결이 불안정합니다. 자동으로 다시 연결합니다.')}\n` }]);
        }
        codePollTimerRef.current = window.setTimeout(poll, Math.min(5000, 300 * (2 ** Math.min(codePollFailureRef.current, 5))));
      }
    };
    codePollTimerRef.current = window.setTimeout(poll, 120);
    return () => {
      cancelled = true;
      if (codePollTimerRef.current) window.clearTimeout(codePollTimerRef.current);
    };
  }, [codeSession?.sessionId, codeSession?.state]);

  const sendCodeInput = async (text) => {
    if (codeSession?.state !== 'running' || !codeSession.sessionId) return;
    const localSequence = `input-${Date.now()}`;
    setCodeEvents((current) => [...current, { sequence: localSequence, stream: 'input', text: `› ${text}\n` }]);
    try {
      await axios.post(`/api/note-studio/code-sessions/${encodeURIComponent(codeSession.sessionId)}/input`, { text }, { withCredentials: true });
    } catch (error) {
      setCodeEvents((current) => [...current, { sequence: `${localSequence}-error`, stream: 'stderr', text: `${errorMessage(error, '입력을 전송하지 못했습니다.')}\n` }]);
    }
  };

  const stopCodeSession = async () => {
    if (executionJob?.jobId && ['queued', 'starting'].includes(executionJob.state)) {
      try {
        const { data } = await axios.delete(`/api/note-studio/execution-jobs/${encodeURIComponent(executionJob.jobId)}`, { withCredentials: true });
        setCodeSession((current) => ({ ...current, state: data.job?.state || 'cancelled', position: 0 }));
        setExecutionJob(null);
      } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '실행 대기를 취소하지 못했습니다.') }); }
      finally { setCodeRunning(false); }
      return;
    }
    if (!codeSession?.sessionId || codeSession.state !== 'running') return;
    try {
      const { data } = await axios.delete(`/api/note-studio/code-sessions/${encodeURIComponent(codeSession.sessionId)}`, { withCredentials: true });
      const incoming = (data.session?.events || []).filter((event) => Number(event.sequence) > codeSessionCursorRef.current);
      if (incoming.length) setCodeEvents((current) => [...current, ...incoming]);
      codeSessionCursorRef.current = data.session?.cursor || codeSessionCursorRef.current;
      setCodeSession((current) => ({ ...current, ...data.session }));
    } catch (error) {
      setMessage({ severity: 'error', text: errorMessage(error, '실행을 중지하지 못했습니다.') });
    } finally { setCodeRunning(false); }
  };

  const openPythonRuntime = async () => {
    setPythonRuntimeOpen(true);
    if (pythonRuntime || pythonRuntimeLoading) return;
    setPythonRuntimeLoading(true);
    try {
      const { data } = await axios.get('/api/note-studio/python/runtime', { withCredentials: true });
      setPythonRuntime(data);
    } catch (error) {
      setMessage({ severity: 'error', text: errorMessage(error, 'Python 패키지 정보를 불러오지 못했습니다.') });
      setPythonRuntimeOpen(false);
    } finally { setPythonRuntimeLoading(false); }
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

  const saveLabel = useMemo(() => ({ idle: '저장됨', saved: '저장됨', dirty: '대기', saving: '저장 중', conflict: '충돌', error: '실패' }[savingState]), [savingState]);
  const notesByNotebook = useMemo(() => notebooks.map((notebook) => {
    const notebookNotes = notes.filter((note) => note.notebookId === notebook.id);
    return { notebook, notes: visibleNoteTree(notebookNotes, collapsedPageIds), childCounts: noteChildCounts(notebookNotes) };
  }), [collapsedPageIds, notebooks, notes]);
  const legacyNotes = useMemo(() => notes.filter((note) => !note.notebookId), [notes]);
  const legacyTreeNotes = useMemo(() => visibleNoteTree(legacyNotes, collapsedPageIds), [collapsedPageIds, legacyNotes]);
  const legacyChildCounts = useMemo(() => noteChildCounts(legacyNotes), [legacyNotes]);
  const visibleCommands = useMemo(() => filterCommands(BLOCK_COMMANDS, commandQuery), [commandQuery]);
  const terminalNotebook = useMemo(() => notebooks.find((item) => item.id === terminalNotebookId) || null, [notebooks, terminalNotebookId]);
  const activeNotebook = useMemo(() => notebooks.find((item) => item.id === activeNotebookId) || null, [activeNotebookId, notebooks]);
  const sidebarNotebook = useMemo(() => notebooks.find((item) => item.id === sidebarNotebookId) || null, [notebooks, sidebarNotebookId]);
  const sidebarNotebookTree = useMemo(() => notesByNotebook.find((item) => item.notebook.id === sidebarNotebookId) || null, [notesByNotebook, sidebarNotebookId]);
  const overviewNotebooks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR');
    if (!normalizedQuery) return notebooks;
    return notebooks.filter((notebook) => String(notebook.title || '').toLocaleLowerCase('ko-KR').includes(normalizedQuery));
  }, [notebooks, query]);

  useEffect(() => {
    if (!loading && sidebarNotebookId && !notebooks.some((notebook) => notebook.id === sidebarNotebookId)) setSidebarNotebookId(null);
  }, [loading, notebooks, sidebarNotebookId]);

  const enterNotebook = (notebook) => {
    if (!notebook?.id) return;
    setActiveNotebookId(notebook.id);
    setSidebarNotebookId(notebook.id);
    setQuery('');
  };

  const leaveNotebook = () => {
    setSidebarNotebookId(null);
    setQuery('');
  };

  const togglePageCollapsed = (noteId) => {
    setCollapsedPageIds((current) => {
      const next = new Set(current);
      if (next.has(noteId)) next.delete(noteId); else next.add(noteId);
      return next;
    });
  };

  const openNotebookTerminal = (notebookId = activeNotebookId) => {
    const target = notebooks.find((item) => item.id === notebookId && item.available !== false);
    if (!target) {
      setMessage({ severity: 'warning', text: '터미널을 열 수 있는 노트북을 먼저 선택해 주세요.' });
      return;
    }
    setActiveNotebookId(target.id);
    setSidebarNotebookId(target.id);
    setQuery('');
    setTerminalNotebookId(target.id);
    setCodePanelOpen(false);
    setTerminalOpen(true);
  };

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

  const closeBlockMenu = (restoreFocus = true) => {
    setBlockMenu(null);
    if (restoreFocus) window.setTimeout(() => editor?.commands.focus(), 0);
  };

  const openBlockContextMenu = (event) => {
    if (selected?.deletedAt || event.shiftKey) return;
    event.preventDefault();
    if (selected?.type !== 'block' || !editor) {
      setOfficeMenu({ position: { top: event.clientY, left: event.clientX } });
      return;
    }
    const hit = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
    const maximum = Math.max(1, editor.state.doc.content.size - 1);
    const position = Math.max(1, Math.min(hit?.pos ?? maximum, maximum));
    editor.commands.setTextSelection(position);
    setBlockMenu({ position: { top: event.clientY, left: event.clientX }, view: 'main' });
  };

  const transformCurrentBlock = (commandId) => {
    if (!editor) return;
    const actions = {
      paragraph: () => editor.chain().focus().setParagraph().run(),
      'heading-1': () => editor.chain().focus().setHeading({ level: 1 }).run(),
      'heading-2': () => editor.chain().focus().setHeading({ level: 2 }).run(),
      'heading-3': () => editor.chain().focus().setHeading({ level: 3 }).run(),
      'bullet-list': () => editor.chain().focus().toggleBulletList().run(),
      'ordered-list': () => editor.chain().focus().toggleOrderedList().run(),
      'task-list': () => editor.chain().focus().toggleTaskList().run(),
      quote: () => editor.chain().focus().toggleBlockquote().run(),
      'code-block': () => editor.chain().focus().setCodeBlock().run(),
    };
    actions[commandId]?.();
    closeBlockMenu(false);
  };

  const duplicateCurrentBlock = () => {
    const target = editor && findContextBlock(editor.state);
    if (!target) return;
    editor.view.dispatch(editor.state.tr.insert(target.pos + target.node.nodeSize, target.node.copy(target.node.content)));
    closeBlockMenu();
  };

  const moveCurrentBlock = (direction) => {
    const target = editor && findContextBlock(editor.state);
    if (!target) return;
    const siblingIndex = target.index + direction;
    if (siblingIndex < 0 || siblingIndex >= target.parent.childCount) return;
    const sibling = target.parent.child(siblingIndex);
    const insertAt = direction < 0 ? target.pos - sibling.nodeSize : target.pos + sibling.nodeSize;
    const transaction = editor.state.tr.delete(target.pos, target.pos + target.node.nodeSize).insert(insertAt, target.node);
    editor.view.dispatch(transaction);
    closeBlockMenu();
  };

  const deleteCurrentBlock = () => {
    const target = editor && findContextBlock(editor.state);
    if (!target) return;
    if (target.depth === 1 && target.parent.childCount === 1) editor.commands.clearContent();
    else editor.view.dispatch(editor.state.tr.delete(target.pos, target.pos + target.node.nodeSize));
    closeBlockMenu();
  };

  const indentCurrentBlock = (outdent = false) => {
    if (!editor) return;
    const { $from } = editor.state.selection;
    const listItemType = [...Array($from.depth).keys()].reverse()
      .map((offset) => $from.node(offset + 1)?.type?.name)
      .find((name) => name === 'taskItem' || name === 'listItem');
    if (listItemType) {
      const chain = editor.chain().focus();
      if (outdent) chain.liftListItem(listItemType).run();
      else chain.sinkListItem(listItemType).run();
    } else if (['paragraph', 'heading', 'codeBlock'].includes($from.parent.type.name)) {
      const position = $from.before($from.depth);
      const indentLevel = nextBlockIndent($from.parent.attrs.indentLevel, outdent);
      editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...$from.parent.attrs, indentLevel }));
    }
    closeBlockMenu(false);
  };

  const copyCurrentBlock = async (cut = false) => {
    const target = editor && findContextBlock(editor.state);
    if (!target) return;
    const copied = await copyTextToClipboard(target.node.textContent || '');
    if (!copied) {
      setMessage({ severity: 'error', text: '블록 내용을 클립보드에 복사하지 못했습니다.' });
      return;
    }
    if (cut) deleteCurrentBlock();
    else closeBlockMenu();
    setMessage({ severity: 'success', text: cut ? '블록을 잘라냈습니다.' : '블록 내용을 복사했습니다.' });
  };

  const setCurrentBlockAppearance = (attribute, value) => {
    if (!editor) return;
    const { $from } = editor.state.selection;
    if (!['paragraph', 'heading', 'codeBlock'].includes($from.parent.type.name)) return;
    const position = $from.before($from.depth);
    editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, { ...$from.parent.attrs, [attribute]: value }));
    closeBlockMenu(false);
  };

  const askAiAboutCurrentBlock = () => {
    const target = editor && findContextBlock(editor.state);
    if (!target) return;
    window.dispatchEvent(new CustomEvent('nas:open-ai-agent', { detail: {
      requestId: `${Date.now()}`,
      context: { activeApp: 'note-studio', noteId: selected?.id || '', notebookId: selected?.notebookId || '' },
      draft: `이 노트 블록을 도와줘.\n\n${(target.node.textContent || '').slice(0, 4000)}`,
    } }));
    closeBlockMenu(false);
  };

  const currentBlockStats = useMemo(() => {
    if (!blockMenu || !editor) return { words: 0, characters: 0 };
    return blockTextStats(findContextBlock(editor.state)?.node?.textContent || '');
  }, [blockMenu, editor]);

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

  const startRenameNote = (note) => {
    setContextMenu(null);
    setRenameNote(note);
    setRenameTitle(note.title || '');
  };

  const openNotebookContextMenu = (event, notebook) => {
    event.preventDefault();
    event.stopPropagation();
    setNotebookMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6, notebook, anchorEl: event.currentTarget });
  };

  const startRenameNotebook = (notebook) => {
    setNotebookMenu(null);
    setRenameNotebook(notebook);
    setRenameNotebookTitle(notebook.title || '');
  };

  const submitRenameNotebook = async () => {
    const title = renameNotebookTitle.trim();
    if (!renameNotebook || !title || renamingNotebook) return;
    setRenamingNotebook(true);
    try {
      const { data } = await axios.patch(`/api/note-studio/notebooks/${encodeURIComponent(renameNotebook.id)}`, { expectedRevision: renameNotebook.revision, title }, { withCredentials: true });
      setNotebooks((items) => items.map((item) => item.id === renameNotebook.id ? { ...item, ...data.notebook } : item));
      setRenameNotebook(null);
      setMessage({ severity: 'success', text: '노트북 이름을 변경했습니다. 실제 프로젝트 폴더 경로는 안전하게 유지됩니다.' });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '노트북 이름을 바꾸지 못했습니다.') }); }
    finally { setRenamingNotebook(false); }
  };

  const createPageInNotebook = (target, anchorEl) => {
    setNotebookMenu(null);
    enterNotebook(target);
    setPendingParentId(null);
    setCreateAnchor(anchorEl);
  };

  const openNotebookTools = (notebook) => {
    setNotebookMenu(null);
    setDevToolsNotebook(notebook);
  };

  const submitRenameNote = async () => {
    const title = renameTitle.trim();
    if (!renameNote || !title || renamingNote) return;
    setRenamingNote(true);
    try {
      const { data } = await axios.patch(`/api/note-studio/notes/${encodeURIComponent(renameNote.id)}`, { expectedRevision: renameNote.revision, title, reason: 'tree-rename' }, { withCredentials: true });
      setNotes((items) => items.map((item) => item.id === renameNote.id ? { ...item, ...data.note, content: undefined } : item));
      if (selectedRef.current?.id === renameNote.id) {
        selectedRef.current = { ...selectedRef.current, ...data.note };
        setSelected(selectedRef.current);
      }
      setRenameNote(null);
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '페이지 이름을 바꾸지 못했습니다.') }); }
    finally { setRenamingNote(false); }
  };

  const trashNoteFromTree = async (note) => {
    setContextMenu(null);
    try {
      await axios.delete(`/api/note-studio/notes/${encodeURIComponent(note.id)}`, { data: { expectedRevision: note.revision }, withCredentials: true });
      if (selectedRef.current?.id === note.id) { setSelected(null); selectedRef.current = null; }
      await loadList({ keepSelection: selectedRef.current?.id !== note.id });
      setMessage({ severity: 'success', text: '페이지를 휴지통으로 이동했습니다.' });
    } catch (error) { setMessage({ severity: 'error', text: errorMessage(error, '페이지를 휴지통으로 이동하지 못했습니다.') }); }
  };

  const openTreeContextMenu = (event, note) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ mouseX: event.clientX + 2, mouseY: event.clientY - 6, note, anchorEl: event.currentTarget });
  };

  const renderNoteTreeRow = (note, childCounts, notebookId = null) => {
    const type = TYPE_OPTIONS.find((option) => option.type === note.type) || TYPE_OPTIONS[0];
    const Icon = type.Icon;
    const hasChildren = (childCounts.get(note.id) || 0) > 0;
    const collapsed = collapsedPageIds.has(note.id);
    const depth = Math.min(note.depth, 8);
    return <ListItemButton className="note-page-tree-row" role="treeitem" aria-level={depth + 1} aria-expanded={hasChildren ? !collapsed : undefined} key={note.id} selected={selected?.id === note.id} onClick={() => { if (notebookId) setActiveNotebookId(notebookId); openNote(note); }} onContextMenu={(event) => openTreeContextMenu(event, note)} onKeyDown={(event) => { if (event.key === 'F2' && !trashMode) { event.preventDefault(); startRenameNote(note); } }} sx={{ py: 0.65, pl: 0.75 + depth * 2, minHeight: 42, position: 'relative', '&:hover .note-tree-row-actions, &:focus-within .note-tree-row-actions': { opacity: 1 } }}>
      {Array.from({ length: depth }).map((_, index) => <Box aria-hidden="true" key={index} sx={{ position: 'absolute', top: 0, bottom: 0, left: 17 + index * 16, borderLeft: '1px solid', borderColor: alpha(theme.palette.text.primary, 0.13), pointerEvents: 'none' }} />)}
      <IconButton size="small" tabIndex={-1} disabled={!hasChildren} aria-label={hasChildren ? (collapsed ? `${note.title} 하위 페이지 펼치기` : `${note.title} 하위 페이지 접기`) : undefined} onClick={(event) => { event.stopPropagation(); if (hasChildren) togglePageCollapsed(note.id); }} sx={{ width: 24, height: 24, mr: 0.25, visibility: hasChildren ? 'visible' : 'hidden' }}><KeyboardArrowRightIcon sx={{ fontSize: 17, transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)', transition: 'transform 120ms ease' }} /></IconButton>
      <ListItemIcon sx={{ minWidth: 29 }}><Icon sx={{ fontSize: 18 }} /></ListItemIcon>
      <ListItemText primary={note.title} secondary={`${type.label} · ${formatTime(note.updatedAt)}`} primaryTypographyProps={{ noWrap: true, fontWeight: 750, fontSize: 13 }} secondaryTypographyProps={{ noWrap: true, fontSize: 10.5 }} />
      {!trashMode && <Box className="note-tree-row-actions" sx={{ display: 'flex', opacity: 0, transition: 'opacity 100ms ease', bgcolor: 'inherit' }}><Tooltip title="하위 페이지 만들기"><IconButton size="small" aria-label={`${note.title} 아래에 페이지 만들기`} onClick={(event) => { event.stopPropagation(); setPendingParentId(note.id); setCreateAnchor(event.currentTarget); }}><AddIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip><Tooltip title="페이지 작업"><IconButton size="small" aria-label={`${note.title} 작업`} onClick={(event) => openTreeContextMenu(event, note)}><MoreHorizIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip></Box>}
    </ListItemButton>;
  };

  const renderNotebookOverviewRow = (notebook) => {
    const tree = notesByNotebook.find((item) => item.notebook.id === notebook.id);
    const pageCount = notes.filter((note) => note.notebookId === notebook.id).length;
    const expanded = expandedOverviewNotebookIds.has(notebook.id);
    return <Box key={notebook.id} role="treeitem" aria-expanded={pageCount ? expanded : undefined}>
      <ListItemButton className="note-notebook-tree-row" onClick={() => enterNotebook(notebook)} onDoubleClick={() => openNotebookTerminal(notebook.id)} onContextMenu={(event) => openNotebookContextMenu(event, notebook)} onKeyDown={(event) => { if (event.key === 'F2' && !trashMode) { event.preventDefault(); startRenameNotebook(notebook); } }} sx={{ py: 0.75, px: 0.75, minHeight: 48, position: 'relative', '&:hover .note-tree-row-actions, &:focus-within .note-tree-row-actions': { opacity: 1 } }}>
        <IconButton size="small" disabled={!pageCount} aria-label={pageCount ? (expanded ? `${notebook.title} 하위 목록 접기` : `${notebook.title} 하위 목록 펼치기`) : undefined} onClick={(event) => { event.stopPropagation(); setExpandedOverviewNotebookIds((current) => { const next = new Set(current); if (next.has(notebook.id)) next.delete(notebook.id); else next.add(notebook.id); return next; }); }} sx={{ width: 26, height: 26, mr: 0.25, visibility: pageCount ? 'visible' : 'hidden' }}><KeyboardArrowRightIcon sx={{ fontSize: 18, transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 120ms ease' }} /></IconButton>
        <ListItemIcon sx={{ minWidth: 31 }}>{notebook.kind === 'project' ? <TerminalIcon fontSize="small" /> : <MenuBookOutlinedIcon fontSize="small" />}</ListItemIcon>
        <ListItemText primary={notebook.title} secondary={notebook.available === false ? `${notebook.directoryName} · 경로 확인 필요` : `${notebook.kind === 'project' ? '프로젝트' : '노트'} · ${pageCount}개 페이지`} primaryTypographyProps={{ fontWeight: 900, noWrap: true }} secondaryTypographyProps={{ fontSize: 10.5, noWrap: true, color: notebook.available === false ? 'error' : 'text.secondary' }} />
        {!trashMode && <Box className="note-tree-row-actions" sx={{ display: 'flex', opacity: 0, transition: 'opacity 100ms ease' }}><Tooltip title="노트북 작업"><IconButton size="small" aria-label={`${notebook.title} 작업`} onClick={(event) => openNotebookContextMenu(event, notebook)}><MoreHorizIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip></Box>}
      </ListItemButton>
      {expanded && <Box role="group" sx={{ bgcolor: alpha(theme.palette.text.primary, 0.018) }}>{tree?.notes.map((note) => renderNoteTreeRow(note, tree.childCounts, notebook.id))}</Box>}
    </Box>;
  };

  return (
    <Box className="note-studio-shell" sx={{ height: '100%', minHeight: 0, display: 'grid', gridTemplateColumns: sidebarOpen ? { xs: '1fr', md: '270px minmax(0, 1fr)' } : '42px minmax(0, 1fr)', bgcolor: 'background.default' }}>
      {!sidebarOpen && <Box sx={{ minHeight: 0, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', pt: 0.75, bgcolor: 'background.paper', borderRight: '1px solid', borderColor: 'divider' }}><Tooltip title="노트북 목록 보기 · Ctrl+B"><IconButton size="small" aria-label="노트북 목록 보기" onClick={() => setSidebarOpen(true)}><ViewSidebarOutlinedIcon fontSize="small" /></IconButton></Tooltip></Box>}
      <Paper square elevation={0} sx={{ display: { xs: sidebarOpen && !(selected || terminalOpen) ? 'flex' : 'none', md: sidebarOpen ? 'flex' : 'none' }, minHeight: 0, flexDirection: 'column', borderRight: { md: '1px solid' }, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" className="note-studio-compact-controls" sx={{ minHeight: 38, px: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            {!sidebarNotebook && <Tooltip title="목록 숨기기 · Ctrl+B"><IconButton size="small" aria-label="노트북 목록 숨기기" onClick={() => setSidebarOpen(false)}><ViewSidebarOutlinedIcon fontSize="small" /></IconButton></Tooltip>}
            {sidebarNotebook && <Button size="small" color="inherit" onClick={leaveNotebook} sx={{ minWidth: 0, px: 0.75, fontWeight: 900 }}>BACK</Button>}
            {sidebarNotebook && <Typography variant="body2" title={sidebarNotebook.title} sx={{ fontWeight: 900, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sidebarNotebook.title}</Typography>}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
            {sidebarNotebook ? <>
              <Tooltip title="새 페이지"><IconButton size="small" aria-label="새 페이지" color="primary" disabled={sidebarNotebook.available === false} onClick={(event) => { setPendingParentId(null); setActiveNotebookId(sidebarNotebook.id); setCreateAnchor(event.currentTarget); }}><AddIcon fontSize="small" /></IconButton></Tooltip>
              <Tooltip title="노트북 작업"><IconButton size="small" aria-label={`${sidebarNotebook.title} 작업`} onClick={(event) => openNotebookContextMenu(event, sidebarNotebook)}><MoreHorizIcon fontSize="small" /></IconButton></Tooltip>
            </> : <Tooltip title="새 노트북"><IconButton size="small" aria-label="새 노트북" onClick={() => setNotebookDialogOpen(true)}><CreateNewFolderOutlinedIcon fontSize="small" /></IconButton></Tooltip>}
          </Box>
        </Stack>
        <Box sx={{ px: 1, py: 0.75 }}><TextField value={query} onChange={(event) => setQuery(event.target.value)} size="small" fullWidth placeholder={sidebarNotebook ? '이 노트북 검색' : '노트북 검색'} InputProps={{ startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: 'text.secondary' }} /> }} /></Box>
        <Stack direction="row" spacing={0.75} sx={{ px: 1.25, pb: 1 }}>
          <Button size="small" variant={!trashMode ? 'contained' : 'text'} onClick={() => { setTrashMode(false); setSelected(null); }}>내 노트</Button>
          <Button size="small" startIcon={<ArchiveIcon />} variant={trashMode ? 'contained' : 'text'} color="inherit" onClick={() => { setTrashMode(true); setSelected(null); }}>휴지통</Button>
        </Stack>
        <Divider />
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {loading ? <Box sx={{ py: 5, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box> : !sidebarNotebook ? <>
            {overviewNotebooks.length === 0 ? <Box sx={{ p: 3, textAlign: 'center' }}><Typography color="text.secondary" variant="body2">{query ? '일치하는 노트북이 없습니다.' : '새 노트북을 만들어 시작하세요.'}</Typography></Box> : <List role="tree" aria-label="전체 노트북 목록" dense disablePadding>{overviewNotebooks.map(renderNotebookOverviewRow)}</List>}
            {legacyTreeNotes.length > 0 && !query && <Box role="group"><Typography variant="overline" color="text.secondary" sx={{ px: 1.5 }}>기존 노트</Typography>{legacyTreeNotes.map((note) => renderNoteTreeRow(note, legacyChildCounts))}</Box>}
          </> : <>
            {!sidebarNotebookTree?.notes.length ? <Box sx={{ p: 3, textAlign: 'center' }}><Typography color="text.secondary" variant="body2">{query ? '이 노트북에서 검색 결과가 없습니다.' : trashMode ? '이 노트북의 휴지통이 비어 있습니다.' : '아직 페이지가 없습니다.'}</Typography></Box> : <List role="tree" aria-label={`${sidebarNotebook.title} 페이지 트리`} dense disablePadding>{sidebarNotebookTree.notes.map((note) => renderNoteTreeRow(note, sidebarNotebookTree.childCounts, sidebarNotebook.id))}</List>}
          </>}
        </Box>
        {sidebarNotebook && <Box sx={{ p: 0.75, borderTop: '1px solid', borderColor: 'divider' }}><Tooltip title="TXT·Markdown·코드 가져오기"><Button size="small" fullWidth startIcon={<UploadFileIcon />} onClick={() => importInputRef.current?.click()}>파일 가져오기</Button></Tooltip><input ref={importInputRef} hidden type="file" accept=".txt,.md,.markdown,.js,.jsx,.ts,.tsx,.py,.json,.html,.css,.sql,.sh,.yaml,.yml" onChange={importFile} /></Box>}
      </Paper>

      <Box sx={{ minWidth: 0, minHeight: 0, display: { xs: selected || terminalOpen ? 'flex' : 'none', md: 'flex' }, flexDirection: 'column' }}>
        {message && <Alert severity={message.severity} onClose={() => setMessage(null)} sx={{ borderRadius: 0 }}>{message.text}</Alert>}
        {!selected ? <Box sx={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center', p: 3 }}><Box sx={{ textAlign: 'center', maxWidth: 480 }}>{!sidebarNotebook ? <><MenuBookOutlinedIcon sx={{ fontSize: 60, color: alpha(theme.palette.text.primary, 0.22) }} /><Typography variant="h6" sx={{ mt: 1, fontWeight: 900 }}>노트북을 선택하세요</Typography><Typography color="text.secondary" sx={{ mt: 0.75 }}>왼쪽 목록에서 노트북을 선택하면 그 안의 페이지와 작업 도구만 표시됩니다.</Typography><Button sx={{ mt: 2 }} variant="outlined" startIcon={<CreateNewFolderOutlinedIcon />} onClick={() => setNotebookDialogOpen(true)}>새 노트북</Button></> : <>{sidebarNotebook.kind === 'project' ? <TerminalIcon sx={{ fontSize: 60, color: alpha(theme.palette.text.primary, 0.22) }} /> : <NotesIcon sx={{ fontSize: 64, color: alpha(theme.palette.text.primary, 0.22) }} />}<Typography variant="h6" sx={{ mt: 1, fontWeight: 900 }}>{sidebarNotebook.kind === 'project' ? '프로젝트 작업공간' : '노트북 안에 페이지를 구성하세요'}</Typography><Typography color="text.secondary" sx={{ mt: 0.75 }}>{sidebarNotebook.kind === 'project' ? '코드·설정·데이터 파일을 한 폴더에 두고 하단 실행 콘솔과 노트북 터미널에서 함께 작업합니다.' : '블록, Markdown, TXT를 Notion식 페이지 트리로 관리하고 필요할 때 코드와 실제 파일을 연결합니다.'}</Typography><Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 2 }}>{sidebarNotebook.kind === 'project' && <Tooltip title="프로젝트 터미널 열기"><Button variant="contained" startIcon={<TerminalIcon />} onClick={() => openNotebookTerminal(sidebarNotebook.id)}>터미널</Button></Tooltip>}<Button variant={sidebarNotebook.kind === 'project' ? 'outlined' : 'contained'} startIcon={<AddIcon />} onClick={(event) => { setPendingParentId(null); setActiveNotebookId(sidebarNotebook.id); setCreateAnchor(event.currentTarget); }}>새 페이지</Button>{sidebarNotebook.kind !== 'project' && <Button variant="outlined" startIcon={<TerminalIcon />} onClick={() => openNotebookTerminal(sidebarNotebook.id)}>터미널</Button>}</Stack></>}</Box></Box> : <>
          <Stack direction="row" alignItems="center" spacing={0.5} className="note-studio-page-bar" sx={{ px: 0.75, minHeight: 40, maxHeight: 40, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', overflowX: 'auto', flexShrink: 0 }}>
            <Button sx={{ display: { md: 'none' }, minWidth: 0 }} onClick={() => setSelected(null)}>BACK</Button>
            <TextField variant="standard" value={selected.title} onChange={(event) => updateMeta({ title: event.target.value })} disabled={!!selected.deletedAt} inputProps={{ 'aria-label': '노트 제목' }} InputProps={{ disableUnderline: true, sx: { minWidth: 140, fontWeight: 850, fontSize: 16 } }} sx={{ flex: '1 1 260px', minWidth: 140 }} />
            <Tooltip title={{ idle: '저장 완료', saved: '저장 완료', dirty: '자동 저장 대기', saving: '저장 중', conflict: '저장 충돌 — 다시 확인 필요', error: '저장 실패' }[savingState]}><Chip size="small" label={saveLabel} color={savingState === 'error' || savingState === 'conflict' ? 'warning' : savingState === 'saved' || savingState === 'idle' ? 'success' : 'default'} variant="outlined" sx={{ height: 24 }} /></Tooltip>
            {selected.type === 'code' && <Divider flexItem orientation="vertical" sx={{ mx: 0.25 }} />}
            {selected.type === 'code' && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Select size="small" value={selected.language || 'plaintext'} onChange={(event) => updateMeta({ language: event.target.value })} sx={{ minWidth: 116, height: 30, flexShrink: 0 }}>{languageOptions.map((language) => <MenuItem key={language.id} value={language.id}>{language.label}</MenuItem>)}</Select>
              {['execute', 'validate'].includes(languageById[String(selected.language || '').toLowerCase()]?.mode) && !selected.deletedAt && <Tooltip title={`${languageById[selected.language]?.label || selected.language} ${languageById[selected.language]?.mode === 'validate' ? '검증·정리' : '격리 실행'}`}><span><Button size="small" variant="contained" startIcon={codeRunning ? <CircularProgress size={15} color="inherit" /> : <PlayArrowIcon />} disabled={codeRunning || savingState === 'dirty' || savingState === 'saving'} onClick={runCode}>{codeRunning ? '대기·실행' : languageById[selected.language]?.mode === 'validate' ? '검증' : '실행'}</Button></span></Tooltip>}
              {languageById[String(selected.language || '').toLowerCase()]?.mode === 'preview' && !selected.deletedAt && <Button size="small" variant="contained" onClick={() => setPreviewOpen(true)}>미리보기</Button>}
              {codeSession && !codePanelOpen && <Tooltip title="실행 콘솔 보기"><IconButton size="small" aria-label="실행 콘솔 보기" onClick={() => { setTerminalOpen(false); setCodePanelOpen(true); }}><TerminalIcon fontSize="small" /></IconButton></Tooltip>}
              {selected.language === 'python' && !selected.deletedAt && <Tooltip title="Python 기본 패키지 확인"><Button size="small" variant="text" onClick={openPythonRuntime}>패키지</Button></Tooltip>}
              {activeNotebook?.kind === 'project' && !selected.deletedAt && <Tooltip title="Open VSX 검색과 VS Code 권장 확장 관리"><Button size="small" variant="text" startIcon={<ExtensionOutlinedIcon />} onClick={() => openNotebookTools(activeNotebook)}>개발 도구</Button></Tooltip>}
            </Box>}
            {selected.type === 'markdown' && !selected.deletedAt && <Button size="small" variant="contained" onClick={() => setPreviewOpen(true)}>미리보기</Button>}
            {!selected.deletedAt && <Divider flexItem orientation="vertical" sx={{ mx: 0.25 }} />}
            {!selected.deletedAt && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
              <Tooltip title="현재 노트북 경로에서 격리 터미널 열기"><span><IconButton size="small" aria-label="터미널 열기" disabled={!selected.notebookId} onClick={() => openNotebookTerminal(selected.notebookId)}><TerminalIcon fontSize="small" /></IconButton></span></Tooltip>
              <Tooltip title="연결 문서 만들기"><span><Button size="small" variant="outlined" startIcon={<DescriptionIcon />} disabled={officeCreating || savingState === 'dirty' || savingState === 'saving'} onClick={(event) => setOfficeMenu({ anchorEl: event.currentTarget })}>문서</Button></span></Tooltip>
              <Tooltip title={savingState === 'dirty' || savingState === 'saving' ? '저장이 끝난 뒤 첨부할 수 있습니다.' : 'NAS 파일 또는 폴더 첨부'}><span><IconButton size="small" aria-label="NAS 파일 또는 폴더 첨부" disabled={savingState === 'dirty' || savingState === 'saving'} onClick={() => setAttachmentPickerOpen(true)}><AttachFileIcon fontSize="small" /></IconButton></span></Tooltip>
            </Box>}
            <Divider flexItem orientation="vertical" sx={{ mx: 0.25 }} />
            <Tooltip title="페이지 작업 더보기"><IconButton size="small" aria-label="페이지 작업 더보기" aria-haspopup="menu" aria-expanded={Boolean(pageMenuAnchor)} onClick={(event) => setPageMenuAnchor(event.currentTarget)}><MoreHorizIcon fontSize="small" /></IconButton></Tooltip>
          </Stack>
          <Menu anchorEl={pageMenuAnchor} open={Boolean(pageMenuAnchor)} onClose={() => setPageMenuAnchor(null)} MenuListProps={{ dense: true, 'aria-label': '페이지 작업' }}>
            {!selected.deletedAt && <MenuItem onClick={() => { setPageMenuAnchor(null); openVersions(); }}><ListItemIcon><HistoryIcon fontSize="small" /></ListItemIcon><ListItemText primary="버전 기록" /></MenuItem>}
            {!selected.deletedAt && <MenuItem onClick={() => { setPageMenuAnchor(null); exportSelected(); }}><ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon><ListItemText primary="파일로 내보내기" /></MenuItem>}
            {!selected.deletedAt && <Divider />}
            {!selected.deletedAt ? <MenuItem onClick={() => { setPageMenuAnchor(null); trashSelected(); }} sx={{ color: 'error.main' }}><ListItemIcon sx={{ color: 'error.main' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon><ListItemText primary="휴지통으로 이동" /></MenuItem> : <>
              <MenuItem onClick={() => { setPageMenuAnchor(null); restoreSelected(); }}><ListItemIcon><RestoreIcon fontSize="small" /></ListItemIcon><ListItemText primary="복원" /></MenuItem>
              <MenuItem onClick={() => { setPageMenuAnchor(null); permanentlyDelete(); }} sx={{ color: 'error.main' }}><ListItemIcon sx={{ color: 'error.main' }}><DeleteForeverIcon fontSize="small" /></ListItemIcon><ListItemText primary="영구 삭제" /></MenuItem>
            </>}
          </Menu>
          {selected.type === 'block' && <BlockToolbar editor={editor} />}
          {(selected.attachments || []).length > 0 && <Stack direction="row" spacing={0.75} sx={{ px: 1.25, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', overflowX: 'auto' }}>{selected.attachments.map((attachment) => <Chip key={attachment.id} icon={<AttachFileIcon />} label={attachment.name} onClick={() => openAttachment(attachment)} onDelete={selected.deletedAt ? undefined : () => removeAttachment(attachment)} deleteIcon={<CloseIcon />} sx={{ flex: '0 0 auto' }} />)}</Stack>}
          <Box onContextMenu={openBlockContextMenu} sx={{ flex: 1, minHeight: 'min(220px, 58%)', position: 'relative', bgcolor: 'background.paper' }}>
            {selected.deletedAt && <Alert severity="warning" sx={{ borderRadius: 0 }}>휴지통의 노트는 읽기 전용입니다. 편집하려면 먼저 복원하세요.</Alert>}
            {selected.type === 'block' ? <Box ref={noteScrollRef} onScroll={saveBlockViewState} className="note-studio-editor" sx={{ height: '100%', pointerEvents: selected.deletedAt ? 'none' : 'auto', opacity: selected.deletedAt ? 0.72 : 1 }}><EditorContent editor={editor} /></Box> : <Editor key={selected.id} onMount={handleNoteMonacoMount} height="100%" language={selected.type === 'markdown' ? 'markdown' : selected.type === 'text' ? 'plaintext' : selected.language || 'plaintext'} value={plainContent} onChange={(value) => !selected.deletedAt && updatePlain(value ?? '')} theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'} options={{ readOnly: !!selected.deletedAt, minimap: { enabled: false }, wordWrap: selected.type === 'code' ? 'off' : 'on', fontSize: 15, padding: { top: 24 }, automaticLayout: true, scrollBeyondLastLine: false }} />}
          </Box>
        </>}
        {terminalOpen && terminalNotebook ? <NoteStudioTerminal notebook={terminalNotebook} explorerOpen={terminalExplorerOpen} onExplorerOpenChange={setTerminalExplorerOpen} onClose={() => setTerminalOpen(false)} onOpenFile={openFileWindowByPath} onOpenFolder={openFolderWindowByPath} /> : codePanelOpen && codeSession ? <CodeRunPanel session={codeSession} events={codeEvents} onInput={sendCodeInput} onStop={stopCodeSession} onHide={() => setCodePanelOpen(false)} /> : null}
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
      <Menu
        open={!!blockMenu}
        onClose={() => closeBlockMenu()}
        anchorReference="anchorPosition"
        anchorPosition={blockMenu?.position}
        autoFocus={false}
        disableRestoreFocus
        MenuListProps={{ dense: true, sx: { width: 292, maxHeight: 'min(520px, 72vh)', py: 0.75 } }}
      >
        {blockMenu?.view !== 'main' && <MenuItem onClick={() => setBlockMenu((current) => ({ ...current, view: 'main' }))} sx={{ fontWeight: 900 }}>BACK</MenuItem>}
        {blockMenu?.view === 'main' && <>
          <MenuItem disabled><ListItemText primary="현재 블록" secondary={`${currentBlockStats.words}단어 · ${currentBlockStats.characters}자`} /></MenuItem>
          <MenuItem onClick={() => setBlockMenu((current) => ({ ...current, view: 'insert' }))}><ListItemText primary="삽입" secondary="블록·페이지·파일·문서" /></MenuItem>
          <MenuItem onClick={() => setBlockMenu((current) => ({ ...current, view: 'transform' }))}><ListItemText primary="블록 유형 변경" secondary="본문·제목·목록·인용·코드" /></MenuItem>
          <MenuItem onClick={() => setBlockMenu((current) => ({ ...current, view: 'color' }))}><ListItemText primary="색상" secondary="글자색과 배경색" /></MenuItem>
          <Divider />
          <MenuItem onClick={duplicateCurrentBlock}>복제</MenuItem>
          <MenuItem disabled={!findContextBlock(editor?.state)?.index} onClick={() => moveCurrentBlock(-1)}>위로 이동</MenuItem>
          <MenuItem disabled={(findContextBlock(editor?.state)?.index ?? -1) >= ((findContextBlock(editor?.state)?.parent?.childCount ?? 0) - 1)} onClick={() => moveCurrentBlock(1)}>아래로 이동</MenuItem>
          <MenuItem onClick={() => indentCurrentBlock(false)}>들여쓰기</MenuItem>
          <MenuItem onClick={() => indentCurrentBlock(true)}>내어쓰기</MenuItem>
          <Divider />
          <MenuItem onClick={() => copyCurrentBlock(false)}>블록 텍스트 복사</MenuItem>
          <MenuItem onClick={() => copyCurrentBlock(true)}>잘라내기</MenuItem>
          <MenuItem onClick={askAiAboutCurrentBlock}>AI에게 이 블록 요청</MenuItem>
          <Divider />
          <MenuItem onClick={deleteCurrentBlock} sx={{ color: 'error.main' }}>삭제</MenuItem>
        </>}
        {blockMenu?.view === 'transform' && <>
          <MenuItem disabled><ListItemText primary="블록 유형 변경" secondary="내용을 유지한 채 표현만 바꿉니다." /></MenuItem>
          {BLOCK_TRANSFORMS.map((option) => <MenuItem key={option.id} onClick={() => transformCurrentBlock(option.id)}>{option.label}</MenuItem>)}
        </>}
        {blockMenu?.view === 'color' && <>
          <MenuItem disabled>글자색</MenuItem>
          {BLOCK_COLORS.map((option) => <MenuItem key={`text-${option.id}`} onClick={() => setCurrentBlockAppearance('blockColor', option.id === 'default' ? null : option.id)}>{option.label}</MenuItem>)}
          <Divider />
          <MenuItem disabled>배경색</MenuItem>
          {BLOCK_BACKGROUNDS.map((option) => <MenuItem key={`background-${option.id}`} onClick={() => setCurrentBlockAppearance('blockBackground', option.id === 'default' ? null : option.id)}>{option.label}</MenuItem>)}
        </>}
        {blockMenu?.view === 'insert' && <>
          <MenuItem disabled><ListItemText primary="현재 위치에 삽입" secondary="필요한 항목을 선택하세요." /></MenuItem>
          {BLOCK_COMMANDS.filter((command) => command.id !== 'subpage').map((command) => <MenuItem key={command.id} onClick={() => { closeBlockMenu(false); runBlockCommand(command.id); }}>{command.label}</MenuItem>)}
          <Divider />
          <MenuItem onClick={() => { closeBlockMenu(false); createLinkedSubpage(); }}>하위 페이지</MenuItem>
          <MenuItem onClick={() => { closeBlockMenu(false); setAttachmentPickerOpen(true); }}>NAS 파일 또는 폴더 연결</MenuItem>
          <MenuItem onClick={() => setBlockMenu((current) => ({ ...current, view: 'document' }))}>Office 문서 생성…</MenuItem>
        </>}
        {blockMenu?.view === 'document' && <>
          <MenuItem disabled><ListItemText primary="페이지 폴더에 문서 생성" secondary="저장 후 이 블록 위치에 연결됩니다." /></MenuItem>
          <MenuItem onClick={() => { closeBlockMenu(false); createOfficeDocument('docx', '글 문서'); }}>글 문서 · DOCX</MenuItem>
          <MenuItem onClick={() => { closeBlockMenu(false); createOfficeDocument('xlsx', '스프레드시트'); }}>스프레드시트 · XLSX</MenuItem>
          <MenuItem onClick={() => { closeBlockMenu(false); createOfficeDocument('pptx', '프레젠테이션'); }}>프레젠테이션 · PPTX</MenuItem>
          <MenuItem onClick={() => { closeBlockMenu(false); createOfficeDocument('hwpx', '한글 문서'); }}>한글 문서 · HWPX</MenuItem>
          <Divider />
          <MenuItem onClick={() => { closeBlockMenu(false); setOfficeLocationDialogOpen(true); }}>다른 NAS 위치에 만들기…</MenuItem>
        </>}
      </Menu>
      <Menu open={!!contextMenu} onClose={() => setContextMenu(null)} anchorReference="anchorPosition" anchorPosition={contextMenu ? { top: contextMenu.mouseY, left: contextMenu.mouseX } : undefined} MenuListProps={{ dense: true, 'aria-label': '페이지 트리 작업' }}>
        <MenuItem onClick={() => { const target = contextMenu.note; setContextMenu(null); openNote(target); }}>열기</MenuItem>
        {!trashMode && (noteChildCounts(notes).get(contextMenu?.note?.id) || 0) > 0 && <MenuItem onClick={() => { togglePageCollapsed(contextMenu.note.id); setContextMenu(null); }}>{collapsedPageIds.has(contextMenu.note.id) ? '하위 페이지 펼치기' : '하위 페이지 접기'}</MenuItem>}
        {!trashMode && <Divider />}
        {!trashMode && <MenuItem onClick={() => { const target = contextMenu; setContextMenu(null); setPendingParentId(target.note.id); setCreateAnchor(target.anchorEl); }}>하위 페이지 만들기</MenuItem>}
        {!trashMode && <MenuItem onClick={() => startRenameNote(contextMenu.note)}>이름 바꾸기 · F2</MenuItem>}
        {!trashMode && contextMenu?.note?.parentId && !contextMenu?.note?.storageRelativePath && <MenuItem onClick={() => moveNoteToRoot(contextMenu.note)}>최상위로 이동</MenuItem>}
        {!trashMode && <Divider />}
        {!trashMode && <MenuItem onClick={() => trashNoteFromTree(contextMenu.note)} sx={{ color: 'error.main' }}>휴지통으로 이동</MenuItem>}
      </Menu>
      <Menu open={!!notebookMenu} onClose={() => setNotebookMenu(null)} anchorReference="anchorPosition" anchorPosition={notebookMenu ? { top: notebookMenu.mouseY, left: notebookMenu.mouseX } : undefined} MenuListProps={{ dense: true, 'aria-label': '노트북 트리 작업' }}>
        <MenuItem onClick={() => { const target = notebookMenu.notebook; setNotebookMenu(null); if (sidebarNotebookId === target.id) leaveNotebook(); else enterNotebook(target); }}>{sidebarNotebookId === notebookMenu?.notebook?.id ? '전체 노트북 보기' : '노트북 열기'}</MenuItem>
        <MenuItem disabled={!notes.some((note) => note.notebookId === notebookMenu?.notebook?.id)} onClick={() => { const targetId = notebookMenu.notebook.id; if (sidebarNotebookId === targetId) setCollapsedPageIds((current) => new Set([...current, ...notes.filter((note) => note.notebookId === targetId).map((note) => note.id)])); else setExpandedOverviewNotebookIds((current) => { const next = new Set(current); if (next.has(targetId)) next.delete(targetId); else next.add(targetId); return next; }); setNotebookMenu(null); }}>{sidebarNotebookId === notebookMenu?.notebook?.id ? '모든 하위 페이지 접기' : expandedOverviewNotebookIds.has(notebookMenu?.notebook?.id) ? '목록에서 하위 페이지 접기' : '목록에서 하위 페이지 펼치기'}</MenuItem>
        <Divider />
        <MenuItem disabled={notebookMenu?.notebook?.available === false} onClick={() => createPageInNotebook(notebookMenu.notebook, notebookMenu.anchorEl)}><ListItemIcon><AddIcon fontSize="small" /></ListItemIcon><ListItemText primary="새 페이지" secondary="형식을 다음 메뉴에서 선택" /></MenuItem>
        <MenuItem disabled={notebookMenu?.notebook?.available === false} onClick={() => { const target = notebookMenu.notebook; setNotebookMenu(null); openNotebookTerminal(target.id); }}><ListItemIcon><TerminalIcon fontSize="small" /></ListItemIcon><ListItemText primary="터미널 열기" secondary="이 노트북 폴더로 제한" /></MenuItem>
        {notebookMenu?.notebook?.kind === 'project' && <MenuItem disabled={notebookMenu?.notebook?.available === false} onClick={() => openNotebookTools(notebookMenu.notebook)}><ListItemIcon><ExtensionOutlinedIcon fontSize="small" /></ListItemIcon><ListItemText primary="개발 도구" secondary="Open VSX·VS Code 권장 확장" /></MenuItem>}
        <MenuItem disabled={notebookMenu?.notebook?.available === false} onClick={() => { const target = notebookMenu.notebook; setNotebookMenu(null); openFolderWindowByPath(target.path); }}>NAS 파일관리자에서 열기</MenuItem>
        <MenuItem onClick={() => { setNotebookMenu(null); setSidebarOpen(false); }}>사이드바 숨기기 <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>Ctrl+B</Typography></MenuItem>
        <Divider />
        <MenuItem onClick={() => startRenameNotebook(notebookMenu.notebook)}><ListItemIcon><DriveFileRenameOutlineIcon fontSize="small" /></ListItemIcon><ListItemText primary="이름 바꾸기" secondary="F2 · 실제 폴더 경로 유지" /></MenuItem>
        <MenuItem disabled={notebookMenu?.notebook?.available === false} onClick={async () => { await copyTextToClipboard(notebookMenu.notebook.path); setNotebookMenu(null); }}><ListItemIcon><ContentCopyIcon fontSize="small" /></ListItemIcon><ListItemText primary="NAS 경로 복사" /></MenuItem>
      </Menu>
      <Dialog open={!!renameNote} onClose={() => !renamingNote && setRenameNote(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>페이지 이름 바꾸기</DialogTitle>
        <DialogContent><TextField autoFocus fullWidth margin="dense" label="페이지 이름" value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitRenameNote(); }} /></DialogContent>
        <DialogActions><Button color="inherit" disabled={renamingNote} onClick={() => setRenameNote(null)}>취소</Button><Button variant="contained" disabled={renamingNote || !renameTitle.trim()} onClick={submitRenameNote}>{renamingNote ? '변경 중…' : '변경'}</Button></DialogActions>
      </Dialog>
      <Dialog open={!!renameNotebook} onClose={() => !renamingNotebook && setRenameNotebook(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>노트북 이름 바꾸기</DialogTitle>
        <DialogContent><TextField autoFocus fullWidth margin="dense" label="표시 이름" value={renameNotebookTitle} onChange={(event) => setRenameNotebookTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitRenameNotebook(); }} helperText="코드와 PC 동기화가 깨지지 않도록 실제 폴더 경로는 유지합니다." /></DialogContent>
        <DialogActions><Button color="inherit" disabled={renamingNotebook} onClick={() => setRenameNotebook(null)}>취소</Button><Button variant="contained" disabled={renamingNotebook || !renameNotebookTitle.trim()} onClick={submitRenameNotebook}>{renamingNotebook ? '변경 중…' : '변경'}</Button></DialogActions>
      </Dialog>
      <DeveloperToolsDialog open={!!devToolsNotebook} notebook={devToolsNotebook} onClose={() => setDevToolsNotebook(null)} />
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
        <DialogTitle sx={{ fontWeight: 900 }}>새 노트북 또는 프로젝트</DialogTitle>
        <DialogContent>
          <Typography variant="caption" color="text.secondary">용도 선택</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.75, mb: 2 }}>
            <Button fullWidth variant={notebookKind === 'notes' ? 'contained' : 'outlined'} onClick={() => setNotebookKind('notes')} sx={{ minHeight: 82, alignItems: 'flex-start', flexDirection: 'column', textAlign: 'left' }}><Typography sx={{ fontWeight: 900 }}>노트</Typography><Typography variant="caption" sx={{ opacity: 0.8 }}>Notion식 페이지·문서 중심</Typography></Button>
            <Button fullWidth variant={notebookKind === 'project' ? 'contained' : 'outlined'} onClick={() => setNotebookKind('project')} sx={{ minHeight: 82, alignItems: 'flex-start', flexDirection: 'column', textAlign: 'left' }}><Typography sx={{ fontWeight: 900 }}>프로젝트</Typography><Typography variant="caption" sx={{ opacity: 0.8 }}>코드·파일·실행 중심</Typography></Button>
          </Stack>
          <TextField autoFocus fullWidth label={notebookKind === 'project' ? '프로젝트 이름' : '노트북 이름'} value={notebookTitle} onChange={(event) => setNotebookTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createNotebook(); }} helperText="계정 루트의 NOTE MANAGER 아래에 실제 폴더로 생성됩니다." />
        </DialogContent>
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
      <Dialog open={pythonRuntimeOpen} onClose={() => setPythonRuntimeOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>Python 기본 패키지</DialogTitle>
        <DialogContent dividers>
          {pythonRuntimeLoading ? <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 180 }}><CircularProgress /></Box> : <>
            <Typography variant="body2" color="text.secondary">Python {pythonRuntime?.pythonVersion || '3.12'} · 런타임 {pythonRuntime?.runtimeVersion || '-'} · {pythonRuntime?.packageCount || 0}개 직접 제공 패키지</Typography>
            <Alert severity="info" sx={{ mt: 1.5, borderRadius: 0 }}>패키지는 이미 NAS 실행 이미지에 설치되어 있으므로 코드에서 바로 import하면 됩니다. 실행 중 인터넷 연결과 pip install은 차단됩니다.</Alert>
            {[...new Set((pythonRuntime?.packages || []).map((item) => item.category))].map((category) => <Box key={category} sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{category}</Typography>
              <Stack direction="row" gap={0.75} flexWrap="wrap">{(pythonRuntime?.packages || []).filter((item) => item.category === category).map((item) => <Chip key={item.name} variant="outlined" label={`${item.name} ${item.version} · import ${item.imports.join(', ')}`} />)}</Stack>
            </Box>)}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{pythonRuntime?.externalPackages?.message}</Typography>
          </>}
        </DialogContent>
        <DialogActions><Button onClick={() => setPythonRuntimeOpen(false)}>닫기</Button></DialogActions>
      </Dialog>
      <CodePreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} language={selected?.type === 'markdown' ? 'markdown' : selected?.language} title={selected?.title} source={plainContent} />
      <NasItemPickerDialog open={attachmentPickerOpen} onClose={() => setAttachmentPickerOpen(false)} onSelect={addAttachment} title="노트에 NAS 항목 첨부" confirmLabel="첨부" allowCurrentFolder />
      <NasItemPickerDialog open={officeLocationPickerOpen} onClose={() => setOfficeLocationPickerOpen(false)} onSelect={chooseOfficeDestination} title="새 문서를 저장할 NAS 폴더" confirmLabel="여기에 만들기" folderOnly allowCurrentFolder />
    </Box>
  );
};

export default NoteStudio;
