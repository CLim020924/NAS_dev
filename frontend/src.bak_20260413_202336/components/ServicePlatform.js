import React from 'react';
import { Container, Box, Typography, Paper } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import HistoryIcon from '@mui/icons-material/History';
import { useNavigate } from 'react-router-dom';

function ServicePlatform() {
  const navigate = useNavigate();
  
  // 🔥 [수정] 빌드 에러의 원인이었던 user 정의를 확실히 추가합니다.
  const user = JSON.parse(localStorage.getItem('user')) || {};

  return (
    <Container sx={{ mt: 8, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Typography variant="h4" sx={{ fontWeight: 800, mb: 6 }}>
        서비스 플랫폼
      </Typography>
      
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* 📁 기본 NAS 서비스 카드 */}
        <Paper 
          elevation={3} 
          sx={{ 
            width: 200, height: 200, p: 4, display: 'flex', flexDirection: 'column', 
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer', 
            borderRadius: 4, transition: 'transform 0.2s, box-shadow 0.2s', 
            '&:hover': { transform: 'translateY(-5px)', boxShadow: 6 } 
          }}
          onClick={() => navigate('/nas')}
        >
          <FolderIcon sx={{ fontSize: 80, color: 'primary.main', mb: 2 }} />
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>NAS 서비스</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>파일 탐색기</Typography>
        </Paper>

        {/* 🛡️ 마스터/전체권한 전용 백업 보관소 카드 */}
        {(user.role === 'MASTER' || user.Masters || user.globalAccess) && (
          <Paper 
            elevation={3} 
            sx={{ 
              width: 200, height: 200, p: 4, display: 'flex', flexDirection: 'column', 
              alignItems: 'center', justifyContent: 'center', cursor: 'pointer', 
              borderRadius: 4, backgroundColor: '#fff5f5', border: '1px solid #feb2b2',
              transition: 'transform 0.2s, box-shadow 0.2s', 
              '&:hover': { transform: 'translateY(-5px)', boxShadow: 6, borderColor: 'error.main' } 
            }}
            onClick={() => navigate('/nas/backup')}
          >
            <HistoryIcon sx={{ fontSize: 80, color: 'error.main', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>백업 보관소</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>시스템 관리자 전용</Typography>
          </Paper>
        )}
      </Box>
    </Container>
  );
}

export default ServicePlatform;
