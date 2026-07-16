import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sharedSrc = resolve(root, 'packages/shared/src');
const webSrc = resolve(root, 'apps/web/src');

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: [
      { find: /^@shared$/, replacement: `${sharedSrc}/index.ts` },
      { find: /^@shared\/(.*)$/, replacement: `${sharedSrc}/$1` },
      { find: /^@web\/(.*)$/, replacement: `${webSrc}/$1` },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
  },
});
