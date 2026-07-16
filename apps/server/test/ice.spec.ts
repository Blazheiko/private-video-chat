import { createHmac } from 'node:crypto';
import { DEFAULTS } from '#shared';
import { describe, expect, it } from 'vitest';
import { buildIceConfig, generateTurnCredentials, turnUrls } from '#server/ice.js';

describe('TURN ICE configuration', () => {
  it('generates coturn REST API credentials with expiry username and HMAC-SHA1 credential', () => {
    const creds = generateTurnCredentials({
      secret: 'test-secret-key',
      userId: 'participant-1',
      ttlSec: 3600,
      now: () => 1_700_000_000_000,
    });

    expect(creds).toEqual({
      username: '1700003600:participant-1',
      credential: createHmac('sha1', 'test-secret-key').update('1700003600:participant-1').digest('base64'),
      ttlSec: 3600,
      expiresAt: 1_700_003_600,
    });
  });

  it('builds temporary TURN credentials when TURN_SECRET is configured', () => {
    const ice = buildIceConfig('participant-1', {
      NODE_ENV: 'production',
      TURN_SECRET: 'test-secret-key',
      TURN_HOST: 'turn.example.com',
      TURN_TTL_SEC: '3600',
      ICE_POLICY: 'relay',
    } as NodeJS.ProcessEnv);

    expect(ice.ttlSec).toBe(3600);
    expect(ice.policy).toBe('relay');
    expect(ice.iceServers).toHaveLength(1);
    expect(ice.iceServers[0]).toMatchObject({
      urls: ['stun:turn.example.com:3478', 'turn:turn.example.com:3478', 'turns:turn.example.com:5349'],
    });
    expect(String(ice.iceServers[0]?.username)).toMatch(/^\d+:participant-1$/);
    expect(ice.iceServers[0]?.credential).toBeTruthy();
    expect(ice.iceServers[0]?.credential).not.toBe('static-password');
  });

  it('keeps static TURN credentials as a fallback when no TURN_SECRET is configured', () => {
    const ice = buildIceConfig('participant-1', {
      NODE_ENV: 'production',
      TURN_URLS: 'turn:turn.example.com:3478, turns:turn.example.com:5349 ',
      TURN_USERNAME: 'static-user',
      TURN_CREDENTIAL: 'static-password',
    } as NodeJS.ProcessEnv);

    expect(ice.iceServers).toEqual([
      {
        urls: ['turn:turn.example.com:3478', 'turns:turn.example.com:5349'],
        username: 'static-user',
        credential: 'static-password',
      },
    ]);
  });

  it('returns no ICE servers in production until TURN_URLS or TURN_HOST is configured', () => {
    expect(turnUrls({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toEqual([]);
    expect(buildIceConfig('participant-1', { NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toMatchObject({
      iceServers: [],
      ttlSec: DEFAULTS.TURN_TTL_SEC,
      policy: 'all',
    });
  });
});
