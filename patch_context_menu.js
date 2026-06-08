const fs = require('fs');
const menuPath = './frontend/src/components/NAS/NASContextMenu.js';

if (fs.existsSync(menuPath)) {
    let code = fs.readFileSync(menuPath, 'utf8');

    // 폴더 우클릭 메뉴(contextMenu.type === 'folder') 영역에 다운로드 버튼 삽입!
    if (!code.includes('<MenuItem key="download"')) {
        code = code.replace(
            /(<Divider key="d2" \/>)/,
            `$1,\n        <MenuItem key="download" onClick={() => { handleContextMenuClose(); setTimeout(() => { const items = getItemsToProcess(contextMenu.item); items.forEach((it, i) => setTimeout(() => handleDownload(it), i * 500)); }, 10); }}>\n          <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon><ListItemText>다운로드</ListItemText>\n        </MenuItem>`
        );
        fs.writeFileSync(menuPath, code);
        console.log("✅ 프론트엔드: 폴더 우클릭 [다운로드] 메뉴 추가 완료!");
    }
}
