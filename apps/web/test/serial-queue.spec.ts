import { describe, expect, it } from 'vitest';
import { createSerialQueue } from '@web/rtc/serial-queue.js';
import { isFatalSignalError } from '@web/rtc/signal-errors.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createSerialQueue', () => {
  it('starts a task only after the previous one finished', async () => {
    const events: string[] = [];
    const queue = createSerialQueue(() => undefined);

    queue.push(async () => {
      events.push('offer:start');
      await tick();
      events.push('offer:end');
    });
    queue.push(async () => {
      events.push('ice:start');
    });

    await queue.idle();

    expect(events).toEqual(['offer:start', 'offer:end', 'ice:start']);
  });

  it('keeps running after a failing task and reports the error', async () => {
    const errors: unknown[] = [];
    const done: string[] = [];
    const queue = createSerialQueue(error => errors.push(error));

    queue.push(async () => {
      throw new Error('boom');
    });
    queue.push(async () => {
      done.push('next');
    });

    await queue.idle();

    expect(errors).toHaveLength(1);
    expect(done).toEqual(['next']);
  });

  it('does not lose tasks pushed while another task is running', async () => {
    const done: number[] = [];
    const queue = createSerialQueue(() => undefined);

    queue.push(async () => {
      await tick();
      queue.push(async () => {
        done.push(2);
      });
      done.push(1);
    });
    queue.push(async () => {
      done.push(3);
    });

    await queue.idle();
    await queue.idle();

    expect(done).toEqual([1, 3, 2]);
  });

  it('drops tasks after close', async () => {
    const done: string[] = [];
    const queue = createSerialQueue(() => undefined);

    queue.close();
    queue.push(async () => {
      done.push('late');
    });
    await queue.idle();

    expect(done).toEqual([]);
  });
});

describe('isFatalSignalError', () => {
  it('treats SDP failures as fatal and ICE candidate failures as non-fatal', () => {
    expect(isFatalSignalError('offer')).toBe(true);
    expect(isFatalSignalError('answer')).toBe(true);
    expect(isFatalSignalError('ice')).toBe(false);
  });
});
