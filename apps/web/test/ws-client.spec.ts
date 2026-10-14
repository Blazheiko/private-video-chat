import { PROTOCOL_VERSION } from '@shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WsClient, isPongOverdue } from '@web/ws/client.js';

type Listener = (event: { data?: string }) => void;

class FakeSocket {
  readonly OPEN = 1;
  readyState = 0;
  sent: Array<{ t: string }> = [];
  closeCalls = 0;
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as { t: string });
  }

  close(): void {
    this.closeCalls += 1;
  }

  open(): void {
    this.readyState = 1;
    this.emit('open');
  }

  receive(message: Record<string, unknown>): void {
    this.emit('message', { data: JSON.stringify({ v: PROTOCOL_VERSION, ...message }) });
  }

  nativeClose(): void {
    this.readyState = 3;
    this.emit('close');
  }

  pings(): number {
    return this.sent.filter(message => message.t === 'ping').length;
  }

  private emit(type: string, event: { data?: string } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

const heartbeat = { intervalMs: 10_000, timeoutMs: 5_000 };

function connect() {
  const sockets: FakeSocket[] = [];
  const onClose = vi.fn();
  const onMessage = vi.fn();
  const client = new WsClient({ onMessage, onClose }, 'ws://test/ws', () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket as unknown as WebSocket;
  }, heartbeat);

  client.connectJoin('abcdefghijklmnopqrstuv', 'sender');

  return { client, socket: sockets[0]!, onClose, onMessage };
}

describe('isPongOverdue', () => {
  it('is overdue only when nothing arrived after the ping', () => {
    expect(isPongOverdue({ pingSentAt: 100, lastMessageAt: 99 })).toBe(true);
    expect(isPongOverdue({ pingSentAt: 100, lastMessageAt: 100 })).toBe(false);
    expect(isPongOverdue({ pingSentAt: 100, lastMessageAt: 150 })).toBe(false);
  });
});

describe('WsClient heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends no ping before the socket opens', () => {
    const { socket } = connect();

    vi.advanceTimersByTime(60_000);

    expect(socket.pings()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('pings after open and stays alive while pongs arrive', () => {
    const { socket, onClose } = connect();

    socket.open();

    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(heartbeat.intervalMs);
      socket.receive({ t: 'pong' });
    }

    vi.advanceTimersByTime(heartbeat.timeoutMs);

    expect(socket.pings()).toBe(3);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('treats any server message after the ping as a sign of life', () => {
    const { socket, onClose } = connect();

    socket.open();
    vi.advanceTimersByTime(heartbeat.intervalMs);
    socket.receive({ t: 'peer-away', participantId: 'abcdefghijklmnopqrstuv' });
    vi.advanceTimersByTime(heartbeat.timeoutMs);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('abandons a silent connection and reports onClose exactly once', () => {
    const { socket, onClose } = connect();

    socket.open();
    vi.advanceTimersByTime(heartbeat.intervalMs + heartbeat.timeoutMs);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);

    socket.nativeClose();
    vi.advanceTimersByTime(60_000);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores messages that arrive after abandon', () => {
    const { client, socket, onMessage } = connect();

    socket.open();
    client.abandon();
    socket.receive({ t: 'pong' });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('stops the heartbeat on native close, leave and abandon', () => {
    for (const end of ['close', 'leave', 'abandon'] as const) {
      const { client, socket } = connect();

      socket.open();
      vi.advanceTimersByTime(heartbeat.intervalMs);

      if (end === 'close') socket.nativeClose();
      if (end === 'leave') client.leave();
      if (end === 'abandon') client.abandon();

      const pingsAtEnd = socket.pings();

      vi.advanceTimersByTime(60_000);

      expect(vi.getTimerCount(), end).toBe(0);
      expect(socket.pings(), end).toBe(pingsAtEnd);
    }
  });

  it('keeps onClose for leave so the app can finish Exit on the native close', () => {
    const { client, socket, onClose } = connect();

    socket.open();
    client.leave();

    expect(socket.sent.at(-1)?.t).toBe('leave');
    expect(onClose).not.toHaveBeenCalled();

    socket.nativeClose();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('runs a single heartbeat even if open fires twice', () => {
    const { socket } = connect();

    socket.open();
    socket.open();
    vi.advanceTimersByTime(heartbeat.intervalMs);

    expect(socket.pings()).toBe(1);
  });
});
