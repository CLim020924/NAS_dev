// src/socket.js
import { io } from "socket.io-client";

// 환경 변수 또는 고정값으로 백엔드 Socket.io 서버 주소 지정
const socket = io("http://localhost:3030", {
  withCredentials: true,
  transports: ["websocket"]
});

export default socket;
