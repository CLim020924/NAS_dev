import React, { useState, useEffect } from 'react';
import { Container, Typography, List, ListItem, ListItemText, Button, Stack, useTheme } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const hostname = window.location.hostname;
const backendUrl =
  hostname === 'localhost' || hostname.startsWith('192.168.')
    ? process.env.REACT_APP_BACKEND_URL_LOCAL
    : process.env.REACT_APP_BACKEND_URL_PROD;

function AdminMembers() {
  const theme = useTheme();
  const [members, setMembers] = useState([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem('user'));

  const fetchMembers = () => {
    axios.get(`/api/members`)
      .then(response => {
        setMembers(response.data);
        setError('');
      })
      .catch(err => {
        setError(err.response?.data?.error || '회원 목록 불러오기 실패');
      });
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const logoutCurrentUser = () => {
    axios.post(`/api/logout`, { id: currentUser.id })
      .then(() => {
        localStorage.removeItem('user');
        navigate('/login', { state: { message: '계정이 관리자로 인해 비활성화/삭제 되었습니다.' } });
      })
      .catch(() => {
        localStorage.removeItem('user');
        navigate('/login', { state: { message: '계정이 관리자로 인해 비활성화/삭제 되었습니다.' } });
      });
  };

const handleToggle = (memberId, isDisabled) => {
  if (memberId === currentUser.id) {
    alert("자신의 계정을 비활성화/활성화할 수 없습니다.");
    return;
  }
  
  const target = members.find(m => m.id === memberId);
  if (!target) {
    alert("대상 회원을 찾을 수 없습니다.");
    return;
  }
  
  // 디버깅: 현재 로그인한 사용자와 대상 회원의 정보를 출력
  console.log("현재 로그인한 사용자:", currentUser);
  console.log("대상 회원:", target);
  
  // 마스터 계정은 보호: 대상 회원이 마스터 계정이면 작업 불가.
  if (target.Masters === true) {
    alert("마스터 계정은 작업할 수 없습니다.");
    return;
  }
  
  // 관리자 계정(Managers: true, Masters: false)인 경우, 요청자(currentUser)가 마스터 계정이어야 함.
  if (target.Managers === true && currentUser.Masters !== true) {
    alert("관리자 계정은 마스터 계정만 활성화/비활성화할 수 있습니다.");
    return;
  }
  
  // 토글 요청: 현재 활성 상태이면 비활성화, 비활성 상태이면 활성화 요청
  if (!isDisabled) {
    // 활성 상태 -> 비활성화 요청 (DELETE)
    axios.delete(`/api/members/${memberId}`, {
      data: { requesterId: currentUser.id }
    })
    .then(() => {
      fetchMembers();
    })
    .catch(err => {
      setError(err.response?.data?.error || '회원 비활성화 실패');
    });
  } else {
    // 비활성 상태 -> 활성화 요청 (PUT)
    axios.put(`/api/members/${memberId}/enable`, { requesterId: currentUser.id })
    .then(() => {
      fetchMembers();
    })
    .catch(err => {
      setError(err.response?.data?.error || '회원 활성화 실패');
    });
  }
};
  const handleDelete = (memberId) => {
    const target = members.find(m => m.id === memberId);
    if (!target) {
      alert("대상 회원을 찾을 수 없습니다.");
      return;
    }
    if (target.Masters === true) {
      alert("마스터 계정은 삭제할 수 없습니다.");
      return;
    }
    if (target.Managers === true && target.Masters === false && currentUser.Masters !== true) {
      alert("관리자 계정은 마스터 계정만 삭제할 수 있습니다.");
      return;
    }
    axios.delete(`/api/members/${memberId}/permanent`, {
      data: { requesterId: currentUser.id }
    })
    .then(() => {
      if (memberId === currentUser.id) {
        logoutCurrentUser();
      } else {
        alert("관리자로 인해 계정이 삭제되었습니다.");
        fetchMembers();
      }
    })
    .catch(err => {
      setError(err.response?.data?.error || '회원 삭제 실패');
    });
  };

  const handleLogout = (memberId) => {
    if (memberId === currentUser.id) {
      logoutCurrentUser();
      return;
    }
    axios.post(`/api/logout`, { id: memberId, forced: true })
      .then(() => {
        alert("관리자로 인해 대상 회원의 로그아웃 요청이 전달되었습니다.");
        fetchMembers();
      })
      .catch(() => {
        fetchMembers();
      });
  };

  return (
    <Container sx={{ mt: 4, color: 'text.primary' }}>
      <Typography variant="h4" gutterBottom>
        회원 관리
      </Typography>
      {error && <Typography color="error">{error}</Typography>}
      <List>
        {members.map((member, index) => (
          <ListItem key={index} divider>
            <ListItemText 
              primary={`${member.id}${member.disabled ? ' (비활성화됨)' : ''}`}
              secondary={
                member.Managers ? (member.Masters ? "마스터" : "관리자") : "일반 회원"
              }
            />
            {member.isOnline ? (
              <FiberManualRecordIcon sx={{ color: 'success.main', ml: 1 }} />
            ) : (
              <FiberManualRecordIcon sx={{ color: theme.palette.mode === 'dark' ? 'grey.500' : 'error.main', ml: 1 }} />
            )}
            <Stack direction="row" spacing={2} sx={{ ml: 2 }}>
              <Button 
                variant="contained" 
                color={member.disabled ? "success" : "warning"}
                onClick={() => handleToggle(member.id, member.disabled)}
              >
                {member.disabled ? "활성화" : "비활성화"}
              </Button>
              <Button 
                variant="contained" 
                color="error" 
                onClick={() => handleDelete(member.id)}
              >
                계정 삭제
              </Button>
              <Button 
                variant="contained" 
                color="inherit"
                onClick={() => handleLogout(member.id)}
              >
                로그아웃
              </Button>
            </Stack>
          </ListItem>
        ))}
      </List>
      <Button variant="text" onClick={() => navigate('/platform')} sx={{ mt: 2 }}>
        서비스 플랫폼으로 돌아가기
      </Button>
    </Container>
  );
}

export default AdminMembers;
