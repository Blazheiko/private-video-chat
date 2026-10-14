import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadStaticCache, resolveStatic } from '#server/static.js';

let staticRoot: string | undefined;

afterEach(() => {
  if (staticRoot) {
    rmSync(staticRoot, { recursive: true, force: true });
    staticRoot = undefined;
  }
});

function createStaticRoot(): string {
  staticRoot = mkdtempSync(join(tmpdir(), 'private-video-chat-static-'));

  writeFileSync(join(staticRoot, 'index.html'), '<html>cached</html>');
  writeFileSync(join(staticRoot, 'app.js'), 'console.log("cached")');
  writeFileSync(join(staticRoot, 'manifest.json'), '{}');
  writeFileSync(join(staticRoot, 'manifest.webmanifest'), '{}');
  writeFileSync(join(staticRoot, 'icon.png'), 'png');
  writeFileSync(join(staticRoot, 'robots.txt'), 'User-agent: *');
  writeFileSync(join(staticRoot, 'style.css'), 'body{}');
  writeFileSync(join(staticRoot, 'icon.svg'), '<svg/>');
  writeFileSync(join(staticRoot, 'sitemap.xml'), '<urlset/>');

  return staticRoot;
}

describe('static cache', () => {
  it('serves cached files from memory after startup', () => {
    const root = createStaticRoot();
    const cache = loadStaticCache(root);

    writeFileSync(join(root, 'app.js'), 'console.log("changed")');

    const asset = resolveStatic(cache, '/app.js');

    expect(asset?.type).toBe('text/javascript; charset=utf-8');
    expect(asset?.body.toString()).toBe('console.log("cached")');
  });

  it('serves PWA assets with nosniff-compatible MIME types', () => {
    const root = createStaticRoot();
    const cache = loadStaticCache(root);

    expect(resolveStatic(cache, '/manifest.json')?.type).toBe('application/json; charset=utf-8');
    expect(resolveStatic(cache, '/manifest.webmanifest')?.type).toBe('application/manifest+json; charset=utf-8');
    expect(resolveStatic(cache, '/icon.png')?.type).toBe('image/png');
  });

  it('serves text assets with explicit MIME types instead of octet-stream', () => {
    const root = createStaticRoot();
    const cache = loadStaticCache(root);
    const expected: Record<string, string> = {
      '/robots.txt': 'text/plain; charset=utf-8',
      '/index.html': 'text/html; charset=utf-8',
      '/app.js': 'text/javascript; charset=utf-8',
      '/style.css': 'text/css; charset=utf-8',
      '/manifest.json': 'application/json; charset=utf-8',
      '/icon.svg': 'image/svg+xml',
      '/sitemap.xml': 'application/xml; charset=utf-8',
    };

    for (const [route, type] of Object.entries(expected)) {
      expect(resolveStatic(cache, route)?.type, route).toBe(type);
    }
  });

  it('falls back to cached index.html for unknown application routes', () => {
    const root = createStaticRoot();
    const cache = loadStaticCache(root);

    const asset = resolveStatic(cache, '/r/p/abcdefghijklmnopqrstuv');

    expect(asset?.path).toBe(join(root, 'index.html'));
    expect(asset?.body.toString()).toBe('<html>cached</html>');
  });
});
