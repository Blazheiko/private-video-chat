import { base64UrlEncode, parseFragmentKey, randomRoomId } from '@shared';

export function readAndClearFragmentKey(locationLike = window.location): string | undefined {
  const key = parseFragmentKey(locationLike.hash);

  if (key && typeof history !== 'undefined') {
    history.replaceState(null, document.title, locationLike.pathname + locationLike.search);
  }

  return key;
}

export function newLink(origin = window.location.origin): { roomId: string; key: string; url: string } {
  const roomId = randomRoomId();
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  const key = base64UrlEncode(bytes);

  return {
    roomId,
    key,
    url: `${origin}/r/p/${roomId}#k=${key}`,
  };
}
