import test from 'node:test';
import assert from 'node:assert/strict';
import {
  E2E_KEY_BASE64URL_LENGTH,
  MAX_GROUP_PARTICIPANTS,
  PROTOCOL_VERSION,
  ROOM_ID_BASE64URL_LENGTH,
  SESSION_NONCE_BASE64URL_LENGTH,
  isBase64Url,
  makeError,
  shouldSkipUnknownServerMessage,
  validateClientMessage,
  validateFragmentKey,
} from '../dist/index.js';

const b64 = 'A'.repeat(ROOM_ID_BASE64URL_LENGTH);
const nonce = 'B'.repeat(SESSION_NONCE_BASE64URL_LENGTH);
const key = 'C'.repeat(E2E_KEY_BASE64URL_LENGTH);

test('base64url room and fragment contracts enforce exact lengths and alphabet', () => {
  assert.equal(isBase64Url(b64, ROOM_ID_BASE64URL_LENGTH), true);
  assert.equal(validateFragmentKey(key).ok, true);
  assert.equal(validateFragmentKey(`${key}=`).ok, false);
  assert.equal(validateFragmentKey(key.slice(1)).ok, false);
});

test('join validation accepts unknown fields but rejects unsupported versions and unknown client message types', () => {
  const valid = validateClientMessage({ v: PROTOCOL_VERSION, t: 'join', room: b64, kind: 'group', senderId: 'alice', sessionNonce: nonce, ignored: true });
  assert.equal(valid.ok, true);

  const version = validateClientMessage({ v: 99, t: 'ping' });
  assert.equal(version.ok, false);
  assert.equal(version.code, 'UNSUPPORTED_VERSION');
  assert.equal(version.fatal, true);

  const unknown = validateClientMessage({ v: PROTOCOL_VERSION, t: 'future-type' });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'UNKNOWN_MESSAGE_TYPE');
  assert.equal(unknown.fatal, false);
});

test('BAD_RESUME_TOKEN is nonfatal while capacity and closed-room errors are fatal', () => {
  assert.deepEqual(makeError('BAD_RESUME_TOKEN', 'bad token'), { v: PROTOCOL_VERSION, t: 'error', code: 'BAD_RESUME_TOKEN', message: 'bad token', fatal: false });
  assert.equal(makeError('ROOM_FULL', `max ${MAX_GROUP_PARTICIPANTS}`).fatal, true);
  assert.equal(makeError('ROOM_CLOSED', 'closed').fatal, true);
});

test('clients can skip unknown server message types for forward compatibility', () => {
  assert.equal(shouldSkipUnknownServerMessage({ v: PROTOCOL_VERSION, t: 'future-server-message', payload: true }), true);
  assert.equal(shouldSkipUnknownServerMessage({ v: PROTOCOL_VERSION, t: 'joined' }), false);
});

test('relay envelopes keep senderId app-level and leave trusted from stamping to server', () => {
  const result = validateClientMessage({
    v: PROTOCOL_VERSION,
    t: 'relay',
    cid: 1,
    env: { iv: 'abc_DEF-123', ciphertext: 'xyz_123-ABC', msgId: 'm1', senderId: 'display-name', seq: 7, ts: 123456 },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.env.senderId, 'display-name');
  assert.equal('from' in result.value, false);
});
