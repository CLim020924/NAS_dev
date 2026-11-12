const buildPublicAdminApprovalSignup = ({ loginId, password, requestedAt, organizationSignup = {} }) => ({
  id: loginId,
  loginId,
  password,
  displayName: loginId,
  nickname: loginId,
  profile: {},
  accountType: organizationSignup.accountType || 'UNCLASSIFIED',
  contactEmail: organizationSignup.contactEmail || '',
  emailVerified: !!organizationSignup.emailVerified,
  invitationId: organizationSignup.invitationId || '',
  organizationName: '',
  organizationProfile: organizationSignup.organizationProfile || { signupSource: 'PUBLIC_ADMIN_APPROVAL' },
  date: requestedAt.slice(0, 10),
  requestedAt
});

module.exports = { buildPublicAdminApprovalSignup };
