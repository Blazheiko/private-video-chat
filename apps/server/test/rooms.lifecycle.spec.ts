import { PROTOCOL_VERSION, type ServerMessage } from '#shared';
import { describe, expect, it, vi } from 'vitest';
import { RoomRegistry } from '#server/rooms.js';
import type { Connection } from '#server/transport.js';

const room = 'abcdefghijklmnopqrstuv';
const sessionNonce = 'abcdefghijklmnopqrstuv';

function conn(name: string) {
  const sent: ServerMessage[] = [];
  const c: Connection = {
    connId: name,
    ip: '127.0.0.1',
    send: (message: ServerMessage) => sent.push(message),
  };

  return { sent, c };
}

describe('room lifecycle', () => {
  it('keeps participantId stable across resume token reconnect', () => {
    const reg = new RoomRegistry();
    const a = conn('a');
    const first = reg.join(a.c, {
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      kind: 'group',
      senderId: 'a',
      sessionNonce,
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    reg.disconnect(a.c);

    const b = conn('b');
    const resumed = reg.join(b.c, {
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      kind: 'group',
      senderId: 'a',
      sessionNonce,
      resumeToken: first.joined.resumeToken,
    });

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.joined.resumed).toBe(true);
    expect(resumed.joined.selfId).toBe(first.joined.selfId);
  });

  it('rejects third private peer', () => {
    const reg = new RoomRegistry();

    expect(
      reg.join(conn('a').c, {
        v: PROTOCOL_VERSION,
        t: 'join',
        room,
        kind: 'private',
        senderId: 'a',
        sessionNonce,
      }).ok,
    ).toBe(true);
    expect(
      reg.join(conn('b').c, {
        v: PROTOCOL_VERSION,
        t: 'join',
        room,
        kind: 'private',
        senderId: 'b',
        sessionNonce,
      }).ok,
    ).toBe(true);

    const third = reg.join(conn('c').c, {
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      kind: 'private',
      senderId: 'c',
      sessionNonce,
    });

    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe('ROOM_FULL');
  });


  it('sends peer-left once on explicit leave', () => {
    const reg = new RoomRegistry();
    const a = conn('a');
    const b = conn('b');

    const joinedA = reg.join(a.c, {
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      kind: 'group',
      senderId: 'a',
      sessionNonce,
    });
    const joinedB = reg.join(b.c, {
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      kind: 'group',
      senderId: 'b',
      sessionNonce,
    });

    expect(joinedA.ok).toBe(true);
    expect(joinedB.ok).toBe(true);
    if (!joinedA.ok) return;

    b.sent.length = 0;
    const result = reg.leave(a.c);

    expect(result.messages).toEqual([]);
    expect(b.sent.filter(message => message.t === 'peer-left')).toEqual([
      { v: PROTOCOL_VERSION, t: 'peer-left', participantId: joinedA.participant.participantId, reason: 'left' },
    ]);
  });

  it('creates private tombstone after grace close', () => {
    vi.useFakeTimers();

    const reg = new RoomRegistry({
      ...({} as any),
      ROOM_GRACE_MS: 10,
      ROOM_TOMBSTONE_MS: 100,
      MAX_GROUP_PARTICIPANTS: 50,
    } as any);
    const a = conn('a');
    const joined = reg.join(a.c, {
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      kind: 'private',
      senderId: 'a',
      sessionNonce,
    });

    expect(joined.ok).toBe(true);

    reg.disconnect(a.c);
    vi.advanceTimersByTime(11);

    const blocked = reg.join(conn('b').c, {
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      kind: 'private',
      senderId: 'b',
      sessionNonce,
    });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe('ROOM_CLOSED');

    vi.useRealTimers();
  });
});
