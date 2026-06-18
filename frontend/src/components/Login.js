import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Container,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import { AccountCircle, Lock, Visibility, VisibilityOff } from '@mui/icons-material';
import { alpha, useTheme } from '@mui/material/styles';
import { motion } from 'framer-motion';

const Login = () => {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const theme = useTheme();

  const handleLogin = () => {
    setError('');
    axios.post('/api/login', { id, password }, { withCredentials: true })
      .then(response => {
        localStorage.setItem('user', JSON.stringify(response.data.user));
        window.dispatchEvent(new Event('nas:user-updated'));
        const next = searchParams.get('next');
        navigate(next || '/platform');
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
        bgcolor: 'background.default',
        backgroundImage: theme.palette.mode === 'dark'
          ? 'linear-gradient(180deg, rgba(125,211,252,0.08), transparent 42%)'
          : 'linear-gradient(180deg, rgba(37,99,235,0.07), transparent 44%)',
        px: 2,
        py: { xs: 3, sm: 6 }
      }}
    >
      <Container maxWidth="xs" disableGutters>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Paper
            elevation={0}
            sx={{
              p: { xs: 3, sm: 4 },
              borderRadius: 2,
              border: `1px solid ${theme.palette.divider}`,
              boxShadow: theme.palette.mode === 'dark'
                ? '0 24px 70px rgba(0,0,0,0.34)'
                : '0 24px 70px rgba(15,23,42,0.10)'
            }}
          >
            <Stack spacing={3}>
              <Stack spacing={1.5} alignItems="center">
                <Box
                  component="img"
                  src="/logo192.png"
                  alt="NAS"
                  sx={{
                    width: 64,
                    height: 64,
                    objectFit: 'contain',
                    borderRadius: 2,
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    p: 1
                  }}
                />
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" sx={{ color: 'text.primary' }}>
                    NAS
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    계정으로 저장소에 접속합니다
                  </Typography>
                </Box>
              </Stack>

              {error && <Alert severity="error">{error}</Alert>}

              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label="User ID"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                  autoComplete="username"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <AccountCircle color="primary" />
                      </InputAdornment>
                    )
                  }}
                />

                <TextField
                  fullWidth
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  autoComplete="current-password"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <Lock color="primary" />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                          onClick={() => setShowPassword(!showPassword)}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    )
                  }}
                />
              </Stack>

              <Stack spacing={1.25}>
                <Button fullWidth variant="contained" size="large" onClick={handleLogin}>
                  Sign In
                </Button>
                <Button fullWidth variant="text" onClick={() => navigate('/signup')}>
                  Create an account
                </Button>
              </Stack>
            </Stack>
          </Paper>
        </motion.div>
      </Container>
    </Box>
  );
};

export default Login;
