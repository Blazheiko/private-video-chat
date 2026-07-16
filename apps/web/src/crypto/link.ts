import { base64UrlEncode, parseFragmentKey, randomRoomId } from '@shared';

export function readAndClearFragmentKey(locationLike = window.location): string | undefined {
  const key = parseFragmentKey(locationLike.hash);

  if (key && typeof history !== 'undefined') {
    history.replaceState(null, document.title, locationLike.pathname + locationLike.search);
  }

  return key;
}

export function newLink(
  kind: 'group' | 'private',
  origin = window.location.origin,
): { roomId: string; key: string; url: string } {
  const roomId = randomRoomId();
  const bytes = new Uint8Array(32);

  crypto.getRandomValues(bytes);

  const key = base64UrlEncode(bytes);
  const routeKind = kind === 'group' ? 'g' : 'p';

  return {
    roomId,
    key,
    url: `${origin}/r/${routeKind}/${roomId}#k=${key}`,
  };
}
