import { PROTOCOL_VERSION, validateClientMessage, validateServerMessage } from '#shared';
import { describe, expect, it } from 'vitest';

const room = 'abcdefghijklmnopqrstuv';

describe('protocol schemas', () => {
  it('rejects unknown client command as fatal BAD_MESSAGE', () => {
    const result = validateClientMessage({ v: PROTOCOL_VERSION, t: 'future', room });

    expect(result.ok).toBe(false);
    if (!result.ok && !('skip' in result)) {
      expect(result.code).toBe('BAD_MESSAGE');
    }
  });

  it('skips unknown server events for forward compatibility', () => {
    const result = validateServerMessage({ v: PROTOCOL_VERSION, t: 'future-event' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect('skip' in result && result.skip).toBe(true);
    }
  });

  it('accepts a valid join', () => {
    const result = validateClientMessage({
      v: PROTOCOL_VERSION,
      t: 'join',
      room,
      kind: 'group',
      senderId: 'alice',
      sessionNonce: 'abcdefghijklmnopqrstuv',
    });

    expect(result.ok).toBe(true);
  });
});
