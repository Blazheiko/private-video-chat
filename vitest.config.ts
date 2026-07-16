import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));
const serverSrc = resolve(root, 'apps/server/src');
const sharedSrc = resolve(root, 'packages/shared/src');
const webSrc = resolve(root, 'apps/web/src');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/*/test/**/*.spec.ts', 'apps/*/test/**/*.spec.ts'],
  },
  resolve: {
    alias: [
      { find: /^#server\/(.*)$/, replacement: `${serverSrc}/$1` },
      { find: /^#shared$/, replacement: `${sharedSrc}/index.ts` },
      { find: /^#shared\/(.*)$/, replacement: `${sharedSrc}/$1` },
      { find: /^@private-video-chat\/shared$/, replacement: `${sharedSrc}/index.ts` },
      { find: /^@private-video-chat\/shared\/(.*)$/, replacement: `${sharedSrc}/$1` },
      { find: /^@server\/(.*)$/, replacement: `${serverSrc}/$1` },
      { find: /^@shared$/, replacement: `${sharedSrc}/index.ts` },
      { find: /^@shared\/(.*)$/, replacement: `${sharedSrc}/$1` },
      { find: /^@web\/(.*)$/, replacement: `${webSrc}/$1` },
    ],
  },
});
