import React, { useState } from 'react';
import { Container, TextField, Button, Typography, Box } from '@mui/material';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

function MyInfo() {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem('user'));
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newId, setNewId] = useState(currentUser.id);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  const handleUpdate = () => {
    // API 호출하여 내 정보 업데이트
    axios.put('http://<BACKEND_URL>/api/update-user', {
      requesterId: currentUser.id,
      currentPassword,
      newId,
      newPassword
    })
      .then(response => {
        alert(response.data.message);
        // 업데이트 후 로그아웃 처리
        localStorage.removeItem('user');
        navigate('/login');
      })
      .catch(err => {
        setError(err.response?.data?.error || '정보 업데이트 실패');
      });
  };

  return (
    <Container maxWidth="sm">
      <Box sx={{ mt: 4 }}>
        <Typography variant="h4" gutterBottom>
          내 정보 수정
        </Typography>
        {error && <Typography color="error">{error}</Typography>}
        <TextField
          label="현재 비밀번호"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="새 아이디"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          fullWidth
          margin="normal"
        />
        <TextField
          label="새 비밀번호"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          fullWidth
          margin="normal"
        />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2 }}>
          <Button variant="outlined" onClick={() => navigate(-1)}>
            뒤로 가기
          </Button>
          <Button variant="contained" onClick={handleUpdate}>
            확인
          </Button>
        </Box>
      </Box>
    </Container>
  );
}

export default MyInfo;
