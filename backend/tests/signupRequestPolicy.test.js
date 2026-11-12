const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPublicAdminApprovalSignup } = require('../signupRequestPolicy');

test('simple public signup creates only a pending unclassified admin-approval profile', () => {
  const request = buildPublicAdminApprovalSignup({
    loginId: 'new.user',
    password: 'not-persisted-plain-by-policy',
    requestedAt: '2026-11-12T09:00:00.000Z'
  });

  assert.equal(request.loginId, 'new.user');
  assert.equal(request.nickname, 'new.user');
  assert.equal(request.accountType, 'UNCLASSIFIED');
  assert.equal(request.contactEmail, '');
  assert.equal(request.invitationId, '');
  assert.deepEqual(request.organizationProfile, { signupSource: 'PUBLIC_ADMIN_APPROVAL' });
  assert.equal(request.requestedAt, '2026-11-12T09:00:00.000Z');
});

test('an invitation can preserve organization metadata without adding public form fields', () => {
  const request = buildPublicAdminApprovalSignup({
    loginId: 'invited.user',
    password: 'not-persisted-plain-by-policy',
    requestedAt: '2026-11-12T09:00:00.000Z',
    organizationSignup: {
      accountType: 'INTERNAL',
      contactEmail: 'person@example.com',
      emailVerified: false,
      invitationId: 'invite_1',
      organizationProfile: { departmentId: 'development' }
    }
  });

  assert.equal(request.accountType, 'INTERNAL');
  assert.equal(request.contactEmail, 'person@example.com');
  assert.equal(request.invitationId, 'invite_1');
  assert.deepEqual(request.organizationProfile, { departmentId: 'development' });
});
