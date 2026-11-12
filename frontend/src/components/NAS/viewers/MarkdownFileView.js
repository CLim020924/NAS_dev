import React from 'react';
import { Box } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MarkdownFileView = ({ content = '', containerRef, onScroll }) => (
  <Box ref={containerRef} onScroll={onScroll} sx={{ p: 3, overflow: 'auto', height: '100%' }}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
  </Box>
);

export default MarkdownFileView;
