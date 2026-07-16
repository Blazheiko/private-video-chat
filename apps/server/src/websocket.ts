import {
  DEFAULTS,
  PROTOCOL_VERSION,
  encodeMessage,
  randomBase64Url,
  validateClientMessage,
  type ServerMessage,
} from '#shared';
import { isAllowedOrigin } from '#server/origin.js';
import { handleRelay } from '#server/relay.js';
import { RoomRegistry } from '#server/rooms.js';
import { routeSignal } from '#server/signaling.js';
import type { Connection } from '#server/transport.js';

type WebSocketLike = {
  send(message: string): number;
  end(code?: number, shortMessage?: string): void;
  getBufferedAmount(): number;
  getRemoteAddressAsText(): ArrayBuffer;
};

type WebSocketUpgradeResponse = {
  writeStatus(status: string): WebSocketUpgradeResponse;
  end(body?: string): void;
  upgrade(
    userData: Record<string, never>,
    secWebSocketKey: string,
    secWebSocketProtocol: string,
    secWebSocketExtensions: string,
    context: unknown,
  ): void;
};

type WebSocketUpgradeRequest = {
  getHeader(name: string): string;
};

type WebSocketBehavior = Record<string, unknown> & {
  upgrade?: (res: WebSocketUpgradeResponse, req: WebSocketUpgradeRequest, context: unknown) => void;
};

type WebSocketApp = {
  ws(pattern: string, behavior: WebSocketBehavior): WebSocketApp;
};

type RegisterWebSocketOptions = {
  allowedOrigins?: readonly string[];
};

const textDecoder = new TextDecoder();

export function registerWebSocket(
  app: WebSocketApp,
  registry = new RoomRegistry(),
  options: RegisterWebSocketOptions = {},
): void {
  const connections = new WeakMap<WebSocketLike, Connection>();
  const allowedOrigins = options.allowedOrigins ?? [];

  app.ws('/ws', {
    maxPayloadLength: DEFAULTS.MAX_BACKPRESSURE_BYTES,
    idleTimeout: Math.ceil(DEFAULTS.IDLE_TIMEOUT_MS / 1000),
    sendPingsAutomatically: true,

    upgrade: (res: WebSocketUpgradeResponse, req: WebSocketUpgradeRequest, context: unknown) => {
      const origin = headerValue(req, 'origin');

      if (!isAllowedOrigin(origin, allowedOrigins)) {
        res.writeStatus('403 Forbidden').end('Forbidden');
        return;
      }

      res.upgrade(
        {},
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context,
      );
    },

    open: (ws: WebSocketLike) => {
      connections.set(ws, createConnection(ws));
    },

    message: (ws: WebSocketLike, message: ArrayBuffer) => {
      const conn = connections.get(ws);

      if (!conn) {
        return;
      }

      handleClientMessage(registry, conn, new Uint8Array(message));
    },

    close: (ws: WebSocketLike) => {
      const conn = connections.get(ws);

      if (!conn) {
        return;
      }

      registry.disconnect(conn);
      connections.delete(ws);
    },
  });
}

function headerValue(req: WebSocketUpgradeRequest, name: string): string | undefined {
  const value = req.getHeader(name);
  return value.length > 0 ? value : undefined;
}

export function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);
}

function createConnection(ws: WebSocketLike): Connection {
  return {
    connId: randomBase64Url(16),
    ip: textDecoder.decode(ws.getRemoteAddressAsText()),
    send: (message: ServerMessage) => {
      ws.send(encodeMessage(message));
    },
    close: (code = 1000, reason = 'closed') => {
      ws.end(code, reason);
    },
    bufferedAmount: () => ws.getBufferedAmount(),
  };
}

function handleClientMessage(registry: RoomRegistry, conn: Connection, input: Uint8Array): void {
  const parsed = validateClientMessage(input);

  if (!parsed.ok) {
    sendValidationError(conn, parsed);
    return;
  }

  switch (parsed.value.t) {
    case 'join': {
      const result = registry.join(conn, parsed.value);

      if (!result.ok) {
        conn.send(result.error);
        closeIfFatal(conn, result.error);
        return;
      }

      conn.send(result.joined);

      for (const peerConn of registry.peers(result.room, result.participant.participantId)) {
        peerConn.send({ v: PROTOCOL_VERSION, t: 'peer-joined', peer: registry.peerInfo(result.participant) });
      }

      return;
    }

    case 'leave': {
      const result = registry.leave(conn);

      for (const outbound of result.messages) {
        outbound.conn.send(outbound.msg);
      }

      conn.close?.(1000, 'left');
      return;
    }

    case 'relay':
      for (const message of handleRelay(registry, conn, parsed.value)) {
        conn.send(message);
        closeIfFatal(conn, message);
      }
      return;

    case 'signal':
    case 'auth': {
      const error = routeSignal(registry, conn, parsed.value);

      if (error) {
        conn.send(error);
        closeIfFatal(conn, error);
      }

      return;
    }

    case 'ping':
      conn.send({ v: PROTOCOL_VERSION, t: 'pong' });
      return;
  }
}

function sendValidationError(
  conn: Connection,
  parsed: Exclude<ReturnType<typeof validateClientMessage>, { ok: true }>,
): void {
  if ('skip' in parsed) {
    return;
  }

  const error: Extract<ServerMessage, { t: 'error' }> = {
    v: PROTOCOL_VERSION,
    t: 'error',
    code: parsed.code,
    message: parsed.message,
    fatal: parsed.fatal,
  };

  conn.send(error);
  closeIfFatal(conn, error);
}

function closeIfFatal(conn: Connection, message: ServerMessage): void {
  if (message.t === 'error' && message.fatal) {
    conn.close?.(1008, message.code);
  }
}
