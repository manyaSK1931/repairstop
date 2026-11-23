'use strict';
// Minimal .env loader (no dependencies). Real environment variables win over .env.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(path.join(ROOT, '.env'));

const e = process.env;
const abs = (p, d) => path.resolve(ROOT, p || d);

module.exports = {
  ROOT,
  isProd: e.NODE_ENV === 'production',
  port: parseInt(e.PORT || '3000', 10),
  appUrl: (e.APP_URL || `http://localhost:${e.PORT || 3000}`).replace(/\/$/, ''),
  dbFile: abs(e.DB_FILE, './data/repairstop.db'),
  uploadDir: abs(e.UPLOAD_DIR, './data/uploads'),
  smtp: {
    host: e.SMTP_HOST || '',
    port: parseInt(e.SMTP_PORT || '587', 10),
    secure: e.SMTP_SECURE === 'true',
    user: e.SMTP_USER || '',
    pass: e.SMTP_PASS || '',
    from: e.MAIL_FROM || 'RepairStop <no-reply@localhost>',
  },
  admin: { email: e.ADMIN_EMAIL || '', password: e.ADMIN_PASSWORD || '', name: e.ADMIN_NAME || 'Administrator' },
  razorpay: { keyId: e.RAZORPAY_KEY_ID || '', keySecret: e.RAZORPAY_KEY_SECRET || '' },
  trustProxy: e.TRUST_PROXY === 'true',
  supportPhone: e.SUPPORT_PHONE || '',
  supportEmail: e.SUPPORT_EMAIL || '',
  resetTtlMs: 30 * 60 * 1000,
  sessionTtlMs: 12 * 60 * 60 * 1000,
  rememberTtlMs: 30 * 24 * 60 * 60 * 1000,
};
