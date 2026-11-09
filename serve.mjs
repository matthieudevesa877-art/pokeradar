import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, relative, resolve, sep } from 'node:path';

const publicDir = fileURLToPath(new URL('./app/', import.meta.url));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

export function createAppServer() {
  return createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
      }
      const url = new URL(request.url, 'http://localhost');
      const file = resolve(publicDir, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      const path = relative(publicDir, file);
      if (!path || path === '..' || path.startsWith('..' + sep) || !mime[extname(file)]) {
        response.writeHead(404).end();
        return;
      }
      const entry = await stat(file);
      if (!entry.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': mime[extname(file)],
        'Content-Length': entry.size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache'
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      const stream = createReadStream(file);
      stream.on('error', () => response.destroy());
      stream.pipe(response);
    } catch {
      response.writeHead(404).end();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.POKERADAR_PORT ?? 4173);
  const host = process.env.POKERADAR_HOST ?? '127.0.0.1';
  createAppServer().listen(port, host, () => {
    process.stdout.write('PokéRadar est disponible à http://' + host + ':' + port + '/\n');
  });
}
