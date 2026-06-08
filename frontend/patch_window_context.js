const fs = require('fs');
const path = './src/contexts/WindowContext.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');
    
    const oldFetchFiles = /const fetchFiles = useCallback\(async \(windowId, path\) => \{[\s\S]*?\}, \[\]\);/;
    const newFetchFiles = `const fetchFiles = useCallback(async (arg1, arg2) => {
    // 💡 [핵심] NAS.js가 경로 1개만 던졌는지, 창번호와 경로 2개를 다 던졌는지 찰떡같이 구분합니다!
    const isSingleArg = arg2 === undefined;
    let targetPath = isSingleArg ? arg1 : arg2;
    const targetWindowId = isSingleArg ? null : arg1;

    // 경로가 비어있거나 'undefined'라는 글자로 오면 안전하게 바탕화면('/')으로 처리
    if (!targetPath || targetPath === 'undefined') targetPath = '/';

    try {
      const response = await axios.get(\`/api/files?path=\${encodeURIComponent(targetPath)}\`, { withCredentials: true });
      
      setOpenWindows(prev => prev.map(w => {
        // 명시된 창이거나, 현재 복사된 폴더를 열고 있는 "모든 창"의 화면을 즉시 새로고침합니다!
        if (w.id === targetWindowId || w.currentPath === targetPath) {
          return { ...w, files: response.data || [], currentPath: targetPath, isLoaded: true };
        }
        return w;
      }));
      
    } catch (err) { console.error("파일 로드 실패:", err); }
  }, []);`;

    if (oldFetchFiles.test(code)) {
        code = code.replace(oldFetchFiles, newFetchFiles);
        fs.writeFileSync(path, code);
        console.log("✅ WindowContext.js: undefined 에러 주범 (파라미터 불일치) 완벽 해결!");
    } else {
        console.log("⚡ WindowContext.js에서 기존 fetchFiles 코드를 찾지 못했습니다.");
    }
}
