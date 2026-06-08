import React from 'react';
// [수정] IconButton 추가
import { AppBar, Toolbar, Typography, Button, Box, IconButton } from '@mui/material';
import { useNavigate } from 'react-router-dom';
// [추가] MenuIcon 불러오기
import MenuIcon from '@mui/icons-material/Menu';

function Header({ onMenuClick }) {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem('user'));

  let backgroundColor = '#1976d2';
  if (currentUser) {
    if (currentUser.canCreateMaster) {
      backgroundColor = '#d32f2f';
    } else if (currentUser.isMaster) {
      backgroundColor = '#9c27b0';
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('user');
    navigate('/login');
  };

  return (
    <AppBar position="static" sx={{ backgroundColor }}>
      <Toolbar sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }}>
        

        {/* [추가] 햄버거 버튼: 로그인한 사용자에게만 보여줍니다 */}
        {currentUser && (
          <IconButton
            edge="start"
            color="inherit"
            aria-label="menu"
            onClick={onMenuClick} // 클릭 시 부모(App.js)의 사이드바 토글 함수 실행
            sx={{ mr: 2 }}
          >
            <MenuIcon />
          </IconButton>
        )}
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          My Service Platform
        </Typography>
        {currentUser ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body1">
              {currentUser.id}
            </Typography>
            <Button color="inherit" onClick={() => navigate('/my-info')}>
              내 정보
            </Button>
            <Button color="inherit" onClick={handleLogout}>
              로그아웃
            </Button>
          </Box>
        ) : (
          <Button color="inherit" onClick={() => navigate('/login')}>
            로그인
          </Button>
        )}
      </Toolbar>
    </AppBar>
  );
}

export default Header;
