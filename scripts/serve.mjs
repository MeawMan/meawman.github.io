#!/usr/bin/env node
// Zero-dependency static file server that mirrors GitHub Pages closely enough for audits.
//
//   node scripts/serve.mjs [--port 4173] [--root .] [--host 127.0.0.1] [--strict-port] [--quiet]
//
// - directory -> index.html (a directory URL without trailing slash is redirected, like Pages)
// - gzip for text types when the client accepts it
// - Cache-Control: max-age=600
// - unknown path -> /404.html with status 404
// - query strings and fragments are ignored when resolving files
//
// Also importable:  const { server, url, port, close } = await startServer({ port, root })

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.cff': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.zip': 'application/zip',
  '.whl': 'application/zip',
  '.py': 'text/x-python; charset=utf-8',
};

// Types worth compressing (GitHub Pages / Fastly gzip these).
const COMPRESSIBLE = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.geojson', '.webmanifest', '.map', '.svg',
  '.xml', '.txt', '.md', '.cff', '.csv', '.yml', '.yaml', '.wasm', '.py']);

function resolveFile(rootAbs, urlPath) {
  let pathname;
  try { pathname = decodeURIComponent(urlPath); } catch { return { status: 400 }; }
  if (pathname.includes('\0')) return { status: 400 };
  const abs = path.resolve(rootAbs, '.' + path.posix.normalize('/' + pathname.replace(/\\/g, '/')));
  // Path traversal guard: the resolved path must stay inside root.
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return { status: 403 };
  let st;
  try { st = fs.statSync(abs); } catch { return { status: 404 }; }
  if (st.isDirectory()) {
    if (!pathname.endsWith('/')) return { status: 301, location: pathname + '/' };
    const idx = path.join(abs, 'index.html');
    try { st = fs.statSync(idx); } catch { return { status: 404 }; }
    return { status: 200, file: idx, stat: st };
  }
  if (!st.isFile()) return { status: 404 };
  return { status: 200, file: abs, stat: st };
}

export function createHandler({ root = '.', quiet = true, log = console.log } = {}) {
  const rootAbs = path.resolve(root);
  const gzCache = new Map(); // file -> { mtimeMs, size, buf }

  function send(req, res, status, file, stat, extraHeaders = {}) {
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'max-age=600',
      'Last-Modified': stat.mtime.toUTCString(),
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    };
    const ims = req.headers['if-modified-since'];
    if (status === 200 && ims && Math.floor(stat.mtimeMs / 1000) <= Math.floor(new Date(ims).getTime() / 1000)) {
      res.writeHead(304, headers); res.end(); return 304;
    }
    const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
    if (COMPRESSIBLE.has(ext)) headers['Vary'] = 'Accept-Encoding';
    if (acceptsGzip && COMPRESSIBLE.has(ext) && stat.size > 256 && stat.size < 64 * 1024 * 1024) {
      let entry = gzCache.get(file);
      if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
        entry = { mtimeMs: stat.mtimeMs, size: stat.size, buf: zlib.gzipSync(fs.readFileSync(file), { level: 6 }) };
        gzCache.set(file, entry);
      }
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = entry.buf.length;
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : entry.buf);
      return status;
    }
    headers['Content-Length'] = stat.size;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') { res.end(); return status; }
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return status;
  }

  return function handler(req, res) {
    let status = 500;
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
        status = 405;
      } else {
        // Ignore query string and fragment when resolving files.
        const rawPath = String(req.url || '/').split('#')[0].split('?')[0] || '/';
        const query = String(req.url || '').includes('?') ? '?' + String(req.url).split('#')[0].split('?').slice(1).join('?') : '';
        const r = resolveFile(rootAbs, rawPath);
        if (r.status === 200) {
          status = send(req, res, 200, r.file, r.stat);
        } else if (r.status === 301) {
          res.writeHead(301, { Location: encodeURI(r.location) + query, 'Cache-Control': 'max-age=600' });
          res.end();
          status = 301;
        } else {
          const nf = path.join(rootAbs, '404.html');
          let st = null;
          try { st = fs.statSync(nf); } catch { /* no custom 404 page */ }
          if (st && st.isFile()) {
            // Never answer the 404 body with 304.
            delete req.headers['if-modified-since'];
            status = send(req, res, 404, nf, st);
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'max-age=600' });
            res.end(req.method === 'HEAD' ? undefined : '404 Not Found');
            status = 404;
          }
        }
      }
    } catch (err) {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('500 ' + (err && err.message));
      status = 500;
    }
    if (!quiet) log(`${status} ${req.method} ${req.url}`);
  };
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(server.address().port); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

/**
 * Start the static server.
 * @param {{port?: number, root?: string, host?: string, strictPort?: boolean, quiet?: boolean}} [opts]
 * @returns {Promise<{server: http.Server, url: string, port: number, root: string, close: () => Promise<void>}>}
 * If the requested port is busy (and strictPort is false) a free port is chosen instead.
 */
export async function startServer({ port = 4173, root = '.', host = '127.0.0.1', strictPort = false, quiet = true } = {}) {
  const rootAbs = path.resolve(root);
  if (!fs.existsSync(rootAbs) || !fs.statSync(rootAbs).isDirectory()) throw new Error(`serve: root is not a directory: ${rootAbs}`);
  const server = http.createServer(createHandler({ root: rootAbs, quiet }));
  let actual;
  try {
    actual = await listen(server, Number(port) || 0, host);
  } catch (err) {
    if (strictPort || (err.code !== 'EADDRINUSE' && err.code !== 'EACCES')) throw err;
    actual = await listen(server, 0, host);
  }
  const shownHost = host === '0.0.0.0' || host === '::' ? 'localhost' : (host.includes(':') ? `[${host}]` : host);
  const url = `http://${shownHost}:${actual}`;
  const close = () => new Promise((resolve) => {
    server.close(() => resolve());
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
  return { server, url, port: actual, root: rootAbs, close };
}

function parseCli(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const args = parseCli(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/serve.mjs [--port 4173] [--root .] [--host 127.0.0.1] [--strict-port] [--quiet]');
    process.exit(0);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = args.root && args.root !== true ? String(args.root) : (fs.existsSync(path.resolve('index.html')) ? '.' : path.resolve(here, '..'));
  try {
    const s = await startServer({
      port: args.port && args.port !== true ? Number(args.port) : 4173,
      root,
      host: args.host && args.host !== true ? String(args.host) : '127.0.0.1',
      strictPort: Boolean(args['strict-port']),
      quiet: Boolean(args.quiet),
    });
    console.log(`Serving ${s.root}`);
    console.log(`  ${s.url}/   (also http://localhost:${s.port}/)`);
    console.log('Press Ctrl+C to stop.');
    const stop = () => { s.close().then(() => process.exit(0)); setTimeout(() => process.exit(0), 500).unref(); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  } catch (err) {
    console.error('serve: ' + err.message);
    process.exit(1);
  }
}
