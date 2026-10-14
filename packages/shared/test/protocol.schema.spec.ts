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
      senderId: 'alice',
      sessionNonce: 'abcdefghijklmnopqrstuv',
    });

    expect(result.ok).toBe(true);
  });

  it('rejects removed group relay command as fatal BAD_MESSAGE', () => {
    const result = validateClientMessage({ v: PROTOCOL_VERSION, t: 'relay', cid: 1, env: {} });

    expect(result.ok).toBe(false);
    if (!result.ok && !('skip' in result)) {
      expect(result.code).toBe('BAD_MESSAGE');
      expect(result.fatal).toBe(true);
    }
  });

  it('rejects protocol v1 clients with PROTOCOL_VERSION', () => {
    const result = validateClientMessage({ v: 1, t: 'ping' });

    expect(result.ok).toBe(false);
    if (!result.ok && !('skip' in result)) {
      expect(result.code).toBe('PROTOCOL_VERSION');
    }
  });

  it('accepts peer-away as a known server event', () => {
    const result = validateServerMessage({ v: PROTOCOL_VERSION, t: 'peer-away', participantId: 'abcdefghijklmnopqrstuv' });

    expect(result.ok).toBe(true);
  });

  it('skips removed relay and ack server events', () => {
    for (const t of ['relay', 'ack']) {
      const result = validateServerMessage({ v: PROTOCOL_VERSION, t });

      expect(result.ok).toBe(false);
      if (!result.ok) expect('skip' in result && result.skip).toBe(true);
    }
  });
});
