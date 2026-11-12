import React, { useState } from 'react';
import { Box, CircularProgress, Stack } from '@mui/material';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const PreviewPdf = ({ previewUrl, surfaceWidth, zoom, zoomControls, onError }) => {
  const [pageCount, setPageCount] = useState(0);
  const pageWidth = Math.round(surfaceWidth * zoom);

  return (
    <Box sx={{ width: '100%', height: '100%', overflow: 'auto', bgcolor: '#737373', WebkitOverflowScrolling: 'touch' }}>
      {zoomControls}
      <Document
        file={{ url: previewUrl, withCredentials: true }}
        loading={<Box sx={{ height: 240, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>}
        error={<Box sx={{ p: 4, textAlign: 'center', color: '#fff' }}>PDF 미리보기를 불러오지 못했습니다.</Box>}
        onLoadSuccess={({ numPages }) => setPageCount(numPages || 0)}
        onLoadError={() => onError?.('PDF 미리보기를 불러오지 못했습니다.')}
      >
        <Stack spacing={1.5} alignItems="center" sx={{ p: { xs: 1, sm: 2 }, minWidth: pageWidth + 16 }}>
          {Array.from(new Array(pageCount), (_, index) => (
            <Box key={`pdf-page-${index + 1}`} sx={{ bgcolor: '#fff', boxShadow: 3 }}>
              <Page
                pageNumber={index + 1}
                width={pageWidth}
                renderAnnotationLayer
                renderTextLayer
                loading={<Box sx={{ width: pageWidth, height: 320, display: 'grid', placeItems: 'center' }}><CircularProgress size={24} /></Box>}
              />
            </Box>
          ))}
        </Stack>
      </Document>
    </Box>
  );
};

export default PreviewPdf;
