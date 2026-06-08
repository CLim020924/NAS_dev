const fs = require('fs');
const path = './src/components/Settings.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 필요한 상태(State) 추가
    code = code.replace(
        "const [searchQuery, setSearchQuery] = useState('');",
        `const [searchQuery, setSearchQuery] = useState('');
  // 🔥 삭제 확인용 상태
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [targetToDelete, setTargetToDelete] = useState(null);
  const [adminPasswordForDelete, setAdminPasswordForDelete] = useState('');`
    );

    // 2. 삭제 처리 함수 추가
    const deleteFunc = `
  const handleOpenDelete = (u) => {
    setTargetToDelete(u);
    setAdminPasswordForDelete('');
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!adminPasswordForDelete) return alert("관리자 비밀번호를 입력해주세요.");
    
    try {
      const res = await axios.post('/api/users/delete', {
        targetId: targetToDelete.id,
        adminId: currentUser.id || currentUser.username,
        adminPassword: adminPasswordForDelete
      }, { withCredentials: true });

      if (res.data.success) {
        alert(\`[\${targetToDelete.username}] 계정이 삭제되었습니다.\`);
        setDeleteConfirmOpen(false);
        // 목록 새로고침은 interval이 알아서 하거나 수동 트리거
      }
    } catch (err) {
      alert(err.response?.data?.error || "삭제에 실패했습니다.");
    }
  };
`;
    code = code.replace("const handleUserUpdate", deleteFunc + "\n  const handleUserUpdate");

    // 3. IconButton에 클릭 이벤트 연결 (이미 있던 IconButton 찾아서 교체)
    code = code.replace(
        /<IconButton color="error" size="small" disabled=\{u\.username === 'admin' \|\| currentUser\.username === u\.username\}><DeleteIcon \/><\/IconButton>/g,
        `<IconButton color="error" size="small" disabled={u.username === 'admin' || currentUser.username === u.username} onClick={() => handleOpenDelete(u)}><DeleteIcon /></IconButton>`
    );

    // 4. 파일 하단에 삭제 확인 Dialog 추가 (Dialog가 이미 import 되어있다고 가정)
    // Settings.js 상단에 Dialog 관련 import가 누락되었을 경우를 대비해 import문 확인 후 추가
    if (!code.includes('DialogContent')) {
        code = "import { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';\n" + code;
    }

    const deleteDialogHtml = `
      {/* 🔥 계정 삭제 확인 팝업 */}
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
  );`;
    
    code = code.replace("    </Box>\n  );", deleteDialogHtml);

    fs.writeFileSync(path, code);
    console.log("✅ Settings.js: 관리자 인증 삭제 UI 및 로직 적용 완료!");
}
