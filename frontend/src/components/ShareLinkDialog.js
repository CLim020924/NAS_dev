import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import axios from 'axios';
import NasItemPickerDialog from './NasItemPickerDialog';

const normalizeTarget = (target) => {
  if (!target) return null;
  const fullPath = target.fullPath || target.path;
  if (!fullPath) return null;
  const name = target.name || String(fullPath).split('/').filter(Boolean).pop() || '공유 항목';
  const type = target.type === 'linked-device' ? 'folder' : (target.type || (name.includes('.') ? 'file' : 'folder'));
  return { ...target, fullPath, name, type };
};

const ensureSharePath = (value = '/') => {
  const clean = String(value || '/').replace(/\\/g, '/').replace(/\/+/g, '/');
  if (!clean || clean === '/') return '/';
  const withSlash = clean.startsWith('/') ? clean : `/${clean}`;
  return withSlash.replace(/\/$/, '') || '/';
};

const isSameOrChildSharePath = (parentPath, childPath) => {
  const parent = ensureSharePath(parentPath);
  const child = ensureSharePath(childPath);
  if (parent === child) return true;
  if (parent === '/') return child.startsWith('/');
  return child.startsWith(`${parent}/`);
};

const removeNestedTargets = (items = []) => {
  const unique = [];
  const seen = new Set();

  items.map(normalizeTarget).filter(Boolean).forEach((item) => {
    const fullPath = ensureSharePath(item.fullPath);
    if (seen.has(fullPath)) return;
    seen.add(fullPath);
    unique.push({ ...item, fullPath });
  });

  unique.sort((a, b) => a.fullPath.length - b.fullPath.length);

  return unique.filter((item, index, list) => !list.some((candidate, candidateIndex) => {
    if (candidateIndex >= index) return false;
    if (candidate.type !== 'folder' && candidate.type !== 'linked-device') return false;
    return isSameOrChildSharePath(candidate.fullPath, item.fullPath);
  }));
};

const ShareLinkDialog = ({ open, initialTarget, initialTargets, initialPath = '/', onClose }) => {
  const [targets, setTargets] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expireDays, setExpireDays] = useState(15);
  const [allowPreview, setAllowPreview] = useState(true);
  const [allowDownload, setAllowDownload] = useState(true);
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [allowFolderDownload, setAllowFolderDownload] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [maxViews, setMaxViews] = useState('');
  const [maxDownloads, setMaxDownloads] = useState('');
  const [customExpiresAt, setCustomExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const incomingTargets = Array.isArray(initialTargets) && initialTargets.length > 0 ? initialTargets : (initialTarget ? [initialTarget] : []);
    const nextTargets = removeNestedTargets(incomingTargets);
    setTargets(nextTargets);
    setExpireDays(15);
    setAllowPreview(true);
    setAllowDownload(true);
    setIncludeSubfolders(true);
    setAllowFolderDownload(false);
    setDisplayName(nextTargets.length > 1 ? '공유 묶음' : (nextTargets[0]?.name || ''));
    setAdvancedOpen(false);
    setPassword('');
    setMaxViews('');
    setMaxDownloads('');
    setCustomExpiresAt('');
    setNote('');
    setCreating(false);
    setResult(null);
    setError('');
    setCopied(false);
  }, [open, initialTarget, initialTargets]);

  const hasFolder = targets.some((target) => target?.type === 'folder' || target?.type === 'linked-device');
  const canCreate = targets.length > 0 && !creating;

  const addTarget = (item) => {
    const nextTarget = normalizeTarget(item);
    if (!nextTarget) return;
    setTargets((prev) => {
      const next = removeNestedTargets([...prev, nextTarget]);
      if (next.length === prev.length && next.every((target, index) => target.fullPath === prev[index]?.fullPath)) return prev;
      if (!displayName.trim()) setDisplayName(next.length > 1 ? '공유 묶음' : nextTarget.name);
      return next;
    });
  };

  const removeTarget = (fullPath) => {
    setTargets((prev) => {
      const next = prev.filter((target) => target.fullPath !== fullPath);
      if (next.length === 0) setDisplayName('');
      else if (displayName === '공유 묶음' && next.length === 1) setDisplayName(next[0].name);
      return next;
    });
  };

  const expireOptions = useMemo(() => [
    { value: 1, label: '1일' },
    { value: 7, label: '7일' },
    { value: 15, label: '15일' },
    { value: 30, label: '30일' },
    { value: 90, label: '90일' }
  ], []);

  const handleCreate = async () => {
    if (targets.length === 0) {
      setPickerOpen(true);
      return;
    }

    setCreating(true);
    setError('');
    setResult(null);
    try {
      const res = await axios.post('/api/shares', {
        paths: targets.map((target) => target.fullPath),
        path: targets[0]?.fullPath,
        expireDays,
        allowPreview,
        allowDownload,
        includeSubfolders: hasFolder ? includeSubfolders : false,
        allowFolderDownload: hasFolder ? allowFolderDownload : false,
        displayName: displayName.trim() || (targets.length > 1 ? '공유 묶음' : targets[0]?.name),
        password: password.trim(),
        maxViews: Number(maxViews || 0),
        maxDownloads: Number(maxDownloads || 0),
        expiresAt: customExpiresAt ? new Date(customExpiresAt).toISOString() : undefined,
        note: note.trim()
      }, { withCredentials: true });
      setResult(res.data || null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || '공유 링크 생성에 실패했습니다.');
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async () => {
    const url = result?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 900 }}>공유 링크 생성</DialogTitle>
        <DialogContent dividers>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {result?.url && (
            <Alert severity="success" sx={{ mb: 2 }}>
              공유 링크가 생성되었습니다. 기본 유효기간은 선택한 기간까지입니다.
            </Alert>
          )}

          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 900 }}>공유할 항목</Typography>
          <Paper variant="outlined" sx={{ p: 1.5, mt: 0.5, mb: 2, display: 'flex', alignItems: 'center', gap: 1.25 }}>
            {targets.length > 0 ? (
              <>
                {hasFolder ? <FolderIcon color="primary" /> : <InsertDriveFileIcon color="action" />}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontWeight: 900 }}>{targets.length > 1 ? `${targets.length}개 항목` : targets[0].name}</Typography>
                  <Typography noWrap variant="caption" color="text.secondary">
                    {targets.length > 1 ? targets.map((item) => item.name).join(', ') : targets[0].fullPath}
                  </Typography>
                </Box>
                {!result && <Button size="small" onClick={() => setPickerOpen(true)}>경로 추가</Button>}
              </>
            ) : (
              <>
                <Typography sx={{ flex: 1 }} color="text.secondary">아직 선택된 항목이 없습니다.</Typography>
                <Button variant="outlined" size="small" onClick={() => setPickerOpen(true)}>선택</Button>
              </>
            )}
          </Paper>

          {targets.length > 0 && (
            <Box sx={{ display: 'grid', gap: 0.75, mb: 2 }}>
              {targets.map((item) => {
                const itemIsFolder = item.type === 'folder' || item.type === 'linked-device';
                return (
                  <Paper key={item.fullPath} variant="outlined" sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                    {itemIsFolder ? <FolderIcon color="primary" fontSize="small" /> : <InsertDriveFileIcon color="action" fontSize="small" />}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography noWrap sx={{ fontWeight: 800, fontSize: '0.9rem' }}>{item.name}</Typography>
                      <Typography noWrap variant="caption" color="text.secondary">{item.fullPath}</Typography>
                    </Box>
                    {!result && (
                      <IconButton size="small" color="error" onClick={() => removeTarget(item.fullPath)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    )}
                  </Paper>
                );
              })}
              {!result && (
                <Button variant="outlined" size="small" onClick={() => setPickerOpen(true)} sx={{ justifySelf: 'start' }}>
                  경로 추가
                </Button>
              )}
            </Box>
          )}

          {!result && (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>공유 링크 이름</Typography>
                <TextField
                  size="small"
                  fullWidth
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={targets.length > 1 ? '공유 묶음' : (targets[0]?.name || '공유 항목')}
                />
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>유효기간</Typography>
                <Select size="small" value={expireDays} onChange={(e) => setExpireDays(Number(e.target.value))} sx={{ minWidth: 160 }}>
                  {expireOptions.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                </Select>
              </Box>
              <FormControlLabel control={<Checkbox checked={allowPreview} onChange={(e) => setAllowPreview(e.target.checked)} />} label="미리보기 허용" />
              <FormControlLabel control={<Checkbox checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />} label="다운로드 허용" />
              {hasFolder && (
                <>
                  <FormControlLabel control={<Checkbox checked={includeSubfolders} onChange={(e) => setIncludeSubfolders(e.target.checked)} />} label="폴더 하위 항목까지 조회/다운로드 허용" />
                  <FormControlLabel control={<Checkbox checked={allowFolderDownload} onChange={(e) => setAllowFolderDownload(e.target.checked)} />} label="폴더 전체 ZIP 다운로드 허용" />
                </>
              )}
              <Box>
                <Button size="small" variant="text" onClick={() => setAdvancedOpen((value) => !value)}>
                  {advancedOpen ? '고급 설정 접기' : '고급 설정 더보기'}
                </Button>
              </Box>
              {advancedOpen && (
                <Paper variant="outlined" sx={{ p: 1.5, display: 'grid', gap: 1.25 }}>
                  <TextField
                    label="비밀번호"
                    type="password"
                    size="small"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    helperText="입력하면 링크 접속 시 비밀번호가 필요합니다."
                  />
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
                    <TextField
                      label="열람 횟수 제한"
                      type="number"
                      size="small"
                      value={maxViews}
                      onChange={(e) => setMaxViews(e.target.value)}
                      inputProps={{ min: 0 }}
                      helperText="0은 무제한"
                    />
                    <TextField
                      label="다운로드 횟수 제한"
                      type="number"
                      size="small"
                      value={maxDownloads}
                      onChange={(e) => setMaxDownloads(e.target.value)}
                      inputProps={{ min: 0 }}
                      helperText="0은 무제한"
                    />
                  </Box>
                  <TextField
                    label="직접 만료 날짜/시간"
                    type="datetime-local"
                    size="small"
                    value={customExpiresAt}
                    onChange={(e) => setCustomExpiresAt(e.target.value)}
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    label="공유 설명/메모"
                    size="small"
                    multiline
                    minRows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Paper>
              )}
            </Box>
          )}

          {result?.url && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>공유 링크</Typography>
              <TextField
                value={result.url}
                fullWidth
                size="small"
                InputProps={{
                  readOnly: true,
                  endAdornment: (
                    <IconButton edge="end" onClick={copyLink}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  )
                }}
              />
              {copied && <Typography variant="caption" color="primary" sx={{ mt: 0.75, display: 'block' }}>링크가 복사되었습니다.</Typography>}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={onClose} color="inherit">{result ? '닫기' : '취소'}</Button>
          {result?.url ? (
            <>
              <Button onClick={copyLink} startIcon={<ContentCopyIcon />}>복사</Button>
              <Button href={result.url} target="_blank" rel="noreferrer" variant="contained" startIcon={<OpenInNewIcon />}>열어보기</Button>
            </>
          ) : (
            <Button onClick={handleCreate} disabled={!canCreate} variant="contained">
              {creating ? '생성 중...' : '링크 생성'}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <NasItemPickerDialog
        open={pickerOpen}
        initialPath={initialPath}
        onClose={() => setPickerOpen(false)}
        onSelect={(item) => {
          addTarget(item);
          setPickerOpen(false);
        }}
      />
    </>
  );
};

export default ShareLinkDialog;
