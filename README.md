# Private Video Chat

Spec-first implementation of `docs/technical-specification.md` for an ephemeral private/group chat service.

## Implemented slice

- pnpm workspace scaffold with strict TypeScript projects:
  - `packages/shared` — protocol types, constants, runtime validators, base64url/WebCrypto helpers.
  - `apps/server` — uWebSockets.js entrypoint scaffold, in-memory room registry, resume-token lifecycle, private-room tombstones, group relay, private signal/auth routing, static security headers.
  - `apps/web` — Preact/Vite shell, client-side link/key generation with `#k` fragment clearing, group AES-GCM helper, replay/dedup guard, WebSocket join/relay UI.
- Tests lock the P0/M1 contracts: unknown client/server message handling, resume identity, private capacity/tombstone, group relay ACK/stamped `from`, and group encryption replay guard.

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
- Group messages are encrypted client-side with AES-GCM using the URL fragment key; the fragment is read and removed from the address bar on load.
- Server relay stamps `from` using the server-assigned stable `participantId`; clients must not trust `senderId` as the sender identity.
- Private P2P media/file UI remains a later M2 slice; server-side signal/auth routing and TURN config scaffolding are present.
