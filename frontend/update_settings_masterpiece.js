const fs = require('fs');
const path = './src/components/Settings.js';

const newSettingsCode = `import React, { useState, useEffect } from 'react';
import { Box, Typography, Paper, Button, Switch, FormControlLabel, Divider, Tabs, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Select, MenuItem, Chip, IconButton } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { useCustomTheme } from '../contexts/ThemeContext';

const Settings = () => {
  const { themeName, setThemeName } = useCustomTheme(); // 테마 변경 함수 (가정)
  const [activeTab, setActiveTab] = useState(0);
  const [showExt, setShowExt] = useState(localStorage.getItem('nas_show_extensions') === 'true');

  // 현재 접속한 사용자 정보 가져오기
  const currentUser = JSON.parse(localStorage.getItem('user')) || { role: 'USER' };
  const isMaster = currentUser.role === 'MASTER';
  const isManager = currentUser.role === 'MANAGER' || isMaster;

  // 마스터 전용: 타인 파일 접근 허용 토글
  const [globalFileAccess, setGlobalFileAccess] = useState(localStorage.getItem('nas_global_file_access') === 'true');

  // (임시) 가입 승인 대기자 및 기존 사용자 목록 데이터
  const [pendingUsers, setPendingUsers] = useState([
    { id: 'user_1', username: 'new_student', name: '김신입', date: '2026-03-21' }
  ]);
  const [users, setUsers] = useState([
    { id: '1', username: 'admin', role: 'MASTER', rootPath: '/' },
    { id: '2', username: 'manager1', role: 'MANAGER', rootPath: '/' },
    { id: '3', username: 'user1', role: 'USER', rootPath: '/USERS/user1' }
  ]);

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
    // 실제로는 백엔드 API로 전송해야 함
  };

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
          
          {/* ========================================================= */}
          {/* 0. 전역 설정 (테마 3종 복구) */}
          {/* ========================================================= */}
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

          {/* ========================================================= */}
          {/* 1. 파일 설정 */}
          {/* ========================================================= */}
          {activeTab === 1 && (
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>파일 시스템 제어</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3, backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8fafc', borderRadius: 2 }}>
                <FormControlLabel control={<Switch checked={showExt} onChange={handleExtToggle} color="primary" />} label={<Typography sx={{ fontWeight: 'bold' }}>알려진 파일 형식의 확장명 표시</Typography>} />
                <Typography variant="body2" color="textSecondary" sx={{ ml: 4, mt: -1 }}>체크 시 파일의 확장자(.zip, .pdf 등)가 표시되며, 파일 이름을 통해 변경 시 경고창이 나타납니다.</Typography>
              </Box>
            </Box>
          )}

          {/* ========================================================= */}
          {/* 2. 사용자 관리 (마스터/관리자 전용) */}
          {/* ========================================================= */}
          {activeTab === 2 && (
            <Box>
              {!isManager ? (
                <Box sx={{ p: 5, textAlign: 'center' }}>
                  <Typography variant="h5" color="error" sx={{ fontWeight: 'bold' }}>접근 권한이 없습니다.</Typography>
                  <Typography color="textSecondary">이 페이지는 마스터 및 관리자 계정만 열람할 수 있습니다.</Typography>
                </Box>
              ) : (
                <>
                  {/* 마스터 전용 구역 */}
                  {isMaster && (
                    <Box sx={{ mb: 4, p: 3, border: '2px solid #ef4444', borderRadius: 2, backgroundColor: themeName === 'dark' ? 'rgba(239,68,68,0.1)' : '#fef2f2' }}>
                      <Typography variant="h6" color="error" sx={{ fontWeight: 'bold', mb: 1 }}>👑 마스터 전용 권한 설정</Typography>
                      <FormControlLabel 
                        control={<Switch checked={globalFileAccess} onChange={handleGlobalAccessToggle} color="error" />} 
                        label={<Typography sx={{ fontWeight: 'bold' }}>관리자 및 타 사용자의 '자신의 경로 외 파일 열기/다운로드' 허용</Typography>} 
                      />
                      <Typography variant="body2" color="textSecondary" sx={{ ml: 4, mt: -1 }}>
                        주의: 이 기능을 켜면 관리자 계정이 전체 서버의 개인 파일 내용을 읽거나 다운로드할 수 있게 됩니다.
                      </Typography>
                    </Box>
                  )}

                  {/* 승인 대기자 목록 */}
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, mt: 4, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>가입 승인 대기자</Typography>
                  <TableContainer component={Paper} elevation={1} sx={{ mb: 4 }}>
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

                  {/* 등록된 사용자 목록 */}
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>등록된 사용자 관리</Typography>
                  <TableContainer component={Paper} elevation={1}>
                    <Table size="small">
                      <TableHead sx={{ backgroundColor: themeName === 'dark' ? '#334155' : '#f1f5f9' }}>
                        <TableRow><TableCell>아이디</TableCell><TableCell>권한 (Role)</TableCell><TableCell>루트 경로 지정</TableCell><TableCell align="center">삭제</TableCell></TableRow>
                      </TableHead>
                      <TableBody>
                        {users.map((u) => (
                          <TableRow key={u.id}>
                            <TableCell sx={{ fontWeight: 'bold' }}>{u.username} {currentUser.username === u.username && <Chip label="나" size="small" color="primary" sx={{ ml: 1, height: 20 }}/>}</TableCell>
                            <TableCell>
                              <Select size="small" value={u.role} disabled={!isMaster && u.role === 'MASTER'} sx={{ width: 120 }}>
                                {isMaster && <MenuItem value="MASTER">마스터</MenuItem>}
                                <MenuItem value="MANAGER">관리자</MenuItem>
                                <MenuItem value="USER">일반 사용자</MenuItem>
                              </Select>
                            </TableCell>
                            <TableCell><input type="text" defaultValue={u.rootPath} style={{ padding: '5px', width: '100%', borderRadius: '4px', border: '1px solid #ccc' }} disabled={!isMaster && u.role === 'MASTER'} /></TableCell>
                            <TableCell align="center">
                              <IconButton color="error" size="small" disabled={currentUser.username === u.username || (!isMaster && u.role === 'MASTER')}><DeleteIcon /></IconButton>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>

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
`;

fs.writeFileSync(path, newSettingsCode);
console.log("✅ 프론트엔드: 설정 창 대규모 업데이트 (테마 3종, 사용자 관리 UI) 완료!");
