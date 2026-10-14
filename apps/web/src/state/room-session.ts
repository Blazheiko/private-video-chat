import { isBase64Url, validateFragmentKey } from '@shared';

// Tab-scoped room state that survives F5: the #k key is cleared from the URL on load and the
// resumeToken lives in memory, so without this a reload could neither decrypt nor reclaim the slot.
export type RoomSession = {
  linkKey: string;
  resumeToken?: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const storageKey = (roomId: string) => `private-video-chat:room:${roomId}`;

// Only a reload (F5) may resume from storage. Any other arrival (Back button, typed URL, a fresh
// link) means the user left the room, so stored credentials must not silently rejoin it.
export function pickRoomSession({
  stored,
  keyFromUrl,
  isReload,
}: {
  stored?: RoomSession;
  keyFromUrl?: string;
  isReload: boolean;
}): RoomSession | undefined {
  if (keyFromUrl) {
    return { linkKey: keyFromUrl };
  }

  return isReload ? stored : undefined;
}

export function loadRoomSession(roomId: string, storage: StorageLike | undefined = sessionStorageOrUndefined()): RoomSession | undefined {
  try {
    const raw = storage?.getItem(storageKey(roomId));
    const parsed: unknown = raw ? JSON.parse(raw) : undefined;

    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }

    const { linkKey, resumeToken } = parsed as Record<string, unknown>;

    if (!validateFragmentKey(linkKey).ok) {
      return undefined;
    }

    return {
      linkKey: linkKey as string,
      ...(typeof resumeToken === 'string' && isBase64Url(resumeToken) ? { resumeToken } : {}),
    };
  } catch {
    return undefined;
  }
}

export function saveRoomSession(
  roomId: string,
  session: RoomSession,
  storage: StorageLike | undefined = sessionStorageOrUndefined(),
): void {
  try {
    storage?.setItem(storageKey(roomId), JSON.stringify(session));
  } catch {
    // Storage can be unavailable (private mode, quota); the room still works without F5 recovery.
  }
}

export function clearRoomSession(roomId: string, storage: StorageLike | undefined = sessionStorageOrUndefined()): void {
  try {
    storage?.removeItem(storageKey(roomId));
  } catch {
    // Ignore storage failures; nothing to clean up.
  }
}

function sessionStorageOrUndefined(): StorageLike | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}
