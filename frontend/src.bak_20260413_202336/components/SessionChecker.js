import { useEffect, useRef } from 'react';
import axios from 'axios';
import socket from '../socket'; // 반드시 src/socket.js 파일이 존재해야 합니다.

const hostname = window.location.hostname;
const backendUrl =
  hostname === 'localhost' || hostname.startsWith('192.168.')
    ? process.env.REACT_APP_BACKEND_URL_LOCAL
    : process.env.REACT_APP_BACKEND_URL_PROD;
console.log("Using backend URL in SessionChecker:", backendUrl);

function SessionChecker({ setCurrentUser }) {
  const forcedLogoutTriggered = useRef(false);

  useEffect(() => {
    const intervalId = setInterval(() => {
      axios.get(`/api/members`, { withCredentials: true })
        .then(response => {
          console.log("세션 체크 성공:", response.data);
          const members = response.data;
          const storedUser = JSON.parse(localStorage.getItem('user'));
          if (storedUser) {
            const userRecord = members.find(member => member.id === storedUser.id);
            if (!userRecord || userRecord.isOnline === false) {
              if (!forcedLogoutTriggered.current) {
                forcedLogoutTriggered.current = true;
                alert("관리자로 인해 로그아웃 되었습니다.");
                setCurrentUser(null);
                window.location.href = '/login';
              }
            }
          }
        })
        .catch(err => {
          console.error("세션 체크 실패:", err);
        });
    }, 5000);

    // Socket.io 강제 로그아웃 이벤트 리스너
    socket.on('forcedLogout', (data) => {
      if (!forcedLogoutTriggered.current) {
        forcedLogoutTriggered.current = true;
        alert(data.message); // 예: "관리자로 인해 로그아웃 되었습니다."
        setCurrentUser(null);
        window.location.href = '/login';
      }
    });

    return () => {
      clearInterval(intervalId);
      socket.off('forcedLogout');
    };
  }, [setCurrentUser]);

  return null;
}

export default SessionChecker;
