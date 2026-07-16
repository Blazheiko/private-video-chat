import {
  base64UrlDecode,
  base64UrlEncode,
  importAesKey,
  randomBase64Url,
  type EncryptedEnvelope,
} from '@shared';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function aadBytes(aad: EncryptedEnvelope['aad']): Uint8Array {
  return textEncoder.encode(JSON.stringify(aad));
}

export async function encryptText(
  key: string,
  text: string,
  senderId: string,
  seq: number,
): Promise<EncryptedEnvelope> {
  const iv = randomBase64Url(12);
  const aad = {
    msgId: crypto.randomUUID(),
    senderId,
    seq,
    ts: Date.now(),
  };
  const cryptoKey = await importAesKey(key);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlDecode(iv) as BufferSource,
      additionalData: aadBytes(aad) as BufferSource,
    },
    cryptoKey,
    textEncoder.encode(text) as BufferSource,
  );

  return {
    iv,
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    aad,
  };
}

export async function decryptText(key: string, env: EncryptedEnvelope): Promise<string> {
  const cryptoKey = await importAesKey(key);
  const plain = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlDecode(env.iv) as BufferSource,
      additionalData: aadBytes(env.aad) as BufferSource,
    },
    cryptoKey,
    base64UrlDecode(env.ciphertext) as BufferSource,
  );

  return textDecoder.decode(plain);
}

export class ReplayGuard {
  private lastSeq = new Map<string, number>();
  private seen = new Map<string, Set<string>>();

  accept(from: string, env: EncryptedEnvelope): boolean {
    const prev = this.lastSeq.get(from) ?? -1;

    if (env.aad.seq <= prev) {
      return false;
    }

    const ids = this.seen.get(from) ?? new Set<string>();

    if (ids.has(env.aad.msgId)) {
      return false;
    }

    ids.add(env.aad.msgId);

    if (ids.size > 1024) {
      ids.delete(ids.values().next().value as string);
    }

    this.seen.set(from, ids);
    this.lastSeq.set(from, env.aad.seq);

    return true;
  }

  resetParticipant(participantId: string): void {
    this.lastSeq.delete(participantId);
    this.seen.delete(participantId);
  }

  resetAll(): void {
    this.lastSeq.clear();
    this.seen.clear();
  }
}
