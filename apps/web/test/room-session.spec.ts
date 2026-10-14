import { describe, expect, it } from 'vitest';
import { clearRoomSession, loadRoomSession, pickRoomSession, saveRoomSession } from '@web/state/room-session.js';

const room = 'abcdefghijklmnopqrstuv';
const linkKey = 'C'.repeat(43);
const resumeToken = 'T'.repeat(86);

function memoryStorage() {
  const data = new Map<string, string>();

  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('room session storage', () => {
  it('round-trips the link key and resume token per room', () => {
    const storage = memoryStorage();

    saveRoomSession(room, { linkKey, resumeToken }, storage);

    expect(loadRoomSession(room, storage)).toEqual({ linkKey, resumeToken });
    expect(loadRoomSession('zyxwvutsrqponmlkjihgfe', storage)).toBeUndefined();
  });

  it('ignores malformed entries instead of throwing', () => {
    const storage = memoryStorage();

    storage.setItem(`private-video-chat:room:${room}`, '{not json');
    expect(loadRoomSession(room, storage)).toBeUndefined();

    storage.setItem(`private-video-chat:room:${room}`, JSON.stringify({ linkKey: 'short' }));
    expect(loadRoomSession(room, storage)).toBeUndefined();
  });

  it('drops an invalid resume token but keeps the key', () => {
    const storage = memoryStorage();

    storage.setItem(`private-video-chat:room:${room}`, JSON.stringify({ linkKey, resumeToken: 'bad token!' }));

    expect(loadRoomSession(room, storage)).toEqual({ linkKey });
  });

  it('clears the session', () => {
    const storage = memoryStorage();

    saveRoomSession(room, { linkKey }, storage);
    clearRoomSession(room, storage);

    expect(storage.data.size).toBe(0);
  });

  it('survives missing storage', () => {
    expect(loadRoomSession(room, undefined)).toBeUndefined();
    expect(() => saveRoomSession(room, { linkKey }, undefined)).not.toThrow();
  });

  describe('pickRoomSession', () => {
    const stored = { linkKey, resumeToken };

    it('resumes from storage only on reload', () => {
      expect(pickRoomSession({ stored, isReload: true })).toEqual(stored);
    });

    it('ignores storage on any other navigation (Back, typed URL)', () => {
      expect(pickRoomSession({ stored, isReload: false })).toBeUndefined();
    });

    it('starts a fresh session from a key in the URL, dropping any stored token', () => {
      const otherKey = 'D'.repeat(43);

      expect(pickRoomSession({ stored, keyFromUrl: otherKey, isReload: false })).toEqual({ linkKey: otherKey });
      expect(pickRoomSession({ stored, keyFromUrl: linkKey, isReload: true })).toEqual({ linkKey });
    });
  });
});
