import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, normalize, relative, sep } from 'node:path';

export type StaticAsset = {
  path: string;
  type: string;
  body: Buffer;
};

export type StaticCache = {
  root: string;
  assets: Map<string, StaticAsset>;
  fallback?: StaticAsset;
};

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export const securityHeaders = {
  'content-security-policy':
    "default-src 'self'; connect-src 'self' wss:; img-src 'self' data:; " +
    "style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

export function loadStaticCache(root: string): StaticCache {
  const assets = new Map<string, StaticAsset>();

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    return { root, assets };
  }

  collectStaticAssets(root, root, assets);

  const fallback = assets.get('/index.html');

  if (fallback) {
    assets.set('/', fallback);
  }

  return { root, assets, fallback };
}

export function resolveStatic(cache: StaticCache, url: string): StaticAsset | undefined {
  const cacheKey = cacheKeyFromUrl(url);

  if (!cacheKey) {
    return cache.fallback;
  }

  return cache.assets.get(cacheKey) ?? cache.fallback;
}

function collectStaticAssets(root: string, directory: string, assets: Map<string, StaticAsset>): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      collectStaticAssets(root, absolutePath, assets);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const route = routeFromPath(root, absolutePath);

    assets.set(route, {
      path: absolutePath,
      type: mime[extname(absolutePath)] ?? 'application/octet-stream',
      body: readFileSync(absolutePath),
    });
  }
}

function routeFromPath(root: string, absolutePath: string): string {
  const relativePath = relative(root, absolutePath).split(sep).join('/');

  return `/${relativePath}`;
}

function cacheKeyFromUrl(url: string): string | undefined {
  try {
    const rawPath = decodeURIComponent(url.split('?')[0] ?? '/');
    const normalizedPath = normalize(rawPath).split(sep).join('/');
    const route = normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`;

    return route === '/' ? '/index.html' : route;
  } catch {
    return undefined;
  }
}
