const fs = require('fs');
const path = '/home/limchanyoung/my-service-platform/frontend/src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 1. 단일 파일 진행도(퍼센트)를 계산하도록 통신 함수(uploadOne) 완벽 교체
    const newUploadOne = `const uploadOne = async (item) => {
        const fullPath = normalizeJoin(targetPath, item.relPath);
        const destDirPath = fullPath.substring(0, fullPath.lastIndexOf('/')) || '/';
        const formData = new FormData();
        formData.append('path', destDirPath);
        formData.append('file', item.file);
        await axios.post('/api/file', formData, {
          withCredentials: true,
          signal: controller.signal,
          headers: { 'x-upload-session': sessionId },
          onUploadProgress: (evt) => {
            if (evt.total) {
              const percent = Math.round((evt.loaded * 100) / evt.total);
              setTransferTasks(prev => prev.map(t => t.id === taskId ? { ...t, percent } : t));
            }
          }
        });
      };`;

    code = code.replace(/const uploadOne = async \(item\) => \{[\s\S]*?await axios\.post\('\/api\/file'[\s\S]*?\}\);\s*\};/, newUploadOne);

    // 2. 텍스트 표시를 파일이 1개일 땐 '45%' 처럼 보이게 교체
    code = code.replace(
        /\{task\.total > 0 \? `\$\{task\.completed\}\/\$\{task\.total\}` : '준비 중'\}/g,
        "{task.total === 1 && task.percent !== undefined ? `${task.percent}%` : (task.total > 0 ? `${task.completed}/${task.total}` : '준비 중')}"
    );

    // 3. 프로그레스 바(파란색 게이지)가 퍼센트에 맞춰 차오르게 교체
    code = code.replace(
        /value=\{task\.total > 0 \? \(task\.completed \/ task\.total\) \* 100 : 0\}/g,
        "value={task.total === 1 && task.percent !== undefined ? task.percent : (task.total > 0 ? (task.completed / task.total) * 100 : 0)}"
    );

    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 퍼센트(%) 게이지 완벽 적용 완료!");
} else {
    console.log("❌ NAS.js 파일을 찾을 수 없습니다.");
}
