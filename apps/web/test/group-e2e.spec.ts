import { base64UrlEncode } from '@shared';
import { describe, expect, it } from 'vitest';
import { ReplayGuard, decryptText, encryptText } from '@web/crypto/e2e.js';

describe('group e2e helpers', () => {
  it('encrypts/decrypts and rejects replayed seq', async () => {
    const key = base64UrlEncode(new Uint8Array(32).fill(7));
    const env = await encryptText(key, 'hello', 'alice', 1);
    const guard = new ReplayGuard();

    await expect(decryptText(key, env)).resolves.toBe('hello');
    expect(guard.accept('p1', env)).toBe(true);
    expect(guard.accept('p1', env)).toBe(false);
  });
});
