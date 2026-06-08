import React, { useState, useEffect } from 'react';
import { Container, Typography, List, ListItem, ListItemIcon, ListItemText, Button, Box, TextField, ToggleButtonGroup, ToggleButton, Grid, Paper } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

function NAS({ backendUrl }) {
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState(''); // 기본 NAS 루트는 빈 문자열로 처리
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('list'); // 'list' 또는 'grid'
  const [newFolderName, setNewFolderName] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const navigate = useNavigate();

  // 파일 목록 불러오기 함수
  const fetchFiles = (path) => {
    axios.get(`/api/files`, { params: { path } })
      .then(response => {
        setFiles(response.data);
        setCurrentPath(path);
        setError('');
      })
      .catch(err => {
        setError(err.response?.data?.error || '파일 목록 불러오기 실패');
      });
  };

  useEffect(() => {
    fetchFiles('');
  }, []);

  // 뷰 모드 토글 핸들러
  const handleViewMode = (event, newMode) => {
    if (newMode !== null) {
      setViewMode(newMode);
    }
  };

  // 상위 폴더로 이동
  const handleBack = () => {
    if (!currentPath) return;
    const lastSlashIndex = currentPath.lastIndexOf('/');
    const parentPath = lastSlashIndex === -1 ? '' : currentPath.substring(0, lastSlashIndex);
    fetchFiles(parentPath);
  };

  // 폴더 생성 함수
  const createFolder = () => {
    axios.post(`/api/file`, { folderName: newFolderName, path: currentPath })
      .then(response => {
        alert(response.data.message);
        setNewFolderName('');
        fetchFiles(currentPath);
      })
      .catch(err => {
        alert(err.response?.data?.error || '폴더 생성 실패');
      });
  };

  // 파일 업로드 핸들러
  const handleFileSelect = (e) => {
    setUploadFile(e.target.files[0]);
  };

  const handleUpload = () => {
    if (!uploadFile) return;
    const formData = new FormData();
    formData.append('file', uploadFile);
    axios.post(`/api/file`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
      .then(response => {
        alert(response.data.message);
        setUploadFile(null);
        fetchFiles(currentPath);
      })
      .catch(err => {
        alert(err.response?.data?.error || '파일 업로드 실패');
      });
  };

  // List view 렌더링
  const renderListView = () => (
    <List>
      {files.map((item, index) => (
        <ListItem button key={index} onClick={() => item.type === 'folder' && fetchFiles(item.fullPath)}>
          <ListItemIcon>
            {item.type === 'folder' ? <FolderIcon /> : <InsertDriveFileIcon />}
          </ListItemIcon>
          <ListItemText primary={item.name} secondary={item.type === 'folder' ? '폴더' : '파일'} />
        </ListItem>
      ))}
    </List>
  );

  // Grid view 렌더링
  const renderGridView = () => (
    <Grid container spacing={2}>
      {files.map((item, index) => (
        <Grid item key={index} xs={6} sm={4} md={3}>
          <Paper
            elevation={3}
            sx={{ padding: 2, textAlign: 'center', cursor: item.type === 'folder' ? 'pointer' : 'default' }}
            onClick={() => item.type === 'folder' && fetchFiles(item.fullPath)}
          >
            {item.type === 'folder' ? <FolderIcon sx={{ fontSize: 40 }} /> : <InsertDriveFileIcon sx={{ fontSize: 40 }} />}
            <Typography variant="body2">{item.name}</Typography>
          </Paper>
        </Grid>
      ))}
    </Grid>
  );

  return (
    <Container sx={{ mt: 4 }}>
      <Typography variant="h4" gutterBottom>NAS 파일 관리자</Typography>
      <Typography variant="subtitle1" gutterBottom>
        현재 경로: {currentPath || 'NAS 루트'}
      </Typography>
      {error && <Typography color="error">{error}</Typography>}
      {/* 상단 버튼 영역 */}
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="outlined" onClick={handleBack}>상위 폴더 이동</Button>
        <ToggleButtonGroup value={viewMode} exclusive onChange={handleViewMode} aria-label="view mode">
          <ToggleButton value="list" aria-label="list view">List View</ToggleButton>
          <ToggleButton value="grid" aria-label="grid view">Grid View</ToggleButton>
        </ToggleButtonGroup>
        <Button variant="contained" onClick={() => fetchFiles(currentPath)}>새로고침</Button>
      </Box>
      {/* 폴더 생성 영역 */}
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <TextField
          label="새 폴더 이름"
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          size="small"
        />
        <Button variant="contained" onClick={createFolder}>폴더 생성</Button>
      </Box>
      {/* 파일 업로드 영역 */}
      <Box sx={{ mb: 2 }}>
        <input type="file" onChange={handleFileSelect} />
        {uploadFile && (
          <Button variant="contained" onClick={handleUpload} sx={{ ml: 1 }}>
            파일 업로드
          </Button>
        )}
      </Box>
      {/* 파일 목록 렌더링 */}
      {viewMode === 'list' ? renderListView() : renderGridView()}
    </Container>
  );
}

export default FileExplorer;
