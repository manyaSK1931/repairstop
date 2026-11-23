'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const H = require('./helpers');

let smtp, server, base, store;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64').toString('base64');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const CUST = { fullName: 'Asha Rao', email: 'Asha@Example.com', phone: '9876543210', password: 'Strong#Pass1', confirmPassword: 'Strong#Pass1' };
const MECH = { fullName: 'Ravi Kumar', email: 'ravi@garage.test', phone: '9123456780', password: 'Garage#Pass1', confirmPassword: 'Garage#Pass1',
  garageName: 'Ravi Auto Works', address: '12 MG Road, Bengaluru', city: 'Bengaluru', experienceYears: 8, lat: 12.98, lng: 77.6,
  services: [{ slug: 'tyre-puncture', price: 350 }, { slug: 'battery-jump-start', price: 400 }], documents: [{ kind: 'id_proof', filename: 'id.png', mime: 'image/png', data: PNG }, { kind: 'garage_license', filename: 'lic.pdf', mime: 'application/pdf', data: PDF }] };
const ADMIN = { email: 'admin@repairstop.test', password: 'Admin#Pass123' };
const LOC = { lat: 12.9716, lng: 77.5946 };

const lastMail = (to) => [...smtp.messages].reverse().find((m) => m.to.toLowerCase() === to.toLowerCase());
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  smtp = await H.startFakeSmtp();
  Object.assign(process.env, {
    DB_FILE: path.join(H.tmp, 't.db'), UPLOAD_DIR: path.join(H.tmp, 'up'), APP_URL: 'http://localhost:3999',
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_SECURE: 'false', SMTP_USER: 'smtp-user', SMTP_PASS: 'smtp-pass', MAIL_FROM: 'RepairStop <no-reply@repairstop.test>',
    ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'test_secret_xyz',
  });
  store = require('../server/db');
  server = await require('../server/index').start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); smtp.server.close(); setTimeout(() => process.exit(0), 50).unref(); });

const cust = () => H.client(base);
let C, M, A, P;   // clients: customer, mechanic, admin, anonymous

test('static pages and security headers', async () => {
  P = H.client(base);
  for (const p of ['/', '/login', '/register', '/forgot-password', '/reset-password', '/partner', '/book', '/customer', '/mechanic', '/admin', '/police', '/terms', '/privacy', '/contact']) {
    const r = await P.get(p); assert.equal(r.status, 200, p + ' should be served');
  }
  assert.equal((await P.get('/verify-email')).status, 404);
  const r = await P.get('/');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal((await P.get('/../server/config.js')).status, 404);
  assert.equal((await P.get('/%2e%2e/server/config.js')).status, 404);
  assert.equal((await P.get('/.env')).status, 404);
});

test('CSRF: state-changing calls need the custom header and same origin', async () => {
  const noHeader = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  const badOrigin = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(badOrigin.status, 403);
});

test('registration validation', async () => {
  C = cust();
  let r = await C.post('/api/auth/register', { ...CUST, email: 'nope' }); assert.equal(r.status, 400); assert.ok(r.body.fields.email);
  r = await C.post('/api/auth/register', { ...CUST, password: 'weak', confirmPassword: 'weak' }); assert.ok(r.body.fields.password);
  r = await C.post('/api/auth/register', { ...CUST, confirmPassword: 'Different#1' }); assert.ok(r.body.fields.confirmPassword);
  r = await C.post('/api/auth/register', { ...CUST, phone: '12' }); assert.ok(r.body.fields.phone);
  r = await C.post('/api/auth/register', { ...CUST, fullName: '' }); assert.ok(r.body.fields.fullName);
});

test('registration stores a hashed password and does not require email or SMTP verification', async () => {
  const mailCount = smtp.messages.length;
  const r = await C.post('/api/auth/register', CUST);
  assert.equal(r.status, 200); assert.equal(r.body.emailSent, undefined);
  assert.match(r.body.message, /now log in/);
  const u = store.get('SELECT * FROM users WHERE email = ?', 'asha@example.com');
  assert.ok(u.password_hash.startsWith('scrypt$')); assert.ok(!u.password_hash.includes(CUST.password));
  assert.equal(smtp.messages.length, mailCount, 'registration sends no email');
  assert.equal((await C.post('/api/auth/verify', { token: 'x'.repeat(43) })).status, 404);
  assert.equal((await C.post('/api/auth/resend-verification', { email: CUST.email })).status, 404);
  const login = await C.post('/api/auth/login', { email: CUST.email, password: CUST.password });
  assert.equal(login.status, 200); assert.equal(login.body.redirect, '/customer');
});

test('duplicate email is rejected (case-insensitive)', async () => {
  const r = await cust().post('/api/auth/register', { ...CUST, email: 'ASHA@example.com' });
  assert.equal(r.status, 409);
});

test('invalid login attempts give a generic error', async () => {
  let r = await C.post('/api/auth/login', { email: CUST.email, password: 'Wrong#Pass1' });
  assert.equal(r.status, 401); assert.equal(r.body.error, 'Invalid email or password.');
  r = await C.post('/api/auth/login', { email: 'ghost@example.com', password: 'Wrong#Pass1' });
  assert.equal(r.status, 401); assert.equal(r.body.error, 'Invalid email or password.');
  r = await C.post('/api/auth/login', { email: 'bad', password: '' }); assert.equal(r.status, 400);
});

test('login works, sets an HttpOnly session cookie, and redirects to the customer dashboard', async () => {
  const r = await C.post('/api/auth/login', { email: 'asha@example.com', password: CUST.password, remember: true });
  assert.equal(r.status, 200); assert.equal(r.body.redirect, '/customer');
  const sc = r.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Lax/); assert.match(sc, /Max-Age=/);
  assert.equal((await C.get('/api/auth/me')).body.user.email, 'asha@example.com');
  assert.equal((await C.get('/api/customer/profile')).status, 200);
});

test('role-based authorization', async () => {
  assert.equal((await C.get('/api/admin/stats')).status, 403);
  assert.equal((await C.get('/api/mechanic/profile')).status, 403);
  assert.equal((await P.get('/api/customer/profile')).status, 401);
  assert.equal((await P.get('/api/admin/stats')).status, 401);
});

test('forgot password: same response for known and unknown emails, email carries a link (never the password)', async () => {
  const before = smtp.messages.length;
  const known = await P.post('/api/auth/forgot', { email: 'asha@example.com' });
  const unknown = await P.post('/api/auth/forgot', { email: 'nobody@example.com' });
  assert.deepEqual(known.body, unknown.body);
  assert.equal((await P.post('/api/auth/forgot', { email: 'not-an-email' })).status, 400);
  await wait(300);
  assert.equal(smtp.messages.length, before + 1, 'only the registered address received mail');
  const { subject, text } = H.bodyOf(lastMail('asha@example.com').raw);
  assert.match(subject, /Reset/); assert.match(text, /\/reset-password\?token=/); assert.ok(!text.includes(CUST.password));
});

test('reset: weak/mismatched passwords rejected, token works once, old password stops working, sessions revoked', async () => {
  const token = H.tokenIn(H.bodyOf(lastMail('asha@example.com').raw).text);
  assert.equal((await P.get('/api/auth/reset-check?token=' + token)).body.valid, true);
  assert.equal((await P.get('/api/auth/reset-check?token=bogus')).body.valid, false);
  assert.equal((await P.post('/api/auth/reset', { token, password: 'weak', confirmPassword: 'weak' })).status, 400);
  assert.equal((await P.post('/api/auth/reset', { token, password: 'New#Password9', confirmPassword: 'Mismatch#9' })).status, 400);
  assert.equal((await P.post('/api/auth/reset', { token: 'y'.repeat(43), password: 'New#Password9', confirmPassword: 'New#Password9' })).status, 400);
  const ok = await P.post('/api/auth/reset', { token, password: 'New#Password9', confirmPassword: 'New#Password9' });
  assert.equal(ok.status, 200);
  assert.equal((await P.post('/api/auth/reset', { token, password: 'Another#Pass9', confirmPassword: 'Another#Pass9' })).status, 400, 'token invalidated after use');
  assert.equal((await C.get('/api/customer/profile')).status, 401, 'existing sessions were revoked');
  assert.equal((await C.post('/api/auth/login', { email: CUST.email, password: CUST.password })).status, 401, 'old password rejected');
  assert.equal((await C.post('/api/auth/login', { email: CUST.email, password: 'New#Password9' })).status, 200, 'new password works');
  await wait(200);
  assert.match(H.bodyOf(lastMail('asha@example.com').raw).subject, /changed/);
});

test('expired reset token is rejected', async () => {
  await P.post('/api/auth/forgot', { email: 'asha@example.com' }); await wait(300);
  const token = H.tokenIn(H.bodyOf(lastMail('asha@example.com').raw).text);
  store.run('UPDATE password_reset_tokens SET expires_at = ?', Date.now() - 1000);
  assert.equal((await P.post('/api/auth/reset', { token, password: 'Expired#Pass9', confirmPassword: 'Expired#Pass9' })).status, 400);
});

test('logout destroys the session', async () => {
  assert.equal((await C.post('/api/auth/logout')).status, 200);
  assert.equal((await C.get('/api/customer/profile')).status, 401);
  await C.post('/api/auth/login', { email: CUST.email, password: 'New#Password9' });
});

test('account lockout after repeated failures', async () => {
  const L = cust();
  await L.post('/api/auth/register', { ...CUST, email: 'lock@example.com' });
  for (let i = 0; i < 5; i++) await L.post('/api/auth/login', { email: 'lock@example.com', password: 'Bad#Pass123' });
  const r = await L.post('/api/auth/login', { email: 'lock@example.com', password: CUST.password });
  assert.equal(r.status, 423);
});

test('change password requires the current password and revokes other sessions', async () => {
  const other = cust(); await other.post('/api/auth/login', { email: CUST.email, password: 'New#Password9' });
  assert.equal((await C.post('/api/auth/change-password', { currentPassword: 'wrong', newPassword: 'Third#Pass99', confirmPassword: 'Third#Pass99' })).status, 400);
  assert.equal((await C.post('/api/auth/change-password', { currentPassword: 'New#Password9', newPassword: 'Third#Pass99', confirmPassword: 'Third#Pass99' })).status, 200);
  assert.equal((await C.get('/api/customer/profile')).status, 200, 'current session kept');
  assert.equal((await other.get('/api/customer/profile')).status, 401, 'other device logged out');
});

test('partner registration validates, stores documents privately, and starts as pending', async () => {
  const mailCount = smtp.messages.filter((m) => m.to.toLowerCase() === 'ravi@garage.test').length;
  M = cust();
  let r = await M.post('/api/partner/register', { ...MECH, documents: [] }); assert.equal(r.status, 400); assert.ok(r.body.fields.documents);
  r = await M.post('/api/partner/register', { ...MECH, services: [] }); assert.ok(r.body.fields.services);
  r = await M.post('/api/partner/register', { ...MECH, lat: undefined }); assert.equal(r.status, 400);
  r = await M.post('/api/partner/register', { ...MECH, documents: [{ kind: 'id_proof', filename: 'x.png', mime: 'image/png', data: Buffer.from('not an image').toString('base64') }] });
  assert.equal(r.status, 400); assert.match(r.body.error, /does not match/);
  assert.equal(store.get("SELECT COUNT(*) AS n FROM users WHERE email='ravi@garage.test'").n, 0, 'failed registration leaves nothing behind');
  r = await M.post('/api/partner/register', MECH); assert.equal(r.status, 200);
  assert.equal(smtp.messages.filter((m) => m.to.toLowerCase() === 'ravi@garage.test').length, mailCount, 'partner registration sends no email');
  const m = store.get("SELECT verification_status FROM mechanics m JOIN users u ON u.id=m.user_id WHERE u.email='ravi@garage.test'");
  assert.equal(m.verification_status, 'pending');
  const login = await M.post('/api/auth/login', { email: MECH.email, password: MECH.password });
  assert.equal(login.body.redirect, '/mechanic');
});

test('pending mechanic is invisible to customers and cannot take jobs', async () => {
  const r = await P.get(`/api/public/mechanics?lat=${LOC.lat}&lng=${LOC.lng}`);
  assert.equal(r.body.mechanics.length, 0);
  assert.equal((await M.post('/api/mechanic/availability', { available: true })).status, 403);
  assert.equal((await M.get('/api/mechanic/jobs/available')).status, 403);
  assert.equal((await M.get('/api/mechanic/profile')).body.profile.verificationStatus, 'pending');
});

test('admin: login, stats, verification queue, document access control', async () => {
  A = cust();
  const login = await A.post('/api/auth/login', { email: ADMIN.email, password: ADMIN.password });
  assert.equal(login.body.redirect, '/admin');
  assert.equal((await A.get('/api/admin/stats')).body.pendingVerifications, 1);
  const list = (await A.get('/api/admin/mechanics?status=pending')).body.mechanics; assert.equal(list.length, 1);
  const detail = (await A.get('/api/admin/mechanics/' + list[0].id)).body.mechanic;
  assert.equal(detail.documents.length, 2);
  const doc = await A.get('/files/' + detail.documents[0].id);
  assert.equal(doc.status, 200); assert.equal(doc.headers.get('content-type'), 'image/png');
  assert.equal((await C.get('/files/' + detail.documents[0].id)).status, 403, 'customers cannot read mechanic documents');
  assert.equal((await P.get('/files/' + detail.documents[0].id)).status, 401);
  assert.equal((await M.get('/files/' + detail.documents[0].id)).status, 200, 'owner can read own documents');
});

test('admin must give a reason to reject; approval emails the mechanic', async () => {
  const id = store.get("SELECT id FROM users WHERE email='ravi@garage.test'").id;
  assert.equal((await A.post(`/api/admin/mechanics/${id}/verify`, { decision: 'reject' })).status, 400);
  assert.equal((await A.post(`/api/admin/mechanics/${id}/verify`, { decision: 'approve' })).status, 200);
  await wait(200);
  assert.match(H.bodyOf(lastMail('ravi@garage.test').raw).subject, /approved/);
  assert.equal((await A.get('/api/admin/stats')).body.mechanics, 1);
});

test('mechanic goes available and appears in nearby search with real data (no fake entries)', async () => {
  assert.equal((await M.post('/api/mechanic/availability', { available: true })).status, 200);
  const r = (await P.get(`/api/public/mechanics?lat=${LOC.lat}&lng=${LOC.lng}&service=tyre-puncture`)).body.mechanics;
  assert.equal(r.length, 1);
  assert.equal(r[0].garageName, 'Ravi Auto Works'); assert.equal(r[0].startingPrice, 350); assert.ok(r[0].distanceKm > 0 && r[0].distanceKm < 3); assert.ok(r[0].etaMinutes >= 5);
  assert.equal(r[0].rating, null, 'no rating until a real review exists');
  assert.equal((await P.get(`/api/public/mechanics?lat=${LOC.lat}&lng=${LOC.lng}&service=towing`)).body.mechanics.length, 0, 'service not offered');
  assert.equal((await P.get(`/api/public/mechanics?lat=28.6&lng=77.2`)).body.mechanics.length, 0, 'out of radius');
  assert.equal((await P.get('/api/public/mechanics')).status, 400);
  const d = (await P.get('/api/public/mechanics/' + r[0].id)).body.mechanic;
  assert.equal(d.services.length, 2); assert.ok(!('email' in d) && !('phone' in d));
});

let bookingId;
test('customer books a selected mechanic; validation and ownership', async () => {
  assert.equal((await C.post('/api/customer/bookings', { serviceSlug: 'tyre-puncture', lat: LOC.lat, lng: LOC.lng })).status, 400);
  assert.equal((await P.post('/api/customer/bookings', {})).status, 401);
  const mid = store.get("SELECT id FROM users WHERE email='ravi@garage.test'").id;
  assert.equal((await C.post('/api/customer/bookings', { serviceSlug: 'towing', mechanicId: mid, ...LOC, address: 'MG Road' })).status, 409, 'mechanic does not offer towing');
  const r = await C.post('/api/customer/bookings', { serviceSlug: 'tyre-puncture', mechanicId: mid, ...LOC, address: 'Near MG Road metro', vehicle: 'Swift KA01', notes: 'rear left flat' });
  assert.equal(r.status, 200); bookingId = r.body.booking.id;
  assert.equal(r.body.booking.status, 'pending_mechanic'); assert.equal(r.body.booking.visitFee, 350);
  assert.equal(r.body.booking.otp, undefined, 'no OTP before acceptance');
  const other = cust();   await other.post('/api/auth/register', { ...CUST, email: 'other@example.com' });
  await other.post('/api/auth/login', { email: 'other@example.com', password: CUST.password });
  assert.equal((await other.get('/api/customer/bookings/' + bookingId)).status, 404, 'other customers cannot see it');
});

test('mechanic sees the request without the exact address until accepting', async () => {
  const jobs = (await M.get('/api/mechanic/jobs/available')).body.jobs;
  assert.equal(jobs.length, 1); assert.equal(jobs[0].directRequest, true); assert.equal(jobs[0].address, undefined); assert.equal(jobs[0].customerPhone, undefined);
  assert.equal(jobs[0].customerFirstName, 'Asha');
});

test('accept -> OTP issued to customer only; wrong OTP rejected; location is shared live', async () => {
  const acc = await M.post(`/api/mechanic/bookings/${bookingId}/accept`); assert.equal(acc.status, 200);
  assert.equal(acc.body.booking.otp, undefined, 'mechanic never sees the OTP');
  assert.equal(acc.body.booking.address, 'Near MG Road metro', 'address revealed after accepting');
  const cv = (await C.get('/api/customer/bookings/' + bookingId)).body.booking;
  assert.match(cv.otp, /^\d{4}$/); assert.equal(cv.status, 'accepted'); assert.equal(cv.mechanic.garageName, 'Ravi Auto Works');
  assert.equal((await M.post(`/api/mechanic/bookings/${bookingId}/start`, { otp: '0000' })).status, 409, 'cannot start before arriving');
  assert.equal((await M.post('/api/mechanic/location', { lat: 12.975, lng: 77.597 })).status, 200);
  assert.equal((await M.post(`/api/mechanic/bookings/${bookingId}/status`, { status: 'en_route' })).status, 200);
  const live = (await C.get('/api/customer/bookings/' + bookingId)).body.booking;
  assert.equal(live.status, 'en_route'); assert.ok(live.mechanicLocation && live.etaMinutes >= 5);
  assert.equal((await M.post(`/api/mechanic/bookings/${bookingId}/status`, { status: 'arrived' })).status, 200);
  const wrong = cv.otp === '0000' ? '1111' : '0000';
  const bad = await M.post(`/api/mechanic/bookings/${bookingId}/start`, { otp: wrong }); assert.equal(bad.status, 400);
  assert.equal((await C.post(`/api/customer/bookings/${bookingId}/cancel`, {})).status, 409, 'cannot cancel after the mechanic arrived');
});

test('OTP start: lock-out after 5 wrong codes is per booking; correct code starts inspection', async () => {
  const otp = store.get('SELECT otp FROM bookings WHERE id = ?', bookingId).otp;
  assert.equal((await M.post(`/api/mechanic/bookings/${bookingId}/start`, { otp: 'abcd' })).status, 400);
  const r = await M.post(`/api/mechanic/bookings/${bookingId}/start`, { otp });
  assert.equal(r.status, 200); assert.equal(r.body.booking.status, 'inspecting');
  assert.equal((await C.get('/api/customer/bookings/' + bookingId)).body.booking.otp, undefined, 'OTP hidden after use');
});

test('OTP brute force is capped', async () => {
  const mid = store.get("SELECT id FROM users WHERE email='ravi@garage.test'").id;
  const b = (await C.post('/api/customer/bookings', { serviceSlug: 'battery-jump-start', mechanicId: mid, ...LOC, address: 'Test road' })).body.booking;
  await M.post(`/api/mechanic/bookings/${b.id}/accept`); await M.post(`/api/mechanic/bookings/${b.id}/status`, { status: 'arrived' });
  const real = store.get('SELECT otp FROM bookings WHERE id=?', b.id).otp;
  const guesses = ['0001', '0002', '0003', '0004', '0005'].map((g) => (g === real ? '9999' : g));
  for (const g of guesses) await M.post(`/api/mechanic/bookings/${b.id}/start`, { otp: g });
  const r = await M.post(`/api/mechanic/bookings/${b.id}/start`, { otp: real });
  assert.equal(r.status, 423, 'even the right code is refused after 5 failures');
  assert.equal((await C.post(`/api/customer/bookings/${b.id}/cancel`, {})).status, 200, 'customer can cancel when the OTP is locked, so nobody is stuck');
});

test('repair photos: images only, visible to customer, hidden from strangers', async () => {
  assert.equal((await M.post(`/api/mechanic/bookings/${bookingId}/photos`, { filename: 'a.pdf', mime: 'application/pdf', data: PDF })).status, 400);
  const up = await M.post(`/api/mechanic/bookings/${bookingId}/photos`, { filename: 'tyre.png', mime: 'image/png', data: PNG, caption: 'Nail in tread' });
  assert.equal(up.status, 200);
  const photos = (await C.get('/api/customer/bookings/' + bookingId)).body.booking.photos; assert.equal(photos.length, 1);
  assert.equal((await C.get('/files/' + photos[0].id)).status, 200);
  const stranger = cust(); await stranger.post('/api/auth/login', { email: 'other@example.com', password: CUST.password });
  assert.equal((await stranger.get('/files/' + photos[0].id)).status, 403);
});

test('estimate -> customer approval -> completion (inspect first, price after)', async () => {
  assert.equal((await M.post(`/api/mechanic/bookings/${bookingId}/estimate`, { amount: 0, notes: '' })).status, 400);
  assert.equal((await M.post(`/api/mechanic/bookings/${bookingId}/estimate`, { amount: 900, notes: 'Replace tube and patch rim' })).status, 200);
  assert.equal((await M.post(`/api/mechanic/bookings/${bookingId}/complete`)).status, 409, 'cannot finish before the customer decides');
  assert.equal((await M.post(`/api/customer/bookings/${bookingId}/estimate`, { approve: true })).status, 403, 'mechanics cannot approve their own quote');
  const r = await C.post(`/api/customer/bookings/${bookingId}/estimate`, { approve: true });
  assert.equal(r.body.booking.status, 'in_progress'); assert.equal(r.body.booking.totalDue, 350 + 900);
  assert.equal((await C.post(`/api/customer/bookings/${bookingId}/pay`, { method: 'cash' })).status, 409, 'cannot pay before completion');
  assert.equal((await M.post(`/api/mechanic/bookings/${bookingId}/complete`)).status, 200);
});

test('online payment: provider failure is handled; signature verification is enforced', async () => {
  const pay = require('../server/payments');
  const r = await C.post(`/api/customer/bookings/${bookingId}/pay`, { method: 'online' });
  assert.ok([502, 200].includes(r.status), 'sandbox has no network: expect a clean 502, not a crash');
  // Simulate what Razorpay Checkout returns, signed with the key secret
  store.run("UPDATE payments SET status='failed' WHERE booking_id=?", bookingId);
  store.run("INSERT INTO payments (booking_id,amount,method,status,provider_order_id,created_at) VALUES (?,?, 'online','created','order_TEST1',?)", bookingId, 1250, Date.now());
  const sig = crypto.createHmac('sha256', 'test_secret_xyz').update('order_TEST1|pay_TEST1').digest('hex');
  assert.equal(pay.verifySignature('order_TEST1', 'pay_TEST1', sig), true);
  assert.equal(pay.verifySignature('order_TEST1', 'pay_TEST1', sig.replace(/.$/, '0')), false);
  let v = await C.post(`/api/customer/bookings/${bookingId}/pay/verify`, { razorpay_order_id: 'order_TEST1', razorpay_payment_id: 'pay_TEST1', razorpay_signature: 'forged' });
  assert.equal(v.status, 400); assert.equal(store.get('SELECT status FROM bookings WHERE id=?', bookingId).status, 'completed');
  v = await C.post(`/api/customer/bookings/${bookingId}/pay/verify`, { razorpay_order_id: 'order_TEST1', razorpay_payment_id: 'pay_TEST1', razorpay_signature: sig });
  assert.equal(v.status, 200); assert.equal(store.get('SELECT status FROM bookings WHERE id=?', bookingId).status, 'paid');
  assert.equal((await C.post(`/api/customer/bookings/${bookingId}/pay/verify`, { razorpay_order_id: 'order_TEST1', razorpay_payment_id: 'pay_TEST1', razorpay_signature: sig })).status, 400, 'a payment cannot be replayed');
});

test('payment history and mechanic earnings reflect the paid job', async () => {
  const p = (await C.get('/api/customer/payments')).body.payments; assert.equal(p.length, 1); assert.equal(p[0].amount, 1250);
  const e = (await M.get('/api/mechanic/earnings')).body; assert.equal(e.totalEarned, 1250); assert.equal(e.paidJobs, 1);
});

test('reviews: only for completed jobs, once, public with first name only, admin can hide', async () => {
  assert.equal((await C.post(`/api/customer/bookings/${bookingId}/review`, { rating: 9 })).status, 400);
  assert.equal((await P.post(`/api/customer/bookings/${bookingId}/review`, { rating: 5 })).status, 401);
  assert.equal((await C.post(`/api/customer/bookings/${bookingId}/review`, { rating: 5, comment: 'Arrived fast and explained the quote.' })).status, 200);
  assert.equal((await C.post(`/api/customer/bookings/${bookingId}/review`, { rating: 1, comment: 'again' })).status, 409);
  const pub = (await P.get('/api/public/reviews')).body.reviews;
  assert.equal(pub.length, 1); assert.equal(pub[0].name, 'Asha'); assert.equal(pub[0].city, 'Bengaluru');
  const stats = (await P.get('/api/public/stats')).body; assert.equal(stats.averageRating, 5); assert.equal(stats.verifiedMechanics, 1);
  const search = (await P.get(`/api/public/mechanics?lat=${LOC.lat}&lng=${LOC.lng}`)).body.mechanics[0]; assert.equal(search.rating, 5);
  const rid = (await A.get('/api/admin/reviews')).body.reviews[0].id;
  assert.equal((await A.patch('/api/admin/reviews/' + rid, { status: 'hidden' })).status, 200);
  assert.equal((await P.get('/api/public/reviews')).body.reviews.length, 0);
  assert.equal((await P.get('/api/public/stats')).body.averageRating, null);
  await A.patch('/api/admin/reviews/' + rid, { status: 'visible' });
});

test('open (auto-match) booking: decline hides it, accept is atomic, decline-estimate charges the visit fee only, cash flow closes the job', async () => {
  const b = (await C.post('/api/customer/bookings', { serviceSlug: 'tyre-puncture', ...LOC, address: 'Open request road' })).body.booking;
  assert.equal(b.status, 'open');
  let jobs = (await M.get('/api/mechanic/jobs/available')).body.jobs; assert.ok(jobs.some((j) => j.id === b.id && !j.directRequest));
  assert.equal((await M.post(`/api/mechanic/bookings/${b.id}/reject`)).status, 200);
  jobs = (await M.get('/api/mechanic/jobs/available')).body.jobs; assert.ok(!jobs.some((j) => j.id === b.id));
  assert.equal((await M.post(`/api/mechanic/bookings/${b.id}/accept`)).status, 409, 'declined jobs cannot be accepted');
  await C.post(`/api/customer/bookings/${b.id}/cancel`, { reason: 'changed mind' });

  const c = (await C.post('/api/customer/bookings', { serviceSlug: 'tyre-puncture', ...LOC, address: 'Second open request' })).body.booking;
  assert.equal((await M.post(`/api/mechanic/bookings/${c.id}/accept`)).status, 200);
  assert.equal((await M.post(`/api/mechanic/bookings/${c.id}/accept`)).status, 409, 'cannot be accepted twice');
  const otp = (await C.get('/api/customer/bookings/' + c.id)).body.booking.otp;
  await M.post(`/api/mechanic/bookings/${c.id}/status`, { status: 'arrived' });
  await M.post(`/api/mechanic/bookings/${c.id}/start`, { otp });
  await M.post(`/api/mechanic/bookings/${c.id}/estimate`, { amount: 5000, notes: 'Needs a new wheel' });
  const dec = await C.post(`/api/customer/bookings/${c.id}/estimate`, { approve: false });
  assert.equal(dec.body.booking.status, 'completed'); assert.equal(dec.body.booking.totalDue, 350, 'only the visit fee is due');
  assert.equal((await M.post(`/api/mechanic/bookings/${c.id}/cash-received`)).status, 409, 'no cash chosen yet');
  assert.equal((await C.post(`/api/customer/bookings/${c.id}/pay`, { method: 'cash' })).body.amount, 350);
  assert.equal((await C.post(`/api/customer/bookings/${c.id}/pay`, { method: 'bitcoin' })).status, 400);
  assert.equal((await M.post(`/api/mechanic/bookings/${c.id}/cash-received`)).body.booking.status, 'paid');
  assert.equal((await M.get('/api/mechanic/earnings')).body.totalEarned, 1250 + 350);
});

test('cancellation rules and the 3-active-booking cap', async () => {
  const ids = [];
  const have = store.get("SELECT COUNT(*) AS n FROM bookings WHERE customer_id=(SELECT id FROM users WHERE email='asha@example.com') AND status IN ('open','pending_mechanic','accepted','en_route','arrived','inspecting','estimate_sent','in_progress')").n;
  for (let i = 0; i < 3 - have; i++) ids.push((await C.post('/api/customer/bookings', { serviceSlug: 'towing', ...LOC, address: 'Cap test ' + i })).body.booking.id);
  assert.equal((await C.post('/api/customer/bookings', { serviceSlug: 'towing', ...LOC, address: 'one too many' })).status, 409);
  for (const id of ids) assert.equal((await C.post(`/api/customer/bookings/${id}/cancel`, {})).status, 200);
  assert.equal((await C.post(`/api/customer/bookings/${ids[0]}/cancel`, {})).status, 409, 'already cancelled');
});

test('profile edit, trusted contact and SOS email', async () => {
  assert.equal((await C.put('/api/customer/profile', { fullName: 'Asha Rao', phone: '9876543210', trustedEmail: 'bad' })).status, 400);
  assert.equal((await C.put('/api/customer/profile', { fullName: 'Asha R', phone: '9876543210', address: 'Indiranagar', city: 'Bengaluru', vehicle: 'Swift', trustedName: 'Meera', trustedPhone: '9000000001', trustedEmail: 'meera@family.test' })).status, 200);
  const p = (await C.get('/api/customer/profile')).body.profile; assert.equal(p.fullName, 'Asha R'); assert.equal(p.trustedEmail, 'meera@family.test');
  const r = await C.post('/api/customer/sos', { lat: LOC.lat, lng: LOC.lng, bookingId });
  assert.equal(r.body.notified, true);
  const { text, subject } = H.bodyOf(lastMail('meera@family.test').raw);
  assert.match(subject, /SOS/); assert.match(text, /maps\?q=12\.9716,77\.5946/); assert.match(text, /112/);
  assert.equal((await P.post('/api/customer/sos', {})).status, 401);
});

test('admin: suspend user (sessions die, login blocked), services, areas, payments, bookings', async () => {
  const uid = store.get("SELECT id FROM users WHERE email='other@example.com'").id;
  const stranger = cust(); await stranger.post('/api/auth/login', { email: 'other@example.com', password: CUST.password });
  assert.equal((await A.patch(`/api/admin/users/${uid}/status`, { status: 'suspended' })).status, 200);
  assert.equal((await stranger.get('/api/customer/profile')).status, 401);
  assert.equal((await stranger.post('/api/auth/login', { email: 'other@example.com', password: CUST.password })).status, 403);
  await A.patch(`/api/admin/users/${uid}/status`, { status: 'active' });
  assert.equal((await A.patch('/api/admin/users/1/status', { status: 'suspended' })).status, 400, 'admin cannot lock themselves out');

  assert.equal((await A.post('/api/admin/services', { name: 'Car wash', basePrice: 150, description: 'Waterless wash' })).status, 200);
  const svc = (await A.get('/api/admin/services')).body.services; assert.equal(svc.length, 7);
  const cw = svc.find((s) => s.slug === 'car-wash');
  await A.put('/api/admin/services/' + cw.id, { name: 'Car wash', basePrice: 200, active: false });
  assert.equal((await P.get('/api/public/services')).body.services.length, 6, 'inactive services are hidden');

  assert.equal((await P.get('/api/public/areas')).body.areas.length, 0, 'coverage is empty until the admin adds cities');
  await A.post('/api/admin/areas', { city: 'Bengaluru' }); await A.post('/api/admin/areas', { city: 'Mysuru' });
  assert.equal((await A.post('/api/admin/areas', { city: 'bengaluru' })).status, 409);
  assert.deepEqual((await P.get('/api/public/areas')).body.areas, ['Bengaluru', 'Mysuru']);

  const st = (await A.get('/api/admin/stats')).body;
  assert.equal(st.customers, 3); assert.equal(st.mechanics, 1); assert.equal(st.pendingVerifications, 0);
  assert.ok(st.totalBookings >= 6); assert.equal(st.completedBookings, 2); assert.ok(st.cancelledBookings >= 4); assert.equal(st.revenue, 1600);
  assert.equal((await A.get('/api/admin/payments')).body.payments.filter((p) => p.status === 'paid').length, 2);
  assert.ok((await A.get('/api/admin/bookings')).body.bookings.length >= 6);
  assert.equal((await A.get('/api/admin/customers')).body.customers.length, 3);
});

test('uploads reject disguised files and oversize payloads', async () => {
  const exe = Buffer.from('MZ\x90\x00fake exe').toString('base64');
  const reg = (docs) => cust().post('/api/partner/register', { ...MECH, email: 'x' + Math.random().toString(36).slice(2, 7) + '@g.test', documents: docs });
  assert.equal((await reg([{ kind: 'id_proof', filename: 'x.png', mime: 'image/png', data: exe }])).status, 400, 'exe renamed to png');
  assert.equal((await reg([{ kind: 'id_proof', filename: 'x.html', mime: 'text/html', data: PNG }])).status, 400, 'html upload');
  assert.equal((await reg([{ kind: 'selfie', filename: 'x.png', mime: 'image/png', data: PNG }])).status, 400, 'unknown document kind');
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(200000) }) });
  assert.equal(r.status, 413);
});

test('SMTP client fails loudly (never silently "succeeds") when not configured or when credentials are wrong', async () => {
  const mail = require('../server/mail');
  await assert.rejects(mail.send({ to: 'a@b.co', subject: 's', text: 't' }, { host: '' }), /not configured/);
  await assert.rejects(mail.send({ to: 'a@b.co', subject: 's', text: 't', from: 'x@y.z' }, { host: '127.0.0.1', port: smtp.port, secure: false, user: 'smtp-user', pass: 'wrong' }), /535/);
  await assert.rejects(mail.send({ to: 'a@b.co', subject: 's', text: 't', from: 'x@y.z' }, { host: 'mail.example.com', port: 1, secure: false, user: 'u', pass: 'p' }));
  const before = smtp.messages.length;
  await mail.send({ to: 'dots@example.com', subject: 'Ünïcode subject ✓', text: 'line1\n.leading dot line\nline3', from: 'RepairStop <a@b.co>' }, { host: '127.0.0.1', port: smtp.port, secure: false, user: 'smtp-user', pass: 'smtp-pass' });
  assert.equal(smtp.messages.length, before + 1);
  const { subject, text } = H.bodyOf(smtp.messages.at(-1).raw);
  assert.equal(subject, 'Ünïcode subject ✓'); assert.match(text, /\.leading dot line/);
});
