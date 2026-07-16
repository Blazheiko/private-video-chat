import { PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from '#shared';
import { RoomRegistry } from '#server/rooms.js';
import type { Connection } from '#server/transport.js';

export function handleRelay(
  registry: RoomRegistry,
  conn: Connection,
  msg: Extract<ClientMessage, { t: 'relay' }>,
): ServerMessage[] {
  const found = registry.getParticipant(conn);

  if (!found) {
    return [{ v: PROTOCOL_VERSION, t: 'error', code: 'NOT_JOINED', message: 'join required', fatal: true }];
  }

  if (found.room.kind !== 'group') {
    return [
      {
        v: PROTOCOL_VERSION,
        t: 'error',
        code: 'WRONG_KIND',
        message: 'relay is only allowed in group rooms',
        fatal: true,
      },
    ];
  }

  const stamped = {
    v: PROTOCOL_VERSION,
    t: 'relay',
    from: found.participant.participantId,
    env: msg.env,
  } as const;

  for (const peer of registry.peers(found.room, found.participant.participantId)) {
    peer.send(stamped);
  }

  return [{ v: PROTOCOL_VERSION, t: 'ack', cid: msg.cid }];
}
