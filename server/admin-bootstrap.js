'use strict';
// Creates an administrator account from explicit input. No default/hardcoded credentials exist.
const store = require('./db');
const auth = require('./auth');
const V = require('./validate');

function createAdmin({ email, password, name }) {
  email = V.normEmail(email);
  if (!V.EMAIL_RE.test(email)) throw new Error('Invalid admin email.');
  const problem = V.passwordProblem(password);
  if (problem) throw new Error('Admin password too weak: ' + problem);
  const existing = store.get('SELECT id, role FROM users WHERE email = ?', email);
  if (existing) { if (existing.role === 'admin') return { created: false }; throw new Error('That email belongs to a non-admin account.'); }
  store.tx(() => {
    const r = store.run("INSERT INTO users (role,full_name,email,phone,password_hash,created_at) VALUES ('admin',?,?,?,?,?)", V.str(name, 100) || 'Administrator', email, null, auth.hashPassword(password), Date.now());
    store.run('INSERT INTO admins (user_id) VALUES (?)', r.lastInsertRowid);
  });
  return { created: true };
}
module.exports = { createAdmin };
