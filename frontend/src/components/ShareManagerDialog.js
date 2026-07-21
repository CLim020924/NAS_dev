import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SaveIcon from '@mui/icons-material/Save';
import axios from 'axios';
import NasItemPickerDialog from './NasItemPickerDialog';

const normalizeSharePath = (value) => {
  const text = String(value || '/').replace(/\\/g, '/');
  if (!text || text === '.') return '/';
  return text.startsWith('/') ? text : `/${text}`;
};

const getDaysLeft = (expiresAt) => {
  const ms = new Date(expiresAt || 0).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
};

const ShareManagerDialog = ({ open, onClose }) => {
  const [shares, setShares] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [advancedShareId, setAdvancedShareId] = useState('');
  const [logs, setLogs] = useState([]);
  const [logsShareId, setLogsShareId] = useState('');

  const expireOptions = useMemo(() => [
    { value: 1, label: '1일' },
    { value: 7, label: '7일' },
    { value: 15, label: '15일' },
    { value: 30, label: '30일' },
    { value: 90, label: '90일' }
  ], []);

  const loadShares = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axios.get('/api/shares', { withCredentials: true });
      setShares(Array.isArray(res.data?.shares) ? res.data.shares : []);
    } catch (err) {
      setError(err.response?.data?.error || err.message || '공유 링크 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setEditing(null);
      loadShares();
    }
  }, [open]);

  const startEdit = (share) => {
    setEditing({
      shareId: share.shareId,
      displayName: share.name || '',
      path: normalizeSharePath(share.targetPath),
      type: share.type,
      expireDays: Math.max(1, Math.min(90, getDaysLeft(share.expiresAt) || 15)),
      allowPreview: share.allowPreview !== false,
      allowDownload: share.allowDownload !== false,
      includeSubfolders: share.includeSubfolders !== false,
      allowFolderDownload: share.allowFolderDownload === true,
      paused: share.paused === true,
      password: '',
      clearPassword: false,
      maxViews: share.maxViews || '',
      maxDownloads: share.maxDownloads || '',
      expiresAt: share.expiresAt ? new Date(share.expiresAt).toISOString().slice(0, 16) : '',
      note: share.note || ''
    });
    setAdvancedShareId('');
  };

  const updateEditing = (patch) => setEditing((prev) => prev ? { ...prev, ...patch } : prev);

  const saveEdit = async () => {
    if (!editing) return;
    setSavingId(editing.shareId);
    setError('');
    try {
      await axios.patch(`/api/shares/${editing.shareId}`, {
        displayName: editing.displayName,
        path: editing.path,
        expireDays: editing.expireDays,
        allowPreview: editing.allowPreview,
        allowDownload: editing.allowDownload,
        includeSubfolders: ['folder', 'bundle'].includes(editing.type) ? editing.includeSubfolders : false,
        allowFolderDownload: ['folder', 'bundle'].includes(editing.type) ? editing.allowFolderDownload : false,
        paused: editing.paused,
        password: editing.password,
        clearPassword: editing.clearPassword,
        maxViews: Number(editing.maxViews || 0),
        maxDownloads: Number(editing.maxDownloads || 0),
        expiresAt: editing.expiresAt ? new Date(editing.expiresAt).toISOString() : undefined,
        note: editing.note
      }, { withCredentials: true });
      setEditing(null);
      await loadShares();
    } catch (err) {
      setError(err.response?.data?.error || err.message || '공유 링크 수정에 실패했습니다.');
    } finally {
      setSavingId('');
    }
  };

  const deleteShare = async (share) => {
    if (!window.confirm(`'${share.name}' 공유 링크를 삭제할까요? 기존 링크는 즉시 사용할 수 없게 됩니다.`)) return;
    setSavingId(share.shareId);
    setError('');
    try {
      await axios.delete(`/api/shares/${share.shareId}`, { withCredentials: true });
      if (editing?.shareId === share.shareId) setEditing(null);
      await loadShares();
    } catch (err) {
      setError(err.response?.data?.error || err.message || '공유 링크 삭제에 실패했습니다.');
    } finally {
      setSavingId('');
    }
  };

  const purgeShare = async (share) => {
    if (!window.confirm(`'${share.name}' 공유 링크를 목록에서 완전히 제거할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    setSavingId(share.shareId);
    setError('');
    try {
      await axios.delete(`/api/shares/${share.shareId}/purge`, { withCredentials: true });
      if (editing?.shareId === share.shareId) setEditing(null);
      if (logsShareId === share.shareId) {
        setLogs([]);
        setLogsShareId('');
      }
      await loadShares();
    } catch (err) {
      setError(err.response?.data?.error || err.message || '공유 링크 제거에 실패했습니다.');
    } finally {
      setSavingId('');
    }
  };

  const copyShareUrl = async (share) => {
    if (!share.url) return;
    try {
      await navigator.clipboard.writeText(share.url);
    } catch (err) {
      const input = document.createElement('input');
      input.value = share.url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
  };

  const regenerateShareUrl = async (share) => {
    setSavingId(share.shareId);
    setError('');
    try {
      const res = await axios.post(`/api/shares/${share.shareId}/regenerate-token`, {}, { withCredentials: true });
      if (res.data?.url) {
        await navigator.clipboard.writeText(res.data.url).catch(() => {});
      }
      await loadShares();
    } catch (err) {
      setError(err.response?.data?.error || err.message || '공유 링크 재발급에 실패했습니다.');
    } finally {
      setSavingId('');
    }
  };

  const loadLogs = async (share) => {
    setSavingId(share.shareId);
    setError('');
    try {
      const res = await axios.get(`/api/shares/${share.shareId}/logs`, { withCredentials: true });
      setLogs(Array.isArray(res.data?.logs) ? res.data.logs : []);
      setLogsShareId(share.shareId);
    } catch (err) {
      setError(err.response?.data?.error || err.message || '공유 로그를 불러오지 못했습니다.');
    } finally {
      setSavingId('');
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>공유 링크 관리</DialogTitle>
        <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Alert severity="info">
            이름과 공유 대상, 옵션을 수정해도 기존 공유 링크 주소는 유지됩니다. 삭제하면 기존 링크는 즉시 만료됩니다.
          </Alert>

          {loading ? (
            <Box sx={{ py: 4, display: 'grid', placeItems: 'center' }}>
              <CircularProgress />
            </Box>
          ) : shares.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
              <Typography color="text.secondary">생성된 공유 링크가 없습니다.</Typography>
            </Paper>
          ) : (
            shares.map((share) => {
              const isEditing = editing?.shareId === share.shareId;
              const isFolder = ['folder', 'bundle'].includes(isEditing ? editing.type : share.type);
              const disabled = savingId === share.shareId;
              return (
                <Paper key={share.shareId} variant="outlined" sx={{ p: 1.5, display: 'grid', gap: 1.25 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    {['folder', 'bundle'].includes(share.type) ? <FolderIcon color="primary" /> : <InsertDriveFileIcon color="action" />}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      {isEditing ? (
                        <TextField
                          label="공유 링크 이름"
                          size="small"
                          fullWidth
                          value={editing.displayName}
                          onChange={(e) => updateEditing({ displayName: e.target.value })}
                        />
                      ) : (
                        <>
                          <Typography noWrap sx={{ fontWeight: 900 }}>{share.name}</Typography>
                          <Typography noWrap variant="caption" color="text.secondary">{share.targetPath}</Typography>
                        </>
                      )}
                    </Box>
                    <Chip size="small" color={share.revoked || share.expired || share.paused ? 'default' : 'success'} label={share.revoked ? '삭제됨' : (share.expired ? '만료됨' : (share.paused ? '일시 중지' : '활성'))} />
                    {share.url ? (
                      <>
                        <IconButton disabled={disabled} onClick={() => copyShareUrl(share)} title="링크 복사"><ContentCopyIcon /></IconButton>
                        <IconButton disabled={disabled} href={share.url} target="_blank" rel="noreferrer" title="링크 열기"><OpenInNewIcon /></IconButton>
                      </>
                    ) : (
                      <Button disabled={disabled} size="small" variant="outlined" onClick={() => regenerateShareUrl(share)}>링크 재발급</Button>
                    )}
                    <IconButton disabled={disabled} onClick={() => startEdit(share)}><EditIcon /></IconButton>
                    <Button disabled={disabled} size="small" onClick={() => loadLogs(share)}>로그</Button>
                    {share.revoked ? (
                      <Button disabled={disabled} size="small" color="error" variant="outlined" onClick={() => purgeShare(share)}>제거</Button>
                    ) : (
                      <IconButton disabled={disabled} color="error" onClick={() => deleteShare(share)} title="삭제"><DeleteIcon /></IconButton>
                    )}
                  </Box>

                  {isEditing && (
                    <>
                      <Divider />
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr auto' }, gap: 1 }}>
                        <TextField
                          label="공유 대상 경로"
                          size="small"
                          fullWidth
                          value={editing.path}
                          onChange={(e) => updateEditing({ path: normalizeSharePath(e.target.value) })}
                        />
                        <Button variant="outlined" onClick={() => setPickerOpen(true)}>찾아보기</Button>
                      </Box>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.25 }}>
                        <Typography variant="body2" color="text.secondary">지금부터 유효기간</Typography>
                        <Select size="small" value={editing.expireDays} onChange={(e) => updateEditing({ expireDays: Number(e.target.value) })}>
                          {expireOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                        </Select>
                        <FormControlLabel control={<Checkbox checked={editing.allowPreview} onChange={(e) => updateEditing({ allowPreview: e.target.checked })} />} label="미리보기" />
                        <FormControlLabel control={<Checkbox checked={editing.allowDownload} onChange={(e) => updateEditing({ allowDownload: e.target.checked })} />} label="다운로드" />
                        {isFolder && (
                          <>
                            <FormControlLabel control={<Checkbox checked={editing.includeSubfolders} onChange={(e) => updateEditing({ includeSubfolders: e.target.checked })} />} label="하위 폴더 포함" />
                            <FormControlLabel control={<Checkbox checked={editing.allowFolderDownload} onChange={(e) => updateEditing({ allowFolderDownload: e.target.checked })} />} label="ZIP 다운로드" />
                          </>
                        )}
                      </Box>
                      <Box>
                        <Button size="small" onClick={() => setAdvancedShareId((id) => id === share.shareId ? '' : share.shareId)}>
                          {advancedShareId === share.shareId ? '고급 설정 접기' : '고급 설정 더보기'}
                        </Button>
                      </Box>
                      {advancedShareId === share.shareId && (
                        <Paper variant="outlined" sx={{ p: 1.5, display: 'grid', gap: 1.25 }}>
                          <FormControlLabel control={<Checkbox checked={editing.paused} onChange={(e) => updateEditing({ paused: e.target.checked })} />} label="공유 링크 일시 중지" />
                          <TextField
                            label="새 비밀번호"
                            type="password"
                            size="small"
                            value={editing.password}
                            onChange={(e) => updateEditing({ password: e.target.value, clearPassword: false })}
                            helperText="비워두면 기존 비밀번호를 유지합니다."
                          />
                          <FormControlLabel control={<Checkbox checked={editing.clearPassword} onChange={(e) => updateEditing({ clearPassword: e.target.checked, password: '' })} />} label="비밀번호 해제" />
                          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                            <TextField label="열람 횟수 제한" type="number" size="small" value={editing.maxViews} onChange={(e) => updateEditing({ maxViews: e.target.value })} inputProps={{ min: 0 }} helperText={`현재 ${share.viewCount || 0}회`} />
                            <TextField label="다운로드 횟수 제한" type="number" size="small" value={editing.maxDownloads} onChange={(e) => updateEditing({ maxDownloads: e.target.value })} inputProps={{ min: 0 }} helperText={`현재 ${share.downloadCount || 0}회`} />
                          </Box>
                          <TextField label="직접 만료 날짜/시간" type="datetime-local" size="small" value={editing.expiresAt} onChange={(e) => updateEditing({ expiresAt: e.target.value })} InputLabelProps={{ shrink: true }} />
                          <TextField label="공유 설명/메모" size="small" multiline minRows={2} value={editing.note} onChange={(e) => updateEditing({ note: e.target.value })} />
                        </Paper>
                      )}
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                        <Button onClick={() => setEditing(null)} color="inherit">취소</Button>
                        <Button onClick={saveEdit} disabled={disabled || !editing.displayName.trim() || !editing.path.trim()} variant="contained" startIcon={<SaveIcon />}>
                          저장
                        </Button>
                      </Box>
                    </>
                  )}
                  {logsShareId === share.shareId && (
                    <Paper variant="outlined" sx={{ p: 1.25, bgcolor: 'action.hover' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 900, mb: 1 }}>최근 공유 로그</Typography>
                      {logs.length === 0 ? (
                        <Typography variant="body2" color="text.secondary">아직 기록이 없습니다.</Typography>
                      ) : (
                        <Box sx={{ display: 'grid', gap: 0.75, maxHeight: 220, overflow: 'auto' }}>
                          {logs.map((log) => (
                            <Box key={log.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '150px 120px 1fr' }, gap: 0.75 }}>
                              <Typography variant="caption" color="text.secondary">{new Date(log.createdAt).toLocaleString()}</Typography>
                              <Typography variant="caption" sx={{ fontWeight: 800 }}>{log.event}</Typography>
                              <Typography variant="caption" color="text.secondary">{log.ip || ''} {log.detail?.name || log.detail?.path || ''}</Typography>
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Paper>
                  )}
                </Paper>
              );
            })
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={loadShares} disabled={loading}>새로고침</Button>
          <Button onClick={onClose} variant="contained">닫기</Button>
        </DialogActions>
      </Dialog>

      <NasItemPickerDialog
        open={pickerOpen}
        initialPath={editing?.path || '/'}
        onClose={() => setPickerOpen(false)}
        onSelect={(item) => {
          updateEditing({
            path: normalizeSharePath(item.fullPath || item.path),
            type: item.type === 'linked-device' ? 'folder' : item.type
          });
          setPickerOpen(false);
        }}
      />
    </>
  );
};

export default ShareManagerDialog;
