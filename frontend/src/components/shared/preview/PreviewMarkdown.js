import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PreviewMarkdown = ({ text = '' }) => <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>;

export default PreviewMarkdown;
