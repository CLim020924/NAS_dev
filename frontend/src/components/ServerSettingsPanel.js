import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Alert, Box, Button, Chip, CircularProgress, FormControl, FormControlLabel, Grid,
  InputLabel, LinearProgress, MenuItem, Paper, Select, Stack, Switch, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import MemoryIcon from '@mui/icons-material/Memory';
import StorageIcon from '@mui/icons-material/Storage';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import DnsIcon from '@mui/icons-material/Dns';
import StorageCapacityOverview, { formatStorage } from './StorageCapacityOverview';

const formatUptime = (seconds) => {
  const value = Math.max(0, Number(seconds || 0));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return [days && `${days}일`, hours && `${hours}시간`, `${minutes}분`].filter(Boolean).join(' ');
};

const GIB = 1024 * 1024 * 1024;
const MIB = 1024 * 1024;
const reasonLabels = {
  CPU_HARD: 'CPU 차단 기준 초과', CPU_SOFT: 'CPU 주의 기준 초과',
  LOAD_HARD: '시스템 부하 차단 기준 초과', LOAD_SOFT: '시스템 부하 주의 기준 초과',
  MEMORY_HARD: '가용 메모리 차단 기준 미달', MEMORY_SOFT: '가용 메모리 주의 기준 미달',
  SWAP_HARD: '스왑 차단 기준 초과', SWAP_SOFT: '스왑 주의 기준 초과',
  TEMPERATURE_HARD: '온도 차단 기준 초과', TEMPERATURE_SOFT: '온도 주의 기준 초과',
  DISK_RESERVE: 'NAS 최소 여유 공간 미달'
};
const gateLabels = { available: '작업 허용', queued: '새 작업 대기', blocked: '새 작업 차단', 'monitor-only': '측정만 사용' };
const gateColors = { available: 'success', queued: 'warning', blocked: 'error', 'monitor-only': 'info' };
const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const draftFromResource = (resource) => {
  const effective = resource?.effective || {};
  const system = effective.system || {};
  const defaults = effective.defaultUser || {};
  return {
    mode: resource?.policy?.mode || 'auto',
    enforcementEnabled: resource?.policy?.enforcementEnabled !== false,
    retentionDays: resource?.policy?.retentionDays || 30,
    manual: {
      cpuSoftPercent: system.cpuSoftPercent || 70,
      cpuHardPercent: system.cpuHardPercent || 90,
      loadSoft: system.loadSoft || 1,
      loadHard: system.loadHard || 2,
      minAvailableMemoryGiB: numeric(system.minAvailableMemoryBytes) / GIB,
      hardMinAvailableMemoryGiB: numeric(system.hardMinAvailableMemoryBytes) / GIB,
      swapSoftPercent: system.swapSoftPercent || 75,
      swapHardPercent: system.swapHardPercent || 90,
      temperatureSoftC: system.temperatureSoftC || 75,
      temperatureHardC: system.temperatureHardC || 85,
      minNasFreeGiB: numeric(system.minNasFreeBytes) / GIB,
      defaultUserCpuPercent: defaults.cpuPercent || 25,
      defaultUserMemoryMiB: numeric(defaults.memoryBytes) / MIB,
      defaultUserMaxConcurrentJobs: defaults.maxConcurrentJobs || 1
    },
    users: (resource?.users || []).map((user) => ({
      userUid: user.userUid,
      cpuPercent: user.limits.cpuPercent,
      memoryMiB: numeric(user.limits.memoryBytes) / MIB,
      maxConcurrentJobs: user.limits.maxConcurrentJobs
    }))
  };
};

const UsageCard = ({ icon, title, value, detail, percent, children }) => (
  <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 2.5, height: '100%' }}>
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.5 }}>
      {icon}
      <Typography variant="subtitle1" fontWeight={800}>{title}</Typography>
    </Stack>
    {value && <Typography variant="h4" fontWeight={850}>{value}</Typography>}
    {detail && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{detail}</Typography>}
    {Number.isFinite(percent) && (
      <LinearProgress
        variant="determinate"
        value={Math.max(0, Math.min(100, percent))}
        color={percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'primary'}
        sx={{ height: 9, borderRadius: 5, mt: 1.5 }}
      />
    )}
    {children}
  </Paper>
);

const ServerSettingsPanel = () => {
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [policyDraft, setPolicyDraft] = useState(null);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [policyMessage, setPolicyMessage] = useState('');
  const [historyHours, setHistoryHours] = useState(24);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const resourceReady = !!metrics?.resourceControl;

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await axios.get('/api/system/metrics', { withCredentials: true });
      setMetrics(response.data);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || '서버 자원 정보를 불러오지 못했습니다.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(() => refresh({ quiet: true }), 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (metrics?.resourceControl && !policyDirty) setPolicyDraft(draftFromResource(metrics.resourceControl));
  }, [metrics, policyDirty]);

  const loadHistory = useCallback(async (hours = historyHours) => {
    setHistoryLoading(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - hours * 60 * 60 * 1000);
      const response = await axios.get('/api/system/resource-history', {
        withCredentials: true,
        params: { from: from.toISOString(), to: to.toISOString(), limit: 500 }
      });
      setHistory(response.data?.rows || response.data || []);
    } catch (err) {
      setError(err.response?.data?.error || '자원 사용 기록을 불러오지 못했습니다.');
    } finally {
      setHistoryLoading(false);
    }
  }, [historyHours]);

  useEffect(() => { if (resourceReady) loadHistory(historyHours); }, [resourceReady, historyHours, loadHistory]);

  const editDraft = (path, value) => {
    setPolicyDirty(true);
    setPolicyMessage('');
    setPolicyDraft((current) => {
      if (path.length === 1) return { ...current, [path[0]]: value };
      return { ...current, [path[0]]: { ...current[path[0]], [path[1]]: value } };
    });
  };

  const editUserLimit = (userUid, key, value) => {
    setPolicyDirty(true);
    setPolicyMessage('');
    setPolicyDraft((current) => ({
      ...current,
      users: current.users.map((user) => user.userUid === userUid ? { ...user, [key]: value } : user)
    }));
  };

  const savePolicy = async () => {
    if (!policyDraft) return;
    setSavingPolicy(true);
    setPolicyMessage('');
    try {
      const manual = policyDraft.manual;
      await axios.put('/api/system/resource-policy', {
        mode: policyDraft.mode,
        enforcementEnabled: policyDraft.enforcementEnabled,
        retentionDays: numeric(policyDraft.retentionDays, 30),
        manual: {
          cpuSoftPercent: numeric(manual.cpuSoftPercent), cpuHardPercent: numeric(manual.cpuHardPercent),
          loadSoft: numeric(manual.loadSoft), loadHard: numeric(manual.loadHard),
          minAvailableMemoryBytes: Math.round(numeric(manual.minAvailableMemoryGiB) * GIB),
          hardMinAvailableMemoryBytes: Math.round(numeric(manual.hardMinAvailableMemoryGiB) * GIB),
          swapSoftPercent: numeric(manual.swapSoftPercent), swapHardPercent: numeric(manual.swapHardPercent),
          temperatureSoftC: numeric(manual.temperatureSoftC), temperatureHardC: numeric(manual.temperatureHardC),
          minNasFreeBytes: Math.round(numeric(manual.minNasFreeGiB) * GIB),
          defaultUserCpuPercent: numeric(manual.defaultUserCpuPercent),
          defaultUserMemoryBytes: Math.round(numeric(manual.defaultUserMemoryMiB) * MIB),
          defaultUserMaxConcurrentJobs: numeric(manual.defaultUserMaxConcurrentJobs)
        },
        userOverrides: policyDraft.users.map((user) => ({
          userUid: user.userUid,
          cpuPercent: numeric(user.cpuPercent),
          memoryBytes: Math.round(numeric(user.memoryMiB) * MIB),
          maxConcurrentJobs: numeric(user.maxConcurrentJobs)
        }))
      }, { withCredentials: true });
      setPolicyDirty(false);
      setPolicyMessage('자원 보호 정책을 저장했습니다. 새로 시작되는 관리 작업부터 적용됩니다.');
      await refresh({ quiet: true });
    } catch (err) {
      setPolicyMessage(err.response?.data?.error || '자원 보호 정책을 저장하지 못했습니다.');
    } finally {
      setSavingPolicy(false);
    }
  };

  if (loading && !metrics) {
    return <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
  }

  const currentGateState = metrics?.resourceControl?.effective?.enforcementEnabled === false
    ? 'monitor-only'
    : metrics?.resourceControl?.pressure?.state;

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1.5} sx={{ mb: 2.5 }}>
        <Box>
          <Typography variant="h6" fontWeight={800}>서버 자원 현황</Typography>
          <Typography variant="body2" color="text.secondary">
            {metrics?.server?.hostname || 'NAS'} · {metrics?.server?.platform} {metrics?.server?.release} · 가동 {formatUptime(metrics?.server?.uptimeSeconds)}
          </Typography>
        </Box>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={() => refresh()} disabled={loading}>새로고침</Button>
      </Stack>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error} 마지막으로 수집된 값이 있으면 그대로 표시합니다.</Alert>}

      <Grid container spacing={2} sx={{ mb: 4 }}>
        <Grid item xs={12} md={6}>
          <UsageCard
            icon={<MemoryIcon color="primary" />}
            title="CPU"
            value={`${metrics?.cpu?.usagePercent ?? 0}%`}
            detail={`${metrics?.cpu?.model || '알 수 없음'} · 물리 ${metrics?.cpu?.physicalCores || '-'}코어 / 논리 ${metrics?.cpu?.logicalCores || '-'}코어`}
            percent={metrics?.cpu?.usagePercent}
          >
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>
              부하 평균 1/5/15분: {(metrics?.cpu?.loadAverage || []).join(' · ') || '-'}
            </Typography>
          </UsageCard>
        </Grid>
        <Grid item xs={12} md={6}>
          <UsageCard
            icon={<DnsIcon color="primary" />}
            title="메모리"
            value={`${metrics?.memory?.usedPercent ?? 0}%`}
            detail={`${formatStorage(metrics?.memory?.usedBytes)} 사용 · ${formatStorage(metrics?.memory?.availableBytes)} 사용 가능 / 전체 ${formatStorage(metrics?.memory?.totalBytes)}`}
            percent={metrics?.memory?.usedPercent}
          >
            {metrics?.memory?.swapTotalBytes > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.25 }}>
                스왑 {formatStorage(metrics.memory.swapUsedBytes)} / {formatStorage(metrics.memory.swapTotalBytes)}
              </Typography>
            )}
          </UsageCard>
        </Grid>
      </Grid>

      <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>디스크</Typography>
      <Grid container spacing={2} sx={{ mb: 4 }}>
        {(metrics?.disks?.volumes || []).map((volume) => (
          <Grid item xs={12} md={6} key={`${volume.purpose}:${volume.mountPath}`}>
            <UsageCard
              icon={<StorageIcon color="primary" />}
              title={volume.purpose}
              value={`${volume.usedPercent}%`}
              detail={`${formatStorage(volume.usedBytes)} 사용 · ${formatStorage(volume.freeBytes)} 여유 / 전체 ${formatStorage(volume.totalBytes)}`}
              percent={volume.usedPercent}
            >
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1.25 }}>
                {volume.device && <Chip size="small" label={volume.device} />}
                {volume.filesystem && <Chip size="small" variant="outlined" label={volume.filesystem} />}
                <Chip size="small" variant="outlined" label={volume.mountPath} />
              </Stack>
            </UsageCard>
          </Grid>
        ))}
      </Grid>

      {(metrics?.disks?.physical || []).length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 4 }}>
          <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>설치된 물리 디스크</Typography>
          <Stack spacing={1}>
            {metrics.disks.physical.map((disk) => (
              <Stack key={disk.name} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={0.5}>
                <Typography variant="body2">{disk.model}</Typography>
                <Typography variant="body2" color="text.secondary">{disk.type} · {formatStorage(disk.sizeBytes)}</Typography>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {(metrics?.temperatures || []).length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>온도 센서</Typography>
          <Grid container spacing={1.5}>
            {metrics.temperatures.map((sensor, index) => (
              <Grid item xs={12} sm={6} md={4} key={`${sensor.source}:${sensor.label}:${index}`}>
                <Paper variant="outlined" sx={{ px: 2, py: 1.5, borderRadius: 2 }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Stack direction="row" spacing={1} alignItems="center" minWidth={0}>
                      <ThermostatIcon color={sensor.value >= 85 ? 'error' : sensor.value >= 70 ? 'warning' : 'primary'} />
                      <Box minWidth={0}>
                        <Typography variant="body2" fontWeight={700} noWrap>{sensor.label}</Typography>
                        <Typography variant="caption" color="text.secondary">{sensor.source}</Typography>
                      </Box>
                    </Stack>
                    <Typography variant="h6" fontWeight={800} whiteSpace="nowrap">{sensor.value}°C</Typography>
                  </Stack>
                </Paper>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {(metrics?.fans || []).length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>팬 속도</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {metrics.fans.map((fan, index) => <Chip key={`${fan.source}:${fan.label}:${index}`} label={`${fan.label} ${fan.value} RPM`} />)}
          </Stack>
        </Box>
      )}

      <Typography variant="h6" fontWeight={800} sx={{ mb: 2 }}>NAS 저장공간 할당</Typography>
      <StorageCapacityOverview storageCapacity={metrics?.storageCapacity} compact />

      {metrics?.resourceControl && policyDraft && (
        <Box sx={{ mt: 4, mb: 4 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }} spacing={1.5} sx={{ mb: 2 }}>
            <Box>
              <Typography variant="h6" fontWeight={800}>사용자별 자원 보호</Typography>
              <Typography variant="body2" color="text.secondary">감지된 서버 사양으로 안전선을 자동 계산하거나 관리자가 직접 지정할 수 있습니다.</Typography>
            </Box>
            <Chip
              color={gateColors[currentGateState] || 'default'}
              label={gateLabels[currentGateState] || currentGateState}
              sx={{ fontWeight: 800 }}
            />
          </Stack>

          {[...(metrics.resourceControl.pressure?.hardReasons || []), ...(metrics.resourceControl.pressure?.softReasons || [])].length > 0 && (
            <Alert severity={metrics.resourceControl.pressure?.state === 'blocked' ? 'error' : 'warning'} sx={{ mb: 2 }}>
              {[...(metrics.resourceControl.pressure?.hardReasons || []), ...(metrics.resourceControl.pressure?.softReasons || [])]
                .map((reason) => reasonLabels[reason] || reason).join(' · ')} — 기존 웹 요청은 중단하지 않고 새 서버 작업만 대기·차단합니다.
            </Alert>
          )}

          <Alert severity="info" sx={{ mb: 2 }}>
            저장공간은 사용자 개인 루트의 실제 사용량과 할당량입니다. CPU·RAM·동시 작업 수는 Python, AI, 문서 변환처럼 서버가 대신 실행하는 관리 작업만 사용자별로 측정합니다. 하나의 Node 프로세스가 처리하는 일반 웹 요청은 사용자별 값으로 허위 분배하지 않습니다.
          </Alert>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>임계값 방식</InputLabel>
                  <Select label="임계값 방식" value={policyDraft.mode} onChange={(event) => editDraft(['mode'], event.target.value)}>
                    <MenuItem value="auto">서버 사양 기반 자동</MenuItem>
                    <MenuItem value="manual">관리자 직접 설정</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControlLabel control={<Switch checked={policyDraft.enforcementEnabled} onChange={(event) => editDraft(['enforcementEnabled'], event.target.checked)} />} label="자동 대기·차단 사용" />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth size="small" type="number" label="기록 보존(일)" inputProps={{ min: 1, max: 365 }} value={policyDraft.retentionDays} onChange={(event) => editDraft(['retentionDays'], event.target.value)} />
              </Grid>
            </Grid>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5 }}>시스템 안전선</Typography>
            <Grid container spacing={1.5}>
              {[
                ['cpuSoftPercent', 'CPU 주의 (%)'], ['cpuHardPercent', 'CPU 차단 (%)'], ['loadSoft', '부하 주의'], ['loadHard', '부하 차단'],
                ['minAvailableMemoryGiB', '가용 RAM 주의 (GiB)'], ['hardMinAvailableMemoryGiB', '가용 RAM 차단 (GiB)'],
                ['swapSoftPercent', '스왑 주의 (%)'], ['swapHardPercent', '스왑 차단 (%)'],
                ['temperatureSoftC', '온도 주의 (°C)'], ['temperatureHardC', '온도 차단 (°C)'], ['minNasFreeGiB', 'NAS 최소 여유 (GiB)']
              ].map(([key, label]) => (
                <Grid item xs={6} md={3} key={key}>
                  <TextField fullWidth size="small" type="number" label={label} value={policyDraft.manual[key]} disabled={policyDraft.mode !== 'manual'} onChange={(event) => editDraft(['manual', key], event.target.value)} />
                </Grid>
              ))}
            </Grid>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={800}>사용자별 현재값과 제한</Typography>
            <Typography variant="caption" color="text.secondary">개별 제한은 자동/수동 모드 모두에서 적용됩니다. RAM 최솟값은 256 MiB입니다.</Typography>
            <TableContainer sx={{ mt: 1.5 }}>
              <Table size="small">
                <TableHead><TableRow><TableCell>사용자</TableCell><TableCell>저장공간</TableCell><TableCell>관리 작업 사용</TableCell><TableCell>CPU 제한 (%)</TableCell><TableCell>RAM 제한 (MiB)</TableCell><TableCell>동시 작업</TableCell></TableRow></TableHead>
                <TableBody>
                  {(metrics.resourceControl.users || []).map((user) => {
                    const draft = policyDraft.users.find((item) => item.userUid === user.userUid) || {};
                    return (
                      <TableRow key={user.userUid}>
                        <TableCell><Typography variant="body2" fontWeight={700}>{user.displayName || user.loginId}</Typography><Typography variant="caption" color="text.secondary">{user.loginId}</Typography></TableCell>
                        <TableCell>{formatStorage(user.storage.usedBytes)} / {formatStorage(user.storage.quotaBytes)}</TableCell>
                        <TableCell>CPU {user.managed.cpuPercent}% · RAM {formatStorage(user.managed.memoryBytes)} · {user.managed.activeJobs}개</TableCell>
                        <TableCell><TextField size="small" type="number" value={draft.cpuPercent ?? ''} inputProps={{ min: 1, max: 100 }} onChange={(event) => editUserLimit(user.userUid, 'cpuPercent', event.target.value)} sx={{ width: 92 }} /></TableCell>
                        <TableCell><TextField size="small" type="number" value={draft.memoryMiB ?? ''} inputProps={{ min: 256 }} onChange={(event) => editUserLimit(user.userUid, 'memoryMiB', event.target.value)} sx={{ width: 112 }} /></TableCell>
                        <TableCell><TextField size="small" type="number" value={draft.maxConcurrentJobs ?? ''} inputProps={{ min: 1, max: 16 }} onChange={(event) => editUserLimit(user.userUid, 'maxConcurrentJobs', event.target.value)} sx={{ width: 82 }} /></TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 3 }}>
            <Button variant="contained" startIcon={<SaveIcon />} disabled={!policyDirty || savingPolicy} onClick={savePolicy}>{savingPolicy ? '저장 중…' : '보호 정책 저장'}</Button>
            {policyMessage && <Typography variant="body2" color={policyMessage.includes('못했습니다') ? 'error' : 'success.main'}>{policyMessage}</Typography>}
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} spacing={1.5} sx={{ mb: 1.5 }}>
            <Typography variant="h6" fontWeight={800}>자원 사용 기록</Typography>
            <FormControl size="small" sx={{ minWidth: 140 }}><InputLabel>조회 기간</InputLabel><Select label="조회 기간" value={historyHours} onChange={(event) => setHistoryHours(Number(event.target.value))}><MenuItem value={1}>최근 1시간</MenuItem><MenuItem value={24}>최근 24시간</MenuItem><MenuItem value={168}>최근 7일</MenuItem></Select></FormControl>
          </Stack>
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5, maxHeight: 360 }}>
            <Table size="small" stickyHeader>
              <TableHead><TableRow><TableCell>시각</TableCell><TableCell>CPU</TableCell><TableCell>RAM 사용</TableCell><TableCell>스왑</TableCell><TableCell>NAS 여유</TableCell><TableCell>판정</TableCell></TableRow></TableHead>
              <TableBody>
                {historyLoading && <TableRow><TableCell colSpan={6} align="center"><CircularProgress size={22} /></TableCell></TableRow>}
                {!historyLoading && history.length === 0 && <TableRow><TableCell colSpan={6} align="center">아직 저장된 기록이 없습니다.</TableCell></TableRow>}
                {!historyLoading && history.slice().reverse().map((row, index) => {
                  const total = numeric(row.system?.memoryUsedBytes) + numeric(row.system?.memoryAvailableBytes);
                  const memoryPercent = total > 0 ? Math.round((numeric(row.system?.memoryUsedBytes) / total) * 1000) / 10 : 0;
                  return <TableRow key={`${row.collectedAt}:${index}`}><TableCell>{new Date(row.collectedAt).toLocaleString()}</TableCell><TableCell>{row.system?.cpuPercent ?? 0}%</TableCell><TableCell>{memoryPercent}%</TableCell><TableCell>{row.system?.swapUsedPercent ?? 0}%</TableCell><TableCell>{formatStorage(row.system?.nasFreeBytes)}</TableCell><TableCell><Chip size="small" color={gateColors[row.system?.gateState] || 'default'} label={gateLabels[row.system?.gateState] || row.system?.gateState || '-'} /></TableCell></TableRow>;
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}

      <Typography variant="caption" color="text.secondary">
        최근 수집: {metrics?.collectedAt ? new Date(metrics.collectedAt).toLocaleString() : '-'} · 5초마다 자동 갱신
      </Typography>
    </Box>
  );
};

export default ServerSettingsPanel;
