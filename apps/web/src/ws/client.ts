import {
  PROTOCOL_VERSION,
  randomSessionNonce,
  validateServerMessage,
  type ClientMessage,
  type RTCSignal,
  type ServerMessage,
} from '@shared';

export type ClientHandlers = {
  onMessage(message: ServerMessage): void;
  onClose?(): void;
  onError?(message: string): void;
};

export class WsClient {
  private ws?: WebSocket;

  constructor(
    private readonly handlers: ClientHandlers,
    private readonly wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  ) {}

  connectJoin(room: string, senderId: string, resumeToken?: string): void {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.addEventListener('open', () =>
      this.send({
        v: PROTOCOL_VERSION,
        t: 'join',
        room,
        senderId,
        sessionNonce: randomSessionNonce(),
        ...(resumeToken ? { resumeToken } : {}),
      }),
    );

    this.ws.addEventListener('message', event => {
      const parsed = validateServerMessage(String(event.data));

      if (parsed.ok) {
        this.handlers.onMessage(parsed.value);
      }
    });

    this.ws.addEventListener('error', () => {
      this.handlers.onError?.('Cannot connect to the signaling server. Start the server app or use pnpm dev from the repo root.');
    });

    this.ws.addEventListener('close', () => this.handlers.onClose?.());
  }

  signal(to: string, data: RTCSignal): void {
    this.send({ v: PROTOCOL_VERSION, t: 'signal', to, data });
  }

  leave(): void {
    this.send({ v: PROTOCOL_VERSION, t: 'leave' });
    this.ws?.close();
  }

  private send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}
