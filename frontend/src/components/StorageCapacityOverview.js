import React from 'react';
import { Alert, Box, Grid, LinearProgress, Paper, Typography } from '@mui/material';

export const formatStorage = (bytes) => {
  const value = Number(bytes || 0);
  if (value >= 1024 ** 4) return `${(value / (1024 ** 4)).toFixed(2)} TB`;
  if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / (1024 ** 2)).toFixed(1)} MB`;
  return `${Math.round(value / 1024)} KB`;
};

const StorageCapacityOverview = ({ storageCapacity, compact = false }) => {
  if (!storageCapacity) return null;
  const usagePercent = storageCapacity.totalBytes
    ? Math.min(100, Math.round((Number(storageCapacity.usedBytes || 0) / Number(storageCapacity.totalBytes)) * 100))
    : 0;

  return (
    <>
      {storageCapacity.overAllocatedBytes > 0 && (
        <Alert severity="error" sx={{ mb: 2 }}>
          현재 사용자·가입 대기자에게 약속된 용량이 안전 할당 가능 범위를 {formatStorage(storageCapacity.overAllocatedBytes)} 초과했습니다. 신규 가입과 추가 증설이 차단됩니다.
        </Alert>
      )}
      <Grid container spacing={2} sx={{ mb: 2 }}>
        {[
          ['전체 NAS', formatStorage(storageCapacity.totalBytes), `사용 ${formatStorage(storageCapacity.usedBytes)} · 여유 ${formatStorage(storageCapacity.freeBytes)}`],
          ['사용자 할당', formatStorage(storageCapacity.allocatedBytes), `가입 대기 예약 ${formatStorage(storageCapacity.pendingReservedBytes)}`],
          ['개인 공간 실사용', formatStorage(storageCapacity.actualUserBytes), `계정 ${storageCapacity.accountCount || 0}개`],
          ['추가 할당 가능', formatStorage(storageCapacity.availableForAllocationBytes), storageCapacity.signupAvailable ? `새 계정 ${formatStorage(storageCapacity.defaultQuotaBytes)} 제공 가능` : '신규 가입 차단']
        ].map(([label, value, detail]) => (
          <Grid item xs={12} sm={6} lg={3} key={label}>
            <Paper variant="outlined" sx={{ p: 2, height: '100%', borderRadius: 1 }}>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
              <Typography variant={compact ? 'h6' : 'h5'} sx={{ fontWeight: 800, my: 0.5 }}>{value}</Typography>
              <Typography variant="caption" color="text.secondary">{detail}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
      <Box sx={{ mb: compact ? 2 : 4 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 0.75 }}>
          <Typography variant="body2">물리 디스크 사용률 {usagePercent}%</Typography>
          <Typography variant="caption" color="text.secondary">안전 여유분 {formatStorage(storageCapacity.systemReserveBytes)} 보호</Typography>
        </Box>
        <LinearProgress variant="determinate" value={usagePercent} color={usagePercent >= 90 ? 'error' : usagePercent >= 75 ? 'warning' : 'primary'} sx={{ height: 10, borderRadius: 5 }} />
      </Box>
    </>
  );
};

export default StorageCapacityOverview;
