const fs = require('fs');
// 절대 경로로 지정해서 무조건 찾게 만듦
const path = '/home/limchanyoung/my-service-platform/frontend/src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 단일 파일일 경우 onUploadProgress 추가 (정규식으로 띄어쓰기 무시하고 교체)
    const targetAxiosRegex = /await axios\.post\('\/api\/file',\s*formData,\s*\{\s*withCredentials:\s*true,\s*signal:\s*controller\.signal,\s*headers:\s*\{\s*'x-upload-session':\s*sessionId\s*\}\s*\}\);/g;
    
    const replaceAxios = `await axios.post('/api/file', formData, {
        withCredentials: true,
        signal: controller.signal,
        headers: { 'x-upload-session': sessionId },
        onUploadProgress: (evt) => {
          if (uploadList.length === 1 && evt.total) {
            const percent = Math.round((evt.loaded * 100) / evt.total);
            setTransferTasks(prev => prev.map(t => t.id === taskId ? { ...t, percent } : t));
          }
        }
      });`;

    if (targetAxiosRegex.test(code)) {
        code = code.replace(targetAxiosRegex, replaceAxios);
    } else {
        console.log("⚠️ Axios 업로드 코드를 찾지 못했습니다. 이미 변경되었을 수 있습니다.");
    }

    // 2. 텍스트 표시 변경 ('0/1' 대신 '45%')
    code = code.replace(
        /\{task\.total > 0 \? `\$\{task\.completed\}\/\$\{task\.total\}` : '준비 중'\}/g,
        "{task.total === 1 && task.percent !== undefined ? `${task.percent}%` : (task.total > 0 ? `${task.completed}/${task.total}` : '준비 중')}"
    );

    // 3. 프로그레스 바 게이지 변경
    code = code.replace(
        /value=\{task\.total > 0 \? \(task\.completed \/ task\.total\) \* 100 : 0\}/g,
        "value={task.total === 1 && task.percent !== undefined ? task.percent : (task.total > 0 ? (task.completed / task.total) * 100 : 0)}"
    );

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 단일 대용량 파일 퍼센트(%) 진행도 표시 완벽 적용!");
} else {
    console.log("❌ NAS.js 파일을 찾을 수 없습니다: " + path);
}
