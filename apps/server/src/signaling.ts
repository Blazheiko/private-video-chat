import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '#shared';
import { RoomRegistry } from '#server/rooms.js';
import type { Connection } from '#server/transport.js';

export function routeSignal(
  registry: RoomRegistry,
  conn: Connection,
  msg: Extract<ClientMessage, { t: 'signal' | 'auth' }>,
): ServerMessage | undefined {
  const found = registry.getParticipant(conn);

  if (!found) {
    return { v: PROTOCOL_VERSION, t: 'error', code: 'NOT_JOINED', message: 'join required', fatal: true };
  }

  if (found.room.kind !== 'private') {
    return {
      v: PROTOCOL_VERSION,
      t: 'error',
      code: 'WRONG_KIND',
      message: 'signal/auth is private-room only',
      fatal: true,
    };
  }

  const target = [...found.room.participants.values()].find(
    participant => participant.participantId === msg.to && participant.conn,
  );

  if (!target?.conn) {
    return { v: PROTOCOL_VERSION, t: 'error', code: 'UNKNOWN_PEER', message: 'unknown peer', fatal: false };
  }

  target.conn.send(
    msg.t === 'signal'
      ? { v: PROTOCOL_VERSION, t: 'signal', from: found.participant.participantId, data: msg.data }
      : { v: PROTOCOL_VERSION, t: 'auth', from: found.participant.participantId, mac: msg.mac },
  );

  return undefined;
}
