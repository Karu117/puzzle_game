import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load local env (e.g. Upstash credentials) before the store module reads process.env.
for (const file of ['.env.development.local', '.env.local', '.env']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(file, import.meta.url)));
  } catch {}
}
const { default: handler } = await import('./api/game.js');
const { default: pickleHandler } = await import('./api/pickle.js');

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const ROUTES = {
  '/': 'index.html',
  '/host': 'host.html',
  '/pickle': 'pickle/index.html',
  '/pickle/': 'pickle/index.html',
  '/pickle/host': 'pickle/host.html',
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/game') return handler(req, res);
  if (pathname === '/api/pickle') return pickleHandler(req, res);

  const file = ROUTES[pathname] || normalize(pathname).replace(/^(\.\.[/\\])+/, '').slice(1);
  try {
    const body = await readFile(join(PUBLIC_DIR, file));
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`O/X 퀴즈 배틀: http://localhost:${PORT}  (진행자: /host)`);
});
