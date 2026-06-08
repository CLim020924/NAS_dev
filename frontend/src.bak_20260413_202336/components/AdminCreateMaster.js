import React, { useState } from 'react';
import { Container, TextField, Button, Typography, Box } from '@mui/material';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';


const hostname = window.location.hostname;
const backendUrl =
  hostname === 'localhost' || hostname.startsWith('192.168.')
    ? process.env.REACT_APP_BACKEND_URL_LOCAL
    : process.env.REACT_APP_BACKEND_URL_PROD;

console.log("Using backend URL:", backendUrl);

function AdminCreateMaster({ backendUrl, currentUser }) {
  const [newId, setNewId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleCreate = () => {
    if (!newId || !newPassword) {
      setError('아이디와 비밀번호를 모두 입력해주세요.');
      return;
    }
    axios.post(`/api/create-master`, {
      requesterId: currentUser.id,  // 현재 로그인한 계정의 ID, 반드시 마스터여야 함
      id: newId,
      password: newPassword
    })
      .then(response => {
        alert(response.data.message);
        navigate('/admin/members');  // 생성 후 회원 관리 페이지로 이동
      })
      .catch(err => {
        setError(err.response?.data?.error || '관리자 계정 생성 실패');
      });
  };

return (
    <Container maxWidth="sm" sx={{ mt: 4, position: 'relative', minHeight: '80vh' }}>
      <Typography variant="h4" align="center" gutterBottom>
        관리자 계정 생성
      </Typography>
      {error && (
        <Typography color="error" align="center">
          {error}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label="새 관리자 아이디"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          fullWidth
        />
        <TextField
          label="새 관리자 비밀번호"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          fullWidth
        />
        <Button variant="contained" onClick={handleCreate}>
          생성
        </Button>
      </Box>
      {/* 우측 하단에 서비스 플랫폼으로 돌아가기 버튼 */}
      <Box sx={{ position: 'absolute', bottom: 16, left: 2 }}>
        <Button variant="text" onClick={() => navigate('/platform')}>
          서비스 플랫폼으로 돌아가기
        </Button>
      </Box>
    </Container>
  );
}

export default AdminCreateMaster;
