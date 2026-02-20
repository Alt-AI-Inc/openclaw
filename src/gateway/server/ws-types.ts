import type { WebSocket } from "ws";
import type { ConnectParams } from "../protocol/index.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  clientIp?: string;
  canvasCapability?: string;
  canvasCapabilityExpiresAtMs?: number;
  /** Authenticated user from trusted-proxy auth (email/username) */
  authenticatedUser?: string;
  /**
   * Pre-resolved session key based on authenticatedUser + dmScope.
   * When set, gateway methods should use this instead of client-provided sessionKey.
   */
  resolvedSessionKey?: string;
};
