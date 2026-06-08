const fs = require('fs');
const path = './src/components/NAS/Window/NASWindow.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 새 모듈(SidebarTree) 가져오기 (연결 준비)
    if (!code.includes("import SidebarTree")) {
        code = code.replace(
            "import FileEditor from './FileEditor';",
            "import FileEditor from './FileEditor';\nimport SidebarTree from './SidebarTree';"
        );
    }

    // 2. 껍데기 코드를 떼어내고 새 모듈 끼워 넣기 (정확한 연결)
    const oldCodeToReplace = "<List sx={{ pt: 1 }}><ListItem button onClick={() => fetchFiles(win.id, win.basePath)}><ListItemIcon sx={{ minWidth: 40 }}><StorageIcon color=\"primary\"/></ListItemIcon><ListItemText primary={<Typography sx={{ fontWeight: 600 }}>{win.name}</Typography>} /></ListItem></List>";
    const newComponent = "<SidebarTree win={win} fetchFiles={fetchFiles} openFileWindow={openFileWindow} theme={theme} />";

    // 문자열이 정확히 일치할 때만 바꿈 (에러 0%)
    if (code.includes(oldCodeToReplace)) {
        code = code.replace(oldCodeToReplace, newComponent);
        fs.writeFileSync(path, code);
        console.log("✅ NASWindow.js: 껍데기를 제거하고 새 모듈(SidebarTree) 연결을 완벽하게 완료했습니다!");
    } else {
        console.log("⚡ 껍데기 코드를 찾을 수 없습니다. (이미 연결되었거나 코드가 다릅니다)");
    }
}
