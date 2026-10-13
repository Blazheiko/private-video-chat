# Private Video Chat

Spec-first implementation of `docs/technical-specification.md` for an ephemeral private one-to-one (P2P) video chat service. Group chats were removed in protocol v2.

## Implemented slice

- pnpm workspace scaffold with strict TypeScript projects:
  - `packages/shared` — protocol types, constants, runtime validators, base64url/WebCrypto helpers.
  - `apps/server` — uWebSockets.js entrypoint scaffold, in-memory room registry, resume-token lifecycle, private-room tombstones, private signal/auth routing, static security headers.
  - `apps/web` — Preact/Vite shell, client-side link/key generation with `#k` fragment clearing, WebSocket join, private WebRTC call UI (video, chat, screen sharing, file transfer).
- Tests lock the core contracts: unknown client/server message handling, resume identity, private capacity/tombstone, and private signal routing.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm lint
pnpm build
pnpm dev

# Build and start the application at http://localhost:3000
pnpm start
```

`pnpm start` runs the production build first, then starts the uWebSockets.js server.
Use `PORT=4000 pnpm start` to override the default port.

## Privacy/security notes

- Room/content state is in memory only; no message persistence is implemented.
- The room key lives in the URL fragment (`#k=`); it is read and removed from the address bar on load and never sent to the server.
- Chat messages, files, and media go peer-to-peer over WebRTC (DTLS/SRTP); the server only routes signaling and issues TURN config.
- Server-routed messages are stamped with the server-assigned stable `participantId`; clients must not trust `senderId` as the sender identity.
