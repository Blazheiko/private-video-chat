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

  it('falls back to cached index.html for unknown application routes', () => {
    const root = createStaticRoot();
    const cache = loadStaticCache(root);

    const asset = resolveStatic(cache, '/r/g/abcdefghijklmnopqrstuv');

    expect(asset?.path).toBe(join(root, 'index.html'));
    expect(asset?.body.toString()).toBe('<html>cached</html>');
  });
});
