import React, { useState, useEffect } from 'react';
import { Container, Typography, List, ListItem, Button } from '@mui/material';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const hostname = window.location.hostname;
const backendUrl =
  hostname === 'localhost' || hostname.startsWith('192.168.')
    ? process.env.REACT_APP_BACKEND_URL_LOCAL
    : process.env.REACT_APP_BACKEND_URL_PROD;

console.log("Using backend URL:", backendUrl);

function AdminSignupRequests() {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const fetchRequests = () => {
    axios.get(`/api/signup-requests`)
      .then(response => {
        setRequests(response.data);
        setError('');
      })
      .catch(err => {
        setError(err.response?.data?.error || '회원가입 요청 불러오기 실패');
      });
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  const handleAccept = (id) => {
    axios.post(`/api/signup-requests/${id}/accept`)
      .then(() => {
        fetchRequests();
      })
      .catch(err => {
        console.error(err);
      });
  };

  const handleReject = (id) => {
    axios.post(`/api/signup-requests/${id}/reject`)
      .then(() => {
        fetchRequests();
      })
      .catch(err => {
        console.error(err);
      });
  };

  return (
    <Container sx={{ mt: 4 }}>
      <Typography variant="h4" gutterBottom>
        회원가입 요청 관리
      </Typography>
      {error && <Typography color="error">{error}</Typography>}
      <List>
        {requests.map((req, index) => (
          <ListItem key={index} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography>{req.id}</Typography>
            <div>
              <Button variant="contained" color="primary" onClick={() => handleAccept(req.id)} sx={{ mr: 1 }}>
                수락
              </Button>
              <Button variant="outlined" color="secondary" onClick={() => handleReject(req.id)}>
                거절
              </Button>
            </div>
          </ListItem>
        ))}
      </List>
      <Button variant="text" onClick={() => navigate('/platform')} sx={{ mt: 2 }}>
        서비스 플랫폼으로 돌아가기
      </Button>
    </Container>
  );
}

export default AdminSignupRequests;
