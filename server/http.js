'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const auth = require('./auth');
const { HttpError } = require('./validate');

const routes = [];
function add(method, pattern, guard, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, guard, handler, bodyLimit: opts.bodyLimit || 64 * 1024 });
}
const router = {};
for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
  router[m.toLowerCase()] = (pattern, guard, handler, opts) => {
    if (typeof guard === 'function' && handler === undefined) { handler = guard; guard = null; }
    add(m, pattern, guard, handler, opts);
  };
}

// ---- Guards ----
const requireRole = (...roles) => (ctx) => {
  if (!ctx.user) throw new HttpError(401, 'Please log in to continue.');
  if (!roles.includes(ctx.user.role)) throw new HttpError(403, 'You do not have access to this resource.');
};
const guards = { customer: requireRole('customer'), mechanic: requireRole('mechanic'), admin: requireRole('admin'), anyUser: requireRole('customer', 'mechanic', 'admin') };

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        if (!chunks.over) { chunks.over = true; chunks.length = 0; reject(new HttpError(413, 'Request too large.')); }
        return;                                   // discard the rest; the socket is closed after the 413 is sent
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); }
      catch { reject(new HttpError(400, 'Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' https://nominatim.openstreetmap.org https://overpass-api.de https://lumberjack.razorpay.com",
    "frame-src https://api.razorpay.com",
    "form-action 'self'", "base-uri 'self'", "frame-ancestors 'none'",
  ].join('; '),
};
if (cfg.isProd || cfg.appUrl.startsWith('https://')) SECURITY_HEADERS['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': isBuf || typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Content-Length': data.length, ...headers,
  });
  res.end(data);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
const PUBLIC = path.join(cfg.ROOT, 'public');
// Friendly URLs -> html files
const PAGES = new Set(['login', 'register', 'forgot-password', 'reset-password', 'partner', 'book', 'customer', 'mechanic', 'admin', 'police', 'terms', 'privacy', 'contact']);

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const name = rel.replace(/^\//, '');
  if (PAGES.has(name)) rel = `/${name}.html`;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, notFoundPage());
    const ext = path.extname(file);
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
  });
}
const notFoundPage = () => '<!doctype html><meta charset="utf-8"><title>Not found</title><body style="font-family:sans-serif;background:#F6F4EF;padding:64px"><h1>Page not found</h1><p><a href="/">Back to RepairStop</a></p>';

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (!pathname.startsWith('/api/') && !pathname.startsWith('/files/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
      return serveStatic(req, res, pathname);
    }
    const route = routes.find((r) => r.method === req.method && r.re.test(pathname));
    if (!route) {
      if (routes.some((r) => r.re.test(pathname))) throw new HttpError(405, 'Method not allowed.');
      throw new HttpError(404, 'Not found.');
    }
    // CSRF: state-changing calls must carry a custom header (cannot be set cross-site without CORS) and a same-origin Origin.
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked.');
      if (req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Missing request header.');
    }
    const m = route.re.exec(pathname);
    const params = {}; route.keys.forEach((k, i) => { params[k] = m[i + 1]; });
    const query = Object.fromEntries(url.searchParams);
    const body = req.method === 'GET' ? {} : await readBody(req, route.bodyLimit);
    const ctx = { req, res, params, query, body, user: auth.currentUser(req), ip: (cfg.trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '', headers: {} };
    if (route.guard) route.guard(ctx);
    const result = await route.handler(ctx);
    if (result && result.__raw) return send(res, result.status || 200, result.body, result.headers);
    return send(res, 200, result === undefined ? { ok: true } : result, ctx.headers);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 413) { res.once('finish', () => req.socket.destroy()); return send(res, 413, { error: err.message }, { Connection: 'close' }); }
      return send(res, err.status, { error: err.message, fields: err.fields });
    }
    console.error('[error]', req.method, pathname, err);           // details stay in server logs only
    return send(res, 500, { error: 'Something went wrong. Please try again.' });
  }
}

module.exports = { router, guards, handle, send, raw: (body, headers, status) => ({ __raw: true, body, headers, status }) };
