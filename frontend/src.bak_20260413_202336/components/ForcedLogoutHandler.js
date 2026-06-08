import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket'; // socket.js에 Socket.io 인스턴스가 있음

function ForcedLogoutHandler({ currentUser, setCurrentUser }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (currentUser) {
      // 로그인 후 자신의 ID 기반 방에 가입
      socket.emit('join', currentUser.id);
      socket.on('forcedLogout', (data) => {
        console.log('forcedLogout 이벤트 수신:', data);
        if (data.id === currentUser.id) {
          alert(data.message); // "관리자로 인해 계정이 정지 되었습니다."
          setCurrentUser(null);
          localStorage.removeItem('user');
          navigate('/login', { state: { message: data.message } });
        }
      });
    }
    return () => {
      socket.off('forcedLogout');
    };
  }, [currentUser, navigate, setCurrentUser]);

  return null;
}

export default ForcedLogoutHandler;
