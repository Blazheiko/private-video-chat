import { signal } from '@preact/signals';
import type { PeerInfo, ServerMessage } from '@shared';

export type ChatMessage = {
  id: string;
  from: string;
  text: string;
  ts: number;
  mine?: boolean;
};

export const connectionState = signal<'closed' | 'connecting' | 'joined' | 'error'>('closed');
export const selfId = signal<string | undefined>(undefined);
export const roomInstanceId = signal<string | undefined>(undefined);
export const peers = signal<PeerInfo[]>([]);
export const messages = signal<ChatMessage[]>([]);
export const errorText = signal<string | undefined>(undefined);

export const rtcSignals = signal<Array<Extract<ServerMessage, { t: 'signal' }>>>([]);
