const fs = require('fs');
const path = './src/components/Settings.js';

const newSettingsCode = `import React, { useState, useEffect } from 'react';
import { Box, Typography, Paper, Button, Switch, FormControlLabel, Divider, Tabs, Tab } from '@mui/material';
import { useCustomTheme } from '../contexts/ThemeContext';

const Settings = () => {
  const { themeName, toggleTheme } = useCustomTheme();
  
  // 탭 상태 관리 (0: 전역, 1: 파일, 2: 계정)
  const [activeTab, setActiveTab] = useState(0);

  // 🔥 파일 확장명 숨기기 상태 변수 및 함수
  const [showExt, setShowExt] = useState(localStorage.getItem('nas_show_extensions') === 'true');
  const handleExtToggle = (e) => {
    const val = e.target.checked;
    setShowExt(val);
    localStorage.setItem('nas_show_extensions', val);
    window.dispatchEvent(new Event('nas_settings_changed')); // 메인 창에 즉시 알림!
  };

  const handleTabChange = (event, newValue) => {
    setActiveTab(newValue);
  };

  return (
    <Box sx={{ p: { xs: 2, md: 4 }, height: '100%', overflowY: 'auto', backgroundColor: themeName === 'dark' ? '#0f172a' : '#f1f5f9' }}>
      <Typography variant="h4" sx={{ fontWeight: 800, mb: 3, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>
        시스템 설정
      </Typography>

      <Paper elevation={4} sx={{ borderRadius: 3, overflow: 'hidden', backgroundColor: themeName === 'dark' ? '#1e293b' : '#ffffff' }}>
        {/* === 상단 탭 네비게이션 === */}
        <Box sx={{ borderBottom: 1, borderColor: 'divider', backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8fafc' }}>
          <Tabs 
            value={activeTab} 
            onChange={handleTabChange} 
            variant="scrollable" 
            scrollButtons="auto" 
            textColor="primary" 
            indicatorColor="primary"
            sx={{ px: 2 }}
          >
            <Tab label={<Typography sx={{ fontWeight: 'bold' }}>전역 설정</Typography>} />
            <Tab label={<Typography sx={{ fontWeight: 'bold' }}>파일 설정</Typography>} />
            <Tab label={<Typography sx={{ fontWeight: 'bold' }}>계정 설정</Typography>} />
          </Tabs>
        </Box>

        {/* === 탭 내용 구역 === */}
        <Box sx={{ p: { xs: 2, md: 4 }, minHeight: '300px' }}>
          
          {/* 0. 전역 설정 (테마) */}
          {activeTab === 0 && (
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>
                테마 및 디스플레이
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3, backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8fafc', borderRadius: 2 }}>
                <Typography variant="body1">
                  현재 적용된 테마: <strong style={{ color: '#3b82f6' }}>{themeName.toUpperCase()}</strong>
                </Typography>
                <Button variant="contained" onClick={toggleTheme} sx={{ width: 'fit-content', fontWeight: 'bold', mt: 1 }}>
                  시스템 테마 전환 (Dark / Light)
                </Button>
              </Box>
            </Box>
          )}

          {/* 1. 파일 설정 */}
          {activeTab === 1 && (
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>
                파일 시스템 제어
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3, backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8fafc', borderRadius: 2 }}>
                <FormControlLabel 
                  control={<Switch checked={showExt} onChange={handleExtToggle} color="primary" />} 
                  label={<Typography sx={{ fontWeight: 'bold' }}>알려진 파일 형식의 확장명 표시</Typography>} 
                />
                <Typography variant="body2" color="textSecondary" sx={{ ml: 4, mt: -1 }}>
                  체크 시 파일의 확장자(.zip, .pdf 등)가 표시되며, 파일 이름을 통해 확장자를 직접 변경할 수 있습니다.
                </Typography>
              </Box>
            </Box>
          )}

          {/* 2. 계정 설정 (개발 예정) */}
          {activeTab === 2 && (
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>
                계정 및 권한 관리
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 4, backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8fafc', borderRadius: 2, border: '2px dashed #94a3b8' }}>
                <Typography variant="body1" sx={{ fontWeight: 'bold', color: 'textSecondary', mb: 1 }}>
                  🚧 계정 관리 시스템 준비 중 🚧
                </Typography>
                <Typography variant="body2" color="textSecondary" align="center">
                  이곳에 최고 관리자(Admin) 권한 설정, 일반 사용자 관리, <br/>그리고 친구 추가 및 공유 시스템이 탑재될 예정입니다.
                </Typography>
              </Box>
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
console.log("✅ 프론트엔드: 설정 창 탭(Tab) 리모델링 대성공!");
