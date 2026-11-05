import { defineEndpoint } from "../endpoint";
import { SocketTokenData } from "../socket-token";

export const realtimeEndpoints = {
  /** A5. Short-lived token for the socket.io auth handshake. */
  socketToken: defineEndpoint({
    id: "socket-token.get",
    method: "GET",
    path: "/api/socket-token",
    auth: "user",
    class: "R1",
    cache: "no-store",
    response: SocketTokenData,
    errors: ["not_configured"],
    summary: "Issues a socket auth token",
  }),
} as const;
