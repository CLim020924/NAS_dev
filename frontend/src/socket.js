import { io } from "socket.io-client";

// IP를 하드코딩하지 않고, 현재 접속한 도메인을 그대로 따라가도록 설정합니다.
const socket = io({
  path: "/socket.io",
  withCredentials: true,
  transports: ["websocket"]
});

export default socket;
