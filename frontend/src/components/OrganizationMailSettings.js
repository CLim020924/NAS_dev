import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  Grid,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material';
import axios from 'axios';
import socket from '../socket';

const ACCOUNT_TYPE_LABELS = {
  UNCLASSIFIED: '미분류',
  INTERNAL: '내부 임직원',
  EXTERNAL: '외부 사용자',
  SERVICE: '서비스 계정'
};

const MAIL_STATUS_LABELS = {
  PLANNED: '구성 대기',
  PENDING_PROVIDER: '메일 제공자 반영 대기',
  ACTIVE: '사용 가능',
  SUSPENDED: '정지',
  REVIEW_REQUIRED: '관리자 확인 필요'
};

const splitDomains = (value) => String(value || '')
  .split(/[\s,]+/)
  .map((item) => item.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

function OrganizationMailSettings() {
  const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
  const isMaster = currentUser.role === 'MASTER' || currentUser.Masters;
  const [state, setState] = useState(null);
  const [users, setUsers] = useState([]);
  const [draftIdentities, setDraftIdentities] = useState({});
  const [policyDraft, setPolicyDraft] = useState(null);
  const [structureDraft, setStructureDraft] = useState({ departments: [], positions: [] });
  const [inviteDraft, setInviteDraft] = useState({ accountType: 'INTERNAL', email: '', departmentId: '', positionId: '', ttlHours: 24 });
  const [createdInvite, setCreatedInvite] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [organizationResponse, usersResponse] = await Promise.all([
        axios.get('/api/organization/admin', { withCredentials: true }),
        axios.get('/api/users/data', { withCredentials: true })
      ]);
      const next = organizationResponse.data || {};
      const nextUsers = usersResponse.data?.users || [];
      const identityByUid = new Map((next.identities || []).map((item) => [item.userUid, item]));
      const merged = nextUsers.map((user) => ({ ...user, organizationIdentity: identityByUid.get(user.userUid) || user.organizationIdentity || {} }));
      setState(next);
      setUsers(merged);
      setPolicyDraft(next.signupPolicy || {});
      setStructureDraft({ departments: next.departments || [], positions: next.positions || [] });
      setDraftIdentities(Object.fromEntries(merged.map((user) => [user.userUid, { ...(user.organizationIdentity || {}) }])));
    } catch (err) {
      setError(err.response?.data?.error || '조직·메일 설정을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const refresh = () => load();
    socket.on('organizationChanged', refresh);
    return () => socket.off('organizationChanged', refresh);
  }, [load]);

  const departments = state?.departments || [];
  const positions = state?.positions || [];
  const mailDomain = state?.domain || 'cresero.com';
  const providerReady = state?.provider?.mode === 'ACTIVE';
  const usersByType = useMemo(() => users.reduce((counts, user) => {
    const type = draftIdentities[user.userUid]?.accountType || 'UNCLASSIFIED';
    counts[type] = (counts[type] || 0) + 1;
    return counts;
  }, {}), [users, draftIdentities]);

  const savePolicy = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      await axios.put('/api/organization/policy', {
        ...policyDraft,
        allowedExternalDomains: splitDomains(policyDraft.allowedExternalDomains),
        blockedExternalDomains: splitDomains(policyDraft.blockedExternalDomains)
      }, { withCredentials: true });
      setNotice('가입·메일 발급 정책을 저장했습니다.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || '정책을 저장하지 못했습니다.');
    } finally { setSaving(false); }
  };

  const createInvite = async () => {
    setSaving(true); setError(''); setNotice(''); setCreatedInvite(null);
    try {
      const response = await axios.post('/api/organization/invitations', inviteDraft, { withCredentials: true });
      const token = response.data?.token || '';
      const link = `${window.location.origin}/signup?accountType=${encodeURIComponent(inviteDraft.accountType)}&invite=${encodeURIComponent(token)}`;
      setCreatedInvite({ token, link, invitation: response.data?.invitation });
      setNotice('일회용 초대를 만들었습니다. 링크는 이 화면에서 한 번만 표시됩니다.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || '초대 링크를 만들지 못했습니다.');
    } finally { setSaving(false); }
  };

  const copyInvite = async () => {
    if (!createdInvite?.link) return;
    try {
      await navigator.clipboard.writeText(createdInvite.link);
      setNotice('초대 링크를 복사했습니다.');
    } catch (err) {
      setError('클립보드에 복사하지 못했습니다. 링크를 직접 선택해 복사해주세요.');
    }
  };

  const patchIdentity = (userUid, patch) => setDraftIdentities((previous) => ({
    ...previous,
    [userUid]: { ...(previous[userUid] || {}), ...patch }
  }));

  const saveIdentity = async (user) => {
    setSaving(true); setError(''); setNotice('');
    try {
      await axios.put(`/api/organization/users/${encodeURIComponent(user.userUid)}`, draftIdentities[user.userUid] || {}, { withCredentials: true });
      setNotice(`${user.displayName || user.username} 사용자의 조직·메일 설정을 저장했습니다.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || '사용자 조직 정보를 저장하지 못했습니다.');
    } finally { setSaving(false); }
  };

  const saveStructure = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      await axios.put('/api/organization/structure', structureDraft, { withCredentials: true });
      setNotice('부서·직책 구조를 저장했습니다. 사용 중인 항목은 삭제 대신 비활성화하세요.');
      await load();
    } catch (err) {
      setError(err.response?.data?.error || '부서·직책 구조를 저장하지 못했습니다.');
    } finally { setSaving(false); }
  };

  const patchStructureItem = (group, index, patch) => setStructureDraft((previous) => ({
    ...previous,
    [group]: previous[group].map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item)
  }));
  const addStructureItem = (group) => setStructureDraft((previous) => ({
    ...previous,
    [group]: [...previous[group], group === 'departments'
      ? { id: '', name: '', active: true }
      : { id: '', name: '', level: 10, roleAddress: '', active: true }]
  }));
  const removeStructureItem = (group, index) => setStructureDraft((previous) => ({
    ...previous,
    [group]: previous[group].filter((_, itemIndex) => itemIndex !== index)
  }));

  const revokeInvite = async (invitation) => {
    setSaving(true); setError(''); setNotice('');
    try {
      await axios.delete(`/api/organization/invitations/${encodeURIComponent(invitation.id)}`, { withCredentials: true });
      setNotice(`${invitation.email} 초대를 취소했습니다.`);
      await load();
    } catch (err) {
      setError(err.response?.data?.error || '초대를 취소하지 못했습니다.');
    } finally { setSaving(false); }
  };

  if (!state || !policyDraft) return <Typography color="text.secondary">조직·메일 설정을 불러오는 중입니다.</Typography>;

  return (
    <Box>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} sx={{ mb: 2 }}>
        <Chip label={`도메인 ${mailDomain}`} variant="outlined" />
        <Chip label={providerReady ? '외부 메일 연결됨' : '외부 메일 연결 전'} color={providerReady ? 'success' : 'warning'} variant="outlined" />
        <Chip label={`내부 ${usersByType.INTERNAL || 0}`} variant="outlined" />
        <Chip label={`외부 ${usersByType.EXTERNAL || 0}`} variant="outlined" />
        <Chip label={`미분류 ${usersByType.UNCLASSIFIED || 0}`} color={(usersByType.UNCLASSIFIED || 0) ? 'warning' : 'default'} variant="outlined" />
      </Stack>

      {!providerReady && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          주소와 권한은 안전하게 준비할 수 있지만 외부 메일 백엔드가 아직 연결되지 않았습니다. 상태가 ‘사용 가능’으로 바뀌기 전에는 실제 송수신이 된다고 표시하지 않습니다.
        </Alert>
      )}
      {error && <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>가입·메일 발급 정책</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <TextField select fullWidth size="small" label="회사 내부 가입" value={policyDraft.internalMode || 'INVITE_ONLY'} disabled={!isMaster}
              onChange={(e) => setPolicyDraft({ ...policyDraft, internalMode: e.target.value })}>
              <MenuItem value="INVITE_ONLY">관리자 초대만</MenuItem>
              <MenuItem value="DISABLED">가입 중단</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField select fullWidth size="small" label="회사 외부 가입" value={policyDraft.externalMode || 'INVITE_ONLY'} disabled={!isMaster}
              onChange={(e) => setPolicyDraft({ ...policyDraft, externalMode: e.target.value })}>
              <MenuItem value="ADMIN_APPROVAL" disabled={!providerReady}>이메일 확인 후 관리자 승인</MenuItem>
              <MenuItem value="INVITE_ONLY">초대만</MenuItem>
              <MenuItem value="DISABLED">가입 중단</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="허용할 외부 도메인" value={Array.isArray(policyDraft.allowedExternalDomains) ? policyDraft.allowedExternalDomains.join(', ') : policyDraft.allowedExternalDomains || ''} disabled={!isMaster}
              helperText="비워두면 차단 목록을 제외한 모든 도메인을 받습니다. 쉼표로 구분합니다."
              onChange={(e) => setPolicyDraft({ ...policyDraft, allowedExternalDomains: e.target.value })} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="차단할 외부 도메인" value={Array.isArray(policyDraft.blockedExternalDomains) ? policyDraft.blockedExternalDomains.join(', ') : policyDraft.blockedExternalDomains || ''} disabled={!isMaster}
              helperText="일회용 메일이나 가입을 막을 도메인을 쉼표로 구분합니다."
              onChange={(e) => setPolicyDraft({ ...policyDraft, blockedExternalDomains: e.target.value })} />
          </Grid>
        </Grid>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 2 }}>
          <FormControlLabel control={<Switch checked={!!policyDraft.autoIssueInternalMailbox} disabled={!isMaster} onChange={(e) => setPolicyDraft({ ...policyDraft, autoIssueInternalMailbox: e.target.checked })} />} label="승인된 내부 사용자 메일 주소 자동 준비" />
          <FormControlLabel control={<Switch checked={!!policyDraft.requireMfaForPrivileged} disabled={!isMaster} onChange={(e) => setPolicyDraft({ ...policyDraft, requireMfaForPrivileged: e.target.checked })} />} label="관리자 MFA 필수" />
        </Stack>
        {isMaster && <Button variant="contained" onClick={savePolicy} disabled={saving} sx={{ mt: 2 }}>정책 저장</Button>}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Box><Typography variant="h6">부서·직책</Typography><Typography variant="body2" color="text.secondary">NAS 권한과 회사 직책을 분리하여 관리합니다.</Typography></Box>
          {isMaster && <Button variant="contained" onClick={saveStructure} disabled={saving}>구조 저장</Button>}
        </Stack>
        <Grid container spacing={3}>
          <Grid item xs={12} md={5}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}><Typography fontWeight={700}>부서</Typography>{isMaster && <Button size="small" onClick={() => addStructureItem('departments')}>+부서</Button>}</Stack>
            <Stack spacing={1}>{structureDraft.departments.map((item, index) => (
              <Stack key={`${item.id}-${index}`} direction="row" spacing={1}>
                <TextField size="small" label="ID" value={item.id} disabled={!isMaster} onChange={(e) => patchStructureItem('departments', index, { id: e.target.value })} sx={{ width: 140 }} />
                <TextField size="small" label="이름" value={item.name} disabled={!isMaster} onChange={(e) => patchStructureItem('departments', index, { name: e.target.value })} fullWidth />
                {isMaster && <Button color="inherit" onClick={() => removeStructureItem('departments', index)}>삭제</Button>}
              </Stack>
            ))}</Stack>
          </Grid>
          <Grid item xs={12} md={7}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}><Typography fontWeight={700}>직책</Typography>{isMaster && <Button size="small" onClick={() => addStructureItem('positions')}>+직책</Button>}</Stack>
            <Stack spacing={1}>{structureDraft.positions.map((item, index) => (
              <Stack key={`${item.id}-${index}`} direction="row" spacing={1}>
                <TextField size="small" label="ID" value={item.id} disabled={!isMaster} onChange={(e) => patchStructureItem('positions', index, { id: e.target.value })} sx={{ width: 120 }} />
                <TextField size="small" label="이름" value={item.name} disabled={!isMaster} onChange={(e) => patchStructureItem('positions', index, { name: e.target.value })} fullWidth />
                <TextField size="small" type="number" label="단계" value={item.level} disabled={!isMaster} onChange={(e) => patchStructureItem('positions', index, { level: e.target.value })} sx={{ width: 90 }} />
                {isMaster && <Button color="inherit" onClick={() => removeStructureItem('positions', index)}>삭제</Button>}
              </Stack>
            ))}</Stack>
          </Grid>
        </Grid>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>일회용 가입 초대</Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={3}>
            <TextField select fullWidth size="small" label="초대 유형" value={inviteDraft.accountType} onChange={(e) => setInviteDraft({ ...inviteDraft, accountType: e.target.value })}>
              <MenuItem value="INTERNAL" disabled={!isMaster}>내부 임직원</MenuItem>
              <MenuItem value="EXTERNAL">외부 사용자</MenuItem>
            </TextField>
          </Grid>
          <Grid item xs={12} md={5}><TextField fullWidth size="small" type="email" label="초대 이메일" value={inviteDraft.email} onChange={(e) => setInviteDraft({ ...inviteDraft, email: e.target.value })} /></Grid>
          <Grid item xs={12} md={2}><TextField fullWidth size="small" type="number" label="유효 시간" value={inviteDraft.ttlHours} inputProps={{ min: 1, max: 168 }} onChange={(e) => setInviteDraft({ ...inviteDraft, ttlHours: e.target.value })} /></Grid>
          <Grid item xs={12} md={2}><Button fullWidth variant="outlined" onClick={createInvite} disabled={saving || !inviteDraft.email}>초대 만들기</Button></Grid>
          {inviteDraft.accountType === 'INTERNAL' && (
            <>
              <Grid item xs={12} md={6}>
                <TextField select fullWidth size="small" label="부서" value={inviteDraft.departmentId} onChange={(e) => setInviteDraft({ ...inviteDraft, departmentId: e.target.value })}>
                  <MenuItem value="">승인할 때 지정</MenuItem>
                  {departments.filter((item) => item.active).map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} md={6}>
                <TextField select fullWidth size="small" label="직책" value={inviteDraft.positionId} onChange={(e) => setInviteDraft({ ...inviteDraft, positionId: e.target.value })}>
                  <MenuItem value="">승인할 때 지정</MenuItem>
                  {positions.filter((item) => item.active).map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
                </TextField>
              </Grid>
            </>
          )}
        </Grid>
        {createdInvite && (
          <Box sx={{ mt: 2 }}>
            <TextField fullWidth size="small" value={createdInvite.link} InputProps={{ readOnly: true }} label="한 번만 표시되는 초대 링크" />
            <Button size="small" onClick={copyInvite} sx={{ mt: 1 }}>링크 복사</Button>
          </Box>
        )}
        {(state.invitations || []).some((item) => !item.consumedAt && !item.revokedAt && new Date(item.expiresAt).getTime() > Date.now()) && (
          <TableContainer sx={{ mt: 2 }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>수신자</TableCell><TableCell>유형</TableCell><TableCell>만료</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>{state.invitations.filter((item) => !item.consumedAt && !item.revokedAt && new Date(item.expiresAt).getTime() > Date.now()).map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>{invitation.email}</TableCell><TableCell>{ACCOUNT_TYPE_LABELS[invitation.accountType] || invitation.accountType}</TableCell><TableCell>{new Date(invitation.expiresAt).toLocaleString()}</TableCell>
                  <TableCell align="right"><Button size="small" color="error" disabled={saving || (invitation.accountType === 'INTERNAL' && !isMaster)} onClick={() => revokeInvite(invitation)}>취소</Button></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Typography variant="h6" sx={{ mb: 1 }}>초기 메일 주소</Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead><TableRow><TableCell>주소</TableCell><TableCell>용도</TableCell><TableCell>종류</TableCell><TableCell>상태</TableCell></TableRow></TableHead>
          <TableBody>{(state.mailAddresses || []).map((address) => (
            <TableRow key={address.id}><TableCell>{address.address}</TableCell><TableCell>{address.label}</TableCell><TableCell>{address.kind}</TableCell><TableCell>{MAIL_STATUS_LABELS[address.status] || address.status}</TableCell></TableRow>
          ))}</TableBody>
        </Table>
      </TableContainer>

      <Typography variant="h6" sx={{ mb: 1 }}>조직 명단과 개인 메일</Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead><TableRow><TableCell>사용자</TableCell><TableCell>유형</TableCell><TableCell>부서</TableCell><TableCell>직책</TableCell><TableCell>메일 주소</TableCell><TableCell>상태</TableCell><TableCell /></TableRow></TableHead>
          <TableBody>{users.map((user) => {
            const identity = draftIdentities[user.userUid] || {};
            return (
              <TableRow key={user.userUid}>
                <TableCell>{user.displayName || user.username}<Typography variant="caption" color="text.secondary" display="block">{user.username}</Typography></TableCell>
                <TableCell>
                  <Select size="small" value={identity.accountType || 'UNCLASSIFIED'} disabled={!isMaster} onChange={(e) => patchIdentity(user.userUid, { accountType: e.target.value })}>
                    {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                  </Select>
                </TableCell>
                <TableCell>
                  <Select size="small" value={identity.departmentId || ''} disabled={!isMaster} onChange={(e) => patchIdentity(user.userUid, { departmentId: e.target.value })} displayEmpty>
                    <MenuItem value="">미지정</MenuItem>{departments.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
                  </Select>
                </TableCell>
                <TableCell>
                  <Select size="small" value={identity.positionId || ''} disabled={!isMaster} onChange={(e) => patchIdentity(user.userUid, { positionId: e.target.value })} displayEmpty>
                    <MenuItem value="">미지정</MenuItem>{positions.map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
                  </Select>
                </TableCell>
                <TableCell>
                  <TextField size="small" value={identity.mailLocalPart || ''} disabled={!isMaster || identity.accountType !== 'INTERNAL'} onChange={(e) => patchIdentity(user.userUid, { mailLocalPart: e.target.value })}
                    InputProps={{ endAdornment: <Typography color="text.secondary">@{mailDomain}</Typography> }} sx={{ minWidth: 260 }} />
                </TableCell>
                <TableCell><Chip size="small" label={MAIL_STATUS_LABELS[identity.mailboxStatus] || identity.mailboxStatus || '미설정'} variant="outlined" /></TableCell>
                <TableCell>{isMaster && <Button size="small" onClick={() => saveIdentity(user)} disabled={saving}>저장</Button>}</TableCell>
              </TableRow>
            );
          })}</TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default OrganizationMailSettings;
