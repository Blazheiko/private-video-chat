# Implementation review handoff

**Date:** 2026-07-14  
**Scope:** worker-3 review/documentation lane for the private-video-chat implementation task list.  
**Source of truth:** `docs/technical-specification.md` v1.6 and `.omx/context/private-video-chat-implementation-20260714T143700Z.md`.

## Current repository state

- Present in this worktree: `README.md`, `docs/technical-specification.md`, OMX/agent metadata.
- Not present in this worktree yet: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `packages/shared`, `apps/server`, `apps/web`, `infra/coturn`, CI config, tests.
- Therefore this review is a pre-implementation gate: it documents the quality contracts that the M0/M1 implementation must satisfy and the verification gaps that remain until scaffold/code is merged.

## Review probe findings integrated

A required read-only review probe inspected the spec/context and current repo. Findings integrated in this branch:

- Empty `README.md` replaced with implementation status, milestone order, and command expectations.
- Base64url contracts normalized to **unpadded** encoded lengths for 128-bit nonces, Ed25519 keys/signatures, and HMAC-SHA256 MACs.
- `senderId` clarified as an opaque local tab ID, not a human display-name field.
- `joined.ice` clarified as private-room-only/optional so group joins do not require needless TURN credentials.
- Streaming SHA-256 wording corrected: WebCrypto `crypto.subtle.digest` is one-shot; large-file verification needs a real incremental hasher.
- Existing trailing whitespace in the spec removed.

Remaining high-risk finding: the implementation scaffold is still absent in this worktree, so code-level verification is blocked until worker-1/M0 changes are integrated.

## P0 contracts that must stay locked before broad implementation

| Area | Required invariant | Spec anchor | Review risk if missed |
| --- | --- | --- | --- |
| ID formats | Room, participant, resume token, nonce, key material, SDP/ICE, and envelope fields follow the exact **unpadded base64url**/length/uint53 limits. | §5.1, §6.1, §6.6 | Incompatible clients, weak tokens, schema bypasses. |
| Runtime validation | Every network message is validated at runtime on server and client; TypeScript types alone are not accepted as validation. | §6.13 | Untrusted JSON reaches state machines. |
| Error contract | All failures use `error{code,message,fatal}`; no legacy `room-full`/`room-closed` events. | §6.8 | Clients fork on inconsistent error paths. |
| Room lifecycle | `participantId` survives reconnect within grace via `resumeToken`; `connId` is socket-local and not part of protocol; private tombstones prevent immediate ID reuse. | §5.4, §6.1 | Slot hijack, wrong seq reset, replay acceptance. |
| Group relay attribution | Trusted sender identity is server-stamped `from: participantId`; `senderId` is only an opaque local tab/display seed. | §6.1, §6.4, §7.2 | Insider can spoof visible authorship if UI trusts `senderId`. |
| ACK semantics | Relay `ack{cid}` confirms server receipt/fanout attempt only; `cid` is WS-local and resets after reconnect. | §6.9 | UI may overclaim peer delivery. |
| Auth-before-data | Private WebRTC data/media starts only after HMAC transcript auth and safety-code agreement. | §7.1, §14 | Malicious signaling server can MITM media/data. |
| TURN timing | TURN/coturn short-term credentials are introduced with M2 and issued only for private/WebRTC rooms, not deferred to prod hardening and not needed for group joins. | §6.10, §12 | P2P works only on easy networks or group joins waste credentials. |
| Logging/privacy | No plaintext, ciphertext, SDP body, file data, or message metadata is persistently logged. | §1.1, §9, §14.1 | Violates core privacy promise. |

## Implementation checklist by milestone

### M0 scaffold gate

- Root scripts exist and work from a clean clone: `pnpm install`, `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm dev`, `pnpm start`.
- `packages/shared` owns protocol types, constants, base64url helpers, and runtime schemas used by both server and web.
- Server starts with uWebSockets.js, static serving, WebSocket upgrade, Origin allow-list, join timeout, heartbeat/backpressure hooks, and no sensitive payload logging.
- Web app starts with Preact + Vite and routes for `/`, `/r/g/:room`, `/r/p/:room`.
- Local HTTPS/WSS and strict CSP are either implemented or explicitly documented as blocked with exact missing pieces.

### M1 group core gate

- Room registry is in-memory only and has grace cleanup, private tombstone logic isolated from group rooms, and capacity/rate-limit guards.
- `join` produces `joined{selfId, roomInstanceId, resumeToken, resumed, peers, ice}` for both group and private kinds.
- Group `relay` rejects private rooms, stamps `from`, applies size/rate/backpressure budgets, returns `ack{cid}`, and never buffers history.
- Client crypto uses fragment-derived key material, wipes `#k` from the visible URL after import, and binds AAD fields exactly as specified.
- Receiver dedup/replay state is keyed by `participantId` and resets only on final peer expiration or `roomInstanceId` change.

### M2 private P2P + TURN gate

- Private room capacity is exactly two active participant slots with grace-aware reclaim; third join returns `ROOM_FULL`.
- `signal`/`auth` are allowed only in private rooms and only to current peers in the same room.
- Perfect negotiation roles derive deterministically from `joined.peers`.
- TURN credentials are short-lived and refreshed before expiry; coturn secret never reaches clients.
- DataChannel `chat` does not open app traffic until auth succeeds.

## Verification plan once scaffold/code lands

Run these from the repository root after integrating implementation work:

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm start
```

Then perform focused checks for:

- Group chat with at least three tabs: no history replay to a late joiner, relay ACK behavior, replay/drop on duplicate or stale `seq`.
- Reconnect within and after `ROOM_GRACE_MS`: same participant before grace expiry, new instance/state reset after expiry.
- Private room: two participants only, third receives `ROOM_FULL`, signaling cannot target unknown peers.
- Forced TURN (`iceTransportPolicy: 'relay'`) for private chat once M2 exists.
- Privacy audit: grep runtime logs for message plaintext/ciphertext/SDP, and inspect room cleanup after `leave`/grace expiry.

## Current verification result

- **PASS:** Documentation review completed against spec/context; P0 contract checklist added.
- **PASS:** Current repo contents inspected; scaffold absence documented instead of inventing commands that do not exist.
- **BLOCKED for code verification:** `pnpm` checks cannot run in this worktree because no root `package.json` or workspace scaffold exists yet.

## Integration notes for other workers

- This lane does not modify implementation files owned by worker-1 or test files owned by worker-2.
- If worker-1 lands M0/M1 code, re-run this review against actual files and convert the checklist into concrete PASS/FAIL findings.
- If worker-2 lands tests first, align test names with the milestone gates above so leader audit can map tests back to spec sections.

