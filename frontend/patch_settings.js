const fs = require('fs');
const path = './src/components/Settings.js';
if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');
    
    // Switch, FormControlLabel 등 MUI 컴포넌트 임포트 확인 및 추가
    if (!code.includes('Switch')) {
        code = code.replace(/import \{([^}]+)\} from '@mui\/material';/, "import { $1, Switch, FormControlLabel, Divider } from '@mui/material';");
    }

    // 설정 창 안에 토글 로직과 UI 주입
    if (!code.includes('nas_show_extensions')) {
        const toggleLogic = `
  const [showExt, setShowExt] = useState(localStorage.getItem('nas_show_extensions') === 'true');
  const handleExtToggle = (e) => {
    const val = e.target.checked;
    setShowExt(val);
    localStorage.setItem('nas_show_extensions', val);
    window.dispatchEvent(new Event('nas_settings_changed')); // NAS.js에 즉시 알림!
  };
`;
        code = code.replace(/(const themeName = [^;]+;)/, "$1\n" + toggleLogic);

        const toggleUI = `
        {/* === 파일 설정 구역 === */}
        <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2, color: themeName === 'dark' ? '#fff' : '#1e293b' }}>
          파일 설정
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 4, p: 2, backgroundColor: themeName === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8fafc', borderRadius: 2 }}>
          <FormControlLabel 
            control={<Switch checked={showExt} onChange={handleExtToggle} color="primary" />} 
            label={<Typography sx={{ fontWeight: 'bold' }}>알려진 파일 형식의 확장명 표시</Typography>} 
          />
          <Typography variant="body2" color="textSecondary" sx={{ ml: 4, mt: -1 }}>
            체크 시 파일의 확장자(.zip, .pdf 등)가 표시되며, 파일 이름을 통해 확장자를 직접 변경할 수 있습니다.
          </Typography>
        </Box>
        <Divider sx={{ my: 4 }} />
`;
        code = code.replace(/(\{\/\* === 테마 설정 구역 === \*\/\})/, toggleUI + "\n        $1");
        fs.writeFileSync(path, code);
        console.log("✅ 설정 창: 파일 확장명 표시 토글 UI 탑재 완료!");
    }
}
