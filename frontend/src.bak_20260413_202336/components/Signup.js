import React, { useState } from 'react';
import { Container, TextField, Button, Typography, Box } from '@mui/material';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

// 현재 호스트에 따라 백엔드 URL 분기 처리
const hostname = window.location.hostname;
const backendUrl =
  hostname === 'localhost' || hostname.startsWith('192.168.')
    ? process.env.REACT_APP_BACKEND_URL_LOCAL
    : process.env.REACT_APP_BACKEND_URL_PROD;
console.log("Using backend URL:", backendUrl);

function Signup() {
  const navigate = useNavigate();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSignup = () => {
    axios.post(`/api/signup-request`, { id, password, passwordConfirm })
      .then(response => {
        // alert 메시지 표시 후 로그인 페이지로 이동
        alert("회원가입 요청을 보냈습니다.");
        navigate('/login');
      })
      .catch(err => {
        setError(err.response?.data?.error || '회원가입 실패');
      });
  };

  return (
    <Container maxWidth="sm" sx={{ mt: 4 }}>
      <Typography variant="h4" align="center" gutterBottom>
        회원가입
      </Typography>
      {error && <Typography color="error" align="center">{error}</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label="아이디"
          value={id}
          onChange={(e) => setId(e.target.value)}
          fullWidth
        />
        <TextField
          label="비밀번호"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
        />
        <TextField
          label="비밀번호 확인"
          type="password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          fullWidth
        />
        <Button variant="contained" onClick={handleSignup}>
          회원가입 요청
        </Button>
      </Box>
    </Container>
  );
}

export default Signup;
