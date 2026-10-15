const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ACCOUNT_TYPES = Object.freeze(['UNCLASSIFIED', 'INTERNAL', 'EXTERNAL', 'SERVICE']);
const MAILBOX_KINDS = Object.freeze(['USER', 'SHARED', 'ALIAS', 'GROUP', 'SYSTEM']);
const MAILBOX_STATUSES = Object.freeze(['PLANNED', 'PENDING_PROVIDER', 'ACTIVE', 'SUSPENDED', 'REVIEW_REQUIRED']);
const SIGNUP_MODES = Object.freeze(['DISABLED', 'ADMIN_APPROVAL', 'INVITE_ONLY']);
const RESERVED_LOCAL_PARTS = Object.freeze([
  'abuse', 'admin', 'administrator', 'billing', 'contact', 'hostmaster', 'mailer-daemon',
  'noreply', 'no-reply', 'postmaster', 'security', 'support', 'webmaster'
]);

const DEFAULT_DEPARTMENTS = Object.freeze([
  { id: 'executive', name: '경영', active: true },
  { id: 'operations', name: '운영', active: true },
  { id: 'development', name: '개발', active: true },
  { id: 'finance', name: '재무', active: true },
  { id: 'hr', name: '인사', active: true },
  { id: 'sales', name: '영업', active: true },
  { id: 'marketing', name: '마케팅', active: true },
  { id: 'support', name: '고객지원', active: true }
]);

const DEFAULT_POSITIONS = Object.freeze([
  { id: 'ceo', name: '대표이사', level: 100, roleAddress: 'ceo', active: true },
  { id: 'coo', name: '최고운영책임자', level: 95, roleAddress: 'coo', active: true },
  { id: 'cto', name: '최고기술책임자', level: 95, roleAddress: 'cto', active: true },
  { id: 'cfo', name: '최고재무책임자', level: 95, roleAddress: 'cfo', active: true },
  { id: 'director', name: '책임자', level: 70, roleAddress: '', active: true },
  { id: 'manager', name: '관리자', level: 50, roleAddress: '', active: true },
  { id: 'member', name: '구성원', level: 10, roleAddress: '', active: true }
]);

const DEFAULT_MAIL_ADDRESSES = Object.freeze([
  { localPart: 'contact', kind: 'SHARED', label: '대표 문의' },
  { localPart: 'support', kind: 'SHARED', label: '고객 지원' },
  { localPart: 'admin', kind: 'SYSTEM', label: '시스템 관리' },
  { localPart: 'security', kind: 'SHARED', label: '보안 신고' },
  { localPart: 'postmaster', kind: 'SYSTEM', label: '메일 운영 연락처' },
  { localPart: 'abuse', kind: 'SYSTEM', label: '스팸 신고 연락처' }
]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const nowIso = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : crypto.randomBytes(16).toString('hex')}`;
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const normalizeDomain = (value) => String(value || '').trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '');
const emailDomain = (value) => normalizeEmail(value).split('@')[1] || '';
const isEmail = (value) => /^[^\s@]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i.test(normalizeEmail(value));
const normalizeAccountType = (value, fallback = 'EXTERNAL') => ACCOUNT_TYPES.includes(String(value || '').toUpperCase())
  ? String(value).toUpperCase()
  : fallback;
const normalizeLocalPart = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9.]+/g, '.')
  .replace(/\.{2,}/g, '.')
  .replace(/^\.+|\.+$/g, '')
  .slice(0, 64);
const isValidLocalPart = (value) => {
  const localPart = normalizeLocalPart(value);
  return localPart.length >= 2
    && localPart.length <= 64
    && /^[a-z0-9](?:[a-z0-9.]*[a-z0-9])?$/.test(localPart)
    && !localPart.includes('..');
};
const hashToken = (token) => crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
const safeTokenEqual = (left, right) => {
  const a = Buffer.from(String(left || ''), 'hex');
  const b = Buffer.from(String(right || ''), 'hex');
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
};
const normalizeStructureId = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/-{2,}/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

const buildDefaultState = () => ({
  version: 2,
  updatedAt: nowIso(),
  domain: 'cresero.com',
  provider: {
    mode: 'UNCONFIGURED',
    name: '',
    lastVerifiedAt: '',
    note: '외부 송수신 백엔드 연결 전에는 주소를 실제 사서함으로 표시하지 않습니다.'
  },
  signupPolicy: {
    internalMode: 'INVITE_ONLY',
    externalMode: 'INVITE_ONLY',
    autoIssueSignupMailbox: true,
    // Kept for state-file compatibility with deployments created before v2.
    autoIssueInternalMailbox: true,
    allowedExternalDomains: [],
    blockedExternalDomains: [],
    requireMfaForPrivileged: true
  },
  reservedLocalParts: [...RESERVED_LOCAL_PARTS],
  departments: clone(DEFAULT_DEPARTMENTS),
  positions: clone(DEFAULT_POSITIONS),
  identities: [],
  mailReservations: [],
  mailAddresses: DEFAULT_MAIL_ADDRESSES.map((item) => ({
    id: makeId('mail'),
    ...item,
    address: `${item.localPart}@cresero.com`,
    status: 'PLANNED',
    memberUserUids: [],
    targetAddressIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso()
  })),
  invitations: [],
  audit: []
});

const createOrganizationDirectory = ({ dataDir }) => {
  if (!dataDir) throw new Error('organization dataDir is required');
  const storeDir = path.resolve(dataDir);
  const storePath = path.join(storeDir, 'organization_directory.json');
  let state;

  const ensureDir = () => {
    fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(storeDir, 0o700); } catch (err) { /* Windows/limited FS */ }
  };
  const write = () => {
    ensureDir();
    state.updatedAt = nowIso();
    const temporaryPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, storePath);
    try { fs.chmodSync(storePath, 0o600); } catch (err) { /* Windows/limited FS */ }
  };
  const load = () => {
    ensureDir();
    if (!fs.existsSync(storePath)) {
      state = buildDefaultState();
      write();
      return;
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const defaults = buildDefaultState();
    state = {
      ...defaults,
      ...parsed,
      provider: { ...defaults.provider, ...(parsed.provider || {}) },
      signupPolicy: {
        ...defaults.signupPolicy,
        ...(parsed.signupPolicy || {}),
        autoIssueSignupMailbox: parsed.signupPolicy?.autoIssueSignupMailbox
          ?? parsed.signupPolicy?.autoIssueInternalMailbox
          ?? defaults.signupPolicy.autoIssueSignupMailbox
      },
      reservedLocalParts: Array.isArray(parsed.reservedLocalParts) ? parsed.reservedLocalParts : defaults.reservedLocalParts,
      departments: Array.isArray(parsed.departments) ? parsed.departments : defaults.departments,
      positions: Array.isArray(parsed.positions) ? parsed.positions : defaults.positions,
      identities: Array.isArray(parsed.identities) ? parsed.identities : [],
      mailReservations: Array.isArray(parsed.mailReservations) ? parsed.mailReservations : [],
      mailAddresses: Array.isArray(parsed.mailAddresses) ? parsed.mailAddresses : defaults.mailAddresses,
      invitations: Array.isArray(parsed.invitations) ? parsed.invitations : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit : []
    };
    write();
  };
  const audit = (actor, action, target, details = {}) => {
    state.audit.push({ id: makeId('audit'), at: nowIso(), actor: String(actor || 'system'), action, target, details });
    state.audit = state.audit.slice(-2000);
  };
  const publicPolicy = () => ({
    domain: state.domain,
    providerReady: state.provider.mode === 'ACTIVE',
    addressProvisioning: {
      enabled: true,
      source: 'LOGIN_ID',
      status: state.provider.mode === 'ACTIVE' ? 'PROVIDER_READY' : 'RESERVATION_ONLY'
    },
    signup: {
      internalMode: state.signupPolicy.internalMode,
      externalMode: state.signupPolicy.externalMode,
      internalRequiresInvite: state.signupPolicy.internalMode === 'INVITE_ONLY',
      externalRequiresInvite: state.signupPolicy.externalMode === 'INVITE_ONLY'
    }
  });
  const adminState = () => ({
    ...clone(state),
    invitations: state.invitations.map(({ tokenHash, ...item }) => item),
    audit: state.audit.slice(-200)
  });
  const findInvitation = (rawToken) => {
    const candidate = hashToken(rawToken);
    return state.invitations.find((invite) => !invite.consumedAt
      && !invite.revokedAt
      && new Date(invite.expiresAt).getTime() > Date.now()
      && safeTokenEqual(invite.tokenHash, candidate));
  };
  const validateExternalDomain = (email) => {
    const domain = emailDomain(email);
    const blocked = state.signupPolicy.blockedExternalDomains.map(normalizeDomain);
    const allowed = state.signupPolicy.allowedExternalDomains.map(normalizeDomain);
    if (blocked.includes(domain)) throw Object.assign(new Error('이 이메일 도메인은 가입에 사용할 수 없습니다.'), { status: 403, code: 'EMAIL_DOMAIN_BLOCKED' });
    if (allowed.length && !allowed.includes(domain)) throw Object.assign(new Error('승인된 협력사 이메일 도메인만 가입할 수 있습니다.'), { status: 403, code: 'EMAIL_DOMAIN_NOT_ALLOWED' });
  };
  const validateSignup = ({ accountType, email, inviteToken }) => {
    const type = normalizeAccountType(accountType);
    const normalizedEmail = normalizeEmail(email);
    if (!['INTERNAL', 'EXTERNAL'].includes(type)) throw Object.assign(new Error('가입 가능한 계정 유형이 아닙니다.'), { status: 400 });
    if (!isEmail(normalizedEmail)) throw Object.assign(new Error('사용 가능한 이메일 주소를 입력해주세요.'), { status: 400, field: 'email' });
    const mode = type === 'INTERNAL' ? state.signupPolicy.internalMode : state.signupPolicy.externalMode;
    if (!SIGNUP_MODES.includes(mode) || mode === 'DISABLED') throw Object.assign(new Error('현재 이 유형의 가입은 중단되었습니다.'), { status: 403 });
    if (type === 'EXTERNAL') validateExternalDomain(normalizedEmail);
    let invite = null;
    if (mode === 'INVITE_ONLY' || inviteToken) {
      invite = findInvitation(inviteToken);
      if (!invite || invite.accountType !== type) throw Object.assign(new Error('초대 코드가 없거나 만료되었습니다.'), { status: 403, field: 'inviteToken' });
      if (invite.email && invite.email !== normalizedEmail) throw Object.assign(new Error('초대받은 이메일 주소와 일치하지 않습니다.'), { status: 403, field: 'email' });
    }
    if (type === 'INTERNAL' && !invite) throw Object.assign(new Error('회사 내부 계정은 관리자 초대가 필요합니다.'), { status: 403 });
    if (invite) {
      invite.consumedAt = nowIso();
      invite.consumedByEmail = normalizedEmail;
      audit('public-signup', 'INVITATION_CONSUMED', invite.id, { accountType: type, emailDomain: emailDomain(normalizedEmail) });
      write();
    }
    return {
      accountType: type,
      contactEmail: normalizedEmail,
      emailVerified: false,
      invitationId: invite?.id || '',
      organizationProfile: {
        departmentId: invite?.departmentId || '',
        positionId: invite?.positionId || '',
        employmentStatus: type === 'INTERNAL' ? 'APPLICANT' : 'EXTERNAL'
      }
    };
  };
  const createInvitation = (input, actor, { isMaster = false } = {}) => {
    const accountType = normalizeAccountType(input.accountType);
    if (!['INTERNAL', 'EXTERNAL'].includes(accountType)) throw Object.assign(new Error('지원하지 않는 초대 유형입니다.'), { status: 400 });
    if (accountType === 'INTERNAL' && !isMaster) throw Object.assign(new Error('내부 임직원 초대는 마스터만 만들 수 있습니다.'), { status: 403 });
    const email = normalizeEmail(input.email);
    if (!isEmail(email)) throw Object.assign(new Error('일회용 초대는 받는 사람의 이메일 주소가 필요합니다.'), { status: 400 });
    const departmentId = String(input.departmentId || '');
    const positionId = String(input.positionId || '');
    if (departmentId && !state.departments.some((item) => item.id === departmentId && item.active)) {
      throw Object.assign(new Error('사용 가능한 부서를 선택해주세요.'), { status: 400 });
    }
    if (positionId && !state.positions.some((item) => item.id === positionId && item.active)) {
      throw Object.assign(new Error('사용 가능한 직책을 선택해주세요.'), { status: 400 });
    }
    const ttlHours = Math.min(168, Math.max(1, Number(input.ttlHours || 24)));
    const token = crypto.randomBytes(32).toString('base64url');
    const invitation = {
      id: makeId('invite'),
      accountType,
      email,
      departmentId,
      positionId,
      tokenHash: hashToken(token),
      createdAt: nowIso(),
      createdBy: String(actor || ''),
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString(),
      consumedAt: '',
      revokedAt: ''
    };
    state.invitations.push(invitation);
    state.invitations = state.invitations.slice(-1000);
    audit(actor, 'INVITATION_CREATED', invitation.id, { accountType, emailDomain: emailDomain(email), expiresAt: invitation.expiresAt });
    write();
    return { token, invitation: { ...invitation, tokenHash: undefined } };
  };
  const revokeInvitation = (invitationId, actor, { isMaster = false } = {}) => {
    const invitation = state.invitations.find((item) => item.id === String(invitationId || ''));
    if (!invitation) throw Object.assign(new Error('초대를 찾을 수 없습니다.'), { status: 404 });
    if (invitation.accountType === 'INTERNAL' && !isMaster) {
      throw Object.assign(new Error('내부 임직원 초대는 마스터만 취소할 수 있습니다.'), { status: 403 });
    }
    if (invitation.consumedAt) throw Object.assign(new Error('이미 사용된 초대는 취소할 수 없습니다.'), { status: 409 });
    if (!invitation.revokedAt) {
      invitation.revokedAt = nowIso();
      audit(actor, 'INVITATION_REVOKED', invitation.id, { accountType: invitation.accountType, emailDomain: emailDomain(invitation.email) });
      write();
    }
    const { tokenHash, ...safeInvitation } = invitation;
    return clone(safeInvitation);
  };
  const updatePolicy = (input, actor, { isMaster = false } = {}) => {
    if (!isMaster) throw Object.assign(new Error('조직 가입 정책은 마스터만 변경할 수 있습니다.'), { status: 403 });
    const next = { ...state.signupPolicy };
    if (input.internalMode !== undefined) {
      if (!SIGNUP_MODES.includes(input.internalMode)) throw Object.assign(new Error('내부 가입 정책 값이 올바르지 않습니다.'), { status: 400 });
      next.internalMode = input.internalMode;
    }
    if (input.externalMode !== undefined) {
      if (!SIGNUP_MODES.includes(input.externalMode)) throw Object.assign(new Error('외부 가입 정책 값이 올바르지 않습니다.'), { status: 400 });
      if (input.externalMode === 'ADMIN_APPROVAL' && state.provider.mode !== 'ACTIVE') {
        throw Object.assign(new Error('외부 이메일 본인 확인을 수행할 메일 제공자가 연결되기 전에는 공개 가입을 켤 수 없습니다.'), { status: 409 });
      }
      next.externalMode = input.externalMode;
    }
    if (input.autoIssueSignupMailbox !== undefined) {
      next.autoIssueSignupMailbox = !!input.autoIssueSignupMailbox;
      next.autoIssueInternalMailbox = next.autoIssueSignupMailbox;
    } else if (input.autoIssueInternalMailbox !== undefined) {
      next.autoIssueSignupMailbox = !!input.autoIssueInternalMailbox;
      next.autoIssueInternalMailbox = next.autoIssueSignupMailbox;
    }
    if (input.requireMfaForPrivileged !== undefined) next.requireMfaForPrivileged = !!input.requireMfaForPrivileged;
    if (input.allowedExternalDomains !== undefined) next.allowedExternalDomains = [...new Set((input.allowedExternalDomains || []).map(normalizeDomain).filter(Boolean))].slice(0, 200);
    if (input.blockedExternalDomains !== undefined) next.blockedExternalDomains = [...new Set((input.blockedExternalDomains || []).map(normalizeDomain).filter(Boolean))].slice(0, 200);
    const overlap = next.allowedExternalDomains.find((domain) => next.blockedExternalDomains.includes(domain));
    if (overlap) throw Object.assign(new Error(`도메인 ${overlap}을(를) 허용과 차단 목록에 동시에 넣을 수 없습니다.`), { status: 400 });
    state.signupPolicy = next;
    audit(actor, 'SIGNUP_POLICY_UPDATED', 'organization', { ...next });
    write();
    return clone(next);
  };
  const updateStructure = (input, actor, { isMaster = false } = {}) => {
    if (!isMaster) throw Object.assign(new Error('부서와 직책은 마스터만 변경할 수 있습니다.'), { status: 403 });
    const normalizeItems = (items, kind) => {
      if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
        throw Object.assign(new Error(`${kind}은 1개 이상 100개 이하여야 합니다.`), { status: 400 });
      }
      const ids = new Set();
      return items.map((item) => {
        const id = normalizeStructureId(item.id);
        const name = String(item.name || '').trim().slice(0, 80);
        if (!id || !name || ids.has(id)) throw Object.assign(new Error(`${kind} ID와 이름을 중복 없이 입력해주세요.`), { status: 400 });
        ids.add(id);
        if (kind === '직책') {
          return {
            id,
            name,
            level: Math.min(100, Math.max(0, Number(item.level || 0))),
            roleAddress: normalizeLocalPart(item.roleAddress),
            active: item.active !== false
          };
        }
        return { id, name, active: item.active !== false };
      });
    };
    const nextDepartments = input.departments === undefined ? state.departments : normalizeItems(input.departments, '부서');
    const nextPositions = input.positions === undefined ? state.positions : normalizeItems(input.positions, '직책');
    const departmentIds = new Set(nextDepartments.map((item) => item.id));
    const positionIds = new Set(nextPositions.map((item) => item.id));
    for (const identity of state.identities) {
      if (identity.departmentId && !departmentIds.has(identity.departmentId)) {
        throw Object.assign(new Error(`사용자가 사용 중인 부서(${identity.departmentId})는 삭제할 수 없습니다. 비활성화해주세요.`), { status: 409 });
      }
      if (identity.positionId && !positionIds.has(identity.positionId)) {
        throw Object.assign(new Error(`사용자가 사용 중인 직책(${identity.positionId})은 삭제할 수 없습니다. 비활성화해주세요.`), { status: 409 });
      }
    }
    state.departments = nextDepartments;
    state.positions = nextPositions;
    audit(actor, 'ORGANIZATION_STRUCTURE_UPDATED', 'organization', {
      departments: nextDepartments.length,
      positions: nextPositions.length
    });
    write();
    return { departments: clone(state.departments), positions: clone(state.positions) };
  };
  const localPartInUse = (localPart, excludingUserUid = '') => state.mailAddresses.some((entry) => entry.localPart === localPart)
    || state.identities.some((entry) => entry.userUid !== excludingUserUid && entry.mailLocalPart === localPart)
    || state.mailReservations.some((entry) => entry.userUid !== excludingUserUid && entry.localPart === localPart);
  const requestedLoginLocalPart = (loginId) => {
    const requested = String(loginId || '').trim().toLowerCase();
    const normalized = normalizeLocalPart(requested);
    if (!isValidLocalPart(requested) || normalized !== requested) {
      throw Object.assign(new Error('아이디는 이메일 주소에도 그대로 사용되므로 소문자 영문, 숫자, 점만 사용할 수 있습니다.'), {
        status: 400,
        code: 'MAIL_ID_INVALID',
        field: 'id'
      });
    }
    if (state.reservedLocalParts.includes(requested)) {
      throw Object.assign(new Error('공용 또는 시스템 메일 주소로 예약된 아이디입니다.'), {
        status: 409,
        code: 'MAIL_ID_RESERVED',
        field: 'id'
      });
    }
    return requested;
  };
  const assertSignupAddressAvailable = (loginId, excludingUserUid = '') => {
    const localPart = requestedLoginLocalPart(loginId);
    if (localPartInUse(localPart, excludingUserUid)) {
      throw Object.assign(new Error('이미 NAS 계정 또는 Cresero 메일 주소에서 사용 중인 아이디입니다.'), {
        status: 409,
        code: 'MAIL_ADDRESS_IN_USE',
        field: 'id'
      });
    }
    return { localPart, address: `${localPart}@${state.domain}` };
  };
  const reserveSignupAddress = (loginId, userUid, actor = 'public-signup') => {
    const safeUserUid = String(userUid || '').trim();
    if (!safeUserUid) throw new Error('signup userUid is required');
    const existing = state.mailReservations.find((entry) => entry.userUid === safeUserUid);
    if (existing) return clone(existing);
    const requested = assertSignupAddressAvailable(loginId, safeUserUid);
    const reservation = {
      id: makeId('mail_reservation'),
      userUid: safeUserUid,
      loginId: requested.localPart,
      localPart: requested.localPart,
      address: requested.address,
      createdAt: nowIso()
    };
    state.mailReservations.push(reservation);
    audit(actor, 'MAIL_ADDRESS_RESERVED', safeUserUid, { address: reservation.address });
    write();
    return clone(reservation);
  };
  const releaseSignupAddress = (userUid, actor = 'system', reason = '') => {
    const safeUserUid = String(userUid || '').trim();
    const prior = state.mailReservations.find((entry) => entry.userUid === safeUserUid);
    if (!prior) return false;
    state.mailReservations = state.mailReservations.filter((entry) => entry.userUid !== safeUserUid);
    audit(actor, 'MAIL_ADDRESS_RESERVATION_RELEASED', safeUserUid, { address: prior.address, reason: String(reason || '') });
    write();
    return true;
  };
  const proposeUserLocalPart = (loginId, userUid) => {
    const base = normalizeLocalPart(loginId);
    if (!isValidLocalPart(base) || state.reservedLocalParts.includes(base)) return '';
    if (!localPartInUse(base, userUid)) return base;
    for (let suffix = 2; suffix <= 999; suffix += 1) {
      const candidate = `${base}.${suffix}`;
      if (!localPartInUse(candidate, userUid)) return candidate;
    }
    return '';
  };
  const approveUser = (user, signup = {}, actor = 'system') => {
    const userUid = String(user.userUid || '');
    if (!userUid) throw new Error('approved userUid is required');
    const type = normalizeAccountType(signup.accountType || user.accountType, 'UNCLASSIFIED');
    let identity = state.identities.find((item) => item.userUid === userUid);
    if (!identity) {
      identity = { id: makeId('identity'), userUid, createdAt: nowIso() };
      state.identities.push(identity);
    }
    identity.accountType = type;
    identity.contactEmail = normalizeEmail(signup.contactEmail || user.contactEmail);
    identity.emailVerified = !!(signup.emailVerified || user.emailVerified);
    identity.departmentId = String(signup.organizationProfile?.departmentId || user.organizationProfile?.departmentId || identity.departmentId || '');
    identity.positionId = String(signup.organizationProfile?.positionId || user.organizationProfile?.positionId || identity.positionId || '');
    identity.employmentStatus = type === 'INTERNAL' ? 'ACTIVE' : (type === 'EXTERNAL' ? 'EXTERNAL' : 'ACTIVE');
    identity.updatedAt = nowIso();
    const reservation = state.mailReservations.find((entry) => entry.userUid === userUid);
    if (!identity.mailLocalPart && (reservation || state.signupPolicy.autoIssueSignupMailbox)) {
      identity.mailLocalPart = reservation?.localPart || proposeUserLocalPart(user.loginId || user.id || user.username, userUid);
      identity.mailboxStatus = identity.mailLocalPart
        ? (state.provider.mode === 'ACTIVE' ? 'PENDING_PROVIDER' : 'PLANNED')
        : 'REVIEW_REQUIRED';
      identity.primaryAddress = identity.mailLocalPart ? `${identity.mailLocalPart}@${state.domain}` : '';
    }
    if (reservation) state.mailReservations = state.mailReservations.filter((entry) => entry.userUid !== userUid);
    audit(actor, 'ORGANIZATION_IDENTITY_APPROVED', userUid, { accountType: type, mailboxStatus: identity.mailboxStatus || '' });
    write();
    return clone(identity);
  };
  const updateIdentity = (userUid, input, actor, { isMaster = false } = {}) => {
    if (!isMaster) throw Object.assign(new Error('조직 계정 유형과 직책은 마스터만 변경할 수 있습니다.'), { status: 403 });
    const identity = state.identities.find((item) => item.userUid === userUid);
    if (!identity) throw Object.assign(new Error('조직 명단에서 사용자를 찾을 수 없습니다.'), { status: 404 });
    if (input.accountType !== undefined) identity.accountType = normalizeAccountType(input.accountType, identity.accountType);
    if (input.departmentId !== undefined) {
      const departmentId = String(input.departmentId || '');
      if (departmentId && !state.departments.some((item) => item.id === departmentId && item.active)) throw Object.assign(new Error('사용 가능한 부서를 선택해주세요.'), { status: 400 });
      identity.departmentId = departmentId;
    }
    if (input.positionId !== undefined) {
      const positionId = String(input.positionId || '');
      if (positionId && !state.positions.some((item) => item.id === positionId && item.active)) throw Object.assign(new Error('사용 가능한 직책을 선택해주세요.'), { status: 400 });
      identity.positionId = positionId;
    }
    if (input.employmentStatus !== undefined) identity.employmentStatus = String(input.employmentStatus || '').toUpperCase();
    if (input.contactEmail !== undefined) {
      const email = normalizeEmail(input.contactEmail);
      if (email && !isEmail(email)) throw Object.assign(new Error('연락 이메일 형식이 올바르지 않습니다.'), { status: 400 });
      identity.contactEmail = email;
      identity.emailVerified = false;
    }
    if (input.mailLocalPart !== undefined) {
      const localPart = normalizeLocalPart(input.mailLocalPart);
      if (!isValidLocalPart(localPart) || state.reservedLocalParts.includes(localPart)) throw Object.assign(new Error('사용할 수 없는 메일 주소입니다.'), { status: 400 });
      if (localPartInUse(localPart, userUid)) throw Object.assign(new Error('이미 사용 중인 메일 주소입니다.'), { status: 409 });
      identity.mailLocalPart = localPart;
      identity.primaryAddress = `${localPart}@${state.domain}`;
      identity.mailboxStatus = state.provider.mode === 'ACTIVE' ? 'PENDING_PROVIDER' : 'PLANNED';
    }
    identity.updatedAt = nowIso();
    audit(actor, 'ORGANIZATION_IDENTITY_UPDATED', userUid, {
      accountType: identity.accountType,
      departmentId: identity.departmentId,
      positionId: identity.positionId,
      employmentStatus: identity.employmentStatus,
      mailboxStatus: identity.mailboxStatus || ''
    });
    write();
    return clone(identity);
  };
  const suspendUser = (userUid, actor = 'system') => {
    const identity = state.identities.find((item) => item.userUid === userUid);
    if (!identity) return null;
    identity.employmentStatus = 'SUSPENDED';
    if (identity.mailboxStatus && identity.mailboxStatus !== 'REVIEW_REQUIRED') identity.mailboxStatus = 'SUSPENDED';
    identity.updatedAt = nowIso();
    audit(actor, 'ORGANIZATION_IDENTITY_SUSPENDED', userUid, {});
    write();
    return clone(identity);
  };
  const ensureExistingUsers = (users = []) => {
    let changed = false;
    for (const user of users) {
      if (!user?.userUid || state.identities.some((item) => item.userUid === user.userUid)) continue;
      state.identities.push({
        id: makeId('identity'),
        userUid: user.userUid,
        accountType: 'UNCLASSIFIED',
        contactEmail: '',
        emailVerified: false,
        departmentId: '',
        positionId: '',
        employmentStatus: user.disabled ? 'SUSPENDED' : 'ACTIVE',
        mailLocalPart: '',
        primaryAddress: '',
        mailboxStatus: 'REVIEW_REQUIRED',
        createdAt: nowIso(),
        updatedAt: nowIso()
      });
      changed = true;
    }
    if (changed) {
      audit('system', 'EXISTING_USERS_REGISTERED', 'organization', { count: users.length });
      write();
    }
    return state.identities.length;
  };
  const reconcileExistingUserMailboxes = (users = [], actor = 'system') => {
    let changed = 0;
    let reviewRequired = 0;
    for (const user of users) {
      const userUid = String(user?.userUid || '');
      const identity = state.identities.find((item) => item.userUid === userUid);
      if (!identity || identity.mailLocalPart || identity.primaryAddress) continue;
      const loginId = String(user.loginId || user.id || user.username || '').trim().toLowerCase();
      try {
        const requested = assertSignupAddressAvailable(loginId, userUid);
        identity.mailLocalPart = requested.localPart;
        identity.primaryAddress = requested.address;
        identity.mailboxStatus = state.provider.mode === 'ACTIVE' ? 'PENDING_PROVIDER' : 'PLANNED';
        identity.updatedAt = nowIso();
        changed += 1;
      } catch (err) {
        if (identity.mailboxStatus !== 'REVIEW_REQUIRED') {
          identity.mailboxStatus = 'REVIEW_REQUIRED';
          identity.updatedAt = nowIso();
          reviewRequired += 1;
        }
      }
    }
    if (changed || reviewRequired) {
      audit(actor, 'EXISTING_USER_MAILBOXES_RECONCILED', 'organization', { changed, reviewRequired });
      write();
    }
    return { changed, reviewRequired };
  };

  load();
  return {
    getPublicPolicy: publicPolicy,
    getAdminState: adminState,
    validateSignup,
    createInvitation,
    revokeInvitation,
    updatePolicy,
    updateStructure,
    approveUser,
    updateIdentity,
    suspendUser,
    ensureExistingUsers,
    assertSignupAddressAvailable,
    reserveSignupAddress,
    releaseSignupAddress,
    reconcileExistingUserMailboxes,
    constants: { ACCOUNT_TYPES, MAILBOX_KINDS, MAILBOX_STATUSES, SIGNUP_MODES }
  };
};

module.exports = {
  ACCOUNT_TYPES,
  MAILBOX_KINDS,
  MAILBOX_STATUSES,
  SIGNUP_MODES,
  createOrganizationDirectory,
  normalizeEmail,
  normalizeLocalPart,
  isValidLocalPart
};
