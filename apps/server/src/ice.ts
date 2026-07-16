import { createHmac } from 'node:crypto';
import { DEFAULTS, type IceConfig } from '#shared';

export type TurnCredentialOptions = {
  secret: string;
  userId: string;
  ttlSec?: number;
  now?: () => number;
};

export type TurnCredentials = {
  username: string;
  credential: string;
  ttlSec: number;
  expiresAt: number;
};

export function generateTurnCredentials({
  secret,
  userId,
  ttlSec = DEFAULTS.TURN_TTL_SEC,
  now = Date.now,
}: TurnCredentialOptions): TurnCredentials {
  const safeTtlSec = normalizeTtlSec(ttlSec);
  const expiresAt = Math.floor(now() / 1000) + safeTtlSec;
  const username = `${expiresAt}:${userId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');

  return { username, credential, ttlSec: safeTtlSec, expiresAt };
}

export function buildIceConfig(userId = 'anonymous', env = process.env): IceConfig {
  const ttlSec = normalizeTtlSec(Number(env.TURN_TTL_SEC ?? DEFAULTS.TURN_TTL_SEC));
  const urls = turnUrls(env);
  const credentials = env.TURN_SECRET
    ? generateTurnCredentials({ secret: env.TURN_SECRET, userId, ttlSec })
    : undefined;

  return {
    iceServers: urls.length
      ? [
          {
            urls,
            username: credentials?.username ?? env.TURN_USERNAME,
            credential: credentials?.credential ?? env.TURN_CREDENTIAL,
          },
        ]
      : [],
    ttlSec: credentials?.ttlSec ?? ttlSec,
    policy: env.ICE_POLICY === 'relay' ? 'relay' : 'all',
  };
}

export function turnUrls(env: NodeJS.ProcessEnv): string[] {
  const configuredUrls = splitCsv(env.TURN_URLS);

  if (configuredUrls.length > 0) {
    return configuredUrls;
  }

  if (env.TURN_HOST) {
    return [`stun:${env.TURN_HOST}:3478`, `turn:${env.TURN_HOST}:3478`, `turns:${env.TURN_HOST}:5349`];
  }

  return env.NODE_ENV === 'production' ? [] : ['stun:stun.l.google.com:19302'];
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

function normalizeTtlSec(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULTS.TURN_TTL_SEC;
}
