import React from 'react';
import { Box, Typography, Paper, Divider, Alert } from '@mui/material';

const Admin = () => {
  return (
    <Box sx={{ p: 4, height: '100%', background: '#fef2f2' }}>
      <Paper elevation={3} sx={{ p: 4, borderRadius: 2, maxWidth: 1000, mx: 'auto', borderTop: '5px solid #ef4444' }}>
        <Typography variant="h5" sx={{ fontWeight: 900, mb: 2, color: 'error.main' }}>
          마스터 관리자 도구
        </Typography>
        <Alert severity="error" sx={{ mb: 3, fontWeight: 'bold' }}>
          최고 관리자(임찬영 - 202204027) 전용 공간입니다. 시스템 핵심 데이터에 접근하므로 주의가 필요합니다.
        </Alert>
        <Divider sx={{ mb: 3 }} />
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          이곳에서 전체 사용자 목록 조회, 권한(마스터/일반) 부여 및 회수, 전체 시스템 로그 확인 등의 작업을 수행할 수 있습니다.
        </Typography>
      </Paper>
    </Box>
  );
};

export default Admin;

