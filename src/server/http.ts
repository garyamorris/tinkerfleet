import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
// Vite's dev root is the whole repository, which contains the default workspace and .tinkerfleet/.
// Forward only what the browser app loads, so workspace files and saved state are not served from this origin.
const DEV_CLIENT_PATH =
  /^\/(?:index\.html|@vite\/client|src\/(?:client|shared)\/[A-Za-z0-9_./-]+|node_modules\/(?:\.vite\/deps|vite\/dist\/client)\/[A-Za-z0-9_.-]+)?$/;
export function isDevClientPath(pathname: string) {
  return DEV_CLIENT_PATH.test(pathname) && !pathname.split('/').includes('..');
}
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function createSecurity(port: number) {
  const csrf = randomBytes(32).toString('hex'),
    session = randomBytes(32).toString('hex');
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([...hosts].map((h) => `http://${h}`));
  // Browsers share cookies across localhost ports, so name the cookie per port to keep two servers apart.
  const cookieName = `tinkerfleet_session_${port}`;
  return {
    headers(res: ServerResponse, production: boolean) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Security-Policy',
        `default-src 'self'; script-src 'self'${production ? '' : " 'unsafe-inline'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
      );
    },
    check(req: IncomingMessage, authenticated = true, allowDocumentNavigation = false) {
      if (!hosts.has(req.headers.host ?? ''))
        throw new HttpError(403, 'Unrecognized localhost host.');
      const origin = req.headers.origin;
      if (origin && !origins.has(origin))
        throw new HttpError(403, 'Cross-origin requests are blocked.');
      // A linked top-level page may load the public shell; API and subresource requests stay restricted.
      const documentNavigation =
        allowDocumentNavigation &&
        req.method === 'GET' &&
        req.headers['sec-fetch-mode'] === 'navigate' &&
        req.headers['sec-fetch-dest'] === 'document';
      const site = req.headers['sec-fetch-site'];
      if ((site === 'cross-site' || site === 'same-site') && !documentNavigation)
        throw new HttpError(403, 'Only this app can access the local API.');
      if (!authenticated) return;
      const cookie =
        (req.headers.cookie ?? '')
          .split(';')
          .map((s) => s.trim())
          .find((s) => s.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1) ?? '';
      if (!safeEqual(cookie, session))
        throw new HttpError(401, 'Session expired. Reload the page.');
      if (
        req.method !== 'GET' &&
        (!origin || !safeEqual(String(req.headers['x-tinkerfleet-csrf'] ?? ''), csrf))
      )
        throw new HttpError(403, 'A same-origin approval is required.');
    },
    bootstrap(res: ServerResponse) {
      res.setHeader('Set-Cookie', `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/api`);
      return { csrf };
    },
  };
}
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json'))
    throw new HttpError(415, 'JSON is required.');
  if (Number(req.headers['content-length'] ?? 0) > 32768) {
    req.resume();
    throw new HttpError(413, 'Request is too large.');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 32768) {
        req.off('data', onData);
        req.resume();
        reject(new HttpError(413, 'Request is too large.'));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.once('end', resolve);
    req.once('error', reject);
    req.once('aborted', () => reject(new HttpError(400, 'Request interrupted.')));
  });
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Invalid JSON object.');
  }
}
export function json(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}
