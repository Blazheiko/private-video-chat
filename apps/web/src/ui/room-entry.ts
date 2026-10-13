export type RoomEntry = 'no-room' | 'missing-key' | 'unavailable' | 'auto-join';

export function roomEntry({
  room,
  linkKey,
  roomUnavailable,
}: {
  room?: string;
  linkKey?: string;
  roomUnavailable: boolean;
}): RoomEntry {
  if (!room) {
    return 'no-room';
  }

  if (!linkKey) {
    return 'missing-key';
  }

  return roomUnavailable ? 'unavailable' : 'auto-join';
}
