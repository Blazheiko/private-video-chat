import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomRegistry, isAllowedOrigin } from '../dist/index.js';

const room = 'A'.repeat(22);
const nonce = 'B'.repeat(22);

test('joined always includes ICE config, including group rooms', () => {
  const registry = new RoomRegistry();
  const joined = registry.join({ room, kind: 'group', senderId: 'alice', sessionNonce: nonce });
  assert.equal(joined.ok, true);
  assert.equal(Array.isArray(joined.joined.ice.iceServers), true);
  assert.equal(joined.joined.ice.policy, 'all');
});

test('group cap returns ROOM_FULL at configured capacity', () => {
  const registry = new RoomRegistry({ maxGroupParticipants: 1 });
  assert.equal(registry.join({ room, kind: 'group', senderId: 'alice', sessionNonce: nonce }).ok, true);
  const second = registry.join({ room, kind: 'group', senderId: 'bob', sessionNonce: nonce });
  assert.equal(second.ok, false);
  assert.equal(second.code, 'ROOM_FULL');
  assert.equal(second.fatal, true);
});

test('private rooms resume participantId within grace and tombstone after expiry', () => {
  let now = 1000;
  const registry = new RoomRegistry({ now: () => now, roomGraceMs: 100, privateTombstoneMs: 500 });
  const first = registry.join({ room, kind: 'private', senderId: 'alice', sessionNonce: nonce });
  assert.equal(first.ok, true);
  const self = first.joined.selfId;
  const token = first.joined.resumeToken;
  const instance = first.joined.roomInstanceId;

  registry.disconnect(room, self);
  now += 50;
  const resumed = registry.join({ room, kind: 'private', senderId: 'alice', sessionNonce: nonce, resumeToken: token });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.joined.selfId, self);
  assert.equal(resumed.joined.roomInstanceId, instance);
  assert.equal(resumed.joined.resumed, true);

  registry.disconnect(room, self);
  now += 101;
  registry.sweep();
  assert.equal(registry.hasRoom(room), false);
  const closed = registry.join({ room, kind: 'private', senderId: 'alice', sessionNonce: nonce });
  assert.equal(closed.ok, false);
  assert.equal(closed.code, 'ROOM_CLOSED');
});

test('invalid resumeToken is nonfatal and does not consume capacity', () => {
  const registry = new RoomRegistry();
  const first = registry.join({ room, kind: 'private', senderId: 'alice', sessionNonce: nonce });
  assert.equal(first.ok, true);
  const bad = registry.join({ room, kind: 'private', senderId: 'mallory', sessionNonce: nonce, resumeToken: 'wrong' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'BAD_RESUME_TOKEN');
  assert.equal(bad.fatal, false);
  const second = registry.join({ room, kind: 'private', senderId: 'bob', sessionNonce: nonce });
  assert.equal(second.ok, true);
});

test('relay excludes sender and rejects replayed seq across reconnect state', () => {
  const registry = new RoomRegistry();
  const alice = registry.join({ room, kind: 'group', senderId: 'alice', sessionNonce: nonce });
  const bob = registry.join({ room, kind: 'group', senderId: 'bob', sessionNonce: nonce });
  assert.equal(alice.ok, true);
  assert.equal(bob.ok, true);
  assert.deepEqual(registry.relayRecipients(room, alice.joined.selfId), [bob.joined.selfId]);
  assert.equal(registry.acceptRelay(room, alice.joined.selfId, 1), true);
  assert.equal(registry.acceptRelay(room, alice.joined.selfId, 1), false);
});

test('origin allow-list rejects absent and unlisted origins with false for HTTP 403 mapping', () => {
  assert.equal(isAllowedOrigin(undefined, ['https://app.example']), false);
  assert.equal(isAllowedOrigin('https://evil.example', ['https://app.example']), false);
  assert.equal(isAllowedOrigin('https://app.example', ['https://app.example']), true);
  assert.equal(isAllowedOrigin(undefined, []), true);
});
