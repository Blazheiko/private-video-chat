import { BASE64URL_RE, LIMITS, PROTOCOL_VERSION, ROOM_RE, UUID_V4_RE } from '#shared/constants.js';
import type { ClientMessage, EncryptedEnvelope, ErrorCode, ServerMessage } from '#shared/protocol.js';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string; fatal: boolean }
  | { ok: false; skip: true; message: string };

const knownServerTypes = [
  'joined',
  'peer-joined',
  'peer-left',
  'relay',
  'signal',
  'auth',
  'ack',
  'ice-refresh',
  'pong',
  'error',
];

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const fail = <T>(code: ErrorCode, message: string, fatal = true): ValidationResult<T> => ({
  ok: false,
  code,
  message,
  fatal,
});

const skip = <T>(message: string): ValidationResult<T> => ({
  ok: false,
  skip: true,
  message,
});

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isString = (value: unknown, max = Infinity): value is string =>
  typeof value === 'string' && value.length <= max;

const isUint53 = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

function isBase64Url(value: unknown, max: number, exact?: number): value is string {
  if (typeof value !== 'string' || value.length > max) {
    return false;
  }

  return BASE64URL_RE.test(value) && (exact === undefined || value.length === exact);
}

function isValidEnvelope(env: unknown): env is EncryptedEnvelope {
  return (
    isObject(env) &&
    isBase64Url(env.iv, LIMITS.IV_CHARS, LIMITS.IV_CHARS) &&
    isBase64Url(env.ciphertext, LIMITS.CIPHERTEXT_CHARS) &&
    isObject(env.aad) &&
    isString(env.aad.msgId, LIMITS.MSG_ID_CHARS) &&
    UUID_V4_RE.test(env.aad.msgId) &&
    isString(env.aad.senderId, LIMITS.SENDER_ID_BYTES) &&
    isUint53(env.aad.seq) &&
    isUint53(env.aad.ts) &&
    (env.sig === undefined || isBase64Url(env.sig, LIMITS.SIG_CHARS, LIMITS.SIG_CHARS))
  );
}

function parseJson(input: string | Uint8Array): unknown | ValidationResult<never> {
  const text = typeof input === 'string' ? input : textDecoder.decode(input);

  if (textEncoder.encode(text).byteLength > LIMITS.WS_FRAME_BYTES) {
    return fail('MSG_TOO_LARGE', 'WS frame too large');
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail('BAD_MESSAGE', 'invalid JSON');
  }
}

export function validateClientMessage(input: string | Uint8Array | unknown): ValidationResult<ClientMessage> {
  const msg = typeof input === 'string' || input instanceof Uint8Array ? parseJson(input) : input;

  if (!isObject(msg)) {
    return fail('BAD_MESSAGE', 'message must be object');
  }

  if (msg.v !== PROTOCOL_VERSION) {
    return fail('PROTOCOL_VERSION', 'unsupported protocol version');
  }

  if (!isString(msg.t)) {
    return fail('BAD_MESSAGE', 'missing type');
  }

  switch (msg.t) {
    case 'join':
      return isValidJoinMessage(msg)
        ? { ok: true, value: msg as ClientMessage }
        : fail('BAD_MESSAGE', 'invalid join');

    case 'leave':
    case 'ping':
      return { ok: true, value: msg as ClientMessage };

    case 'relay':
      return isUint53(msg.cid) && isValidEnvelope(msg.env)
        ? { ok: true, value: msg as ClientMessage }
        : fail('BAD_MESSAGE', 'invalid relay');

    case 'signal':
      return isValidSignalMessage(msg)
        ? { ok: true, value: msg as ClientMessage }
        : fail('BAD_MESSAGE', 'invalid signal');

    case 'auth':
      return isString(msg.to, LIMITS.PARTICIPANT_ID_CHARS) && isBase64Url(msg.mac, LIMITS.MAC_CHARS, LIMITS.MAC_CHARS)
        ? { ok: true, value: msg as ClientMessage }
        : fail('BAD_MESSAGE', 'invalid auth');

    default:
      return fail('BAD_MESSAGE', 'unknown client message type');
  }
}

export function validateServerMessage(input: string | Uint8Array | unknown): ValidationResult<ServerMessage> {
  const msg = typeof input === 'string' || input instanceof Uint8Array ? parseJson(input) : input;

  if (!isObject(msg)) {
    return fail('BAD_MESSAGE', 'server message must be object');
  }

  if (msg.v !== PROTOCOL_VERSION) {
    return fail('PROTOCOL_VERSION', 'unsupported protocol version');
  }

  if (!isString(msg.t)) {
    return fail('BAD_MESSAGE', 'missing type');
  }

  if (!knownServerTypes.includes(msg.t)) {
    return skip(`unknown server event ${msg.t}`);
  }

  return { ok: true, value: msg as ServerMessage };
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

function isValidJoinMessage(msg: Record<string, unknown>): boolean {
  return (
    typeof msg.room === 'string' &&
    ROOM_RE.test(msg.room) &&
    (msg.kind === 'group' || msg.kind === 'private') &&
    isString(msg.senderId, LIMITS.SENDER_ID_BYTES) &&
    isBase64Url(msg.sessionNonce, LIMITS.SESSION_NONCE_CHARS, LIMITS.SESSION_NONCE_CHARS) &&
    (msg.resumeToken === undefined || isBase64Url(msg.resumeToken, LIMITS.RESUME_TOKEN_CHARS)) &&
    (msg.senderPubKey === undefined ||
      isBase64Url(msg.senderPubKey, LIMITS.SENDER_PUBKEY_CHARS, LIMITS.SENDER_PUBKEY_CHARS))
  );
}

function isValidSignalMessage(msg: Record<string, unknown>): boolean {
  if (!isString(msg.to, LIMITS.PARTICIPANT_ID_CHARS) || !isObject(msg.data)) {
    return false;
  }

  if (msg.data.type === 'offer' || msg.data.type === 'answer') {
    return isString(msg.data.sdp, LIMITS.SDP_CHARS);
  }

  return msg.data.type === 'ice' && JSON.stringify(msg.data.candidate).length <= LIMITS.CANDIDATE_CHARS;
}
