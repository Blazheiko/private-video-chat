const subtle = globalThis.crypto.subtle;
const textEncoder = new TextEncoder();

function hasNodeBuffer(): boolean {
  return typeof Buffer !== 'undefined';
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return binary;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64);

  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function normalizeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (base64.length % 4)) % 4;

  return `${base64}${'='.repeat(paddingLength)}`;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  if (hasNodeBuffer()) {
    return Buffer.from(bytes).toString('base64url');
  }

  return globalThis
    .btoa(bytesToBinaryString(bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  if (hasNodeBuffer()) {
    return new Uint8Array(Buffer.from(value, 'base64url'));
  }

  return base64ToBytes(normalizeBase64Url(value));
}

export function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);

  return base64UrlEncode(bytes);
}

export function randomRoomId(): string {
  return randomBase64Url(16);
}

export function randomResumeToken(): string {
  return randomBase64Url(64);
}

export function randomSessionNonce(): string {
  return randomBase64Url(16);
}

export async function importAesKey(base64urlKey: string): Promise<CryptoKey> {
  return subtle.importKey('raw', base64UrlDecode(base64urlKey) as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function deriveAuthKey(linkKey: string): Promise<CryptoKey> {
  const key = await subtle.importKey('raw', base64UrlDecode(linkKey) as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);

  return subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: textEncoder.encode('private-video-chat-v1'),
      info: textEncoder.encode('webrtc-auth'),
    },
    key,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

export async function hmacBase64Url(key: CryptoKey, transcript: string): Promise<string> {
  const mac = await subtle.sign('HMAC', key, textEncoder.encode(transcript));

  return base64UrlEncode(new Uint8Array(mac));
}

export function parseFragmentKey(hash: string): string | undefined {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);

  return params.get('k') ?? undefined;
}
