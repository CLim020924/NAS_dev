const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createOrganizationDirectory } = require('../organizationDirectory');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-org-directory-'));
const directory = createOrganizationDirectory({ dataDir: tempRoot });

try {
  const publicPolicy = directory.getPublicPolicy();
  assert.strictEqual(publicPolicy.domain, 'cresero.com');
  assert.strictEqual(publicPolicy.providerReady, false);
  assert.strictEqual(publicPolicy.signup.internalRequiresInvite, true);
  assert.strictEqual(publicPolicy.signup.externalRequiresInvite, true);
  assert.throws(() => directory.updatePolicy({
    externalMode: 'ADMIN_APPROVAL'
  }, 'master-user', { isMaster: true }), /메일 제공자/);

  const internalInvite = directory.createInvitation({
    accountType: 'INTERNAL',
    email: 'person@example.com',
    departmentId: 'development',
    positionId: 'member',
    ttlHours: 24
  }, 'master-user', { isMaster: true });
  assert.ok(internalInvite.token.length > 20);
  assert.strictEqual(internalInvite.invitation.tokenHash, undefined);

  const internalSignup = directory.validateSignup({
    accountType: 'INTERNAL',
    email: 'person@example.com',
    inviteToken: internalInvite.token
  });
  assert.strictEqual(internalSignup.accountType, 'INTERNAL');
  assert.strictEqual(internalSignup.organizationProfile.departmentId, 'development');

  assert.throws(() => directory.validateSignup({
    accountType: 'INTERNAL',
    email: 'person@example.com',
    inviteToken: internalInvite.token
  }), /초대 코드/);

  assert.throws(() => directory.createInvitation({
    accountType: 'INTERNAL',
    email: 'other@example.com'
  }, 'manager-user', { isMaster: false }), /마스터/);

  const revocableInvite = directory.createInvitation({
    accountType: 'EXTERNAL',
    email: 'revoke@example.net'
  }, 'manager-user', { isMaster: false });
  const revoked = directory.revokeInvitation(revocableInvite.invitation.id, 'manager-user', { isMaster: false });
  assert.ok(revoked.revokedAt);
  assert.throws(() => directory.validateSignup({
    accountType: 'EXTERNAL',
    email: 'revoke@example.net',
    inviteToken: revocableInvite.token
  }), /초대 코드/);

  const structure = directory.updateStructure({
    departments: [
      { id: 'executive', name: '경영', active: true },
      { id: 'development', name: '개발', active: true },
      { id: 'operations', name: '운영', active: true }
    ],
    positions: [
      { id: 'ceo', name: '대표이사', level: 100, roleAddress: 'ceo', active: true },
      { id: 'manager', name: '관리자', level: 50, active: true },
      { id: 'member', name: '구성원', level: 10, active: true }
    ]
  }, 'master-user', { isMaster: true });
  assert.strictEqual(structure.departments.length, 3);
  assert.throws(() => directory.updateStructure({ departments: [{ id: 'same', name: 'A' }, { id: 'same', name: 'B' }] }, 'master-user', { isMaster: true }), /중복/);

  directory.ensureExistingUsers([{ userUid: 'usr_legacy', loginId: 'legacy-user', disabled: false }]);
  const legacyIdentity = directory.getAdminState().identities.find((item) => item.userUid === 'usr_legacy');
  assert.strictEqual(legacyIdentity.accountType, 'UNCLASSIFIED');
  assert.strictEqual(legacyIdentity.mailboxStatus, 'REVIEW_REQUIRED');

  const approvedInternal = directory.approveUser({
    userUid: 'usr_internal',
    loginId: 'alice'
  }, internalSignup, 'master-user');
  assert.strictEqual(approvedInternal.primaryAddress, 'alice@cresero.com');
  assert.strictEqual(approvedInternal.mailboxStatus, 'PLANNED');

  const externalInvite = directory.createInvitation({
    accountType: 'EXTERNAL',
    email: 'guest@example.net'
  }, 'manager-user', { isMaster: false });
  const externalSignup = directory.validateSignup({
    accountType: 'EXTERNAL',
    email: 'guest@example.net',
    inviteToken: externalInvite.token
  });
  const approvedExternal = directory.approveUser({
    userUid: 'usr_external',
    loginId: 'guest'
  }, externalSignup, 'master-user');
  assert.strictEqual(approvedExternal.primaryAddress, undefined);
  assert.strictEqual(approvedExternal.accountType, 'EXTERNAL');

  directory.updatePolicy({
    blockedExternalDomains: ['blocked.example'],
    allowedExternalDomains: []
  }, 'master-user', { isMaster: true });
  assert.throws(() => directory.updatePolicy({
    allowedExternalDomains: ['same.example'],
    blockedExternalDomains: ['same.example']
  }, 'master-user', { isMaster: true }), /동시/);
  const blockedInvite = directory.createInvitation({
    accountType: 'EXTERNAL',
    email: 'guest@blocked.example'
  }, 'manager-user', { isMaster: false });
  assert.throws(() => directory.validateSignup({
    accountType: 'EXTERNAL',
    email: 'guest@blocked.example',
    inviteToken: blockedInvite.token
  }), /가입에 사용할 수 없습니다/);

  const updated = directory.updateIdentity('usr_internal', {
    departmentId: 'operations',
    positionId: 'manager',
    employmentStatus: 'ACTIVE',
    mailLocalPart: 'alice.kim'
  }, 'master-user', { isMaster: true });
  assert.strictEqual(updated.primaryAddress, 'alice.kim@cresero.com');
  assert.throws(() => directory.updateIdentity('usr_external', {
    mailLocalPart: 'admin'
  }, 'master-user', { isMaster: true }), /사용할 수 없는/);

  const suspended = directory.suspendUser('usr_internal', 'master-user');
  assert.strictEqual(suspended.employmentStatus, 'SUSPENDED');
  assert.strictEqual(suspended.mailboxStatus, 'SUSPENDED');

  const saved = JSON.parse(fs.readFileSync(path.join(tempRoot, 'organization_directory.json'), 'utf8'));
  assert.ok(saved.invitations.every((invite) => invite.tokenHash && !Object.hasOwn(invite, 'token')));
  assert.ok(saved.audit.length > 0);
  console.log('organizationDirectory tests passed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
