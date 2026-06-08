import React, { useEffect, useState } from 'react';

function FileViewer({ fileUrl, fileName }) {
  const ext = fileName.split('.').pop().toLowerCase();


  // 텍스트/코드 파일인 경우: 파일 내용을 fetch해서 보여줌
  const [textContent, setTextContent] = useState('');
  useEffect(() => {
    if (['txt', 'js', 'css', 'html', 'json', 'md'].includes(ext)) {
      fetch(fileUrl)
        .then(res => res.text())
        .then(text => setTextContent(text))
        .catch(err => setTextContent('Error loading file.'));
    }
  }, [fileUrl, ext]);

  if (['txt', 'js', 'css', 'html', 'json', 'md'].includes(ext)) {
    return (
      <pre style={{ whiteSpace: 'pre-wrap', overflow: 'auto', height: '100%' }}>
        {textContent}
      </pre>
    );
  } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg'].includes(ext)) {
    return <img src={fileUrl} alt={fileName} style={{ maxWidth: '100%', maxHeight: '100%' }} />;
  } else if (['mp3', 'wav', 'ogg'].includes(ext)) {
    return <audio controls src={fileUrl} style={{ width: '100%' }} />;
  } else if (['mp4', 'webm', 'ogg'].includes(ext)) {
    return <video controls src={fileUrl} style={{ maxWidth: '100%', maxHeight: '100%' }} />;
  } else if (ext === 'pdf') {
    return <iframe src={fileUrl} style={{ width: '100%', height: '100%' }} title={fileName} />;
  } else if (['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(ext)) {
    const encodedUrl = encodeURIComponent(fileUrl);
    const viewerUrl = `https://docs.google.com/gview?url=${encodedUrl}&embedded=true`;
    return <iframe src={viewerUrl} style={{ width: '100%', height: '100%' }} title={fileName} />;
  } else if (ext === 'hwp') {
    return <div>HWP 파일은 지원되지 않습니다.</div>;
  } else {
    return <div>지원되지 않는 파일 형식입니다.</div>;
  }
}

export default FileViewer;
