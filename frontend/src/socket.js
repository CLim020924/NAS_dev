import { io } from "socket.io-client";

// IP를 하드코딩하지 않고, 현재 접속한 도메인을 그대로 따라가도록 설정합니다.
const socket = io({
  path: "/socket.io",
  withCredentials: true,
  transports: ["polling", "websocket"],
  upgrade: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 5000,
  timeout: 15000
});

export default socket;
