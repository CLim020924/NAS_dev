const fs = require('fs');
const path = './src/components/Settings.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 승인/거부 버튼 부분을 세련된 디자인으로 교체
    const oldButtons = /<IconButton color="success" size="small" onClick=\{\(\) => handleApprove\(p\.id\)\}>[\s\S]*?<\/IconButton>/;
    const newButtons = `
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
        <Button 
          variant="contained" 
          size="small" 
          color="primary" 
          onClick={() => handleApprove(p.id)}
          sx={{ fontWeight: 'bold', borderRadius: '6px', fontSize: '0.75rem' }}
        >
          승인
        </Button>
        <Button 
          variant="outlined" 
          size="small" 
          color="error" 
          onClick={() => handleReject(p.id)}
          sx={{ fontWeight: 'bold', borderRadius: '6px', fontSize: '0.75rem' }}
        >
          거절
        </Button>
      </Box>
    `.trim();

    // 전체 가입 대기자 테이블의 버튼 구역을 교체
    code = code.replace(/<TableCell align="center">[\s\S]*?<IconButton color="success"[\s\S]*?<\/IconButton>[\s\S]*?<IconButton color="error"[\s\S]*?<\/IconButton>[\s\S]*?<\/TableCell>/g, 
        \`<TableCell align="center">\${newButtons}<\/TableCell>\`);

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 버튼 UI 환골탈태 완료!");
}
