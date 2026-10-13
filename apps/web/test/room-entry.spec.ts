import { describe, expect, it } from 'vitest';
import { roomEntry } from '@web/ui/room-entry.js';

const room = 'abcdefghijklmnopqrstuv';
const linkKey = 'C'.repeat(43);

describe('roomEntry', () => {
  it('auto-joins a room link with a key', () => {
    expect(roomEntry({ room, linkKey, roomUnavailable: false })).toBe('auto-join');
  });

  it('stops at missing-key when the link has no #k fragment', () => {
    expect(roomEntry({ room, roomUnavailable: false })).toBe('missing-key');
  });

  it('returns no-room outside a room route', () => {
    expect(roomEntry({ linkKey, roomUnavailable: false })).toBe('no-room');
  });

  it('prefers unavailable over auto-join once the room is full or closed', () => {
    expect(roomEntry({ room, linkKey, roomUnavailable: true })).toBe('unavailable');
  });
});
