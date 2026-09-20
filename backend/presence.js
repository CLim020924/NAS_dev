const connectedIdentitySets = (sockets) => {
  const loginIds = new Set();
  const userUids = new Set();
  for (const socket of sockets.values()) {
    if (socket.userId) loginIds.add(socket.userId);
    if (socket.userUid) userUids.add(socket.userUid);
  }
  return { loginIds, userUids };
};

const isUserOnline = (sets, loginId, userUid) =>
  sets.loginIds.has(loginId) || sets.userUids.has(userUid);

module.exports = { connectedIdentitySets, isUserOnline };
