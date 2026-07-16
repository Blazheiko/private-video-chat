export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000] as const;

export function reconnectDelayMs(attempt: number): number {
  if (!Number.isSafeInteger(attempt) || attempt <= 0) {
    return RECONNECT_DELAYS_MS[0];
  }

  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? RECONNECT_DELAYS_MS[0];
}
