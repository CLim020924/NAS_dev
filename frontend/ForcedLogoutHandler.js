import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import socket from '../socket'; // Socket.io 인스턴스를 불러옵니다.

function ForcedLogoutHandler({ currentUser, setCurrentUser }) {
  const navigate = useNavigate();

  useEffect(() => {
    if (currentUser) {
      // 사용자가 로그인 후 자신의 ID 기반 방에 가입
      socket.emit('join', currentUser.id);
      
      // forcedLogout 이벤트 처리
      socket.on('forcedLogout', (data) => {
        console.log('forcedLogout 이벤트 수신:', data);
        if (data.id === currentUser.id) {
          alert(data.message);
          setCurrentUser(null);
          // 저장소에서 사용자 정보 삭제 (예: localStorage 또는 sessionStorage)
          localStorage.removeItem('user');
          // 로그인 페이지로 이동
          navigate('/login', { state: { message: data.message } });
        }
      });
    }

    // 클린업: 컴포넌트 언마운트 시 이벤트 리스너 제거
    return () => {
      socket.off('forcedLogout');
    };
  }, [currentUser, navigate, setCurrentUser]);

  return null; // UI는 렌더링하지 않고, 전역 이벤트 핸들러로만 사용합니다.
}

export default ForcedLogoutHandler;
