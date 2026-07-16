import {
  DEFAULTS,
  PROTOCOL_VERSION,
  randomBase64Url,
  randomResumeToken,
  type ClientMessage,
  type ErrorCode,
  type PeerInfo,
  type ServerMessage,
} from '#shared';
import { buildIceConfig } from '#server/ice.js';
import type { Connection } from '#server/transport.js';

type Participant = PeerInfo & {
  conn?: Connection;
  resumeToken: string;
  graceTimer?: NodeJS.Timeout;
  joinedAt: number;
};

type Room = {
  roomId: string;
  kind: 'group' | 'private';
  roomInstanceId: string;
  participants: Map<string, Participant>;
  closeTimer?: NodeJS.Timeout;
};

export type JoinResult =
  | {
      ok: true;
      room: Room;
      participant: Participant;
      joined: Extract<ServerMessage, { t: 'joined' }>;
      peersToNotify: PeerInfo[];
    }
  | { ok: false; error: Extract<ServerMessage, { t: 'error' }> };

export class RoomRegistry {
  private rooms = new Map<string, Room>();
  private privateTombstones = new Map<string, NodeJS.Timeout>();

  constructor(private readonly opts = DEFAULTS) {}

  join(conn: Connection, msg: Extract<ClientMessage, { t: 'join' }>): JoinResult {
    if (this.privateTombstones.has(msg.room)) {
      return { ok: false, error: this.error('ROOM_CLOSED', 'private room is closed', true) };
    }

    const room = this.findOrCreateRoom(msg);

    if (!room.ok) {
      return room;
    }

    this.cancelRoomClose(room.value);

    const resume = msg.resumeToken ? this.findByToken(room.value, msg.resumeToken) : undefined;

    if (msg.resumeToken && !resume) {
      return { ok: false, error: this.error('BAD_RESUME_TOKEN', 'resume token is invalid or expired', false) };
    }

    if (!resume) {
      const capacityError = this.roomCapacityError(room.value);

      if (capacityError) {
        return { ok: false, error: capacityError };
      }
    }

    const peers = [...room.value.participants.entries()]
      .filter(([participantId]) => participantId !== resume?.participantId)
      .map(([, participant]) => this.peerInfo(participant));

    const participant = resume ? this.resumeParticipant(resume, conn) : this.createParticipant(room.value, conn, msg);
    const resumed = Boolean(resume);
    const joined = {
      v: PROTOCOL_VERSION,
      t: 'joined',
      selfId: participant.participantId,
      roomInstanceId: room.value.roomInstanceId,
      resumeToken: participant.resumeToken,
      resumed,
      peers,
      ice: buildIceConfig(),
    } as const;

    return {
      ok: true,
      room: room.value,
      participant,
      joined,
      peersToNotify: resumed ? [] : peers,
    };
  }

  leave(
    conn: Connection,
    reason: 'left' | 'grace-expired' = 'left',
  ): { room?: Room; participantId?: string; messages: Array<{ conn: Connection; msg: ServerMessage }> } {
    const found = this.findByConnection(conn);

    if (!found) {
      return { messages: [] };
    }

    const { room, participant } = found;
    const participantId = participant.participantId;
    const removeParticipant = () => this.removeParticipant(room, participantId, reason);

    participant.conn = undefined;

    if (reason === 'left') {
      removeParticipant();
    } else {
      participant.graceTimer = setTimeout(removeParticipant, this.opts.ROOM_GRACE_MS);
    }

    if (room.participants.size === 0 || [...room.participants.values()].every(peer => !peer.conn)) {
      this.scheduleRoomClose(room);
    }

    return {
      room,
      participantId,
      messages: [],
    };
  }

  disconnect(conn: Connection) {
    const found = this.findByConnection(conn);

    if (!found) {
      return { messages: [] as Array<{ conn: Connection; msg: ServerMessage }> };
    }

    found.participant.conn = undefined;
    found.participant.graceTimer = setTimeout(
      () => this.removeParticipant(found.room, found.participant.participantId, 'grace-expired'),
      this.opts.ROOM_GRACE_MS,
    );

    if ([...found.room.participants.values()].every(participant => !participant.conn)) {
      this.scheduleRoomClose(found.room);
    }

    return { messages: [] as Array<{ conn: Connection; msg: ServerMessage }> };
  }

  getParticipant(conn: Connection) {
    return this.findByConnection(conn);
  }

  peers(room: Room, except?: string) {
    return [...room.participants.values()]
      .filter(participant => participant.participantId !== except && participant.conn)
      .map(participant => participant.conn!);
  }

  peerInfo(participant: Participant): PeerInfo {
    return {
      participantId: participant.participantId,
      senderId: participant.senderId,
      sessionNonce: participant.sessionNonce,
      ...(participant.senderPubKey ? { senderPubKey: participant.senderPubKey } : {}),
    };
  }

  private findOrCreateRoom(
    msg: Extract<ClientMessage, { t: 'join' }>,
  ): { ok: true; value: Room } | { ok: false; error: Extract<ServerMessage, { t: 'error' }> } {
    const existing = this.rooms.get(msg.room);

    if (existing && existing.kind !== msg.kind) {
      return { ok: false, error: this.error('WRONG_KIND', 'room kind mismatch', true) };
    }

    if (existing) {
      return { ok: true, value: existing };
    }

    const room: Room = {
      roomId: msg.room,
      kind: msg.kind,
      roomInstanceId: randomBase64Url(16),
      participants: new Map(),
    };

    this.rooms.set(msg.room, room);
    return { ok: true, value: room };
  }

  private cancelRoomClose(room: Room): void {
    if (!room.closeTimer) {
      return;
    }

    clearTimeout(room.closeTimer);
    room.closeTimer = undefined;
  }

  private roomCapacityError(room: Room): Extract<ServerMessage, { t: 'error' }> | undefined {
    if (room.kind === 'private' && room.participants.size >= 2) {
      return this.error('ROOM_FULL', 'private room is full', true);
    }

    if (room.kind === 'group' && room.participants.size >= this.opts.MAX_GROUP_PARTICIPANTS) {
      return this.error('ROOM_FULL', 'group room is full', true);
    }

    return undefined;
  }

  private resumeParticipant(participant: Participant, conn: Connection): Participant {
    if (participant.graceTimer) {
      clearTimeout(participant.graceTimer);
    }

    participant.graceTimer = undefined;
    participant.conn = conn;
    participant.resumeToken = randomResumeToken();

    return participant;
  }

  private createParticipant(
    room: Room,
    conn: Connection,
    msg: Extract<ClientMessage, { t: 'join' }>,
  ): Participant {
    const participant: Participant = {
      participantId: randomBase64Url(16),
      senderId: msg.senderId,
      sessionNonce: msg.sessionNonce,
      senderPubKey: msg.senderPubKey,
      conn,
      resumeToken: randomResumeToken(),
      joinedAt: Date.now(),
    };

    room.participants.set(participant.participantId, participant);
    return participant;
  }

  private removeParticipant(room: Room, participantId: string, reason: 'left' | 'grace-expired') {
    room.participants.delete(participantId);

    for (const target of this.peers(room)) {
      target.send({ v: PROTOCOL_VERSION, t: 'peer-left', participantId, reason });
    }

    if (room.participants.size === 0) {
      this.scheduleRoomClose(room);
    }
  }

  private scheduleRoomClose(room: Room) {
    if (room.closeTimer) {
      return;
    }

    room.closeTimer = setTimeout(() => {
      this.rooms.delete(room.roomId);

      if (room.kind === 'private') {
        const timer = setTimeout(() => this.privateTombstones.delete(room.roomId), this.opts.ROOM_TOMBSTONE_MS);
        this.privateTombstones.set(room.roomId, timer);
      }
    }, this.opts.ROOM_GRACE_MS);
  }

  private findByToken(room: Room, token: string) {
    return [...room.participants.values()].find(participant => participant.resumeToken === token);
  }

  private findByConnection(conn: Connection) {
    for (const room of this.rooms.values()) {
      for (const participant of room.participants.values()) {
        if (participant.conn === conn) {
          return { room, participant };
        }
      }
    }

    return undefined;
  }


  private error(code: ErrorCode, message: string, fatal: boolean): Extract<ServerMessage, { t: 'error' }> {
    return { v: PROTOCOL_VERSION, t: 'error', code, message, fatal };
  }
}
