import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { 
  Box, Button, TextField, Typography, Paper, 
  Container, InputAdornment, IconButton 
} from '@mui/material';
import { AccountCircle, Lock, Visibility, VisibilityOff } from '@mui/icons-material';
import { motion } from 'framer-motion';

const Login = () => {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleLogin = () => {
    // 상대 경로 /api 를 사용하여 undefined 이슈를 원천 차단합니다.
    axios.post('/api/login', { id, password }, { withCredentials: true })
      .then(response => {
        localStorage.setItem('user', JSON.stringify(response.data.user));
        navigate('/platform');
      })
      .catch(err => {
        setError(err.response?.data?.error || '로그인 정보가 올바르지 않습니다.');
      });
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // 세련된 그라데이션 배경 또는 OS 느낌의 배경 이미지
        background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 50%, #93c5fd 100%)',
        backgroundSize: 'cover',
      }}
    >
      <Container maxWidth="xs">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <Paper
            elevation={10}
            sx={{
              p: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              borderRadius: 4,
              // Glassmorphism 효과
              background: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
            }}
          >
            <Box
              component="img"
              src="/logo192.png"
              sx={{ width: 80, mb: 2, filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.1))' }}
            />
            
            <Typography variant="h4" sx={{ mb: 3, fontWeight: 'bold', color: '#1e3a8a' }}>
              NAS Login
            </Typography>

            {error && (
              <Typography color="error" variant="body2" sx={{ mb: 2 }}>
                {error}
              </Typography>
            )}

            <TextField
              fullWidth
              label="User ID"
              margin="normal"
              value={id}
              onChange={(e) => setId(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <AccountCircle color="primary" />
                  </InputAdornment>
                ),
              }}
            />

            <TextField
              fullWidth
              label="Password"
              type={showPassword ? 'text' : 'password'}
              margin="normal"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Lock color="primary" />
                  </InputAdornment>
                ),
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            <Button
              fullWidth
              variant="contained"
              size="large"
              onClick={handleLogin}
              sx={{
                mt: 4,
                mb: 2,
                borderRadius: 2,
                py: 1.5,
                fontSize: '1.1rem',
                textTransform: 'none',
                boxShadow: '0 4px 14px 0 rgba(0,118,255,0.39)',
              }}
            >
              Sign In
            </Button>

            <Button
              fullWidth
              variant="text"
              onClick={() => navigate('/signup')}
              sx={{ textTransform: 'none' }}
            >
              Create an account
            </Button>
          </Paper>
        </motion.div>
      </Container>
    </Box>
  );
};

export default Login;
