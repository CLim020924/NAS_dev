import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';
import { Box, Typography, Paper, IconButton, LinearProgress, Snackbar, Alert, CircularProgress } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { ensureSlash } from '../components/NAS/nasUtils';

const TransferContext = createContext(null);

export const useTransfer = () => {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error('useTransfer must be used inside TransferProvider');
  return ctx;
};

const getCurrentUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}') || {};
  } catch (err) {
    return {};
  }
};

export const TransferProvider = ({ children }) => {
  const currentUser = getCurrentUser();

  const [transferTasks, setTransferTasks] = useState([]);
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'info' });

  const uploadControllersRef = useRef({});
  const resumeTaskRef = useRef(null);
  const resumeInputRef = useRef(null);

  const handleCloseSnackbar = () => setSnackbar(prev => ({ ...prev, open: false }));


  const emitTransferCompleted = (targetPath) => {
    const safePath = ensureSlash(targetPath || '/');
    window.dispatchEvent(new CustomEvent('nas_transfer_completed', { detail: { path: safePath } }));
    window.dispatchEvent(new CustomEvent('nas_tree_refresh'));
  };


  const getUploadUserKey = () => {
    return String(
      currentUser.userUid ||
      currentUser.loginId ||
      currentUser.id ||
      currentUser.username ||
      currentUser.name ||
      'unknown'
    );
  };

  const getResumableStorageKey = () => `nas_resumable_uploads_${getUploadUserKey()}`;

  const readResumableSessions = () => {
    try {
      const raw = localStorage.getItem(getResumableStorageKey());
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  };

  const writeResumableSessions = (sessions) => {
    try {
      localStorage.setItem(getResumableStorageKey(), JSON.stringify(sessions || []));
    } catch (err) {
      console.warn('이어올리기 세션 저장 실패:', err);
    }
  };

  const saveResumableSession = (session) => {
    if (!session || !session.taskId) return;
    const sessions = readResumableSessions();
    const idx = sessions.findIndex(s => s.taskId === session.taskId);
    const next = {
      ...session,
      updatedAt: new Date().toISOString()
    };

    if (idx >= 0) sessions[idx] = next;
    else sessions.push(next);

    writeResumableSessions(sessions);
  };

  const removeResumableSession = (taskId) => {
    if (!taskId) return;
    writeResumableSessions(readResumableSessions().filter(s => s.taskId !== taskId));
  };

  const getFileResumeKey = (file, relPath) => {
    return [
      relPath || file.name,
      file.name,
      file.size,
      file.lastModified || 0
    ].join('|');
  };

  const getStoredFileResumeKey = (meta) => {
    return [
      meta.relPath || meta.name,
      meta.name,
      meta.size,
      meta.lastModified || 0
    ].join('|');
  };

  const fileMatchesResumeMeta = (file, meta) => {
    if (!file || !meta) return false;
    return file.name === meta.name &&
      Number(file.size) === Number(meta.size) &&
      Number(file.lastModified || 0) === Number(meta.lastModified || 0);
  };

  const restoreResumableUploadTasks = useCallback(() => {
    const sessions = readResumableSessions().filter(s => s && s.taskId && s.status !== 'done' && s.status !== 'canceled');

    if (!sessions.length) return;

    setTransferTasks(prev => {
      const existing = new Set(prev.map(t => t.id));
      const restored = sessions
        .filter(s => !existing.has(s.taskId))
        .map(s => {
          const currentFile = s.files?.[s.currentFileIndex || 0] || s.files?.[0];
          return {
            id: s.taskId,
            sessionId: s.sessionId,
            name: s.taskName || currentFile?.name || '중단된 업로드',
            total: s.files?.length || 1,
            completed: s.completedFiles || 0,
            percent: s.percent || 0,
            status: 'paused',
            currentFileName: currentFile?.name || s.taskName || '중단된 업로드',
            label: '중단됨 · 같은 파일 선택 시 이어올리기',
            resumeNeedsFile: true,
            targetPath: s.targetPath || '/',
            resumeMeta: s
          };
        });

      return restored.length ? [...prev, ...restored] : prev;
    });

    sessions.forEach(s => {
      if (!uploadControllersRef.current[s.taskId]) {
        uploadControllersRef.current[s.taskId] = {
          canceled: false,
          paused: true,
          resuming: false,
          sessionId: s.sessionId,
          controllers: new Set(),
          uploadIds: new Set(Object.values(s.uploadIds || {})),
          uploadIdByKey: { ...(s.uploadIds || {}) },
          resumeMeta: s,
          files: null,
          targetPath: s.targetPath || '/',
          taskName: s.taskName || '중단된 업로드',
          currentFileIndex: s.currentFileIndex || 0
        };
      }
    });
  }, []);

  useEffect(() => {
    restoreResumableUploadTasks();
  }, [restoreResumableUploadTasks]);


  const LARGE_UPLOAD_THRESHOLD = 64 * 1024 * 1024;
  const FILE_CHUNK_SIZE = 64 * 1024 * 1024;
  const FILE_CHUNK_CONCURRENCY = 3;
  const FILE_CHUNK_RETRY = 5;

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  const isCanceledError = (err) => {
    return err?.code === 'ERR_CANCELED' ||
      err?.name === 'CanceledError' ||
      err?.response?.status === 409 ||
      String(err?.message || '').toLowerCase().includes('canceled') ||
      String(err?.response?.data?.error || '').includes('UPLOAD_CANCELED');
  };

  const normalizeUploadJoin = (base, rel) => {
    const safeBase = ensureSlash(base || '/');
    const cleanRel = String(rel || '').replace(/^\/+/, '');
    if (!cleanRel) return safeBase;
    return safeBase === '/' ? `/${cleanRel}` : `${safeBase}/${cleanRel}`;
  };

  const getUploadDestDir = (basePath, relPath) => {
    const fullPath = normalizeUploadJoin(basePath, relPath);
    const idx = fullPath.lastIndexOf('/');
    return idx <= 0 ? '/' : fullPath.substring(0, idx);
  };

  const getUploadTaskState = (taskId) => uploadControllersRef.current[taskId];

  const setTaskPatch = (taskId, patch) => {
    setTransferTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...patch } : t));
  };

  const createUploadTaskState = (taskId, sessionId, extra = {}) => {
    const resumeMeta = extra.resumeMeta || null;
    const state = {
      canceled: false,
      paused: Boolean(extra.paused),
      resuming: false,
      sessionId,
      controllers: new Set(),
      uploadIds: new Set(Object.values(resumeMeta?.uploadIds || {})),
      uploadIdByKey: { ...(resumeMeta?.uploadIds || {}) },
      resumeMeta,
      files: extra.files || null,
      targetPath: extra.targetPath || resumeMeta?.targetPath || '/',
      taskName: extra.taskName || resumeMeta?.taskName || '',
      currentFileIndex: extra.currentFileIndex || resumeMeta?.currentFileIndex || 0
    };
    uploadControllersRef.current[taskId] = state;
    return state;
  };

  const cancelUploadTaskState = async (taskId) => {
    const state = getUploadTaskState(taskId);
    if (!state) return;

    state.canceled = true;
    state.paused = false;

    for (const ctrl of Array.from(state.controllers)) {
      try { ctrl.abort(); } catch (e) {}
    }

    const cancelCalls = [];

    if (state.sessionId) {
      cancelCalls.push(
        axios.post('/api/file/cancel-session', { sessionId: state.sessionId }, { withCredentials: true }).catch(() => null)
      );
    }

    for (const uploadId of Array.from(state.uploadIds)) {
      cancelCalls.push(
        axios.post('/api/file/chunk/cancel', { uploadId }, { withCredentials: true }).catch(() => null)
      );
    }

    await Promise.all(cancelCalls);
    removeResumableSession(taskId);
  };

  const handleCancelTransferTask = async (task) => {
    setTaskPatch(task.id, { status: 'canceling', label: '취소 중...' });

    try {
      await cancelUploadTaskState(task.id);
    } catch (err) {
      console.warn('업로드 취소 처리 중 오류:', err);
    }

    delete uploadControllersRef.current[task.id];
    setTransferTasks(prev => prev.filter(t => t.id !== task.id));
    setSnackbar({ open: true, message: `'${task.name}' 업로드 취소`, severity: 'info' });
  };

  const pauseUploadTaskState = (taskId) => {
    const state = getUploadTaskState(taskId);
    if (!state) return null;

    state.paused = true;
    state.canceled = false;

    for (const ctrl of Array.from(state.controllers)) {
      try { ctrl.abort(); } catch (e) {}
    }

    if (state.resumeMeta) {
      state.resumeMeta.status = 'paused';
      state.resumeMeta.currentFileIndex = state.currentFileIndex || 0;
      state.resumeMeta.percent = state.resumeMeta.percent || 0;
      saveResumableSession(state.resumeMeta);
    }

    return state;
  };

  const handlePauseTransferTask = async (task) => {
    const state = pauseUploadTaskState(task.id);

    setTaskPatch(task.id, {
      status: 'paused',
      label: '중단됨 · 이어올리기 가능'
    });

    if (state?.resumeMeta) saveResumableSession(state.resumeMeta);

    setSnackbar({ open: true, message: `'${task.name}' 업로드 일시정지`, severity: 'info' });
  };

  const handleResumeTransferTask = async (task) => {
    let state = getUploadTaskState(task.id);

    if (!state) {
      state = createUploadTaskState(task.id, task.sessionId, {
        paused: true,
        resumeMeta: task.resumeMeta,
        targetPath: task.targetPath || task.resumeMeta?.targetPath || '/',
        taskName: task.name
      });
    }

    if (state.resuming) return;

    if (!state.files || !state.files.length) {
      resumeTaskRef.current = task;
      setSnackbar({ open: true, message: `'${task.currentFileName || task.name}' 파일을 다시 선택하면 이어올립니다.`, severity: 'info' });
      if (resumeInputRef.current) {
        resumeInputRef.current.value = '';
        resumeInputRef.current.click();
      }
      return;
    }

    state.resuming = true;
    state.paused = false;
    state.canceled = false;

    setTaskPatch(task.id, {
      status: 'queued',
      label: '이어올리기 준비 중...'
    });

    try {
      await uploadFilesSequentialWithChunks({
        uploadItems: state.files,
        targetPath: state.targetPath || task.targetPath || '/',
        taskName: state.taskName || task.name,
        existingTaskId: task.id,
        existingSessionId: state.sessionId || task.sessionId,
        startIndex: state.currentFileIndex || 0,
        resumeMeta: state.resumeMeta || task.resumeMeta || null
      });
    } finally {
      const latest = getUploadTaskState(task.id);
      if (latest) latest.resuming = false;
    }
  };

  const createAbortControllerForTask = (taskId) => {
    const state = getUploadTaskState(taskId);
    const controller = new AbortController();

    if (state) {
      state.controllers.add(controller);
      if (state.canceled || state.paused) controller.abort();
    }

    return controller;
  };

  const removeAbortControllerForTask = (taskId, controller) => {
    const state = getUploadTaskState(taskId);
    if (state) state.controllers.delete(controller);
  };

  const isPausedError = (err) => {
    return err?.code === 'UPLOAD_PAUSED' || String(err?.message || '').includes('UPLOAD_PAUSED');
  };

  const throwIfTaskCanceled = (taskId) => {
    const state = getUploadTaskState(taskId);

    if (state?.canceled) {
      const err = new Error('UPLOAD_CANCELED');
      err.code = 'ERR_CANCELED';
      throw err;
    }

    if (state?.paused) {
      const err = new Error('UPLOAD_PAUSED');
      err.code = 'UPLOAD_PAUSED';
      throw err;
    }
  };

  const uploadSmallFileDirect = async ({ file, relPath, targetPath, taskId, sessionId }) => {
    throwIfTaskCanceled(taskId);

    const destDirPath = getUploadDestDir(targetPath, relPath);
    const formData = new FormData();
    formData.append('path', destDirPath);
    formData.append('file', file);

    const controller = createAbortControllerForTask(taskId);

    try {
      await axios.post('/api/file', formData, {
        withCredentials: true,
        timeout: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        signal: controller.signal,
        headers: {
          'Content-Type': 'multipart/form-data',
          'x-upload-session': sessionId
        },
        onUploadProgress: (evt) => {
          const total = evt.total || file.size;
          if (!total) return;
          const percent = Math.max(0, Math.min(99, Math.round((evt.loaded * 100) / total)));
          setTaskPatch(taskId, {
            percent,
            currentFileName: file.name,
            label: `${percent}%`
          });
        }
      });
    } finally {
      removeAbortControllerForTask(taskId, controller);
    }
  };

  const uploadLargeFileByChunks = async ({ file, relPath, targetPath, taskId }) => {
    throwIfTaskCanceled(taskId);

    const state = getUploadTaskState(taskId);
    const destDirPath = getUploadDestDir(targetPath, relPath);
    let chunkSize = Number(state?.resumeMeta?.chunkSize || FILE_CHUNK_SIZE);
    if (!Number.isFinite(chunkSize) || chunkSize <= 0) chunkSize = FILE_CHUNK_SIZE;
    let totalChunks = Math.ceil(file.size / chunkSize);
    const fileResumeKey = getFileResumeKey(file, relPath || file.name);

    setTaskPatch(taskId, {
      status: 'uploading',
      method: 'chunk',
      currentFileName: file.name,
      percent: 0,
      chunkIndex: 0,
      totalChunks,
      label: `0% · 청크 0/${totalChunks}`
    });

    if (state?.resumeMeta) {
      state.resumeMeta.status = 'uploading';
      state.resumeMeta.targetPath = targetPath;
      state.resumeMeta.percent = state.resumeMeta.percent || 0;
      state.resumeMeta.currentFileIndex = state.currentFileIndex || 0;
      state.resumeMeta.uploadIds = state.resumeMeta.uploadIds || {};
      saveResumableSession(state.resumeMeta);
    }

    let uploadId = state?.uploadIdByKey?.[fileResumeKey] || state?.resumeMeta?.uploadIds?.[fileResumeKey] || null;
    let receivedSet = new Set();

    const getChunkByteSize = (idx) => {
      const startByte = idx * chunkSize;
      const endByte = Math.min(file.size, startByte + chunkSize);
      return Math.max(0, endByte - startByte);
    };

    if (uploadId) {
      const statusController = createAbortControllerForTask(taskId);

      try {
        const statusRes = await axios.post('/api/file/chunk/status', { uploadId }, {
          withCredentials: true,
          timeout: 0,
          signal: statusController.signal
        });

        if (statusRes.data?.canceled) {
          throw new Error('UPLOAD_CANCELED');
        }

        const serverChunkSize = Number(statusRes.data?.chunkSize);
        const serverTotalChunks = Number(statusRes.data?.totalChunks);

        if (Number.isFinite(serverChunkSize) && serverChunkSize > 0) {
          chunkSize = serverChunkSize;
          totalChunks = Number.isFinite(serverTotalChunks) && serverTotalChunks > 0
            ? serverTotalChunks
            : Math.ceil(file.size / chunkSize);
        }

        if (state?.resumeMeta) {
          state.resumeMeta.chunkSize = chunkSize;
          state.resumeMeta.totalChunks = totalChunks;
          saveResumableSession(state.resumeMeta);
        }

        receivedSet = new Set((statusRes.data?.receivedChunks || []).map(Number));
      } catch (err) {
        if (isCanceledError(err) || isPausedError(err) || getUploadTaskState(taskId)?.paused) throw err;

        if (err?.response?.status === 404) {
          uploadId = null;
          if (state?.uploadIdByKey) delete state.uploadIdByKey[fileResumeKey];
          if (state?.resumeMeta?.uploadIds) delete state.resumeMeta.uploadIds[fileResumeKey];
        } else {
          throw err;
        }
      } finally {
        removeAbortControllerForTask(taskId, statusController);
      }
    }

    if (!uploadId) {
      let initController = createAbortControllerForTask(taskId);

      try {
        const initRes = await axios.post('/api/file/chunk/init', {
          path: destDirPath,
          fileName: file.name,
          fileSize: file.size,
          chunkSize,
          totalChunks
        }, {
          withCredentials: true,
          timeout: 0,
          signal: initController.signal
        });

        uploadId = initRes.data.uploadId;
        if (!uploadId) throw new Error('청크 uploadId를 받지 못했습니다.');

        if (state?.resumeMeta) {
          state.resumeMeta.chunkSize = chunkSize;
          state.resumeMeta.totalChunks = totalChunks;
          saveResumableSession(state.resumeMeta);
        }
      } finally {
        removeAbortControllerForTask(taskId, initController);
      }
    }

    if (state) {
      state.uploadIds.add(uploadId);
      state.uploadIdByKey = state.uploadIdByKey || {};
      state.uploadIdByKey[fileResumeKey] = uploadId;

      state.resumeMeta = state.resumeMeta || {};
      state.resumeMeta.uploadIds = state.resumeMeta.uploadIds || {};
      state.resumeMeta.uploadIds[fileResumeKey] = uploadId;
      state.resumeMeta.status = 'uploading';
      saveResumableSession(state.resumeMeta);
    }

    throwIfTaskCanceled(taskId);

    let uploadedBytes = Array.from(receivedSet).reduce((sum, idx) => sum + getChunkByteSize(idx), 0);
    let completedChunks = receivedSet.size;
    const chunkProgress = new Map();

    const missingChunks = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!receivedSet.has(i)) missingChunks.push(i);
    }

    const initialPercent = Math.max(0, Math.min(99, Math.floor((uploadedBytes * 100) / file.size)));
    setTaskPatch(taskId, {
      percent: initialPercent,
      currentFileName: file.name,
      chunkIndex: completedChunks,
      totalChunks,
      label: `${initialPercent}% · 청크 ${completedChunks}/${totalChunks}`
    });

    const uploadChunk = async (chunkIndex) => {
      const startByte = chunkIndex * chunkSize;
      const endByte = Math.min(file.size, startByte + chunkSize);
      const chunkBlob = file.slice(startByte, endByte);
      const chunkBytes = endByte - startByte;

      for (let attempt = 0; attempt <= FILE_CHUNK_RETRY; attempt++) {
        throwIfTaskCanceled(taskId);

        const formData = new FormData();
        formData.append('uploadId', uploadId);
        formData.append('chunkIndex', String(chunkIndex));
        formData.append('startByte', String(startByte));
        formData.append('chunk', chunkBlob, `${file.name}.part${chunkIndex}`);

        const controller = createAbortControllerForTask(taskId);

        try {
          await axios.post('/api/file/chunk', formData, {
            withCredentials: true,
            timeout: 0,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            signal: controller.signal,
            headers: {
              'Content-Type': 'multipart/form-data',
              'x-upload-id': uploadId,
              'x-chunk-index': String(chunkIndex),
              'x-start-byte': String(startByte)
            },
            onUploadProgress: (evt) => {
              const loaded = Math.min(evt.loaded || 0, chunkBytes);
              const prevLoaded = chunkProgress.get(chunkIndex) || 0;

              if (loaded > prevLoaded) {
                uploadedBytes += loaded - prevLoaded;
                chunkProgress.set(chunkIndex, loaded);

                const percent = Math.max(0, Math.min(99, Math.floor((uploadedBytes * 100) / file.size)));
                if (state?.resumeMeta) {
                  state.resumeMeta.percent = percent;
                  saveResumableSession(state.resumeMeta);
                }

                setTaskPatch(taskId, {
                  percent,
                  currentFileName: file.name,
                  label: `${percent}% · 청크 ${completedChunks}/${totalChunks}`
                });
              }
            }
          });

          const prevLoaded = chunkProgress.get(chunkIndex) || 0;
          if (chunkBytes > prevLoaded) {
            uploadedBytes += chunkBytes - prevLoaded;
            chunkProgress.set(chunkIndex, chunkBytes);
          }

          completedChunks += 1;
          receivedSet.add(chunkIndex);

          const percent = Math.max(0, Math.min(99, Math.floor((uploadedBytes * 100) / file.size)));

          if (state?.resumeMeta) {
            state.resumeMeta.percent = percent;
            saveResumableSession(state.resumeMeta);
          }

          setTaskPatch(taskId, {
            percent,
            currentFileName: file.name,
            chunkIndex: completedChunks,
            totalChunks,
            label: `${percent}% · 청크 ${completedChunks}/${totalChunks}`
          });

          return;
        } catch (err) {
          if (isPausedError(err) || getUploadTaskState(taskId)?.paused) throw err;
          if (isCanceledError(err) || getUploadTaskState(taskId)?.canceled) throw err;

          const counted = chunkProgress.get(chunkIndex) || 0;
          if (counted > 0) {
            uploadedBytes = Math.max(0, uploadedBytes - counted);
            chunkProgress.delete(chunkIndex);
          }

          if (attempt >= FILE_CHUNK_RETRY) throw err;

          await sleep(500 * (attempt + 1));
        } finally {
          removeAbortControllerForTask(taskId, controller);
        }
      }
    };

    let nextMissingCursor = 0;

    const worker = async () => {
      while (true) {
        throwIfTaskCanceled(taskId);

        const current = missingChunks[nextMissingCursor];
        nextMissingCursor += 1;

        if (current === undefined) return;

        await uploadChunk(current);
      }
    };

    const workerCount = Math.min(FILE_CHUNK_CONCURRENCY, Math.max(1, missingChunks.length));
    if (missingChunks.length > 0) {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    }

    throwIfTaskCanceled(taskId);

    const completeController = createAbortControllerForTask(taskId);

    try {
      await axios.post('/api/file/chunk/complete', { uploadId }, {
        withCredentials: true,
        timeout: 0,
        signal: completeController.signal
      });

      state?.uploadIds.delete(uploadId);
    } finally {
      removeAbortControllerForTask(taskId, completeController);
    }

    setTaskPatch(taskId, {
      percent: 100,
      currentFileName: file.name,
      chunkIndex: totalChunks,
      totalChunks,
      label: `100% · 청크 ${totalChunks}/${totalChunks}`
    });
  };

  const collectDroppedUploadItems = async (dataTransfer) => {
    const items = dataTransfer?.items ? Array.from(dataTransfer.items) : [];
    const plainFiles = dataTransfer?.files ? Array.from(dataTransfer.files) : [];

    const readAllEntries = async (reader) => {
      let all = [];
      while (true) {
        const chunk = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!chunk || chunk.length === 0) break;
        all = all.concat(chunk);
      }
      return all;
    };

    const scanEntry = async (entry, prefix = '') => {
      if (!entry) return [];

      if (entry.isFile) {
        try {
          const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
          if (!file) return [];
          return [{ file, relPath: `${prefix}${file.name}` }];
        } catch (err) {
          console.warn('파일 엔트리 읽기 실패:', `${prefix}${entry.name || ''}`, err);
          return [];
        }
      }

      if (entry.isDirectory) {
        const dirName = entry.name || '';
        const dirPrefix = `${prefix}${dirName}/`;
        const reader = entry.createReader();
        const children = await readAllEntries(reader);

        let out = [];
        for (const child of children) {
          out = out.concat(await scanEntry(child, dirPrefix));
        }
        return out;
      }

      return [];
    };

    if (items.length > 0 && items.some(item => item.webkitGetAsEntry && item.webkitGetAsEntry())) {
      let uploadList = [];
      for (const item of items) {
        const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
        if (!entry) continue;
        uploadList = uploadList.concat(await scanEntry(entry, ''));
      }
      return uploadList;
    }

    return plainFiles.map(file => ({
      file,
      relPath: file.webkitRelativePath || file.name
    }));
  };

  const uploadFilesSequentialWithChunks = async ({
    uploadItems,
    targetPath,
    taskName,
    existingTaskId = null,
    existingSessionId = null,
    startIndex = 0,
    resumeMeta = null
  }) => {
    const files = (uploadItems || []).filter(item => item?.file);

    if (!files.length) {
      setSnackbar({ open: true, message: '업로드할 파일을 읽지 못했습니다.', severity: 'warning' });
      return;
    }

    const safeTargetPath = ensureSlash(targetPath || resumeMeta?.targetPath || '/');
    const taskId = existingTaskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = existingSessionId || resumeMeta?.sessionId || `upl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const displayName = taskName || resumeMeta?.taskName || files[0].file.name || '업로드';

    let state = getUploadTaskState(taskId);

    const fileMetas = files.map(item => ({
      name: item.file.name,
      size: item.file.size,
      lastModified: item.file.lastModified || 0,
      relPath: item.relPath || item.file.name,
      type: item.file.type || ''
    }));

    const baseResumeMeta = resumeMeta || state?.resumeMeta || {
      taskId,
      sessionId,
      taskName: displayName,
      targetPath: safeTargetPath,
      files: fileMetas,
      uploadIds: {},
      status: 'uploading',
      currentFileIndex: startIndex,
      completedFiles: startIndex,
      percent: 0,
      createdAt: new Date().toISOString()
    };

    baseResumeMeta.taskId = taskId;
    baseResumeMeta.sessionId = sessionId;
    baseResumeMeta.taskName = displayName;
    baseResumeMeta.targetPath = safeTargetPath;
    baseResumeMeta.files = baseResumeMeta.files && baseResumeMeta.files.length ? baseResumeMeta.files : fileMetas;
    baseResumeMeta.uploadIds = baseResumeMeta.uploadIds || {};
    baseResumeMeta.status = 'uploading';

    if (!state) {
      state = createUploadTaskState(taskId, sessionId, {
        files,
        targetPath: safeTargetPath,
        taskName: displayName,
        resumeMeta: baseResumeMeta,
        currentFileIndex: startIndex
      });
    } else {
      state.canceled = false;
      state.paused = false;
      state.files = files;
      state.targetPath = safeTargetPath;
      state.taskName = displayName;
      state.resumeMeta = baseResumeMeta;
      state.uploadIdByKey = { ...(baseResumeMeta.uploadIds || {}) };
      state.currentFileIndex = startIndex;
    }

    saveResumableSession(baseResumeMeta);

    if (!existingTaskId) {
      setTransferTasks(prev => [
        ...prev,
        {
          id: taskId,
          sessionId,
          name: displayName,
          total: files.length,
          completed: startIndex,
          percent: baseResumeMeta.percent || 0,
          status: 'queued',
          currentFileName: files[startIndex]?.file?.name || files[0].file.name,
          label: files.length > 1 ? `대기 중 · ${startIndex}/${files.length}` : '대기 중',
          targetPath: safeTargetPath,
          resumeMeta: baseResumeMeta
        }
      ]);
    } else {
      setTaskPatch(taskId, {
        sessionId,
        name: displayName,
        total: files.length,
        completed: startIndex,
        status: 'queued',
        targetPath: safeTargetPath,
        resumeMeta: baseResumeMeta,
        label: '이어올리기 준비 중...'
      });
    }

    let completedFiles = Math.max(0, startIndex || 0);

    try {
      for (let i = completedFiles; i < files.length; i++) {
        state.currentFileIndex = i;
        baseResumeMeta.currentFileIndex = i;
        baseResumeMeta.completedFiles = completedFiles;
        baseResumeMeta.status = 'uploading';
        saveResumableSession(baseResumeMeta);

        throwIfTaskCanceled(taskId);

        const item = files[i];
        const file = item.file;

        setTaskPatch(taskId, {
          status: 'uploading',
          currentFileName: file.name,
          completed: completedFiles,
          total: files.length,
          percent: i === completedFiles ? (baseResumeMeta.percent || 0) : 0,
          label: files.length > 1 ? `파일 ${i + 1}/${files.length}` : '0%',
          targetPath: safeTargetPath,
          resumeMeta: baseResumeMeta
        });

        if (file.size > LARGE_UPLOAD_THRESHOLD) {
          await uploadLargeFileByChunks({
            file,
            relPath: item.relPath || file.name,
            targetPath: safeTargetPath,
            taskId
          });
        } else {
          await uploadSmallFileDirect({
            file,
            relPath: item.relPath || file.name,
            targetPath: safeTargetPath,
            taskId,
            sessionId
          });
        }

        completedFiles += 1;
        baseResumeMeta.completedFiles = completedFiles;
        baseResumeMeta.percent = 100;
        saveResumableSession(baseResumeMeta);

        setTaskPatch(taskId, {
          completed: completedFiles,
          percent: 100,
          label: files.length > 1 ? `완료 ${completedFiles}/${files.length}` : '100%',
          resumeMeta: baseResumeMeta
        });
      }

      delete uploadControllersRef.current[taskId];
      removeResumableSession(taskId);

      setTaskPatch(taskId, {
        status: 'done',
        completed: completedFiles,
        percent: 100,
        label: files.length > 1 ? `완료 ${completedFiles}/${files.length}` : '100%'
      });

      emitTransferCompleted(safeTargetPath);
      if (safeTargetPath !== '/') emitTransferCompleted('/');

      setSnackbar({
        open: true,
        message: `'${displayName}' 업로드 완료! (${completedFiles}개)`,
        severity: 'success'
      });

      setTimeout(() => {
        setTransferTasks(prev => prev.filter(t => t.id !== taskId));
      }, 1200);
    } catch (err) {
      const latestState = getUploadTaskState(taskId);
      const wasPaused = latestState?.paused || isPausedError(err);

      if (wasPaused) {
        baseResumeMeta.status = 'paused';
        baseResumeMeta.currentFileIndex = latestState?.currentFileIndex || completedFiles;
        baseResumeMeta.completedFiles = completedFiles;
        saveResumableSession(baseResumeMeta);

        setTaskPatch(taskId, {
          status: 'paused',
          label: '중단됨 · 이어올리기 가능',
          completed: completedFiles,
          resumeMeta: baseResumeMeta
        });

        setSnackbar({ open: true, message: `'${displayName}' 업로드 일시정지`, severity: 'info' });
        return;
      }

      const wasCanceled = latestState?.canceled || isCanceledError(err);

      if (wasCanceled) {
        try {
          await cancelUploadTaskState(taskId);
        } catch (cancelErr) {
          console.warn('취소 후 서버 정리 실패:', cancelErr);
        }

        if (completedFiles > 0) {
          emitTransferCompleted(safeTargetPath);
          if (safeTargetPath !== '/') emitTransferCompleted('/');
        }

        removeResumableSession(taskId);
        delete uploadControllersRef.current[taskId];
        setTransferTasks(prev => prev.filter(t => t.id !== taskId));
        setSnackbar({ open: true, message: `'${displayName}' 업로드 취소`, severity: 'info' });
        return;
      }

      console.error('청크/순차 업로드 실패:', err);

      delete uploadControllersRef.current[taskId];

      baseResumeMeta.status = 'failed';
      saveResumableSession(baseResumeMeta);

      setTaskPatch(taskId, {
        status: 'failed',
        label: '실패',
        percent: 100,
        resumeMeta: baseResumeMeta
      });

      setTimeout(() => {
        setTransferTasks(prev => prev.filter(t => t.id !== taskId));
      }, 3000);

      setSnackbar({ open: true, message: `[업로드 오류] ${err?.response?.data?.error || err.message || '알 수 없는 오류'}`, severity: 'error' });
    } finally {
      if (resumeInputRef.current) resumeInputRef.current.value = '';
    }
  };



  const handleResumeFileInput = async (e) => {
    const files = Array.from(e.target.files || []);
    const resumeTask = resumeTaskRef.current;
    resumeTaskRef.current = null;

    if (resumeInputRef.current) resumeInputRef.current.value = '';

    if (!resumeTask || !files.length) return;

    const state = getUploadTaskState(resumeTask.id);
    const resumeMeta = state?.resumeMeta || resumeTask.resumeMeta;

    if (!resumeMeta) {
      setSnackbar({ open: true, message: '이어올리기 정보를 찾지 못했습니다.', severity: 'error' });
      return;
    }

    const targetIndex = resumeMeta.currentFileIndex || 0;
    const expected = resumeMeta.files?.[targetIndex] || resumeMeta.files?.[0];
    const selectedFile = files.find(file => fileMatchesResumeMeta(file, expected)) || files[0];

    if (!fileMatchesResumeMeta(selectedFile, expected)) {
      setSnackbar({
        open: true,
        message: `'${expected?.name || resumeTask.name}'와 같은 파일을 선택해야 이어올리기 가능합니다.`,
        severity: 'error'
      });
      return;
    }

    const uploadItems = [{
      file: selectedFile,
      relPath: expected.relPath || selectedFile.name
    }];

    let resumeState = state;

    if (!resumeState) {
      resumeState = createUploadTaskState(resumeTask.id, resumeMeta.sessionId || resumeTask.sessionId, {
        paused: false,
        resumeMeta,
        targetPath: resumeMeta.targetPath || '/',
        taskName: resumeMeta.taskName || resumeTask.name,
        currentFileIndex: 0
      });
    }

    resumeState.files = uploadItems;
    resumeState.paused = false;
    resumeState.canceled = false;
    resumeState.targetPath = resumeMeta.targetPath || '/';
    resumeState.taskName = resumeMeta.taskName || resumeTask.name;

    await uploadFilesSequentialWithChunks({
      uploadItems,
      targetPath: resumeMeta.targetPath || '/',
      taskName: resumeMeta.taskName || selectedFile.name,
      existingTaskId: resumeTask.id,
      existingSessionId: resumeMeta.sessionId || resumeTask.sessionId,
      startIndex: 0,
      resumeMeta
    });
  };

  const startUpload = async ({ uploadItems, targetPath = '/', taskName = '업로드' }) => {
    return uploadFilesSequentialWithChunks({
      uploadItems,
      targetPath,
      taskName
    });
  };



  const value = {
    startUpload
  };

  return (
    <TransferContext.Provider value={value}>
      {children}

      <input
        type="file"
        ref={resumeInputRef}
        style={{ display: 'none' }}
        onChange={handleResumeFileInput}
      />

      {transferTasks.length > 0 && (
        <Box sx={{ position: 'fixed', bottom: 20, right: 20, width: 360, zIndex: 20000, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {transferTasks.map(task => {
            const percent = Math.max(0, Math.min(100, Number(task.percent || 0)));
            const canPause = ['queued', 'scanning', 'uploading'].includes(task.status);
            const canResume = task.status === 'paused';
            const canCancel = ['queued', 'scanning', 'uploading', 'paused', 'canceling'].includes(task.status);
            const title =
              task.status === 'canceling' ? `취소 중: ${task.currentFileName || task.name}` :
              task.status === 'paused' ? `중단됨: ${task.currentFileName || task.name}` :
              task.status === 'queued' ? `대기 중: ${task.currentFileName || task.name}` :
              task.status === 'done' ? `완료: ${task.name}` :
              task.status === 'failed' ? `실패: ${task.currentFileName || task.name}` :
              `업로드 중: ${task.currentFileName || task.name}`;

            const subText = task.label || (
              task.total > 1
                ? `${task.completed || 0}/${task.total}`
                : `${percent}%`
            );

            return (
              <Paper key={task.id} elevation={8} sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{ p: 1, bgcolor: '#323232', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {title}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>
                      {subText}
                    </Typography>
                  </Box>

                  {canResume && (
                    <IconButton size="small" color="inherit" title="이어올리기" onClick={() => handleResumeTransferTask(task)}>
                      <PlayArrowIcon fontSize="inherit" />
                    </IconButton>
                  )}

                  {canPause && (
                    <IconButton size="small" color="inherit" title="일시정지" onClick={() => handlePauseTransferTask(task)}>
                      <PauseIcon fontSize="inherit" />
                    </IconButton>
                  )}

                  {canCancel && (
                    <IconButton size="small" color="inherit" title="취소" onClick={() => handleCancelTransferTask(task)}>
                      <CloseIcon fontSize="inherit" />
                    </IconButton>
                  )}
                </Box>

                <LinearProgress
                  variant={task.status === 'queued' || task.status === 'scanning' || task.status === 'canceling' ? 'query' : 'determinate'}
                  value={percent}
                  sx={{ height: 5 }}
                />
              </Paper>
            );
          })}
        </Box>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={snackbar.severity === 'info' ? null : 3000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleCloseSnackbar} severity={snackbar.severity} sx={{ width: '100%', display: 'flex', alignItems: 'center' }}>
          {snackbar.severity === 'info' && <CircularProgress size={20} sx={{ mr: 2, color: 'inherit' }} />}
          {snackbar.message}
        </Alert>
      </Snackbar>
    </TransferContext.Provider>
  );
};

