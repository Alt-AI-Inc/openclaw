import type { OpenClawConfig } from "../config/config.js";
import type { GatewayWsClient } from "./server/ws-types.js";

/**
 * Rewrite the session key for per-user isolation when trusted-proxy auth
 * has isolateSessions enabled. This allows each authenticated user to have
 * their own session instead of sharing the default "main" session.
 *
 * @param sessionKey - The session key from the client request
 * @param client - The WebSocket client (contains authenticatedUser)
 * @param cfg - Gateway configuration
 * @returns Rewritten session key or original if isolation not enabled
 */
export function rewriteSessionKeyForUser(
  sessionKey: string,
  client: GatewayWsClient | null | undefined,
  cfg: OpenClawConfig,
): string {
  // Check if trusted-proxy isolateSessions is enabled
  const isolateSessions = cfg.gateway?.auth?.trustedProxy?.isolateSessions === true;
  if (!isolateSessions) {
    return sessionKey;
  }

  // Check if we have an authenticated user
  const authenticatedUser = client?.authenticatedUser;
  if (!authenticatedUser) {
    return sessionKey;
  }

  // Rewrite "main" and empty/default session keys to user-specific keys
  // Leave other session keys (like explicit thread IDs) unchanged
  if (sessionKey === "main" || sessionKey === "" || !sessionKey) {
    // Create a user-specific session key
    // Use format: "user:{email}" which will be canonicalized to "agent:main:user:{email}"
    const userSessionKey = `user:${authenticatedUser}`;
    return userSessionKey;
  }

  // Don't rewrite explicit non-main session keys
  return sessionKey;
}
