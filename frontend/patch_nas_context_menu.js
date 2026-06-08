const fs = require('fs');
const path = './src/components/NAS/NASContextMenu.js';
if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');
    
    if (!code.includes('SettingsIcon')) {
        code = code.replace(/import FolderIcon from '@mui\/icons-material\/Folder';/, "import FolderIcon from '@mui/icons-material/Folder';\nimport SettingsIcon from '@mui/icons-material/Settings';");
    }

    if (!code.includes('key="settings"')) {
        code = code.replace(
            /(<MenuItem key="upload"[\s\S]*?<\/MenuItem>)/,
            `$1,\n        <Divider key="d_settings" />,\n        <MenuItem key="settings" onClick={() => { handleContextMenuClose(); setTimeout(() => window.location.href='/settings', 10); }}>\n          <ListItemIcon><SettingsIcon fontSize="small" color="inherit" /></ListItemIcon><ListItemText>설정</ListItemText>\n        </MenuItem>`
        );
        fs.writeFileSync(path, code);
        console.log("✅ 우클릭 메뉴: 배경 클릭 시 [설정] 메뉴 연동 완료!");
    }
}
