import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './components/Login';
import Signup from './components/Signup';
import ServicePlatform from './components/ServicePlatform';
import NAS from './components/nas';
import AdminSignupRequests from './components/AdminSignupRequests';
import AdminCreateMaster from './components/AdminCreateMaster';
import AdminMembers from './components/AdminMembers';
import MyInfo from './components/MyInfo';
import PrivateRoute from './components/PrivateRoute';
import Header from './components/Header';
import SessionChecker from './components/SessionChecker';

// 환경에 따른 백엔드 URL 분기 처리
const hostname = window.location.hostname;
const backendUrl =
  hostname === 'localhost' || hostname.startsWith('192.168.')
    ? process.env.REACT_APP_BACKEND_URL_LOCAL
    : process.env.REACT_APP_BACKEND_URL_PROD;
console.log("Using backend URL:", backendUrl);

function App() {
  // 초기 상태는 localStorage에서 읽어오지만, 이후에는 state를 그대로 유지합니다.
  const [currentUser, setCurrentUser] = useState(() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  useEffect(() => {
    if (currentUser) {
      localStorage.setItem('user', JSON.stringify(currentUser));
    } else {
      localStorage.removeItem('user');
    }
  }, [currentUser]);

  return (
    <Router>
      <SessionChecker setCurrentUser={setCurrentUser} />
      {/* Header는 항상 렌더링하여 로그인 상태와 상관없이 상단바를 표시 */}
      <Header currentUser={currentUser} />
      <Routes>
        <Route 
          path="/login" 
          element={<Login setCurrentUser={setCurrentUser} backendUrl={backendUrl} />} 
        />
        <Route 
          path="/signup" 
          element={<Signup backendUrl={backendUrl} />} 
        />
        <Route 
          path="/platform" 
          element={
            <PrivateRoute currentUser={currentUser}>
              <ServicePlatform />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/nas" 
          element={
            <PrivateRoute currentUser={currentUser}>
             <NAS backendUrl={process.env.REACT_APP_BACKEND_URL_LOCAL} />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/admin/signup-requests" 
          element={
            <PrivateRoute currentUser={currentUser}>
              <AdminSignupRequests backendUrl={backendUrl} />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/admin/create-master" 
          element={
            <PrivateRoute currentUser={currentUser}>
              <AdminCreateMaster backendUrl={backendUrl} currentUser={currentUser} />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/admin/members" 
          element={
            <PrivateRoute currentUser={currentUser}>
              <AdminMembers backendUrl={backendUrl} currentUser={currentUser} setCurrentUser={setCurrentUser} />
            </PrivateRoute>
          } 
        />
        <Route 
          path="/my-info" 
          element={
            <PrivateRoute currentUser={currentUser}>
              <MyInfo backendUrl={backendUrl} currentUser={currentUser} setCurrentUser={setCurrentUser} />
            </PrivateRoute>
          } 
        />
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}

export default App;
