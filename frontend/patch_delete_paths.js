const fs = require('fs');
const path = './src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 키보드 Delete 키 삭제 로직 교정 (paths 배열 -> path 단일 요소들의 Promise.all로 변환)
    const oldDeleteTarget = /await axios\.delete\('\/api\/file',\s*\{\s*data:\s*\{\s*paths:\s*selectedItems\s*\}\s*,\s*withCredentials:\s*true\s*\}\);/g;
    const newDeleteTarget = "await Promise.all(selectedItems.map(item => axios.delete('/api/file', { data: { path: item }, withCredentials: true })));";
    
    // 2. 혹시 마우스 우클릭 컨텍스트 메뉴에도 똑같은 로직이 있다면 같이 교정
    const oldContextMenuDelete = /await axios\.delete\('\/api\/file',\s*\{\s*data:\s*\{\s*paths:\s*\[itemPath\]\s*\}\s*,\s*withCredentials:\s*true\s*\}\);/g;
    const newContextMenuDelete = "await axios.delete('/api/file', { data: { path: itemPath }, withCredentials: true });";

    let changed = false;

    if (oldDeleteTarget.test(code)) {
        code = code.replace(oldDeleteTarget, newDeleteTarget);
        changed = true;
    }
    
    if (oldContextMenuDelete.test(code)) {
        code = code.replace(oldContextMenuDelete, newContextMenuDelete);
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(path, code);
        console.log("✅ NAS.js: 삭제 API 파라미터 불일치(paths -> path) 완벽 해결!");
    } else {
        console.log("⚡ NAS.js에서 해당 삭제 로직을 찾지 못했습니다. 코드가 다를 수 있습니다.");
    }
}
