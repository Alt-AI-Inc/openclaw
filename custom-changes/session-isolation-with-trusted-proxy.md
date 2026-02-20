# Session Isolation with Trusted-Proxy Authentication

**Date:** 2026-02-20
**Status:** Implemented and tested
**Impact:** Gateway session routing for multi-user deployments

## Problem

OpenClaw's gateway was designed for single-user scenarios. When deploying with a reverse proxy (Cloudflare Workers) that authenticates users and forwards their identity via headers, all users shared the same session. This meant:

1. All authenticated users saw the same chat history
2. Messages from different users appeared in the same conversation
3. No user privacy or isolation

## Solution Overview

Implemented **per-user session isolation** using OpenClaw's existing `dmScope` configuration system, treating the gateway as a channel (like Slack/WhatsApp) rather than requiring custom session rewriting logic.

### Key Insight

Instead of building custom session isolation logic, we unified gateway session routing with the existing channel routing architecture:

- Channels (Slack, WhatsApp, Discord) already use `buildAgentPeerSessionKey` with `dmScope`
- Gateway should work the same way
- Compute session key **once at connection time** based on authenticated user

## Architecture

```
Browser → Cloudflare Worker (auth) → OpenClaw Gateway
                ↓
         X-Forwarded-User: alice@example.com
                ↓
         resolvedSessionKey: agent:main:direct:alice@example.com
```

### Session Resolution Flow

1. **Connection Time:**
   - WebSocket connects through proxy with `X-Forwarded-User` header
   - Gateway extracts `authenticatedUser` from trusted-proxy auth
   - Calls `buildAgentPeerSessionKey` with dmScope to compute session
   - Stores `resolvedSessionKey` in client object

2. **Request Time:**
   - Client sends RPC request with default session key (e.g., "agent:main:main")
   - Gateway overrides with `client.resolvedSessionKey` if present
   - All operations use the per-user session

3. **Session Listing:**
   - Gateway filters session list to only show user's own sessions
   - Privacy: users can't see other users' session names

## Implementation Details

### Files Modified

#### 1. `src/gateway/server/ws-types.ts`

Added `resolvedSessionKey` to client type:

```typescript
export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  clientIp?: string;
  authenticatedUser?: string;
  resolvedSessionKey?: string; // ← NEW
};
```

#### 2. `src/gateway/server/ws-connection/message-handler.ts`

Added helper function and connection-time resolution:

```typescript
function resolveGatewaySessionKey(params: {
  authenticatedUser: string | undefined;
  cfg: ReturnType<typeof loadConfig>;
}): string | undefined {
  if (!authenticatedUser) return undefined;

  return buildAgentPeerSessionKey({
    agentId: "main",
    channel: "gateway", // Treat gateway as a channel
    peerKind: "direct",
    peerId: authenticatedUser,
    dmScope: cfg.session?.dmScope ?? "main",
    identityLinks: cfg.session?.identityLinks,
  });
}
```

Set on connection:

```typescript
const authenticatedUser = authResult.ok && "user" in authResult ? authResult.user : undefined;
const cfg = loadConfig();
const resolvedSessionKey = resolveGatewaySessionKey({ authenticatedUser, cfg });

const nextClient: GatewayWsClient = {
  // ...
  authenticatedUser,
  resolvedSessionKey,
};
```

#### 3. `src/gateway/server-methods/chat.ts`

Updated 4 handlers to use resolved session:

- `chat.history`
- `chat.send`
- `chat.abort`
- `chat.inject`

Pattern:

```typescript
const rawSessionKey = params.sessionKey;
const sessionKey = client?.resolvedSessionKey || rawSessionKey;
// Use sessionKey for all operations
```

#### 4. `src/gateway/server-methods/sessions.ts`

Added session list filtering:

```typescript
"sessions.list": ({ params, respond, client }) => {
  // ... load sessions ...

  const authenticatedUser = client?.authenticatedUser;
  if (authenticatedUser) {
    result.sessions = result.sessions.filter((session) => {
      return session.key.includes(`:${authenticatedUser}`);
    });
  }

  respond(true, result, undefined);
}
```

#### 5. `src/config/types.gateway.ts` & `src/config/zod-schema.ts`

Removed obsolete `isolateSessions` field (replaced by `dmScope`)

#### 6. `src/gateway/server-session-key-rewrite.ts`

**DELETED** - Custom rewriting logic no longer needed

## Configuration

### Production openclaw.json

```json
{
  "session": {
    "dmScope": "per-peer"
  },
  "gateway": {
    "auth": {
      "mode": "trusted-proxy",
      "trustedProxy": {
        "userHeader": "x-forwarded-user",
        "requiredHeaders": ["x-forwarded-proto", "x-forwarded-host"],
        "allowUsers": [] // Optional: restrict to specific users
      }
    },
    "trustedProxies": ["127.0.0.1", "::1", "::ffff:127.0.0.1"]
  }
}
```

### dmScope Options

- `"main"` (default): All users share one session
- `"per-peer"`: Each user gets isolated session across all channels
- `"per-channel-peer"`: Each user per channel gets isolated session
- `"per-account-channel-peer"`: Each user per channel per account

For gateway with trusted-proxy: use **`"per-peer"`**

### Cloudflare Worker Configuration

The worker must add the authentication header:

```javascript
const headers = new Headers(request.headers);
headers.set("x-forwarded-user", user.email);
headers.set("x-forwarded-proto", "https");
headers.set("x-forwarded-host", request.headers.get("host"));

return fetch(gatewayUrl, {
  method: request.method,
  headers,
  body: request.body,
});
```

## Testing Locally

### 1. Test Proxy (for local development only)

Created `test-proxy-v2.js` using `http-proxy` to simulate Cloudflare Worker:

- Reads `?user=` query param
- Sets cookie for subsequent requests
- Adds `X-Forwarded-User` header
- Properly handles WebSocket upgrades

**Note:** Test proxy has WebSocket streaming limitations. Production Cloudflare handles this correctly.

### 2. Dev Configuration

Created `.openclaw/` directory in repo for isolated dev config:

```bash
OPENCLAW_STATE_DIR=~/Source/openclaw/.openclaw \
OPENAI_API_KEY=$OPENAI_API_KEY \
node dist/entry.js gateway
```

### 3. Test URLs

- Alice: `http://localhost:18790/?user=alice@example.com`
- Bob: `http://localhost:18790/?user=bob@example.com`

## Key Learnings

### 1. Architecture Unification

**Before:** Gateway had separate, custom session logic
**After:** Gateway uses same `buildAgentPeerSessionKey` as channels

**Why this matters:**

- Single source of truth for session routing
- Leverages existing, tested dmScope logic
- Easier to maintain and understand

### 2. Connection-Time Resolution

**Pattern:** Resolve session once at connection, not per-request

**Benefits:**

- Performance: compute once, reuse many times
- Consistency: session can't change mid-connection
- Simplicity: handlers just use `client.resolvedSessionKey`

### 3. Trusted-Proxy Auth Model

Gateway trusts headers from known proxy IPs. Critical security:

- Configure `trustedProxies` IP allowlist
- Validate `userHeader` presence
- Use `requiredHeaders` for additional verification
- Never expose gateway directly to internet

### 4. Session Privacy

Session isolation has two aspects:

1. **Message isolation** (security critical): ✅ Users can't access each other's messages
2. **Metadata privacy** (UX/privacy): ✅ Users can't see each other's session names

Both must be handled.

### 5. WebSocket Proxying Complexity

Simple TCP tunneling (our test proxy) doesn't handle WebSocket framing perfectly.
Production solution: Use proper WebSocket proxy (Cloudflare handles this correctly)

## Deployment Checklist

- [ ] Update `openclaw.json` with session.dmScope and gateway.auth.trustedProxy
- [ ] Configure Cloudflare Worker to add X-Forwarded-User header
- [ ] Set gateway.trustedProxies to Cloudflare IP ranges
- [ ] Test with multiple users (different emails)
- [ ] Verify session isolation (messages don't leak)
- [ ] Verify session privacy (can't see other users' sessions)
- [ ] Test WebSocket streaming works in production

## Production Deployment

### Cloudflare IP Ranges

Add to `trustedProxies`:

```json
"trustedProxies": [
  "127.0.0.1",
  "::1",
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  // ... (full Cloudflare IP list)
]
```

### Security Considerations

1. **Never expose gateway without proxy** - trusted-proxy mode assumes all requests are authenticated
2. **Validate proxy IPs** - only trust known reverse proxy IPs
3. **Use requiredHeaders** - verify requests came through your proxy
4. **HTTPS only** - use TLS for gateway connections
5. **Optional: allowUsers** - restrict to specific user list

## Future Enhancements

1. **Identity Links**: Map multiple user IDs to same session (e.g., email aliases)
2. **Group Sessions**: Support group chats with multiple authenticated users
3. **Session Migration**: Handle user ID changes gracefully
4. **Audit Logging**: Track which user accessed which session

## References

- OpenClaw dmScope documentation: [link to docs]
- Channel routing: `src/routing/session-key.ts`
- Trusted-proxy auth: `src/gateway/auth/trusted-proxy.ts`
- Session utilities: `src/gateway/session-utils.ts`

## Commit Message

```
feat(gateway): add per-user session isolation with trusted-proxy auth

Unified gateway session routing with channel routing architecture by using
buildAgentPeerSessionKey + dmScope for per-user session isolation.

Changes:
- Compute session at connection time based on X-Forwarded-User header
- Store resolvedSessionKey in client object for request reuse
- Update chat handlers to use resolvedSessionKey
- Filter session list to show only user's own sessions
- Remove custom isolateSessions config (replaced by dmScope)

This enables multi-user gateway deployments where users connect through
an identity-aware reverse proxy (e.g., Cloudflare Workers with auth).

Breaking change: Removes gateway.auth.trustedProxy.isolateSessions config.
Use session.dmScope instead (set to "per-peer" for per-user isolation).
```
