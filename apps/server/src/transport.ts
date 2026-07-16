import type { ServerMessage } from '#shared';

export interface Connection {
  connId: string;
  ip: string;
  send(message: ServerMessage): void;
  close?(code?: number, reason?: string): void;
  bufferedAmount?(): number;
}
