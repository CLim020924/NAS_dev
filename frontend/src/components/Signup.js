import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Container, TextField, Typography } from '@mui/material';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';

// 현재 호스트에 따라 백엔드 URL 분기 처리
const hostname = window.location.hostname;
const backendUrl =
  hostname === 'localhost' || hostname.startsWith('192.168.')
    ? process.env.REACT_APP_BACKEND_URL_LOCAL
    : process.env.REACT_APP_BACKEND_URL_PROD;
console.log("Using backend URL:", backendUrl);

function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [id, setId] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');
  const [idAvailable, setIdAvailable] = useState(null);
  const [nicknameAvailable, setNicknameAvailable] = useState(null);
  const [capacity, setCapacity] = useState(null);
  const [capacityLoading, setCapacityLoading] = useState(true);
  const requestedNext = searchParams.get('next');
  const safeNext = requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/platform';
  const loginPath = `/login?next=${encodeURIComponent(safeNext)}`;

  const refreshSignupCapacity = async () => {
    try {
      const response = await axios.get('/api/signup-capacity', { withCredentials: true });
      setCapacity(response.data || null);
      return response.data || null;
    } catch (err) {
      setCapacity(null);
      return null;
    } finally {
      setCapacityLoading(false);
    }
  };

  useEffect(() => {
    refreshSignupCapacity();
  }, []);

  const checkIdentity = async (field) => {
    try {
      const response = await axios.get('/api/users/check-identity', { params: { id, nickname } });
      if (field === 'id') setIdAvailable(response.data.idAvailable);
      if (field === 'nickname') setNicknameAvailable(response.data.nicknameAvailable);
      return response.data;
    } catch (err) {
      setError('중복 확인 중 오류가 발생했습니다.');
      return null;
    }
  };

  const handleSignup = async () => {
    setError('');
    const latestCapacity = await refreshSignupCapacity();
    if (latestCapacity && latestCapacity.signupAvailable === false) {
      setError(latestCapacity.reason || '현재 새 계정에 제공할 저장공간이 부족합니다.');
      return;
    }
    if (!id.trim() || !nickname.trim() || !password || !passwordConfirm) {
      setError('아이디, 닉네임, 비밀번호를 모두 입력해주세요.');
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
    const availability = await checkIdentity('id');
    setNicknameAvailable(availability?.nicknameAvailable ?? null);
    if (!availability?.idAvailable || !availability?.nicknameAvailable) {
      setError(!availability?.idAvailable ? '이미 사용 중인 아이디입니다.' : '이미 사용 중인 닉네임입니다.');
      return;
    }

    axios.post(`/api/signup-request`, { id: id.trim(), nickname: nickname.trim(), password, passwordConfirm })
      .then(response => {
        // alert 메시지 표시 후 로그인 페이지로 이동
        alert("회원가입 요청을 보냈습니다.");
        navigate(loginPath);
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
      {capacityLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', my: 2 }}><CircularProgress size={24} /></Box>
      ) : capacity?.signupAvailable === false ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          현재 새 계정의 기본 50GB를 확보할 수 없어 회원가입이 잠시 중단되었습니다. 관리자에게 문의해주세요.
        </Alert>
      ) : (
        <Alert severity="info" sx={{ mb: 2 }}>승인된 계정에는 기본 개인 저장공간 50GB가 제공됩니다.</Alert>
      )}
      {error && <Typography color="error" align="center">{error}</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField
          label="아이디"
          value={id}
          onChange={(e) => { setId(e.target.value); setIdAvailable(null); }}
          fullWidth
          helperText={idAvailable === true ? '사용 가능한 아이디입니다.' : idAvailable === false ? '이미 사용 중인 아이디입니다.' : '로그인에 사용할 고유 아이디입니다.'}
          error={idAvailable === false}
        />
        <Button variant="text" size="small" onClick={() => checkIdentity('id')} disabled={!id.trim()} sx={{ alignSelf: 'flex-end', mt: -1.5 }}>아이디 중복 확인</Button>
        <TextField
          label="닉네임"
          value={nickname}
          onChange={(e) => { setNickname(e.target.value); setNicknameAvailable(null); }}
          fullWidth
          helperText={nicknameAvailable === true ? '사용 가능한 닉네임입니다.' : nicknameAvailable === false ? '이미 사용 중인 닉네임입니다.' : '친구와 채팅에 표시되는 이름입니다.'}
          error={nicknameAvailable === false}
        />
        <Button variant="text" size="small" onClick={() => checkIdentity('nickname')} disabled={!nickname.trim()} sx={{ alignSelf: 'flex-end', mt: -1.5 }}>닉네임 중복 확인</Button>
        <TextField
          label="비밀번호"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          helperText="최소 10자 이상 입력해주세요."
        />
        <TextField
          label="비밀번호 확인"
          type="password"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          fullWidth
        />
        <Button variant="contained" onClick={handleSignup} disabled={capacityLoading || capacity?.signupAvailable === false}>
          회원가입 요청
        </Button>
        <Button variant="text" onClick={() => navigate(loginPath)}>
          이미 계정이 있나요? 로그인
        </Button>
      </Box>
    </Container>
  );
}

export default Signup;
