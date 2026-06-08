import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import axios from 'axios';

// 환경 변수 기반 백엔드 URL 분기 처리
const hostname = window.location.hostname;
const backendUrl =
  hostname === 'localhost' || hostname.startsWith('192.168.')
    ? process.env.REACT_APP_BACKEND_URL_LOCAL
    : process.env.REACT_APP_BACKEND_URL_PROD;

console.log("Using backend URL in PrivateRoute:", backendUrl);

function PrivateRoute({ children }) {
  const [authorized, setAuthorized] = useState(null);
  const user = JSON.parse(localStorage.getItem('user'));

  useEffect(() => {
    if (!user) {
      setAuthorized(false);
      return;
    }
    // withCredentials 옵션을 추가하여 쿠키가 함께 전송되도록 함
    axios.get(`/api/members`, { withCredentials: true })
      .then(response => {
        // localStorage의 사용자와 백엔드에 저장된 사용자 목록을 비교하여 유효성 체크
        const validUser = response.data.find(u => u.id === user.id);
        setAuthorized(!!validUser);
      })
      .catch(err => {
        console.error("세션 검증 에러:", err);
        setAuthorized(false);
      });
  }, [user]);

  if (authorized === null) return <div>Loading...</div>;
  if (!authorized) return <Navigate to="/login" />;
  return children;
}

export default PrivateRoute;
