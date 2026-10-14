import {
  DEFAULTS,
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

export type SocketFactory = (url: string) => WebSocket;

export type HeartbeatOptions = {
  intervalMs: number;
  timeoutMs: number;
};

// The browser only notices a dead TCP connection after minutes, and JS never sees the server's
// protocol-level pings, so liveness is checked with app-level ping/pong. Timestamps are compared
// instead of trusting timer accuracy: background tabs throttle timers, but message events still
// arrive on time, so a late timer cannot produce a false "dead" verdict.
export function isPongOverdue({ pingSentAt, lastMessageAt }: { pingSentAt: number; lastMessageAt: number }): boolean {
  return lastMessageAt < pingSentAt;
}

export class WsClient {
  private ws?: WebSocket;
  private closed = false;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private pongTimer?: ReturnType<typeof setTimeout>;
  private lastMessageAt = 0;

  constructor(
    private readonly handlers: ClientHandlers,
    private readonly wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
    private readonly createSocket: SocketFactory = url => new WebSocket(url),
    private readonly heartbeat: HeartbeatOptions = {
      intervalMs: DEFAULTS.HEARTBEAT_MS,
      timeoutMs: DEFAULTS.PONG_TIMEOUT_MS,
    },
  ) {}

  connectJoin(room: string, senderId: string, resumeToken?: string): void {
    const ws = this.createSocket(this.wsUrl);

    this.ws = ws;

    ws.addEventListener('open', () => {
      if (this.closed) {
        return;
      }

      this.lastMessageAt = Date.now();
      this.join(room, senderId, resumeToken);
      this.startHeartbeat();
    });

    ws.addEventListener('message', event => {
      if (this.closed) {
        return;
      }

      this.lastMessageAt = Date.now();

      const parsed = validateServerMessage(String(event.data));

      if (parsed.ok) {
        this.handlers.onMessage(parsed.value);
      }
    });

    ws.addEventListener('error', () => {
      if (!this.closed) {
        this.handlers.onError?.('Cannot connect to the signaling server. Start the server app or use pnpm dev from the repo root.');
      }
    });

    ws.addEventListener('close', () => this.finish());
  }

  join(room: string, senderId: string, resumeToken?: string): void {
    this.send({
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      senderId,
      sessionNonce: randomSessionNonce(),
      ...(resumeToken ? { resumeToken } : {}),
    });
  }

  signal(to: string, data: RTCSignal): void {
    this.send({ v: PROTOCOL_VERSION, t: 'signal', to, data });
  }

  // onClose still fires from the native close event, which the app uses to finish an Exit.
  leave(): void {
    this.stopHeartbeat();
    this.send({ v: PROTOCOL_VERSION, t: 'leave' });
    this.ws?.close();
  }

  // Give up on a connection that is presumed dead (no pong, or the browser went offline): report the
  // close right away instead of waiting for a native close that may take minutes on a dead network.
  abandon(): void {
    if (this.closed) {
      return;
    }

    try {
      this.ws?.close();
    } catch {
      // Closing a socket that never opened can throw in some browsers; it is abandoned either way.
    }

    this.finish();
  }

  private finish(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.stopHeartbeat();
    this.handlers.onClose?.();
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendPing(), this.heartbeat.intervalMs);
  }

  private stopHeartbeat(): void {
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.pongTimer);
    this.heartbeatTimer = undefined;
    this.pongTimer = undefined;
  }

  private sendPing(): void {
    const pingSentAt = Date.now();

    this.send({ v: PROTOCOL_VERSION, t: 'ping' });
    clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      if (isPongOverdue({ pingSentAt, lastMessageAt: this.lastMessageAt })) {
        this.abandon();
      }
    }, this.heartbeat.timeoutMs);
  }

  private send(message: ClientMessage): void {
    if (this.ws && this.ws.readyState === this.ws.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}
