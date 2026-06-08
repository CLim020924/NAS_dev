import React from 'react';
import { Box, Typography, Divider, List, ListItem, ListItemIcon, ListItemText, useTheme } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import SettingsIcon from '@mui/icons-material/Settings';
import PeopleIcon from '@mui/icons-material/People';
import LogoutIcon from '@mui/icons-material/Logout';

const GlobalSidebar = ({ isSidebarOpen, setSidebarOpen }) => {
  const navigate = useNavigate();
  const theme = useTheme(); // [핵심] 현재 테마 상태를 불러옵니다
  
  const user = JSON.parse(localStorage.getItem('user')) || { 
    name: '임찬영', 
    studentId: '202204027', 
    isMaster: true 
  };

  return (
    <AnimatePresence>
      {isSidebarOpen && (
        <>
          <Box 
            onClick={() => setSidebarOpen(false)} 
            sx={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1200 }} 
          />
          <motion.div
            initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            style={{ 
              position: 'fixed', top: 0, left: 0, width: 300, height: '100vh', 
              // [수정] 하드코딩된 #fff 대신 테마 배경색 사용
              backgroundColor: theme.palette.background.paper, 
              // [수정] 테마에 맞는 구분선 색상 사용
              borderRight: `1px solid ${theme.palette.divider}`, 
              // [수정] 글자색도 테마에 맞춤
              color: theme.palette.text.primary, 
              zIndex: 1300, boxShadow: '5px 0 15px rgba(0,0,0,0.2)', 
              paddingTop: '80px' 
            }}
          >
            <Box sx={{ p: 3, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ textAlign: 'center', mb: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>{user.name}</Typography>
                
              </Box>
              <Divider />
              
              <List sx={{ mt: 2, flex: 1 }}>
                <ListItem button sx={{ borderRadius: 2, mb: 1 }} onClick={() => { setSidebarOpen(false); navigate('/settings'); }}>
                  {/* [수정] 아이콘 색상도 테마 텍스트 색상 따라가게 변경 */}
                  <ListItemIcon sx={{ color: theme.palette.text.secondary }}><SettingsIcon /></ListItemIcon>
                  <ListItemText primary="플랫폼 설정" />
                </ListItem>

                {user.isMaster && (
                  // [수정] 마스터 도구 배경색도 다크모드일 때 너무 튀지 않게 조정
                  <ListItem button sx={{ borderRadius: 2, mb: 1, bgcolor: theme.palette.mode === 'dark' ? 'rgba(239, 68, 68, 0.1)' : '#fef2f2' }} onClick={() => { setSidebarOpen(false); navigate('/admin'); }}>
                    <ListItemIcon><PeopleIcon sx={{ color: '#ef4444' }} /></ListItemIcon>
                    <ListItemText primary={<Typography sx={{ color: '#ef4444', fontWeight: 'bold' }}>마스터 관리자 도구</Typography>} />
                  </ListItem>
                )}
              </List>

              <Divider sx={{ my: 2 }} />
              <ListItem button onClick={() => { localStorage.removeItem('user'); window.location.reload(); }}>
                <ListItemIcon><LogoutIcon color="error" /></ListItemIcon>
                <ListItemText primary="시스템 로그아웃" />
              </ListItem>
            </Box>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default GlobalSidebar;
