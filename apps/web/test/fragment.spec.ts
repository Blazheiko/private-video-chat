import { E2E_KEY_BASE64URL_LENGTH } from '@shared';
import { describe, expect, it } from 'vitest';
import { readAndClearFragmentKey } from '@web/fragment.js';

type HistoryCall = Parameters<History['replaceState']>;

function makeLocation(hash: string): Location {
  return {
    hash,
    pathname: '/r/g/room-id',
    search: '?utm=1',
  } as Location;
}

function makeHistory(state: unknown = null): { history: History; calls: HistoryCall[] } {
  const calls: HistoryCall[] = [];
  const history = {
    state,
    replaceState: (...args: HistoryCall) => calls.push(args),
  } as unknown as History;

  return { history, calls };
}

describe('readAndClearFragmentKey', () => {
  it('returns a valid fragment key and removes it from URL', () => {
    const key = 'A'.repeat(E2E_KEY_BASE64URL_LENGTH);
    const { history, calls } = makeHistory({ retained: true });

    const result = readAndClearFragmentKey(makeLocation(`#k=${key}`), history);

    expect(result).toBe(key);
    expect(calls).toEqual([[{ retained: true }, '', '/r/g/room-id?utm=1']]);
  });

  it('clears malformed keys without returning them', () => {
    const { history, calls } = makeHistory();

    const result = readAndClearFragmentKey(makeLocation('#k=not-valid='), history);

    expect(result).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[2]).toBe('/r/g/room-id?utm=1');
  });

  it('leaves URLs without a key untouched', () => {
    const { history, calls } = makeHistory();

    const result = readAndClearFragmentKey(makeLocation('#other=value'), history);

    expect(result).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
