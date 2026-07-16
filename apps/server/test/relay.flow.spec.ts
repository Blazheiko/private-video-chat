import { PROTOCOL_VERSION, type EncryptedEnvelope, type ServerMessage } from '#shared';
import { describe, expect, it } from 'vitest';
import { handleRelay } from '#server/relay.js';
import { RoomRegistry } from '#server/rooms.js';
import type { Connection } from '#server/transport.js';

const room = 'abcdefghijklmnopqrstuv';
const sessionNonce = 'abcdefghijklmnopqrstuv';
const env: EncryptedEnvelope = {
  iv: 'abcdefghijklmnop',
  ciphertext: 'abc',
  aad: {
    msgId: '00000000-0000-4000-8000-000000000000',
    senderId: 'a',
    seq: 1,
    ts: 1,
  },
};

function conn(name: string) {
  const sent: ServerMessage[] = [];
  const c: Connection = {
    connId: name,
    ip: '127.0.0.1',
    send: (message: ServerMessage) => sent.push(message),
  };

  return { sent, c };
}

describe('group relay', () => {
  it('fans out stamped relay and acks sender', () => {
    const reg = new RoomRegistry();
    const a = conn('a');
    const b = conn('b');

    reg.join(a.c, {
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      kind: 'group',
      senderId: 'a',
      sessionNonce,
    });
    reg.join(b.c, {
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      kind: 'group',
      senderId: 'b',
      sessionNonce,
    });

    const out = handleRelay(reg, a.c, { v: PROTOCOL_VERSION, t: 'relay', cid: 7, env });

    expect(out[0]).toMatchObject({ t: 'ack', cid: 7 });
    expect(b.sent.some(message => message.t === 'relay' && message.from)).toBe(true);
  });
});
