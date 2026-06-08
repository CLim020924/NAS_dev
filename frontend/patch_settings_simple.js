const fs = require('fs');
const path = './src/components/Settings.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 필요한 MUI 컴포넌트 추가
    if (!code.includes('useMediaQuery')) {
        code = code.replace(
            "import { Box,",
            "import { Box, useMediaQuery, Grid, Stack,"
        );
    }

    // 2. Settings 컴포넌트 시작 부분에 isMobile 선언 추가
    if (!code.includes('isMobile =')) {
        code = code.replace(
            "const Settings = () => {",
            "const Settings = () => {\n  const isMobile = useMediaQuery('(max-width:600px)');"
        );
    }

    // 3. renderUserTable 함수 전면 개편 (모바일 카드 + PC 심플 테이블)
    const oldRenderTable = /const renderUserTable = \(userList, bgColor, titleColor\) => \([\s\S]*?<\/TableContainer>[\s\S]*?\);/g;
    const newRenderTable = `const renderUserTable = (userList) => (
    isMobile ? (
      // 📱 모바일 스마트 카드 뷰
      <Box sx={{ mt: 2 }}>
        {userList.length === 0 ? (
          <Typography align="center" color="text.secondary" sx={{ py: 4 }}>
            해당 사용자가 없습니다.
          </Typography>
        ) : (
          userList.map((u) => (
            <Paper key={u.id} elevation={1} sx={{ p: 2, mb: 2, borderRadius: 2, border: '1px solid #e2e8f0' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                  {u.username} {currentUser.username === u.username && <Chip label="나" size="small" color="primary" sx={{ ml: 1, height: 20 }}/>}
                </Typography>
                <IconButton color="error" size="small" disabled={u.username === 'admin' || currentUser.username === u.username}><DeleteIcon /></IconButton>
              </Box>
              <Grid container spacing={1.5}>
                <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>권한</Typography>
                    <Select size="small" value={u.role} disabled={!isMaster || u.username === 'admin'} onChange={(e) => handleUserUpdate(users.map(user => user.id === u.id ? { ...user, role: e.target.value } : user))} fullWidth>
                        {isMaster && <MenuItem value="MASTER">마스터</MenuItem>}
                        <MenuItem value="MANAGER">관리자</MenuItem>
                        <MenuItem value="USER">일반 사용자</MenuItem>
                    </Select>
                </Grid>
                <Grid item xs={12}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 0.5 }}>
                        <Typography variant="body2" color="text.secondary">타인 파일 접근</Typography>
                        <Switch size="small" color="error" checked={u.role === 'MASTER' ? true : (u.globalAccess || false)} disabled={!isMaster || u.role === 'MASTER'} onChange={(e) => handleUserUpdate(users.map(user => user.id === u.id ? { ...user, globalAccess: e.target.checked } : user))} />
                    </Box>
                </Grid>
                <Grid item xs={12}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>루트 경로</Typography>
                    <input type="text" defaultValue={u.rootPath} onBlur={(e) => handleUserUpdate(users.map(user => user.id === u.id ? { ...user, rootPath: e.target.value } : user))} style={{ padding: '8px', width: '100%', borderRadius: '4px', border: '1px solid #ccc', boxSizing: 'border-box' }} disabled={!isMaster && u.role === 'MASTER'} />
                </Grid>
              </Grid>
            </Paper>
          ))
        )}
      </Box>
    ) : (
      // 💻 PC 심플 테이블 뷰
      <TableContainer component={Paper} elevation={0} sx={{ mt: 2, border: '1px solid #e2e8f0', borderRadius: 2 }}>
        <Table size="small">
          <TableHead sx={{ backgroundColor: '#f8fafc' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>아이디</TableCell>
              <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>권한 변경</TableCell>
              <TableCell align="center" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>타인 파일 접근</TableCell>
              <TableCell sx={{ fontWeight: 'bold', color: 'text.secondary' }}>루트 경로 지정</TableCell>
              <TableCell align="center" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>삭제</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {userList.length === 0 ? <TableRow><TableCell colSpan={5} align="center">해당 사용자가 없습니다.</TableCell></TableRow> : 
              userList.map((u) => (
                <TableRow key={u.id} sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                  <TableCell sx={{ fontWeight: 'bold' }}>
                    {u.username} {currentUser.username === u.username && <Chip label="나" size="small" color="primary" sx={{ ml: 1, height: 20 }}/>}
                  </TableCell>
                  <TableCell>
                    <Select size="small" value={u.role} disabled={!isMaster || u.username === 'admin'} onChange={(e) => handleUserUpdate(users.map(user => user.id === u.id ? { ...user, role: e.target.value } : user))} sx={{ width: 120 }}>
                      {isMaster && <MenuItem value="MASTER">마스터</MenuItem>}
                      <MenuItem value="MANAGER">관리자</MenuItem>
                      <MenuItem value="USER">일반 사용자</MenuItem>
                    </Select>
                  </TableCell>
                  <TableCell align="center">
                    <Switch size="small" color="error" checked={u.role === 'MASTER' ? true : (u.globalAccess || false)} disabled={!isMaster || u.role === 'MASTER'} onChange={(e) => handleUserUpdate(users.map(user => user.id === u.id ? { ...user, globalAccess: e.target.checked } : user))} />
                  </TableCell>
                  <TableCell>
                    <input type="text" defaultValue={u.rootPath} onBlur={(e) => handleUserUpdate(users.map(user => user.id === u.id ? { ...user, rootPath: e.target.value } : user))} style={{ padding: '5px', width: '100%', borderRadius: '4px', border: '1px solid #ccc' }} disabled={!isMaster && u.role === 'MASTER'} />
                  </TableCell>
                  <TableCell align="center">
                    <IconButton color="error" size="small" disabled={u.username === 'admin' || currentUser.username === u.username}><DeleteIcon /></IconButton>
                  </TableCell>
                </TableRow>
              ))
            }
          </TableBody>
        </Table>
      </TableContainer>
    )
  );`;

    code = code.replace(oldRenderTable, newRenderTable);

    // 4. 메인 return문 수정 (섹션 헤더 이모티콘 제거 및 심플화)
    const oldSectionHeaders = /<Typography variant="subtitle2" color="error"[\s\S]*?\/>\s*👑 마스터<\/Typography>\{renderUserTable\(masters, '#fee2e2', '#b91c1c'\)\}\s*<Typography variant="subtitle2" color="warning\.main"[\s\S]*?\/>\s*🛡️ 관리자<\/Typography>\{renderUserTable\(managers, '#fef3c7', '#b45309'\)\}\s*<Typography variant="subtitle2" color="primary"[\s\S]*?\/>\s*👤 사용자<\/Typography>\{renderUserTable\(normalUsers, '#dbeafe', '#1d4ed8'\)\}/g;
    const newSectionHeaders = `<Typography variant="subtitle1" sx={{ mt: 4, mb: 1, fontWeight: 'bold', color: 'primary.main' }}>마스터 계정</Typography>
    {renderUserTable(masters)}

    <Typography variant="subtitle1" sx={{ mt: 4, mb: 1, fontWeight: 'bold', color: 'primary.main' }}>관리자 계정</Typography>
    {renderUserTable(managers)}

    <Typography variant="subtitle1" sx={{ mt: 4, mb: 1, fontWeight: 'bold', color: 'primary.main' }}>일반 사용자 계정</Typography>
    {renderUserTable(normalUsers)}`;

    code = code.replace(oldSectionHeaders, newSectionHeaders);

    fs.writeFileSync(path, code);
    console.log("✅ Settings.js: 세련되고 심플한 디자인 & 모바일 반응형 전면 개편 완료!");
}
