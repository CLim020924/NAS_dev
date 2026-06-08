const fs = require('fs');
const path = './src/components/ServicePlatform.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // History 아이콘 추가 (MUI)
    if (!code.includes('HistoryIcon')) {
        code = "import HistoryIcon from '@mui/icons-material/History';\n" + code;
    }

    // 마스터/전체권한 유저에게만 보이는 백업 카드 추가
    const backupCard = `
        {/* 🛡️ 마스터/전체권한 전용 백업 보관소 아이콘 */}
        {(user?.role === 'MASTER' || user?.Masters || user?.globalAccess) && (
          <Paper 
            elevation={3} 
            sx={{ 
              width: 200, height: 200, p: 4, display: 'flex', flexDirection: 'column', 
              alignItems: 'center', justifyContent: 'center', cursor: 'pointer', 
              borderRadius: 4, backgroundColor: '#f8fafc', border: '2px dashed #cbd5e1',
              transition: 'transform 0.2s, box-shadow 0.2s', 
              '&:hover': { transform: 'translateY(-5px)', boxShadow: 6, borderColor: 'error.main' } 
            }}
            onClick={() => navigate('/nas/backup')}
          >
            <HistoryIcon sx={{ fontSize: 80, color: 'error.light', mb: 2 }} />
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>백업 보관소</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>삭제된 데이터 아카이브</Typography>
          </Paper>
        )}
      </Box>`;

    code = code.replace(/<\/Box>/, backupCard);
    fs.writeFileSync(path, code);
    console.log("✅ ServicePlatform.js: 마스터 전용 백업 보관소 아이콘 추가 완료!");
}
