import type { RTCSignal } from '@shared';

// SDP steps define the session, so their failure fails the call. A single ICE candidate can be
// stale (from a session before the peer reloaded) or simply unusable; a real ICE failure still
// surfaces through connectionState 'failed'.
export function isFatalSignalError(type: RTCSignal['type']): boolean {
  return type !== 'ice';
}
