const fs = require('fs');

// 1. ServicePlatform.js 전면 교체 (NAS 서비스만 큼지막한 카드로 남깁니다)
const platformPath = './src/components/ServicePlatform.js';
const newPlatformCode = `import React from 'react';
import { Container, Box, Typography, Paper } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import { useNavigate } from 'react-router-dom';

function ServicePlatform() {
  const navigate = useNavigate();

  return (
    <Container sx={{ mt: 8, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Typography variant="h4" sx={{ fontWeight: 800, mb: 6 }}>
        서비스 플랫폼
      </Typography>
      
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
        {/* 🔥 나중에 다른 서비스를 쉽게 옆에 붙일 수 있도록 '카드형 앱 아이콘' 디자인 적용 */}
        <Paper 
          elevation={3} 
          sx={{ 
            width: 200, height: 200, p: 4, display: 'flex', flexDirection: 'column', 
            alignItems: 'center', justifyContent: 'center', cursor: 'pointer', 
            borderRadius: 4, transition: 'transform 0.2s, box-shadow 0.2s', 
            '&:hover': { transform: 'translateY(-5px)', boxShadow: 6 } 
          }}
          onClick={() => navigate('/platform')} // /nas로 이동하기 전 기본 주소 (이후 NAS 라우터가 처리)
        >
          <FolderIcon sx={{ fontSize: 80, color: 'primary.main', mb: 2 }} />
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>NAS 서비스</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>파일 탐색기</Typography>
        </Paper>
      </Box>
    </Container>
  );
}

export default ServicePlatform;`;

fs.writeFileSync(platformPath, newPlatformCode.replace("navigate('/platform')", "navigate('/nas')"));
console.log("✅ ServicePlatform.js: 불필요한 관리자 버튼 제거 및 NAS 앱 아이콘화 완료!");

// 2. TopBar.js 수정 (좌측 상단 로고를 '홈 버튼'으로 만듭니다)
const topBarPath = './src/components/TopBar.js';
if (fs.existsSync(topBarPath)) {
    let code = fs.readFileSync(topBarPath, 'utf8');
    
    // 로고에 onClick(홈 이동)과 마우스 hover(손가락 포인터) 효과를 부여합니다.
    const oldLogo = /<Typography variant="h6" sx=\{\{ fontWeight: 800, fontSize: '1\.1rem' \}\}>\s*FileManager NAS\+\s*<\/Typography>/;
    const newLogo = `<Typography variant="h6" onClick={() => navigate('/platform')} sx={{ fontWeight: 800, fontSize: '1.1rem', cursor: 'pointer', transition: 'opacity 0.2s', '&:hover': { opacity: 0.7 } }}> FileManager NAS+ </Typography>`;
    
    if (oldLogo.test(code)) {
        code = code.replace(oldLogo, newLogo);
        fs.writeFileSync(topBarPath, code);
        console.log("✅ TopBar.js: 로고 클릭 시 바탕화면(/platform)으로 돌아가는 기능 적용 완료!");
    } else {
        console.log("⚡ TopBar.js: 로고 홈 버튼 기능이 이미 적용되어 있거나 코드가 다릅니다.");
    }
}
