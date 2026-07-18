import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sharedSrc = resolve(root, 'packages/shared/src');
const webSrc = resolve(root, 'apps/web/src');
const pwaBuildVersion = new Date().toISOString().replace(/[^0-9]/g, '');

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      filename: 'sw.js',
      manifestFilename: 'manifest.json',
      injectRegister: false,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'pwa-icon-180.png'],
      manifest: {
        name: 'Private Video Chat',
        short_name: 'Private Chat',
        description:
          'Secure browser-based private and group video rooms with ephemeral links, WebRTC media, and encrypted chat.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0b1020',
        theme_color: '#101827',
        categories: ['communication', 'security', 'productivity'],
        icons: [
          { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: '/pwa-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/favicon.ico', sizes: '32x32', type: 'image/x-icon' },
        ],
      },
      workbox: {
        cacheId: `private-video-chat-${pwaBuildVersion}`,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/ws(?:\/|$)/],
      },
    }),
  ],
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
