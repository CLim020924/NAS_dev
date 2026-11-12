const jwt = require('jsonwebtoken');

const verifySignedLogoutToken = (token, secret) => {
  if (!token) return null;
  try {
    // Logout must still revoke the server-side session after the JWT expiry
    // boundary, but the signature must remain valid.
    return jwt.verify(token, secret, { ignoreExpiration: true });
  } catch {
    return null;
  }
};

module.exports = { verifySignedLogoutToken };
