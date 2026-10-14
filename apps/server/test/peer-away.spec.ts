import { DEFAULTS, PROTOCOL_VERSION, type ServerMessage } from '#shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomRegistry } from '#server/rooms.js';
import { registerWebSocket } from '#server/websocket.js';

type Handlers = {
  open(ws: FakeSocket): void;
  message(ws: FakeSocket, message: ArrayBuffer): void;
  close(ws: FakeSocket): void;
};

class FakeSocket {
  received: ServerMessage[] = [];

  constructor(private readonly handlers: Handlers) {
    handlers.open(this);
  }

  send(message: string): number {
    this.received.push(JSON.parse(message) as ServerMessage);
    return 1;
  }

  end(): void {
    this.handlers.close(this);
  }

  getBufferedAmount(): number {
    return 0;
  }

  getRemoteAddressAsText(): ArrayBuffer {
    return new TextEncoder().encode('127.0.0.1').buffer as ArrayBuffer;
  }

  sendClient(message: Record<string, unknown>): void {
    this.handlers.message(this, new TextEncoder().encode(JSON.stringify({ v: PROTOCOL_VERSION, ...message })).buffer as ArrayBuffer);
  }

  last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
    return this.received.filter(message => message.t === t).at(-1) as Extract<ServerMessage, { t: T }> | undefined;
  }

  types(): string[] {
    return this.received.map(message => message.t);
  }
}

const room = 'abcdefghijklmnopqrstuv';
const sessionNonce = 'abcdefghijklmnopqrstuv';

function setup() {
  let handlers: Handlers | undefined;

  registerWebSocket(
    {
      ws(_pattern: string, behavior: Record<string, unknown>) {
        handlers = behavior as unknown as Handlers;
        return this;
      },
    },
    new RoomRegistry({ ...DEFAULTS, ROOM_GRACE_MS: 100, ROOM_TOMBSTONE_MS: 100 } as unknown as typeof DEFAULTS),
  );

  const join = (senderId: string, resumeToken?: string) => {
    const socket = new FakeSocket(handlers!);
    socket.sendClient({ t: 'join', room, senderId, sessionNonce, ...(resumeToken ? { resumeToken } : {}) });
    return socket;
  };

  return { join };
}

describe('peer-away', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tells the peer immediately when a socket closes without leave', () => {
    vi.useFakeTimers();
    const { join } = setup();
    const a = join('a');
    const b = join('b');
    const bId = b.last('joined')!.selfId;

    b.end();

    expect(a.last('peer-away')).toEqual({ v: PROTOCOL_VERSION, t: 'peer-away', participantId: bId });
    expect(a.last('peer-left')).toBeUndefined();
  });

  it('follows peer-away with peer-left after the grace period', () => {
    vi.useFakeTimers();
    const { join } = setup();
    const a = join('a');
    const b = join('b');
    const bId = b.last('joined')!.selfId;

    b.end();
    vi.advanceTimersByTime(101);

    expect(a.types().slice(-2)).toEqual(['peer-away', 'peer-left']);
    expect(a.last('peer-left')).toMatchObject({ participantId: bId, reason: 'grace-expired' });
  });

  it('announces the same participant again via peer-joined when it resumes', () => {
    vi.useFakeTimers();
    const { join } = setup();
    const a = join('a');
    const b = join('b');
    const joined = b.last('joined')!;

    b.end();
    const resumed = join('b', joined.resumeToken);

    expect(resumed.last('joined')).toMatchObject({ resumed: true, selfId: joined.selfId });
    expect(a.types().slice(-2)).toEqual(['peer-away', 'peer-joined']);
    expect(a.last('peer-joined')?.peer.participantId).toBe(joined.selfId);
  });

  it('marks a peer that is away inside grace in the joined snapshot of a resuming client', () => {
    vi.useFakeTimers();
    const { join } = setup();
    const a = join('a');
    const b = join('b');
    const aJoined = a.last('joined')!;
    const bId = b.last('joined')!.selfId;

    b.end();
    a.end();
    const aResumed = join('a', aJoined.resumeToken);

    expect(aResumed.last('joined')).toMatchObject({ resumed: true, peers: [{ participantId: bId, away: true }] });
  });

  it('does not mark connected peers as away', () => {
    const { join } = setup();
    join('a');
    const b = join('b');

    expect(b.last('joined')!.peers[0]).not.toHaveProperty('away');
  });

  it('refreshes senderId and sessionNonce on resume and announces them to the peer', () => {
    vi.useFakeTimers();
    const { join } = setup();
    const a = join('a');
    const b = join('b');
    const bJoined = b.last('joined')!;

    b.end();
    const resumed = join('b-reloaded', bJoined.resumeToken);

    expect(resumed.last('joined')?.resumed).toBe(true);
    expect(a.last('peer-joined')?.peer).toMatchObject({ participantId: bJoined.selfId, senderId: 'b-reloaded' });
    expect(a.last('peer-joined')?.peer).not.toHaveProperty('away');
  });

  it('sends only peer-left on explicit leave', () => {
    vi.useFakeTimers();
    const { join } = setup();
    const a = join('a');
    const b = join('b');

    b.sendClient({ t: 'leave' });

    expect(a.last('peer-away')).toBeUndefined();
    expect(a.last('peer-left')).toMatchObject({ reason: 'left' });
  });
});
