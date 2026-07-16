import { describe, expect, it } from 'vitest';
import { base64UrlDecode, base64UrlEncode } from '#shared/crypto.js';

describe('base64url helpers', () => {
  it('round-trips bytes using native base64 primitives', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    const encoded = base64UrlEncode(bytes);

    expect(encoded).toBe('AAEC_f7_');
    expect(base64UrlDecode(encoded)).toEqual(bytes);
  });

  it('omits base64 padding', () => {
    expect(base64UrlEncode(new Uint8Array([255]))).toBe('_w');
  });
});
