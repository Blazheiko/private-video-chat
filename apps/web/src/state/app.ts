import { signal } from '@preact/signals';
import type { PeerInfo, ServerMessage } from '@shared';

export const connectionState = signal<'closed' | 'connecting' | 'joined' | 'error'>('closed');
export const selfId = signal<string | undefined>(undefined);
export const roomInstanceId = signal<string | undefined>(undefined);
export const peers = signal<PeerInfo[]>([]);
// Peers whose socket closed without `leave`; their slot is held until they resume or the grace period ends.
export const awayPeerIds = signal<string[]>([]);
export const errorText = signal<string | undefined>(undefined);

export const rtcSignals = signal<Array<Extract<ServerMessage, { t: 'signal' }>>>([]);
