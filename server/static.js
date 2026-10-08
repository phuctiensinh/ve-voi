// Phục vụ giao diện tĩnh: ETag + gzip + header bảo mật (CSP, chống nhúng iframe, chống đoán MIME).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.json', '.webmanifest', '.txt']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(self), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '),
};

function createStatic(rootDir) {
  const root = path.resolve(rootDir);
  const cache = new Map();

  const load = (file, st) => {
    let entry = cache.get(file);
    if (entry && entry.mtimeMs === st.mtimeMs && entry.size === st.size) return entry;
    const body = fs.readFileSync(file);
    const ext = path.extname(file);
    entry = {
      mtimeMs: st.mtimeMs, size: st.size, body,
      gz: COMPRESSIBLE.has(ext) && body.length > 512 ? zlib.gzipSync(body) : null,
      etag: `"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 20)}"`,
      type: MIME[ext] || 'application/octet-stream',
    };
    cache.set(file, entry);
    return entry;
  };

  return function serve(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS });
      res.end();
      return;
    }
    let p;
    try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400, SECURITY_HEADERS); res.end(); return; }
    // Ký tự NUL / điều khiển trong đường dẫn: từ chối ngay (fs sẽ ném lỗi đồng bộ với byte NUL)
    if (/[\u0000-\u001f]/.test(p)) { res.writeHead(400, SECURITY_HEADERS); res.end(); return; }
    if (p === '/' || /^\/r\/[A-Za-z0-9]{6}\/?$/.test(p)) p = '/index.html';
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403, SECURITY_HEADERS); res.end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
        res.end('Không tìm thấy trang này.');
        return;
      }
      let entry;
      try { entry = load(file, st); } catch { res.writeHead(500); res.end(); return; }
      const headers = {
        'Content-Type': entry.type,
        'Cache-Control': 'no-cache',
        ETag: entry.etag,
        Vary: 'Accept-Encoding',
        ...SECURITY_HEADERS,
      };
      if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); res.end(); return; }
      const gzip = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
      const body = gzip ? entry.gz : entry.body;
      if (gzip) headers['Content-Encoding'] = 'gzip';
      headers['Content-Length'] = body.length;
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    });
  };
}

module.exports = { createStatic, SECURITY_HEADERS };
