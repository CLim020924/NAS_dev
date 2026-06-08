// PDFViewer.js
import React, { useState } from 'react';
import { Document, Page } from 'react-pdf/dist/esm/entry.webpack'; // webpack 엔트리 버전 사용

function PDFViewer({ fileUrl }) {
  const [numPages, setNumPages] = useState(null);

  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
  };

  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <Document file={fileUrl} onLoadSuccess={onDocumentLoadSuccess}>
        {Array.from(new Array(numPages), (el, index) => (
          <Page key={`page_${index + 1}`} pageNumber={index + 1} />
        ))}
      </Document>
    </div>
  );
}

export default PDFViewer;
