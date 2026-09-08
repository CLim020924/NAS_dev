import React, { useMemo } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;">`;

const previewDocument = (language, source) => {
  if (language === 'html') return `<!doctype html><html><head>${csp}</head><body>${source}</body></html>`;
  if (language === 'css') return `<!doctype html><html><head>${csp}<style>${source}</style></head><body><main><h1>CSS 미리보기</h1><p>문단과 <a>링크</a>, <button>버튼</button>의 스타일을 확인합니다.</p><section class="card">.card 예시 영역</section></main></body></html>`;
  return '';
};

const CodePreviewDialog = ({ open, language, title, source, onClose }) => {
  const srcDoc = useMemo(() => previewDocument(language, source), [language, source]);
  return <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '82vh' } }}>
    <DialogTitle sx={{ fontWeight: 850, py: 1.25 }}>{title || '미리보기'} <Typography component="span" variant="caption" color="text.secondary">· {language}</Typography></DialogTitle>
    <DialogContent dividers sx={{ p: language === 'markdown' ? 3 : 0, overflow: 'auto' }}>
      {language === 'markdown'
        ? <Box className="note-studio-markdown-preview" sx={{ maxWidth: 920, mx: 'auto', '& img': { maxWidth: '100%' }, '& pre': { overflow: 'auto', p: 1.5, bgcolor: 'action.hover' }, '& table': { borderCollapse: 'collapse' }, '& th, & td': { border: '1px solid', borderColor: 'divider', p: 1 } }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{source || ''}</ReactMarkdown></Box>
        : <Box component="iframe" title={`${title || language} 안전 미리보기`} sandbox="" srcDoc={srcDoc} sx={{ display: 'block', width: '100%', height: '100%', border: 0, bgcolor: '#fff' }} />}
    </DialogContent>
    <DialogActions><Button onClick={onClose}>닫기</Button></DialogActions>
  </Dialog>;
};

export default CodePreviewDialog;
