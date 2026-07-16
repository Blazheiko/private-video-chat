import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import uWS from 'uWebSockets.js';
import { loadStaticCache, resolveStatic, securityHeaders } from '#server/static.js';
import { parseAllowedOrigins, registerWebSocket } from '#server/websocket.js';

export * from '#server/rooms.js';
export * from '#server/origin.js';

const DEFAULT_PORT = 3000;

function serverRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

function defaultStaticRoot(): string {
  return fileURLToPath(new URL('../../web/dist/', import.meta.url));
}

function resolveStaticRoot(value: string | undefined): string {
  if (!value) {
    return defaultStaticRoot();
  }

  return isAbsolute(value) ? value : resolve(serverRoot(), value);
}

function loadServerEnv(): void {
  const envPath = fileURLToPath(new URL('../.env', import.meta.url));

  if (existsSync(envPath)) {
    loadEnvFile(envPath);
  }
}

function writeSecurityHeaders(res: any): void {
  for (const [name, value] of Object.entries(securityHeaders)) {
    res.writeHeader(name, value);
  }
}

export function startServer(options: { port?: number; staticRoot?: string } = {}): void {
  loadServerEnv();

  const port = options.port ?? Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10);
  const staticRoot = options.staticRoot ?? resolveStaticRoot(process.env.STATIC_ROOT);

  const staticCache = loadStaticCache(staticRoot);
  const app = uWS.App();

  registerWebSocket(app, undefined, { allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS) });

  app.get('/healthz', (res: any) => {
    writeSecurityHeaders(res);
    res.writeHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true }));
  });

  const serveStatic = (res: any, req: any, includeBody: boolean) => {
    const match = resolveStatic(staticCache, req.getUrl());
    writeSecurityHeaders(res);

    if (!match) {
      res.writeStatus('404 Not Found');
      res.end(includeBody ? 'Not found' : undefined);
      return;
    }

    res.writeHeader('content-type', match.type);
    res.end(includeBody ? match.body : undefined);
  };

  app.get('/*', (res: any, req: any) => serveStatic(res, req, true));
  app.head('/*', (res: any, req: any) => serveStatic(res, req, false));

  app.listen(port, (token: unknown) => {
    if (!token) {
      console.error(`Failed to listen on http://localhost:${port}`);
      process.exitCode = 1;
      return;
    }

    console.log(`Private Video Chat listening on http://localhost:${port}`);
    console.log(`Serving ${staticCache.assets.size} cached static routes from ${staticRoot}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
