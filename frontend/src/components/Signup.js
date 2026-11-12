import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Container, TextField, Typography } from '@mui/material';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';

function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [inviteToken] = useState(searchParams.get('invite') || '');
  const requestedNext = searchParams.get('next');
  const safeNext = requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/platform';
  const loginPath = `/login?next=${encodeURIComponent(safeNext)}`;

  useEffect(() => {
    if (!searchParams.get('invite')) return;
    const sanitizedUrl = new URL(window.location.href);
    sanitizedUrl.searchParams.delete('invite');
    window.history.replaceState(window.history.state, '', `${sanitizedUrl.pathname}${sanitizedUrl.search}${sanitizedUrl.hash}`);
  }, [searchParams]);

  const handleSignup = async (event) => {
    event?.preventDefault();
    if (submitting) return;

    const loginId = id.trim().toLowerCase();
    setError('');
    if (!loginId || !password || !passwordConfirm) {
      setError('아이디와 비밀번호, 비밀번호 확인을 모두 입력해주세요.');
      return;
    }
    if (password.length < 10) {
      setError('비밀번호는 최소 10자 이상이어야 합니다.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('비밀번호 확인이 일치하지 않습니다.');
      return;
    }

    setSubmitting(true);
    try {
      await axios.post('/api/signup-request', {
        id: loginId,
        password,
        passwordConfirm,
        inviteToken
      }, { withCredentials: true });
      alert('회원가입 요청을 보냈습니다. 관리자가 승인하면 로그인할 수 있습니다.');
      navigate(loginPath, { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || '회원가입 요청을 보내지 못했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container maxWidth="xs" sx={{ mt: { xs: 3, sm: 7 }, px: 2 }}>
      <Box component="form" onSubmit={handleSignup} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ textAlign: 'center', mb: 1 }}>
          <Typography variant="h4" fontWeight={700} gutterBottom>
            회원가입
          </Typography>
          <Typography variant="body2" color="text.secondary">
            가입 요청은 관리자 승인 후 사용할 수 있습니다.
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        <TextField
          label="아이디"
          value={id}
          onChange={(event) => {
            setId(event.target.value.toLowerCase());
            setError('');
          }}
          fullWidth
          autoFocus
          autoComplete="username"
          helperText="소문자 영문, 숫자, 점을 사용할 수 있습니다."
          disabled={submitting}
        />
        <TextField
          label="비밀번호"
          type="password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setError('');
          }}
          fullWidth
          autoComplete="new-password"
          helperText="최소 10자 이상 입력해주세요."
          disabled={submitting}
        />
        <TextField
          label="비밀번호 확인"
          type="password"
          value={passwordConfirm}
          onChange={(event) => {
            setPasswordConfirm(event.target.value);
            setError('');
          }}
          fullWidth
          autoComplete="new-password"
          disabled={submitting}
        />
        <Button type="submit" variant="contained" size="large" disabled={submitting}>
          {submitting ? '요청 보내는 중…' : '관리자에게 가입 요청'}
        </Button>
        <Button type="button" variant="text" onClick={() => navigate(loginPath)} disabled={submitting}>
          이미 계정이 있나요? 로그인
        </Button>
      </Box>
    </Container>
  );
}

export default Signup;
