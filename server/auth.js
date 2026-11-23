'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./db');

// ---- Password hashing: scrypt with per-user random salt ----
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(password, stored) {
  try {
    const [alg, N, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}
// Burn comparable time when the user does not exist (reduces account-enumeration timing signal)
const DUMMY_HASH = hashPassword('dummy-password-for-timing');
function fakeVerify(password) { verifyPassword(password, DUMMY_HASH); }

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

// ---- One-time password-reset tokens. Only the hash is stored. ----
function issueToken(table, userId, ttlMs) {
  const token = newToken();
  const now = Date.now();
  // Invalidate any older unused tokens for this user
  store.run(`UPDATE ${table} SET used_at = ? WHERE user_id = ? AND used_at IS NULL`, now, userId);
  store.run(`INSERT INTO ${table} (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)`, sha256(token), userId, now + ttlMs, now);
  return token;
}
// Atomically consumes the token; returns user_id or null
function consumeToken(table, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const now = Date.now();
  const h = sha256(token);
  const r = store.run(`UPDATE ${table} SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`, now, h, now);
  if (!r.changes) return null;
  return store.get(`SELECT user_id FROM ${table} WHERE token_hash = ?`, h).user_id;
}
// Check without consuming (to show the reset form only for a live token)
function peekToken(table, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return false;
  return !!store.get(`SELECT 1 AS ok FROM ${table} WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`, sha256(token), Date.now());
}

// ---- Sessions ----
const COOKIE = 'rs_session';
function createSession(userId, remember) {
  const token = newToken();
  const ttl = remember ? cfg.rememberTtlMs : cfg.sessionTtlMs;
  const now = Date.now();
  store.run('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)', sha256(token), userId, now + ttl, now);
  return { token, ttl };
}
function cookieHeader(token, ttlMs, remember) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (remember) parts.push(`Max-Age=${Math.floor(ttlMs / 1000)}`);
  if (cfg.isProd || cfg.appUrl.startsWith('https://')) parts.push('Secure');
  return parts.join('; ');
}
function clearCookieHeader() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}
function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = store.get(
    `SELECT u.id, u.role, u.full_name, u.email, u.phone, u.status, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha256(token));
  if (!row || row.expires_at < Date.now() || row.status !== 'active') return null;
  return row;
}
function destroySession(req) {
  const token = parseCookies(req)[COOKIE];
  if (token) store.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}
function destroyUserSessions(userId, exceptReq) {
  if (exceptReq) {
    const t = parseCookies(exceptReq)[COOKIE];
    store.run('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?', userId, t ? sha256(t) : '');
  } else store.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

// ---- Simple in-memory rate limiter ----
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return b.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset < now) buckets.delete(k); }, 60000).unref();

module.exports = {
  hashPassword, verifyPassword, fakeVerify, sha256, newToken,
  issueToken, consumeToken, peekToken,
  createSession, cookieHeader, clearCookieHeader, currentUser, destroySession, destroyUserSessions,
  rateLimit,
};
