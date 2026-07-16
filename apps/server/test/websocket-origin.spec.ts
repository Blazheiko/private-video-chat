import { describe, expect, it } from 'vitest';
import { parseAllowedOrigins, registerWebSocket } from '#server/websocket.js';

type CapturedBehavior = Record<string, unknown> & {
  upgrade?: (res: FakeUpgradeResponse, req: FakeUpgradeRequest, context: unknown) => void;
};

class FakeUpgradeResponse {
  status?: string;
  body?: string;
  upgraded?: {
    userData: Record<string, never>;
    key: string;
    protocol: string;
    extensions: string;
    context: unknown;
  };

  writeStatus(status: string): this {
    this.status = status;
    return this;
  }

  end(body?: string): void {
    this.body = body;
  }

  upgrade(
    userData: Record<string, never>,
    key: string,
    protocol: string,
    extensions: string,
    context: unknown,
  ): void {
    this.upgraded = { userData, key, protocol, extensions, context };
  }
}

class FakeUpgradeRequest {
  constructor(private readonly headers: Record<string, string>) {}

  getHeader(name: string): string {
    return this.headers[name.toLowerCase()] ?? '';
  }
}

function captureBehavior(allowedOrigins: readonly string[]): CapturedBehavior {
  let behavior: CapturedBehavior | undefined;
  const app = {
    ws(pattern: string, registered: CapturedBehavior) {
      expect(pattern).toBe('/ws');
      behavior = registered;
      return this;
    },
  };

  registerWebSocket(app, undefined, { allowedOrigins });

  expect(behavior?.upgrade).toBeTypeOf('function');
  return behavior!;
}

function runUpgrade(behavior: CapturedBehavior, origin?: string): FakeUpgradeResponse {
  const res = new FakeUpgradeResponse();
  const req = new FakeUpgradeRequest({
    ...(origin ? { origin } : {}),
    'sec-websocket-key': 'key',
    'sec-websocket-protocol': 'protocol',
    'sec-websocket-extensions': 'extensions',
  });

  behavior.upgrade?.(res, req, 'context');
  return res;
}

describe('registerWebSocket Origin checks', () => {
  it('accepts allowed origins during upgrade', () => {
    const res = runUpgrade(captureBehavior(['https://app.example']), 'https://app.example');

    expect(res.status).toBeUndefined();
    expect(res.upgraded).toMatchObject({ key: 'key', protocol: 'protocol', extensions: 'extensions', context: 'context' });
  });

  it('rejects missing and unlisted origins when an allow-list is configured', () => {
    for (const origin of [undefined, 'https://evil.example']) {
      const res = runUpgrade(captureBehavior(['https://app.example']), origin);

      expect(res.status).toBe('403 Forbidden');
      expect(res.body).toBe('Forbidden');
      expect(res.upgraded).toBeUndefined();
    }
  });

  it('preserves permissive local behavior for an empty allow-list', () => {
    const res = runUpgrade(captureBehavior([]));

    expect(res.status).toBeUndefined();
    expect(res.upgraded).toBeDefined();
  });

  it('parses comma-separated allowed origins', () => {
    expect(parseAllowedOrigins(' https://a.example,https://b.example ,, ')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});
