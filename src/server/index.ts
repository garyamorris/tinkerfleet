import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';
import { isDevClientPath } from './http.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
const production = process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const port = Number(process.env.TINKERFLEET_PORT ?? 4317);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error('Choose a valid local port from 1024 to 65535.');
let serve: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
let closeVite: () => Promise<void> = async () => {};
if (!production) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  serve = (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    if (!isDevClientPath(url.pathname)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    req.url = url.pathname + url.search;
    vite.middlewares(req, res);
  };
  closeVite = () => vite.close();
} else {
  const root = path.resolve('dist');
  serve = async (req, res) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', `http://127.0.0.1:${port}`).pathname);
    } catch {
      res.statusCode = 400;
      res.end();
      return;
    }
    const file = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
    if (
      !/^[A-Za-z0-9_./-]+$/.test(file) ||
      file.split('/').some((p) => p === '..' || p.startsWith('.'))
    ) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const target = path.resolve(root, file);
    if (!target.startsWith(root + path.sep)) {
      res.statusCode = 404;
      res.end();
      return;
    }
    try {
      const contents = await readFile(target);
      const mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      res.setHeader('Content-Type', mime[path.extname(target)] ?? 'application/octet-stream');
      res.end(contents);
    } catch {
      res.statusCode = 404;
      res.end('Not found');
    }
  };
}
const app = createApp({
  port,
  production,
  serve,
  statePath: path.resolve('.tinkerfleet/conversations.json'),
});
app.server.listen(port, '127.0.0.1', () =>
  console.log(`Tinkerfleet is ready at http://127.0.0.1:${port} (${app.state().mode} mode).`),
);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      let exitCode = 1;
      try {
        const result = await app.close();
        if (!result.cleanupSucceeded)
          console.error(
            'Local command cleanup could not be confirmed. Inspect running commands before continuing.',
          );
        exitCode = result.cleanupSucceeded ? 0 : 1;
      } catch {
        console.error(
          'Shutdown encountered an error. Check local storage and running commands before continuing.',
        );
      } finally {
        try {
          await closeVite();
        } catch {
          exitCode = 1;
        }
        process.exit(exitCode);
      }
    })();
  });
