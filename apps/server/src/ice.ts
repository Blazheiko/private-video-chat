import { DEFAULTS, type IceConfig } from '#shared';

export function buildIceConfig(env = process.env): IceConfig {
  const isProduction = env.NODE_ENV === 'production';
  const urls = isProduction
    ? (env.TURN_URLS ?? '').split(',').filter(Boolean)
    : ['stun:stun.l.google.com:19302'];

  return {
    iceServers: urls.length
      ? [
          {
            urls,
            username: env.TURN_USERNAME,
            credential: env.TURN_CREDENTIAL,
          },
        ]
      : [],
    ttlSec: Number(env.TURN_TTL_SEC ?? DEFAULTS.TURN_TTL_SEC),
    policy: env.ICE_POLICY === 'relay' ? 'relay' : 'all',
  };
}
