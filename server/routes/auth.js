'use strict';
const store = require('../db');
const auth = require('../auth');
const mail = require('../mail');
const cfg = require('../config');
const { router, guards } = require('../http');
const V = require('../validate');
const { HttpError } = V;

const HOME = { customer: '/customer', mechanic: '/mechanic', admin: '/admin' };
const publicUser = (u) => ({ id: u.id, role: u.role, fullName: u.full_name, email: u.email, phone: u.phone, home: HOME[u.role] });

function validateAccountFields(b, errors) {
  const out = { fullName: V.str(b.fullName, 100), email: V.normEmail(b.email), phone: V.normPhone(b.phone) };
  if (out.fullName.length < 2) errors.fullName = 'Enter your full name.';
  if (!V.EMAIL_RE.test(out.email)) errors.email = 'Enter a valid email address.';
  if (!V.PHONE_RE.test(out.phone)) errors.phone = 'Enter a valid phone number (10 to 13 digits).';
  const pw = V.passwordProblem(b.password);
  if (pw) errors.password = pw;
  else if (b.password !== b.confirmPassword) errors.confirmPassword = 'Passwords do not match.';
  return out;
}

router.post('/api/auth/register', async (ctx) => {
  if (!auth.rateLimit('reg:' + ctx.ip, 10, 3600e3)) throw new HttpError(429, 'Too many attempts. Try again later.');
  const errors = {};
  const f = validateAccountFields(ctx.body, errors);
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  if (store.get('SELECT 1 AS x FROM users WHERE email = ?', f.email)) throw new HttpError(409, 'This email is already registered.', { email: 'This email is already registered. Try logging in.' });
  store.tx(() => {
    const r = store.run('INSERT INTO users (role,full_name,email,phone,password_hash,created_at) VALUES (?,?,?,?,?,?)', 'customer', f.fullName, f.email, f.phone, auth.hashPassword(ctx.body.password), Date.now());
    store.run('INSERT INTO customers (user_id) VALUES (?)', r.lastInsertRowid);
  });
  return { ok: true, message: 'Account created. You can now log in.' };
});

router.post('/api/auth/login', async (ctx) => {
  const email = V.normEmail(ctx.body.email);
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  const errors = {};
  if (!V.EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  if (!password) errors.password = 'Enter your password.';
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  if (!auth.rateLimit(`login:${ctx.ip}:${email}`, 10, 15 * 60e3)) throw new HttpError(429, 'Too many login attempts. Please wait 15 minutes.');
  const u = store.get('SELECT * FROM users WHERE email = ?', email);
  const generic = new HttpError(401, 'Invalid email or password.');
  if (!u) { auth.fakeVerify(password); throw generic; }
  if (u.locked_until && u.locked_until > Date.now()) throw new HttpError(423, 'Account temporarily locked after repeated failed logins. Try again in a few minutes or reset your password.');
  if (!auth.verifyPassword(password, u.password_hash)) {
    const n = u.failed_logins + 1;
    store.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', n >= 5 ? 0 : n, n >= 5 ? Date.now() + 15 * 60e3 : null, u.id);
    throw generic;
  }
  if (u.status !== 'active') throw new HttpError(403, 'This account has been suspended. Contact support.');
  store.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', u.id);
  const remember = ctx.body.remember === true;
  const s = auth.createSession(u.id, remember);
  ctx.headers['Set-Cookie'] = auth.cookieHeader(s.token, s.ttl, remember);
  return { ok: true, user: publicUser(u), redirect: HOME[u.role] };
});

router.post('/api/auth/logout', (ctx) => {
  auth.destroySession(ctx.req);
  ctx.headers['Set-Cookie'] = auth.clearCookieHeader();
  return { ok: true };
});

router.get('/api/auth/me', (ctx) => ({ user: ctx.user ? publicUser(ctx.user) : null }));

// ---- Forgot / reset password ----
const FORGOT_MSG = 'If that email is registered, we have sent a password-reset link. It expires in 30 minutes.';
router.post('/api/auth/forgot', async (ctx) => {
  const email = V.normEmail(ctx.body.email);
  if (!V.EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address.', { email: 'Enter a valid email address.' });
  if (!auth.rateLimit('forgot:' + ctx.ip, 5, 3600e3) || !auth.rateLimit('forgot-email:' + email, 3, 3600e3)) return { ok: true, message: FORGOT_MSG };
  const u = store.get("SELECT id, full_name, email FROM users WHERE email = ? AND status = 'active'", email);
  if (u) {
    const token = auth.issueToken('password_reset_tokens', u.id, cfg.resetTtlMs);
    // Not awaited: response time must not reveal whether the email exists.
    mail.sendTemplate(u.email, mail.templates.reset(u.full_name, `${cfg.appUrl}/reset-password?token=${token}`, cfg.resetTtlMs / 60000))
      .catch((e) => console.error('[mail] reset email failed:', e.message));
  }
  return { ok: true, message: FORGOT_MSG };
});

router.get('/api/auth/reset-check', (ctx) => ({ valid: auth.peekToken('password_reset_tokens', ctx.query.token) }));

router.post('/api/auth/reset', async (ctx) => {
  const { token, password, confirmPassword } = ctx.body;
  const errors = {};
  const pw = V.passwordProblem(password);
  if (pw) errors.password = pw; else if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match.';
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  const uid = auth.consumeToken('password_reset_tokens', token);
  if (!uid) throw new HttpError(400, 'This reset link is invalid, already used, or has expired. Request a new one.');
  store.run('UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?', auth.hashPassword(password), uid);
  auth.destroyUserSessions(uid);
  const u = store.get('SELECT full_name, email FROM users WHERE id = ?', uid);
  mail.sendTemplate(u.email, mail.templates.passwordChanged(u.full_name)).catch((e) => console.error('[mail]', e.message));
  return { ok: true, message: 'Password updated. Please log in with your new password.' };
});

router.post('/api/auth/change-password', guards.anyUser, (ctx) => {
  const { currentPassword, newPassword, confirmPassword } = ctx.body;
  const u = store.get('SELECT * FROM users WHERE id = ?', ctx.user.id);
  if (!auth.verifyPassword(String(currentPassword || ''), u.password_hash)) throw new HttpError(400, 'Current password is incorrect.', { currentPassword: 'Current password is incorrect.' });
  const pw = V.passwordProblem(newPassword);
  if (pw) throw new HttpError(400, pw, { newPassword: pw });
  if (newPassword !== confirmPassword) throw new HttpError(400, 'Passwords do not match.', { confirmPassword: 'Passwords do not match.' });
  if (newPassword === currentPassword) throw new HttpError(400, 'Choose a password different from the current one.', { newPassword: 'Choose a different password.' });
  store.run('UPDATE users SET password_hash = ? WHERE id = ?', auth.hashPassword(newPassword), u.id);
  auth.destroyUserSessions(u.id, ctx.req);
  mail.sendTemplate(u.email, mail.templates.passwordChanged(u.full_name)).catch((e) => console.error('[mail]', e.message));
  return { ok: true, message: 'Password changed. Other devices have been logged out.' };
});

module.exports = { validateAccountFields, HOME };
