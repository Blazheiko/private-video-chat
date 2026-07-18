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

  it('falls back to cached index.html for unknown application routes', () => {
    const root = createStaticRoot();
    const cache = loadStaticCache(root);

    const asset = resolveStatic(cache, '/r/g/abcdefghijklmnopqrstuv');

    expect(asset?.path).toBe(join(root, 'index.html'));
    expect(asset?.body.toString()).toBe('<html>cached</html>');
  });
});
