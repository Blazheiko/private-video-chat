import {
  BASE64URL_RE,
  E2E_KEY_BASE64URL_LENGTH,
  LIMITS,
  MAX_RELAY_CIPHERTEXT_BYTES,
  MAX_SENDER_ID_LENGTH,
  PROTOCOL_VERSION,
  ROOM_ID_BASE64URL_LENGTH,
  SESSION_NONCE_BASE64URL_LENGTH,
} from '#shared/constants.js';
import type { ClientMessage, EncryptedEnvelope, ErrorCode, ServerMessage } from '#shared/protocol.js';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string; fatal: boolean };

const KNOWN_SERVER_TYPES = new Set([
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
]);

const fatalByCode: Record<ErrorCode, boolean> = {
  PROTOCOL_VERSION: true,
  BAD_MESSAGE: true,
  MSG_TOO_LARGE: true,
  NOT_JOINED: true,
  ALREADY_JOINED: false,
  ROOM_FULL: true,
  ROOM_CLOSED: true,
  WRONG_KIND: true,
  UNKNOWN_PEER: false,
  RATE_LIMITED: false,
  JOIN_TIMEOUT: true,
  BACKPRESSURE: true,
  BAD_RESUME_TOKEN: false,
  CAPACITY: true,
  INTERNAL: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export function isBase64Url(value: string, expectedLength?: number): boolean {
  return BASE64URL_RE.test(value) && (expectedLength === undefined || value.length === expectedLength);
}

export function validateRoomId(value: unknown): ValidationResult<string> {
  if (!isNonEmptyString(value) || !isBase64Url(value, ROOM_ID_BASE64URL_LENGTH)) {
    return err('BAD_MESSAGE', `room id must be ${ROOM_ID_BASE64URL_LENGTH} chars of base64url`);
  }

  return { ok: true, value };
}

export function validateFragmentKey(value: unknown): ValidationResult<string> {
  if (!isNonEmptyString(value) || !isBase64Url(value, E2E_KEY_BASE64URL_LENGTH)) {
    return err('BAD_MESSAGE', `fragment key must be ${E2E_KEY_BASE64URL_LENGTH} chars of base64url`);
  }

  return { ok: true, value };
}

export function validateSessionNonce(value: unknown): ValidationResult<string> {
  if (!isNonEmptyString(value) || !isBase64Url(value, SESSION_NONCE_BASE64URL_LENGTH)) {
    return err('BAD_MESSAGE', `sessionNonce must be ${SESSION_NONCE_BASE64URL_LENGTH} chars of base64url`);
  }

  return { ok: true, value };
}

export function validateClientMessage(value: unknown): ValidationResult<ClientMessage> {
  if (!isRecord(value)) {
    return err('BAD_MESSAGE', 'message must be an object');
  }

  if (value.v !== PROTOCOL_VERSION) {
    return err('PROTOCOL_VERSION', 'unsupported protocol version');
  }

  if (!isNonEmptyString(value.t)) {
    return err('BAD_MESSAGE', 'message type is required');
  }

  switch (value.t) {
    case 'join':
      return validateJoinMessage(value);

    case 'leave':
    case 'ping':
      return { ok: true, value: { v: PROTOCOL_VERSION, t: value.t } as ClientMessage };

    case 'relay':
      return validateRelayMessage(value);

    case 'signal':
      return validateSignalMessage(value);

    case 'auth':
      return validateAuthMessage(value);

    default:
      return err('BAD_MESSAGE', `unknown client message type: ${value.t}`);
  }
}

export function makeError(code: ErrorCode, message: string): Extract<ServerMessage, { t: 'error' }> {
  return {
    v: PROTOCOL_VERSION,
    t: 'error',
    code,
    message,
    fatal: fatalByCode[code],
  };
}

export function shouldSkipUnknownServerMessage(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.v === PROTOCOL_VERSION &&
    isNonEmptyString(value.t) &&
    !KNOWN_SERVER_TYPES.has(value.t)
  );
}

function validateJoinMessage(value: Record<string, unknown>): ValidationResult<ClientMessage> {
  const room = validateRoomId(value.room);
  if (!room.ok) return room;

  if (value.kind !== 'group' && value.kind !== 'private') {
    return err('BAD_MESSAGE', 'kind must be group or private');
  }

  const senderId = validateSenderId(value.senderId);
  if (!senderId.ok) return senderId;

  const sessionNonce = validateSessionNonce(value.sessionNonce);
  if (!sessionNonce.ok) return sessionNonce;

  if (value.resumeToken !== undefined && !isNonEmptyString(value.resumeToken)) {
    return err('BAD_RESUME_TOKEN', 'resumeToken must be a non-empty string');
  }

  if (value.senderPubKey !== undefined && !isNonEmptyString(value.senderPubKey)) {
    return err('BAD_MESSAGE', 'senderPubKey must be a string');
  }

  return { ok: true, value: value as ClientMessage };
}

function validateRelayMessage(value: Record<string, unknown>): ValidationResult<ClientMessage> {
  if (!isSafeInteger(value.cid)) {
    return err('BAD_MESSAGE', 'cid must be a per-socket safe integer');
  }

  const env = validateEnvelope(value.env);
  if (!env.ok) return env;

  return {
    ok: true,
    value: {
      v: PROTOCOL_VERSION,
      t: 'relay',
      cid: value.cid,
      env: env.value,
    },
  };
}

function validateSignalMessage(value: Record<string, unknown>): ValidationResult<ClientMessage> {
  if (!isNonEmptyString(value.to) || !isRecord(value.data) || !isNonEmptyString(value.data.type)) {
    return err('BAD_MESSAGE', 'signal requires to and data.type');
  }

  return { ok: true, value: value as ClientMessage };
}

function validateAuthMessage(value: Record<string, unknown>): ValidationResult<ClientMessage> {
  if (!isNonEmptyString(value.to) || !isNonEmptyString(value.mac)) {
    return err('BAD_MESSAGE', 'auth requires to and mac');
  }

  return { ok: true, value: value as ClientMessage };
}

function validateSenderId(value: unknown): ValidationResult<string> {
  if (!isNonEmptyString(value) || value.length > MAX_SENDER_ID_LENGTH) {
    return err('BAD_MESSAGE', `senderId must be 1..${MAX_SENDER_ID_LENGTH} chars`);
  }

  return { ok: true, value };
}

function validateEnvelope(value: unknown): ValidationResult<EncryptedEnvelope> {
  if (!isRecord(value)) {
    return err('BAD_MESSAGE', 'env must be an object');
  }

  const { iv, ciphertext, aad, sig } = value;

  if (!isNonEmptyString(iv) || !isBase64Url(iv, LIMITS.IV_CHARS)) {
    return err('BAD_MESSAGE', 'env.iv must be base64url');
  }

  if (!isNonEmptyString(ciphertext) || !isBase64Url(ciphertext) || ciphertext.length > MAX_RELAY_CIPHERTEXT_BYTES * 2) {
    return err('MSG_TOO_LARGE', 'env.ciphertext is malformed or too large');
  }

  if (!isRecord(aad)) {
    return err('BAD_MESSAGE', 'env.aad must be an object');
  }

  if (!isNonEmptyString(aad.msgId)) {
    return err('BAD_MESSAGE', 'env.aad.msgId is required');
  }

  const sender = validateSenderId(aad.senderId);
  if (!sender.ok) return sender;

  if (!isSafeInteger(aad.seq) || !isSafeInteger(aad.ts)) {
    return err('BAD_MESSAGE', 'env aad seq and ts must be safe integers');
  }

  if (sig !== undefined && !isNonEmptyString(sig)) {
    return err('BAD_MESSAGE', 'env.sig must be a string');
  }

  return {
    ok: true,
    value: {
      iv,
      ciphertext,
      aad: {
        msgId: aad.msgId,
        senderId: sender.value,
        seq: aad.seq,
        ts: aad.ts,
      },
      ...(sig === undefined ? {} : { sig }),
    },
  };
}

function err(code: ErrorCode, message: string): ValidationResult<never> {
  return { ok: false, code, message, fatal: fatalByCode[code] };
}
