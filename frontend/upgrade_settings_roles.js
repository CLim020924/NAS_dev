const fs = require('fs');
const path = './src/components/Settings.js';

const newCode = `import React, { useState, useEffect } from 'react';
import { Box, Typography, Paper, Button, Switch, FormControlLabel, Tabs, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Select, MenuItem, Chip, IconButton, TextField, InputAdornment } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import SearchIcon from '@mui/icons-material/Search';
import axios from 'axios';
import { useCustomTheme } from '../contexts/ThemeContext';

const Settings = () => {
  const { themeName, setThemeName } = useCustomTheme();
  const [activeTab, setActiveTab] = useState(0);
  const [showExt, setShowExt] = useState(localStorage.getItem('nas_show_extensions') === 'true');
  const [globalFileAccess, setGlobalFileAccess] = useState(false);
  
  const [pendingUsers, setPendingUsers] = useState([]);
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState(''); // 🔥 검색어 상태

  const currentUser = JSON.parse(localStorage.getItem('user')) || { role: 'USER', username: '' };
  const isMaster = currentUser.role === 'MASTER' || currentUser.Masters;
  const isManager = currentUser.role === 'MANAGER' || currentUser.Managers || isMaster;

  // 🔥 [실시간 동기화] 5초마다 백엔드를 찔러서 새로운 대기자/권한 변동을 가져옴 (새로고침 불필요!)
  useEffect(() => {
    let interval;
    if (activeTab === 2 && isManager) {
      const fetchData = () => {
        axios.get('/api/users/data', { withCredentials: true })
          .then(res => {
            if (res.data) {
              setUsers(res.data.users || []);
              setPendingUsers(res.data.pendingUsers || []);
              setGlobalFileAccess(res.data.settings?.globalFileAccess || false);
            }
          })
          .catch(err => console.error("DB 로드 실패:", err));
      };
      
      fetchData(); // 처음 탭을 열었을 때 즉시 실행
      interval = setInterval(fetchData, 5000); // 5초마다 자동 갱신
    }
    return () => clearInterval(interval); // 탭을 닫으면 감시 종료
  }, [activeTab, isManager]);

  const handleTabChange = (event, newValue) => setActiveTab(newValue);

  const handleExtToggle = (e) => {
    const val = e.target.checked;
    setShowExt(val);
    localStorage.setItem('nas_show_extensions', val);
    window.dispatchEvent(new Event('nas_settings_changed'));
  };

  const handleGlobalAccessToggle = (e) => {
    const val = e.target.checked;
    setGlobalFileAccess(val);
    localStorage.setItem('nas_global_file_access', val);
    axios.put('/api/users/update', { settings: { globalFileAccess: val } }, { withCredentials: true })
      .catch(err => alert("DB 업데이트 실패: " + err.message));
  };

  const handleUserUpdate = (updatedUsers) => {
    // 낙관적 UI 업데이트 (화면에 먼저 반영)
    setUsers(updatedUsers);
    // 백엔드 영구 저장
    axios.put('/api/users/update', { users: updatedUsers }, { withCredentials: true })
      .catch(err => alert("DB 업데이트 실패: " + err.message));
  };

  // 🔥 [검색 및 3단 분리 로직]
  const filteredUsers = users.filter(u => u.username.toLowerCase().includes(searchQuery.toLowerCase()));
  const masters = filteredUsers.filter(u => u.role === 'MASTER');
  const managers = filteredUsers.filter(u => u.role === 'MANAGER');
  const normalUsers = filteredUsers.filter(u => u.role === 'USER');

  // 표(Table)를 찍어내는 공장 함수 (코드 중복 방지)
  const renderUserTable = (userList, bgColor, titleColor) => (
    <TableContainer component={Paper} elevation={1} sx={{ mb: 4, border: \`1px solid \${bgColor}\` }}>
      <Table size="small">
        <TableHead sx={{ backgroundColor: bgColor }}>
          <TableRow><TableCell sx={{ color: titleColor, fontWeight: 'bold' }}>아이디</TableCell><TableCell sx={{ color: titleColor, fontWeight: 'bold' }}>권한 변경</TableCell><TableCell sx={{ color: titleColor, fontWeight: 'bold' }}>루트 경로 지정</TableCell><TableCell align="center" sx={{ color: titleColor, fontWeight: 'bold' }}>삭제</TableCell></TableRow>
        </TableHead>
        <TableBody>
          {userList.length === 0 ? <TableRow><TableCell colSpan={4} align="center">해당하는 사용자가 없습니다.</TableCell></TableRow> : 
            userList.map((u) => (
              <TableRow key={u.id}>
                <TableCell sx={{ fontWeight: 'bold' }}>
                  {u.username} 
                  {currentUser.username === u.username && <Chip label="나" size="small" color="primary" sx={{ ml: 1, height: 20 }}/>}
                  {u.username === 'admin' && <Chip label="절대자" size="small" color="error" sx={{ ml: 1, height: 20 }}/>}
                </TableCell>
                <TableCell>
                  <Select size="small" value={u.role} disabled={!isMaster || u.username === 'admin'} onChange={(e) => handleUserUpdate(users.map(user => user.id === u.id ? { ...user, role: e.target.value } : user))} sx={{ width: 120 }}>
                    {isMaster && <MenuItem value="MASTER">마스터</MenuItem>}
                    <MenuItem value="MANAGER">관리자</MenuItem>
                    <MenuItem value="USER">일반 사용자</MenuItem>
                  </Select>
                </TableCell>
                <TableCell><input type="text" defaultValue={u.rootPath} onBlur={(e) => handleUserUpdate(users.map(user => user.id === u.id ? { ...user, rootPath: e.target.value } : user))} style={{ padding: '5px', width: '100%', borderRadius: '4px', border: '1px solid #ccc' }} disabled={!isMaster && u.role === 'MASTER'} /></TableCell>
                <TableCell align="center">
                  <IconButton color="error" size="small" disabled={currentUser.username === u.username || u.username === 'admin' || (!isMaster && u.role === 'MASTER')}><DeleteIcon /></IconButton>
                </TableCell>
              </TableRow>
            ))
          }
        </TableBody>
      </Table>
    </TableContainer>
  );

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, height: '100%', overflowY: 'auto', backgroundColor: themeName === 'dark' ? '#0f172a' : (themeName === 'ocean' ? '#e0f2fe' : '#f1f5f9') }}>
      <Typography variant="h4" sx={{ fontWeight: 800, mb: 3, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>
        시스템 설정
      </Typography>

      <Paper elevation={4} sx={{ borderRadius: 3, overflow: 'hidden', backgroundColor: themeName === 'dark' ? '#1e293b' : '#ffffff' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8fafc' }}>
          <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" textColor="primary" indicatorColor="primary" sx={{ px: 2 }}>
            <Tab label={<Typography sx={{ fontWeight: 'bold' }}>전역 설정</Typography>} />
            <Tab label={<Typography sx={{ fontWeight: 'bold' }}>파일 설정</Typography>} />
            <Tab label={<Typography sx={{ fontWeight: 'bold' }}>사용자 관리</Typography>} />
          </Tabs>
        </Box>

        <Box sx={{ p: { xs: 2, md: 4 }, minHeight: '400px' }}>
          {/* 전역 설정 & 파일 설정 생략 (기존과 동일) */}
          {activeTab === 0 && (
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>테마 및 디스플레이</Typography>
              <Box sx={{ p: 3, backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8fafc', borderRadius: 2 }}>
                <Typography variant="body1" sx={{ mb: 2 }}>원하시는 시스템 테마를 선택하세요.</Typography>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <Button variant={themeName === 'light' ? 'contained' : 'outlined'} onClick={() => setThemeName('light')}>밝은 테마 (Light)</Button>
                  <Button variant={themeName === 'dark' ? 'contained' : 'outlined'} onClick={() => setThemeName('dark')} color="secondary">어두운 테마 (Dark)</Button>
                  <Button variant={themeName === 'ocean' ? 'contained' : 'outlined'} onClick={() => setThemeName('ocean')} color="info">오션 블루 (Ocean)</Button>
                </Box>
              </Box>
            </Box>
          )}

          {activeTab === 1 && (
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>파일 시스템 제어</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3, backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8fafc', borderRadius: 2 }}>
                <FormControlLabel control={<Switch checked={showExt} onChange={handleExtToggle} color="primary" />} label={<Typography sx={{ fontWeight: 'bold' }}>알려진 파일 형식의 확장명 표시</Typography>} />
              </Box>
            </Box>
          )}

          {/* 🔥 사용자 관리 탭 🔥 */}
          {activeTab === 2 && (
            <Box>
              {!isManager ? (
                <Box sx={{ p: 5, textAlign: 'center' }}>
                  <Typography variant="h5" color="error" sx={{ fontWeight: 'bold' }}>접근 권한이 없습니다.</Typography>
                </Box>
              ) : (
                <>
                  {isMaster && (
                    <Box sx={{ mb: 4, p: 3, border: '2px solid #ef4444', borderRadius: 2, backgroundColor: themeName === 'dark' ? 'rgba(239,68,68,0.1)' : '#fef2f2' }}>
                      <Typography variant="h6" color="error" sx={{ fontWeight: 'bold', mb: 1 }}>👑 마스터 전용 권한 설정</Typography>
                      <FormControlLabel control={<Switch checked={globalFileAccess} onChange={handleGlobalAccessToggle} color="error" />} label={<Typography sx={{ fontWeight: 'bold' }}>관리자 및 타 사용자의 '자신의 경로 외 파일 열기/다운로드' 허용</Typography>} />
                    </Box>
                  )}

                  {/* 승인 대기자 목록 */}
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, mt: 4, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>
                    가입 승인 대기자 <Chip label={pendingUsers.length + "명"} color="error" size="small" sx={{ ml: 1 }} />
                  </Typography>
                  <TableContainer component={Paper} elevation={1} sx={{ mb: 5 }}>
                    <Table size="small">
                      <TableHead sx={{ backgroundColor: themeName === 'dark' ? '#334155' : '#f1f5f9' }}>
                        <TableRow><TableCell>아이디</TableCell><TableCell>이름</TableCell><TableCell>가입일</TableCell><TableCell align="center">승인 / 거절</TableCell></TableRow>
                      </TableHead>
                      <TableBody>
                        {pendingUsers.length === 0 ? <TableRow><TableCell colSpan={4} align="center">대기자가 없습니다.</TableCell></TableRow> : 
                          pendingUsers.map((p) => (
                            <TableRow key={p.id}>
                              <TableCell>{p.username}</TableCell><TableCell>{p.name}</TableCell><TableCell>{p.date}</TableCell>
                              <TableCell align="center">
                                <IconButton color="success" size="small"><CheckCircleIcon /></IconButton>
                                <IconButton color="error" size="small"><CancelIcon /></IconButton>
                              </TableCell>
                            </TableRow>
                          ))
                        }
                      </TableBody>
                    </Table>
                  </TableContainer>

                  {/* 등록된 사용자 헤더 & 검색창 */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', color: themeName === 'dark' ? '#fff' : '#1e293b' }}>등록된 사용자 관리</Typography>
                    <TextField 
                      size="small" 
                      placeholder="아이디 검색..." 
                      variant="outlined" 
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon /></InputAdornment>) }}
                      sx={{ backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.05)' : '#fff', borderRadius: 1 }}
                    />
                  </Box>

                  {/* 계급별 3단 표 렌더링 */}
                  <Typography variant="subtitle2" sx={{ mb: 1, color: '#ef4444', fontWeight: 'bold' }}>👑 마스터 계정 (MASTER)</Typography>
                  {renderUserTable(masters, themeName === 'dark' ? 'rgba(239,68,68,0.2)' : '#fee2e2', '#b91c1c')}

                  <Typography variant="subtitle2" sx={{ mb: 1, color: '#f59e0b', fontWeight: 'bold' }}>🛡️ 관리자 계정 (MANAGER)</Typography>
                  {renderUserTable(managers, themeName === 'dark' ? 'rgba(245,158,11,0.2)' : '#fef3c7', '#b45309')}

                  <Typography variant="subtitle2" sx={{ mb: 1, color: '#3b82f6', fontWeight: 'bold' }}>👤 일반 사용자 (USER)</Typography>
                  {renderUserTable(normalUsers, themeName === 'dark' ? 'rgba(59,130,246,0.2)' : '#dbeafe', '#1d4ed8')}

                </>
              )}
            </Box>
          )}
        </Box>
      </Paper>
    </Box>
  );
};

export default Settings;
\`;

fs.writeFileSync(path, newCode);
console.log("✅ 프론트엔드: 계급별 3단 분리 및 실시간 감시 레이더 탑재 완료!");
