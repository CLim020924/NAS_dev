import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
  Alert, Box, Button, Chip, CircularProgress, Grid, LinearProgress, Paper, Stack, Typography
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
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

  if (loading && !metrics) {
    return <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}><CircularProgress /></Box>;
  }

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

      <Typography variant="caption" color="text.secondary">
        최근 수집: {metrics?.collectedAt ? new Date(metrics.collectedAt).toLocaleString() : '-'} · 5초마다 자동 갱신
      </Typography>
    </Box>
  );
};

export default ServerSettingsPanel;
