import React from 'react';
import { Box, Button, Chip, Container, Paper, Stack, Typography } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import HistoryIcon from '@mui/icons-material/History';
import DesktopWindowsIcon from '@mui/icons-material/DesktopWindows';
import SettingsIcon from '@mui/icons-material/Settings';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { alpha, useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';

function ServicePlatform() {
  const navigate = useNavigate();
  const theme = useTheme();
  const user = JSON.parse(localStorage.getItem('user')) || {};
  const canOpenBackup = user.role === 'MASTER' || user.Masters || user.globalAccess;

  const serviceCards = [
    {
      title: 'NAS 파일',
      description: '저장소, PC 연동 폴더, 파일 창을 관리합니다.',
      icon: FolderIcon,
      color: theme.palette.primary.main,
      action: '열기',
      onClick: () => navigate('/nas')
    },
    {
      title: 'PC 연동',
      description: '설치된 Sync Agent와 연결된 폴더를 확인합니다.',
      icon: DesktopWindowsIcon,
      color: theme.palette.secondary.main,
      action: 'NAS에서 설정',
      onClick: () => navigate('/nas')
    },
    {
      title: '설정',
      description: '계정, 테마, 파일 표시 방식을 조정합니다.',
      icon: SettingsIcon,
      color: theme.palette.info.main,
      action: '설정 열기',
      onClick: () => navigate('/settings')
    }
  ];

  if (canOpenBackup) {
    serviceCards.push({
      title: '백업 보관소',
      description: '관리자용 백업 저장소로 이동합니다.',
      icon: HistoryIcon,
      color: theme.palette.error.main,
      action: '백업 열기',
      onClick: () => navigate('/nas/backup')
    });
  }

  return (
    <Box sx={{ minHeight: '100%', bgcolor: 'background.default', overflow: 'auto' }}>
      <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 5 } }}>
        <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', gap: 2, mb: 3, flexDirection: { xs: 'column', sm: 'row' } }}>
          <Box>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900 }}>Workspace</Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, fontSize: { xs: '1.7rem', sm: '2.2rem' } }}>
              {user.displayName || user.username || 'NAS'}님의 작업 허브
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              파일 관리와 PC 연동을 한 화면에서 시작합니다.
            </Typography>
          </Box>
          <Button variant="contained" size="large" endIcon={<ArrowForwardIcon />} onClick={() => navigate('/nas')}>
            NAS 열기
          </Button>
        </Box>

        <Paper
          elevation={0}
          sx={{
            p: { xs: 2, sm: 3 },
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 2,
            mb: 3,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.2fr 0.8fr' },
            gap: 2.5,
            bgcolor: 'background.paper'
          }}
        >
          <Box>
            <Chip size="small" label="Ready" color="success" sx={{ mb: 2, fontWeight: 800 }} />
            <Typography variant="h5" sx={{ fontWeight: 900, mb: 1 }}>
              파일을 열고, PC 폴더를 연결하고, 변경사항을 바로 관리하세요.
            </Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 640 }}>
              새 NAS 화면은 상단 작업바와 좌측 탐색을 중심으로 구성되어 파일 작업 중 필요한 버튼을 계속 찾지 않아도 됩니다.
            </Typography>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
            {[
              ['빠른 실행', '상단 작업바'],
              ['모바일', '하단 액션'],
              ['연동 PC', '계정별 표시'],
              ['파일 창', '오버레이 유지']
            ].map(([label, value]) => (
              <Box key={label} sx={{ p: 1.5, borderRadius: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.06) }}>
                <Typography variant="caption" color="text.secondary">{label}</Typography>
                <Typography sx={{ fontWeight: 900 }}>{value}</Typography>
              </Box>
            ))}
          </Box>
        </Paper>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' }, gap: 2 }}>
          {serviceCards.map(({ title, description, icon: Icon, color, action, onClick }) => (
            <Paper
              key={title}
              elevation={0}
              onClick={onClick}
              sx={{
                p: 2,
                minHeight: 184,
                borderRadius: 2,
                border: `1px solid ${theme.palette.divider}`,
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'transform 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  borderColor: alpha(color, 0.44),
                  boxShadow: `0 18px 48px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.28 : 0.10)}`
                }
              }}
            >
              <Stack spacing={1.5}>
                <Box sx={{ width: 46, height: 46, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: alpha(color, 0.10), color }}>
                  <Icon />
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 900 }}>{title}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{description}</Typography>
                </Box>
              </Stack>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 2 }}>
                <Typography variant="button" sx={{ color, fontWeight: 900 }}>{action}</Typography>
                <ArrowForwardIcon sx={{ color }} fontSize="small" />
              </Box>
            </Paper>
          ))}
        </Box>
      </Container>
    </Box>
  );
}

export default ServicePlatform;
