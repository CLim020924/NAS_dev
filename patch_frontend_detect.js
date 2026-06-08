const fs = require('fs');
const path = './frontend/src/components/NAS.js';

if (fs.existsSync(path)) {
    let code = fs.readFileSync(path, 'utf8');

    // 바꾸고자 하는 예전 코드 덩어리
    const oldCode = `const safeApiUrl = \`/api/file/download?path=\${encodeURIComponent(safePath)}\`; const ext = fileItem.name.includes('.') ? fileItem.name.split('.').pop().toLowerCase() : '';
    const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'flac', 'm4a', 'pdf', 'heic', 'heif', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'hwp', 'hwpx', 'zip', 'tar', 'gz'];
    const isBinary = binaryExts.includes(ext);
    try { let content = ''; if (!isBinary) { const response = await axios.get(safeApiUrl, { responseType: 'text', withCredentials: true }); content = typeof response.data === 'object' ? JSON.stringify(response.data, null, 2) : response.data; }`;

    // 새롭게 들어갈 똑똑한 코드 (감식반 출동 로직 포함)
    const newCode = `const safeApiUrl = \`/api/file/download?path=\${encodeURIComponent(safePath)}\`; 
    let ext = fileItem.name.includes('.') ? fileItem.name.split('.').pop().toLowerCase() : '';
    const binaryExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'flac', 'm4a', 'pdf', 'heic', 'heif', 'xlsx', 'xls', 'docx', 'doc', 'pptx', 'ppt', 'hwp', 'hwpx', 'zip', 'tar', 'gz'];
    
    // 🔥 확장자가 없다면 백엔드 과학수사대(CSI) 호출!
    if (ext === '') {
      try {
        const { data } = await axios.get(\`/api/file/detect?path=\${encodeURIComponent(safePath)}\`, { withCredentials: true });
        if (data.ext) ext = data.ext; // 찾아낸 진짜 확장자 주입!
      } catch (e) { console.error('지문 감식 실패', e); }
    }

    const isBinary = binaryExts.includes(ext);
    try { let content = ''; if (!isBinary) { const response = await axios.get(safeApiUrl, { responseType: 'text', withCredentials: true }); content = typeof response.data === 'object' ? JSON.stringify(response.data, null, 2) : response.data; }`;

    // 텍스트 정확하게 교체
    code = code.replace(oldCode, newCode);
    fs.writeFileSync(path, code);
    console.log("✅ 프론트엔드: 무확장자 파일 감식 & 자동 뷰어 연결 로직 탑재 완료!");
}
