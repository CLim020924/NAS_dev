const fs = require('fs');
const path = require('path');

const candidates = [
  './frontend/src/components/NAS.js',
  '/home/limchanyoung/my-service-platform/frontend/src/components/NAS.js'
];

const filePath = candidates.find(p => fs.existsSync(p));

if (!filePath) {
  console.error('NAS.js 파일을 찾지 못했습니다.');
  console.error('찾은 경로 후보:', candidates);
  process.exit(1);
}

let code = fs.readFileSync(filePath, 'utf8');
const backupPath = `${filePath}.backup_${Date.now()}`;
fs.writeFileSync(backupPath, code);
console.log(`백업 생성: ${backupPath}`);

const newHandleFileUploadUseCallback = `const handleFileUpload = useCallback(async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const targetPath = ensureSlash(uploadTargetRef.current);

    setSnackbar({
      open: true,
      message: \`'\${file.name}' 업로드 준비 중...\`,
      severity: 'info'
    });

    const formData = new FormData();
    formData.append('path', targetPath);
    formData.append('file', file);

    try {
      await axios.post('/api/file', formData, {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || file.size;
          if (!total) return;

          const percentCompleted = Math.max(
            0,
            Math.min(99, Math.round((progressEvent.loaded * 100) / total))
          );

          setSnackbar({
            open: true,
            message: \`'\${file.name}' 전송 중... \${percentCompleted}%\`,
            severity: 'info'
          });
        }
      });

      setSnackbar({
        open: true,
        message: \`'\${file.name}' 업로드 완료!\`,
        severity: 'success'
      });

      refreshPath(targetPath);
    } catch (err) {
      if (err?.response?.status === 413) {
        setSnackbar({
          open: true,
          message: '업로드 실패: 서버 업로드 용량 제한(413)에 걸렸습니다. Nginx client_max_body_size 설정을 확인하세요.',
          severity: 'error'
        });
        return;
      }

      showError('파일 업로드', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [uploadTargetRef, setSnackbar, refreshPath, showError, fileInputRef]);

  const handleDelete = useCallback`;

const newHandleFileUploadNormal = `const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const targetPath = ensureSlash(uploadTargetRef.current);

    setSnackbar({
      open: true,
      message: \`'\${file.name}' 업로드 준비 중...\`,
      severity: 'info'
    });

    const formData = new FormData();
    formData.append('path', targetPath);
    formData.append('file', file);

    try {
      await axios.post('/api/file', formData, {
        withCredentials: true,
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        onUploadProgress: (evt) => {
          const total = evt.total || file.size;
          if (!total) return;

          const p = Math.max(
            0,
            Math.min(99, Math.round((evt.loaded * 100) / total))
          );

          setSnackbar({
            open: true,
            message: \`'\${file.name}' 전송 중... \${p}%\`,
            severity: 'info'
          });
        }
      });

      setSnackbar({
        open: true,
        message: \`'\${file.name}' 업로드 완료!\`,
        severity: 'success'
      });

      refreshPath(targetPath);
    } catch (err) {
      if (err?.response?.status === 413) {
        setSnackbar({
          open: true,
          message: '업로드 실패: 서버 업로드 용량 제한(413)에 걸렸습니다. Nginx client_max_body_size 설정을 확인하세요.',
          severity: 'error'
        });
        return;
      }

      showError('업로드', err);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async`;

let changed = false;

const useCallbackRegex = /const handleFileUpload = useCallback\(async \(e\) => \{[\s\S]*?\n  \}, \[[\s\S]*?\]\);\n\n  const handleDelete = useCallback/;

if (useCallbackRegex.test(code)) {
  code = code.replace(useCallbackRegex, newHandleFileUploadUseCallback);
  console.log('handleFileUpload(useCallback 버전) 패치 완료');
  changed = true;
} else {
  const normalRegex = /const handleFileUpload = async \(e\) => \{[\s\S]*?\n  \};\n\n  const handleDelete = async/;
  if (normalRegex.test(code)) {
    code = code.replace(normalRegex, newHandleFileUploadNormal);
    console.log('handleFileUpload(일반 함수 버전) 패치 완료');
    changed = true;
  } else {
    console.log('handleFileUpload 자동 교체 실패: 함수 구조가 예상과 다릅니다.');
  }
}

// 드래그앤드롭 작업 카드 초기 percent 추가
code = code.replace(
  /\{ id: taskId, sessionId, name: taskName, total: 0, completed: 0, status: 'scanning' \}/g,
  "{ id: taskId, sessionId, name: taskName, total: 0, completed: 0, percent: 0, status: 'scanning' }"
);

// 드래그앤드롭 axios 옵션 보강: timeout/maxBodyLength 없으면 추가
code = code.replace(
  /await axios\.post\('\/api\/file', formData, \{\s*withCredentials: true,/g,
  "await axios.post('/api/file', formData, {\n          withCredentials: true,\n          timeout: 0,\n          maxContentLength: Infinity,\n          maxBodyLength: Infinity,"
);

// 드래그앤드롭 진행률 계산 보강: evt.total 없을 때 item.file.size 사용
code = code.replace(
  /const percent = Math\.round\(\(evt\.loaded \* 100\) \/ evt\.total\);/g,
  `const total = evt.total || item.file.size;
            if (!total) return;
            const percent = Math.max(0, Math.min(99, Math.round((evt.loaded * 100) / total)));`
);

code = code.replace(
  /const p = Math\.round\(\(evt\.loaded \* 100\) \/ evt\.total\);/g,
  `const total = evt.total || item?.file?.size || file?.size;
            if (!total) return;
            const p = Math.max(0, Math.min(99, Math.round((evt.loaded * 100) / total)));`
);

// 드래그앤드롭 413 에러 안내 추가
if (!code.includes('서버 업로드 용량 제한(413)에 걸렸습니다')) {
  code = code.replace(
    /console\.error\('업로드 실패:',\s*item\.file\.name,\s*err\);/g,
    `if (err?.response?.status === 413) {
        setSnackbar({
          open: true,
          message: \`'\${item.file.name}' 업로드 실패: 서버 업로드 용량 제한(413)에 걸렸습니다. Nginx client_max_body_size 설정을 확인하세요.\`,
          severity: 'error'
        });
      }
      console.error('업로드 실패:', item.file.name, err);`
  );
}

// 성공 시 단일 파일 100% 표시를 조금 더 오래 보이게 하는 보강
code = code.replace(
  /setTransferTasks\(prev => prev\.filter\(t => t\.id !== taskId\)\);/g,
  `setTransferTasks(prev => prev.map(t => t.id === taskId ? { ...t, percent: 100, status: 'done' } : t));
      setTimeout(() => {
        setTransferTasks(prev => prev.filter(t => t.id !== taskId));
      }, 1000);`
);

fs.writeFileSync(filePath, code);

console.log('NAS.js 대용량 업로드 퍼센트/413 안내 패치 완료');
console.log(`📄 수정 파일: ${filePath}`);
console.log('다음 단계: 프론트엔드 빌드 후 배포하세요.');
