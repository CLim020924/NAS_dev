const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. MUI 다이얼로그(모달창) 컴포넌트 임포트 추가
    if (!code.includes('DialogTitle')) {
        code = code.replace(
            /import \{(.*?)\} from '@mui\/material';/,
            "import {$1, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions} from '@mui/material';"
        );
    }

    // 2. 모달창 띄울지 말지 결정하는 상태(State) 추가
    if (!code.includes('const [closePrompt')) {
        code = code.replace(
            /const \[snackbar, setSnackbar\] = useState\(/,
            "const [closePrompt, setClosePrompt] = useState(null);\n  const [snackbar, setSnackbar] = useState("
        );
    }

    // 3. X 버튼 눌렀을 때 변경사항 검사하는 로직 추가
    if (!code.includes('const handleCloseWindowClick')) {
        code = code.replace(
            /const toggleSidebar =/,
            `const handleCloseWindowClick = (win) => {
    const isOffice = ['docx', 'doc', 'xlsx', 'xls', 'csv', 'pptx', 'ppt'].includes(win.ext);
    // 일반 파일인데 원본 내용과 다르면(수정되었으면) 알림창 띄우기!
    if (win.winType === 'file' && !win.isBinary && !isOffice && win.content !== win.originalContent) {
      setClosePrompt(win);
    } else {
      closeWindow(win.id);
    }
  };\n  const toggleSidebar =`
        );
    }

    // 4. 기존 X 버튼의 onClick 이벤트를 새로운 검사 함수로 교체
    code = code.replace(
        /onClick=\{\(\) => closeWindow\(win\.id\)\}/g,
        'onClick={() => handleCloseWindowClick(win)}'
    );

    // 5. 윈도우 창 3지선다 UI (저장, 저장 안 함, 취소) 추가
    if (!code.includes('<DialogTitle sx={{ fontWeight: \'bold\' }}>저장되지 않은 변경 사항</DialogTitle>')) {
        const dialogUI = `
      {/* 🔥 저장 3지선다 다이얼로그 */}
      <Dialog open={Boolean(closePrompt)} onClose={() => setClosePrompt(null)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>저장되지 않은 변경 사항</DialogTitle>
        <DialogContent>
          <DialogContentText>
            '{closePrompt?.name}' 파일의 변경 내용을 저장하시겠습니까?
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button onClick={async () => { await saveFile(closePrompt); closeWindow(closePrompt.id); setClosePrompt(null); }} color="primary" variant="contained" disableElevation>저장</Button>
          <Button onClick={() => { closeWindow(closePrompt.id); setClosePrompt(null); }} color="error" variant="outlined">저장 안 함</Button>
          <Button onClick={() => setClosePrompt(null)} color="inherit">취소</Button>
        </DialogActions>
      </Dialog>
    `;
        
        code = code.replace(
            /<NASContextMenu/g,
            `${dialogUI}\n      <NASContextMenu`
        );
    }

    fs.writeFileSync(path, code);
    console.log("✅ 윈도우 창 종료 3지선다 로직 패치 완료!");
}
