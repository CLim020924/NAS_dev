import React, { useState, useEffect } from 'react';
import { Alert, Box, Typography, Paper, Button, Switch, FormControlLabel, Tabs, Tab, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Select, MenuItem, Chip, IconButton, TextField, InputAdornment, useMediaQuery, Grid, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, LinearProgress, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import axios from 'axios';
import { useCustomTheme } from '../contexts/ThemeContext';
import { useWindows } from '../contexts/WindowContext';

const Settings = () => {
  const { themeName, setThemeName } = useCustomTheme();
  const {
    openWindows,
    setOpenWindows,
    focusedContext,
    setFocusedContext,
    fileManagerPath,
    openFolderWindowByPath
  } = useWindows();
  const [activeTab, setActiveTab] = useState(0);
  const [showExt, setShowExt] = useState(localStorage.getItem('nas_show_extensions') === 'true');
  const [appOpenMode, setAppOpenMode] = useState(localStorage.getItem('platform_app_open_mode') || 'window');
  const [loginPersistenceEnabled, setLoginPersistenceEnabled] = useState(false);
  const [loginPersistenceSaving, setLoginPersistenceSaving] = useState(false);
  
  const [pendingUsers, setPendingUsers] = useState([]);
  const [users, setUsers] = useState([]);
  const [storageCapacity, setStorageCapacity] = useState(null);
  const [userManagementError, setUserManagementError] = useState('');
  const [userManagementSaving, setUserManagementSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [targetToDelete, setTargetToDelete] = useState(null);
  const [adminPasswordForDelete, setAdminPasswordForDelete] = useState('');

  const [pendingUserDetailsOpen, setPendingUserDetailsOpen] = useState(false);
  const [selectedPendingUser, setSelectedPendingUser] = useState(null);

  const isMobile = useMediaQuery('(max-width:600px)');
  const currentUser = JSON.parse(localStorage.getItem('user')) || { role: 'USER', username: '' };
  const isMaster = currentUser.role === 'MASTER' || currentUser.Masters;
  const isManager = currentUser.role === 'MANAGER' || currentUser.Managers || isMaster;

  useEffect(() => {
    axios.get('/api/user/preferences', { withCredentials: true })
      .then((res) => setLoginPersistenceEnabled(!!res.data?.loginPersistenceEnabled))
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!isManager && activeTab === 2) {
      setActiveTab(0);
    }
  }, [activeTab, isManager]);

  useEffect(() => {
    let interval;
    if (activeTab === 2 && isManager) {
      axios.get('/api/users/data', { withCredentials: true })
        .then(res => {
          if (res.data) {
            setUsers(res.data.users || []);
            setPendingUsers(res.data.pendingUsers || []);
            setStorageCapacity(res.data.storageCapacity || null);
          }
        })
        .catch(err => setUserManagementError(err.response?.data?.error || '사용자 정보를 불러오지 못했습니다.'));

      interval = setInterval(() => {
        axios.get('/api/users/data', { withCredentials: true })
          .then(res => {
            if (res.data) {
              setPendingUsers(res.data.pendingUsers || []);
              setStorageCapacity(res.data.storageCapacity || null);
            }
          });
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [activeTab, isManager]);

  const refreshUserManagement = async () => {
    const response = await axios.get('/api/users/data', { withCredentials: true });
    setUsers(response.data?.users || []);
    setPendingUsers(response.data?.pendingUsers || []);
    setStorageCapacity(response.data?.storageCapacity || null);
  };

  const handleApprove = async (id) => {
    setUserManagementError('');
    try {
      await axios.post('/api/users/approve', { id }, { withCredentials: true });
      await refreshUserManagement();
    } catch (err) {
      setUserManagementError(err.response?.data?.error || '가입 요청을 승인하지 못했습니다.');
    }
  };
  const handleReject = (id) => axios.post('/api/users/reject', { id }, { withCredentials: true }).then(() => setPendingUsers(prev => prev.filter(p => (p.userUid || p.id) !== id)));

  const handleAppOpenModeChange = (nextMode) => {
    if (nextMode === appOpenMode) return;

    if (appOpenMode === 'window' && nextMode === 'inline') {
      const openFolderWindows = openWindows.filter((win) => win.winType === 'folder');
      if (openFolderWindows.length > 0) {
        const ok = window.confirm('현재 열려 있는 폴더 창이 모두 닫힙니다. 계속하시겠습니까?');
        if (!ok) return;
        setOpenWindows((prev) => prev.filter((win) => win.winType !== 'folder'));
        if (openFolderWindows.some((win) => win.id === focusedContext)) {
          setFocusedContext('desktop');
        }
      }
    }

    if (appOpenMode === 'inline' && nextMode === 'window') {
      openFolderWindowByPath(fileManagerPath || '/', fileManagerPath === '/' ? '내 클라우드' : null);
    }

    setAppOpenMode(nextMode);
    localStorage.setItem('platform_app_open_mode', nextMode);
    window.dispatchEvent(new Event('nas_settings_changed'));
  };

  const handleLoginPersistenceChange = async (nextValue) => {
    setLoginPersistenceEnabled(nextValue);
    setLoginPersistenceSaving(true);
    try {
      await axios.patch('/api/user/preferences', {
        loginPersistenceEnabled: nextValue
      }, { withCredentials: true });
    } catch (err) {
      setLoginPersistenceEnabled(!nextValue);
      alert(err.response?.data?.error || '로그인 유지 설정을 저장하지 못했습니다.');
    } finally {
      setLoginPersistenceSaving(false);
    }
  };
  
  const handleSaveChanges = async () => {
    setUserManagementSaving(true);
    setUserManagementError('');
    try {
      const managedUsers = users.map(u => ({
        userUid: u.userUid,
        id: u.id,
        role: u.role,
        globalAccess: !!u.globalAccess,
        displayName: u.displayName,
        nickname: u.nickname,
        storageQuotaMode: u.storageQuotaMode,
        storageQuotaGb: u.storageQuotaGb,
        storageQuotaBytes: u.storageQuotaBytes
      }));
      const response = await axios.put('/api/users/update', { users: managedUsers }, { withCredentials: true });
      setStorageCapacity(response.data?.storageCapacity || storageCapacity);
      await refreshUserManagement();
      alert('사용자 역할과 저장공간 설정을 저장했습니다.');
    } catch (err) {
      setUserManagementError(err.response?.data?.error || '사용자 설정을 저장하지 못했습니다.');
    } finally {
      setUserManagementSaving(false);
    }
  };

  const handleOpenDelete = (u) => {
    setTargetToDelete(u);
    setAdminPasswordForDelete('');
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!adminPasswordForDelete) return alert("관리자 비밀번호를 입력해주세요.");
    try {
      const res = await axios.post('/api/users/delete', {
        targetId: targetToDelete.userUid || targetToDelete.id,
        adminId: currentUser.userUid || currentUser.id || currentUser.username,
        adminPassword: adminPasswordForDelete
      }, { withCredentials: true });

      if (res.data.success) {
        alert(`[${targetToDelete.username}] 계정이 삭제되었습니다.`);
        setDeleteConfirmOpen(false);
        window.location.reload(); 
      }
    } catch (err) {
      alert(err.response?.data?.error || "삭제에 실패했습니다.");
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return [u.username, u.displayName, u.nickname]
      .filter(Boolean)
      .some(v => String(v).toLowerCase().includes(q));
  });
  const masters = filteredUsers.filter(u => u.role === 'MASTER');
  const managers = filteredUsers.filter(u => u.role === 'MANAGER');
  const normalUsers = filteredUsers.filter(u => u.role === 'USER');

  const formatStorage = (bytes) => {
    if (bytes == null) return '계산 전';
    const gib = Number(bytes || 0) / (1024 * 1024 * 1024);
    return gib >= 1024 ? `${(gib / 1024).toFixed(2)}TB` : `${Math.round(gib * 10) / 10}GB`;
  };
  const getQuotaGbValue = (u) => {
    const bytes = Number(u.storageQuotaBytes || 0);
    return Number.isFinite(bytes) && bytes > 0 ? String(Math.round(bytes / (1024 * 1024 * 1024))) : '50';
  };
  const updateUserStorageQuota = (targetUser, value) => {
    const trimmed = String(value || '').trim();
    const numericValue = Number(trimmed);
    setUsers(users.map(user => user.id === targetUser.id
      ? {
          ...user,
          storageQuotaMode: 'limited',
          storageQuotaGb: Number.isFinite(numericValue) ? Math.max(1, numericValue) : '',
          storageQuotaBytes: Number.isFinite(numericValue) ? Math.max(1, numericValue) * 1024 * 1024 * 1024 : 0
        }
      : user
    ));
  };
  const updateUserRole = (targetUser, nextRole) => {
    setUsers(users.map((user) => user.id === targetUser.id
      ? {
          ...user,
          role: nextRole,
          globalAccess: nextRole === 'MASTER' ? true : (nextRole === 'USER' ? false : user.globalAccess)
        }
      : user));
  };
  const storageUsagePercent = storageCapacity?.totalBytes
    ? Math.min(100, Math.round((Number(storageCapacity.usedBytes || 0) / Number(storageCapacity.totalBytes)) * 100))
    : 0;

  const renderUserTable = (userList) => (
    isMobile ? (
      <Box sx={{ mt: 2 }}>
        {userList.length === 0 ? (
          <Typography align="center" color="text.secondary" sx={{ py: 4 }}>해당 사용자가 없습니다.</Typography>
        ) : (
          userList.map((u) => (
            <Paper key={u.userUid || u.id} elevation={1} sx={{ p: 2, mb: 2, borderRadius: 2, border: themeName === 'dark' ? '1px solid rgba(255,255,255,0.12)' : '1px solid #e2e8f0' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  {u.displayName || u.username} {currentUser.username === u.username && <Chip label="나" size="small" color="primary" sx={{ ml: 1, height: 20 }}/>}
                </Typography>
                <IconButton color="error" size="small" disabled={u.username === 'admin' || currentUser.username === u.username} onClick={() => handleOpenDelete(u)}><DeleteIcon /></IconButton>
              </Box>
              <Grid container spacing={1.5}>
                <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>권한</Typography>
                    <Select size="small" value={u.role} disabled={!isMaster || u.username === 'admin'} onChange={(e) => updateUserRole(u, e.target.value)} fullWidth>
                        {isMaster && <MenuItem value="MASTER">마스터</MenuItem>}
                        <MenuItem value="MANAGER">관리자</MenuItem>
                        <MenuItem value="USER">일반 사용자</MenuItem>
                    </Select>
                </Grid>
                <Grid item xs={12}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">NAS 전체 루트 접근</Typography>
                        <Switch size="small" color="error" checked={u.role === 'MASTER' || u.role === 'MANAGER' || !!u.globalAccess} disabled={!isMaster || u.role === 'MASTER' || u.role === 'MANAGER'}
                          onChange={(e) => {
                            const isGlobal = e.target.checked;
                            setUsers(users.map(user => user.id === u.id ? { ...user, globalAccess: isGlobal } : user));
                          }} 
                        />
                    </Box>
                </Grid>
                <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>개인 공간</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{u.personalRootPath || `/users/${u.username}`}</Typography>
                    {(u.role === 'MASTER' || u.role === 'MANAGER' || u.globalAccess) && <Typography variant="caption" color="primary">개인 공간과 별도로 NAS 전체 루트를 탐색할 수 있습니다.</Typography>}
                </Grid>
                <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>개인 저장공간 할당</Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                      <TextField size="small" type="number" value={getQuotaGbValue(u)} onChange={(e) => updateUserStorageQuota(u, e.target.value)} disabled={!isMaster && u.role !== 'USER'} label="할당량(GB)" inputProps={{ min: 1 }} sx={{ maxWidth: 150 }} />
                      <Typography variant="body2" color="text.secondary">사용 {formatStorage(u.storageUsedBytes)}</Typography>
                    </Box>
                </Grid>
              </Grid>
            </Paper>
          ))
        )}
      </Box>
    ) : (
      <TableContainer component={Paper} elevation={0} sx={{ mt: 2, border: themeName === 'dark' ? '1px solid rgba(255,255,255,0.12)' : '1px solid #e2e8f0', borderRadius: 2 }}>
        <Table size="small">
          <TableHead sx={{ backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.06)' : '#f8fafc' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>아이디</TableCell>
              <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>권한 변경</TableCell>
              <TableCell align="center" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>전체 NAS 접근</TableCell>
              <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>개인 저장공간</TableCell>
              <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>개인 경로</TableCell>
              <TableCell align="center" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>삭제</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {userList.length === 0 ? <TableRow><TableCell colSpan={6} align="center">해당 사용자가 없습니다.</TableCell></TableRow> : 
              userList.map((u) => (
                <TableRow key={u.userUid || u.id} sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                  <TableCell sx={{ fontWeight: 'bold' }}>
                    {u.displayName || u.username} {currentUser.username === u.username && <Chip label="나" size="small" color="primary" sx={{ ml: 1, height: 20 }}/>}
                  </TableCell>
                  <TableCell>
                    <Select size="small" value={u.role} disabled={!isMaster || u.username === 'admin'} onChange={(e) => updateUserRole(u, e.target.value)} sx={{ width: 120 }}>
                      {isMaster && <MenuItem value="MASTER">마스터</MenuItem>}
                      <MenuItem value="MANAGER">관리자</MenuItem>
                      <MenuItem value="USER">일반 사용자</MenuItem>
                    </Select>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title={u.role === 'MASTER' || u.role === 'MANAGER' ? '마스터와 관리자는 역할상 NAS 전체 루트에 접근합니다.' : '마스터가 일반 사용자에게 별도 전체 접근 권한을 부여할 수 있습니다.'}>
                    <Switch size="small" color="error" checked={u.role === 'MASTER' || u.role === 'MANAGER' || !!u.globalAccess} disabled={!isMaster || u.role === 'MASTER' || u.role === 'MANAGER'}
                      onChange={(e) => {
                        const isGlobal = e.target.checked;
                        setUsers(users.map(user => user.id === u.id ? { ...user, globalAccess: isGlobal } : user));
                      }} 
                    />
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TextField size="small" type="number" value={getQuotaGbValue(u)} onChange={(e) => updateUserStorageQuota(u, e.target.value)} disabled={!isMaster && u.role !== 'USER'} inputProps={{ min: 1, 'aria-label': `${u.username} 할당량 GB` }} sx={{ width: 96 }} />
                      <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>GB / 사용 {formatStorage(u.storageUsedBytes)}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{u.personalRootPath || `/users/${u.username}`}</Typography>
                  </TableCell>
                  <TableCell align="center">
                    <IconButton color="error" size="small" disabled={u.username === 'admin' || currentUser.username === u.username} onClick={() => handleOpenDelete(u)}><DeleteIcon /></IconButton>
                  </TableCell>
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
      </TableContainer>
    )
  );

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, height: '100%', overflowY: 'auto', backgroundColor: themeName === 'dark' ? '#0f172a' : (themeName === 'ocean' ? '#e0f2fe' : '#f1f5f9') }}>
      <Typography variant="h4" sx={{ fontWeight: 800, mb: 3 }}>시스템 설정</Typography>
      <Paper elevation={4} sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={isManager ? activeTab : Math.min(activeTab, 1)} onChange={(e, v) => setActiveTab(v)} textColor="primary" indicatorColor="primary" sx={{ px: 2 }}>
            <Tab label="전역 설정" /><Tab label="파일 설정" />{isManager && <Tab label="사용자 관리" />}
          </Tabs>
        </Box>
        <Box sx={{ p: { xs: 2, md: 4 }, minHeight: '400px' }}>
          {activeTab === 0 && (
            <Box>
              <Typography variant="h6" sx={{ mb: 2 }}>일반 설정</Typography>
              <FormControlLabel
                control={(
                  <Switch
                    checked={loginPersistenceEnabled}
                    disabled={loginPersistenceSaving}
                    onChange={(e) => handleLoginPersistenceChange(e.target.checked)}
                  />
                )}
                label="로그인 유지"
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 4 }}>
                꺼두면 브라우저를 닫은 뒤 짧은 시간 내 재접속이 없을 때 자동으로 로그아웃됩니다. 켜두면 직접 로그아웃하기 전까지 로그인이 유지됩니다.
              </Typography>

              <Typography variant="h6" sx={{ mb: 2 }}>테마 설정</Typography>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button variant={themeName === 'light' ? 'contained' : 'outlined'} onClick={() => setThemeName('light')}>밝음</Button>
                <Button variant={themeName === 'dark' ? 'contained' : 'outlined'} onClick={() => setThemeName('dark')}>어두움</Button>
                <Button variant={themeName === 'ocean' ? 'contained' : 'outlined'} onClick={() => setThemeName('ocean')}>오션</Button>
              </Box>
              <Box sx={{ mt: 4 }}>
                <Typography variant="h6" sx={{ mb: 2 }}>앱 열기 방식</Typography>
                <Select
                  size="small"
                  value={appOpenMode}
                  onChange={(e) => handleAppOpenModeChange(e.target.value)}
                  sx={{ minWidth: 220 }}
                >
                  <MenuItem value="window">창으로 열기</MenuItem>
                  <MenuItem value="inline">현재 화면에서 열기</MenuItem>
                </Select>
              </Box>
            </Box>
          )}
          {activeTab === 1 && (
             <FormControlLabel control={<Switch checked={showExt} onChange={(e) => {
               setShowExt(e.target.checked); localStorage.setItem('nas_show_extensions', e.target.checked); window.dispatchEvent(new Event('nas_settings_changed'));
             }} />} label="확장명 표시" />
          )}
          {activeTab === 2 && isManager && (
            <Box>
              <Typography variant="h6" sx={{ mb: 2 }}>NAS 저장공간 현황</Typography>
              {userManagementError && <Alert severity="error" onClose={() => setUserManagementError('')} sx={{ mb: 2 }}>{userManagementError}</Alert>}
              {storageCapacity && (
                <>
                  {storageCapacity.overAllocatedBytes > 0 && (
                    <Alert severity="error" sx={{ mb: 2 }}>
                      현재 사용자·가입 대기자에게 약속된 용량이 안전 할당 가능 범위를 {formatStorage(storageCapacity.overAllocatedBytes)} 초과했습니다. 신규 가입과 추가 증설이 차단됩니다.
                    </Alert>
                  )}
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    {[
                      ['전체 NAS', formatStorage(storageCapacity.totalBytes), `사용 ${formatStorage(storageCapacity.usedBytes)} · 여유 ${formatStorage(storageCapacity.freeBytes)}`],
                      ['사용자 할당', formatStorage(storageCapacity.allocatedBytes), `가입 대기 예약 ${formatStorage(storageCapacity.pendingReservedBytes)}`],
                      ['개인 공간 실사용', formatStorage(storageCapacity.actualUserBytes), `계정 ${storageCapacity.accountCount || 0}개`],
                      ['추가 할당 가능', formatStorage(storageCapacity.availableForAllocationBytes), storageCapacity.signupAvailable ? '새 계정 50GB 제공 가능' : '신규 가입 차단']
                    ].map(([label, value, detail]) => (
                      <Grid item xs={12} sm={6} lg={3} key={label}>
                        <Paper variant="outlined" sx={{ p: 2, height: '100%', borderRadius: 2 }}>
                          <Typography variant="caption" color="text.secondary">{label}</Typography>
                          <Typography variant="h5" sx={{ fontWeight: 800, my: 0.5 }}>{value}</Typography>
                          <Typography variant="caption" color="text.secondary">{detail}</Typography>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                  <Box sx={{ mb: 4 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
                      <Typography variant="body2">물리 디스크 사용률 {storageUsagePercent}%</Typography>
                      <Typography variant="caption" color="text.secondary">안전 여유분 {formatStorage(storageCapacity.systemReserveBytes)} 보호</Typography>
                    </Box>
                    <LinearProgress variant="determinate" value={storageUsagePercent} color={storageUsagePercent >= 90 ? 'error' : storageUsagePercent >= 75 ? 'warning' : 'primary'} sx={{ height: 10, borderRadius: 5 }} />
                  </Box>
                </>
              )}
              <Typography variant="h6" sx={{ mb: 2 }}>가입 승인 대기자 {pendingUsers.length > 0 && <Chip label={pendingUsers.length} color="error" size="small" />}</Typography>
              {pendingUsers.length > 0 && <Alert severity="info" sx={{ mb: 2 }}>가입 대기자 한 명마다 기본 50GB가 미리 예약되어 중복 승인을 해도 전체 용량을 초과하지 않습니다.</Alert>}
              <TableContainer component={Paper} sx={{ mb: 5, border: '1px solid #e2e8f0', borderRadius: 2 }} elevation={0}>
                <Table size="small">
                  <TableHead sx={{ backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.06)' : '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>아이디</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>상세정보</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>승인/거절</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pendingUsers.length === 0 ? (
                      <TableRow><TableCell colSpan={3} align="center" sx={{ py: 3, color: 'text.secondary' }}>대기 중인 요청이 없습니다.</TableCell></TableRow>
                    ) : (
                      pendingUsers.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell sx={{ fontWeight: 'bold' }}>{p.username || p.id}</TableCell>
                          <TableCell align="center">
                            <Button variant="outlined" size="small" color="info" onClick={() => { setSelectedPendingUser(p); setPendingUserDetailsOpen(true); }}>더보기</Button>
                          </TableCell>
                          <TableCell align="center">
                            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                              <Button variant="contained" size="small" onClick={() => handleApprove(p.id)}>승인</Button>
                              <Button variant="outlined" color="error" size="small" onClick={() => handleReject(p.id)}>거절</Button>
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="h6">사용자 목록</Typography>
                <TextField size="small" placeholder="아이디 검색" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }} />
              </Box>
              
              <Typography variant="subtitle1" sx={{ mt: 4, mb: 1, fontWeight: 'bold', color: 'primary.main' }}>마스터 계정</Typography>
              {renderUserTable(masters)}

              <Typography variant="subtitle1" sx={{ mt: 4, mb: 1, fontWeight: 'bold', color: 'primary.main' }}>관리자 계정</Typography>
              {renderUserTable(managers)}

              <Typography variant="subtitle1" sx={{ mt: 4, mb: 1, fontWeight: 'bold', color: 'primary.main' }}>일반 사용자 계정</Typography>
              {renderUserTable(normalUsers)}

              <Box sx={{ mt: 6, mb: 2, display: 'flex', justifyContent: 'center' }}>
                <Button 
                  variant="contained" 
                  color="primary" 
                  size="large" 
                  onClick={handleSaveChanges}
                  disabled={userManagementSaving}
                  sx={{ px: 6, py: 1.5, fontSize: '1.1rem', fontWeight: 'bold', borderRadius: 2, boxShadow: 3 }}
                >
                  {userManagementSaving ? '검증 후 저장 중…' : '역할·용량 변경사항 저장'}
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      </Paper>

      <Dialog open={pendingUserDetailsOpen} onClose={() => setPendingUserDetailsOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>가입 요청 상세 정보</DialogTitle>
        <DialogContent dividers>
          {selectedPendingUser && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box>
                <Typography variant="body2" color="text.secondary">요청 아이디</Typography>
                <Typography variant="subtitle1" fontWeight="bold">{selectedPendingUser.username || selectedPendingUser.id}</Typography>
              </Box>
              <Box sx={{ p: 2, bgcolor: themeName === 'dark' ? 'rgba(255,255,255,0.04)' : '#f8fafc', borderRadius: 1, border: themeName === 'dark' ? '1px dashed rgba(255,255,255,0.18)' : '1px dashed #cbd5e1' }}>
                <Typography variant="body2" color="text.secondary" align="center">
                  추후 회원가입 폼에 추가될 부가 정보<br/>(이메일, 연락처, 소속 등)가<br/>여기에 표시되도록 확장할 수 있습니다.
                </Typography>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setPendingUserDetailsOpen(false)} color="inherit">닫기</Button>
          <Button onClick={() => { handleApprove(selectedPendingUser?.id); setPendingUserDetailsOpen(false); }} color="primary" variant="contained">이 사용자 승인</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold', color: 'error.main' }}>계정 영구 삭제 경고</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            정말로 <strong>{targetToDelete?.username}</strong> 계정을 삭제하시겠습니까?<br />
            이 작업은 되돌릴 수 없으며, 해당 유저의 모든 권한이 즉시 회수됩니다.
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label="관리자 비밀번호 확인"
            type="password"
            fullWidth
            variant="outlined"
            autoComplete="new-password"
            value={adminPasswordForDelete}
            onChange={(e) => setAdminPasswordForDelete(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setDeleteConfirmOpen(false)} color="inherit">취소</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">본인 인증 및 삭제</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
export default Settings;
