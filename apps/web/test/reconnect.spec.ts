import { describe, expect, it } from 'vitest';
import { RECONNECT_DELAYS_MS, reconnectDelayMs } from '@web/ws/reconnect.js';

describe('reconnectDelayMs', () => {
  it('uses bounded backoff delays', () => {
    expect(reconnectDelayMs(-1)).toBe(RECONNECT_DELAYS_MS[0]);
    expect(reconnectDelayMs(0)).toBe(RECONNECT_DELAYS_MS[0]);
    expect(reconnectDelayMs(1)).toBe(RECONNECT_DELAYS_MS[1]);
    expect(reconnectDelayMs(2)).toBe(RECONNECT_DELAYS_MS[2]);
    expect(reconnectDelayMs(3)).toBe(RECONNECT_DELAYS_MS[3]);
    expect(reconnectDelayMs(99)).toBe(RECONNECT_DELAYS_MS[3]);
  });
});
