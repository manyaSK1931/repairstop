'use strict';
const crypto = require('crypto');
const store = require('../db');
const files = require('../files');
const auth = require('../auth');
const { router, guards } = require('../http');
const B = require('../bookings');
const V = require('../validate');
const { HttpError } = V;

const G = guards.mechanic;
const me = (ctx) => store.get('SELECT * FROM mechanics WHERE user_id = ?', ctx.user.id);
function approved(ctx) {
  const m = me(ctx);
  if (!m || m.verification_status !== 'approved') throw new HttpError(403, 'Your partner account is not verified yet. You will be notified by email once an administrator approves it.');
  return m;
}
function ownBooking(ctx) {
  const id = V.int(ctx.params.id, 1, 1e9);
  const b = id && B.loadBooking(id);
  if (!b || b.mechanic_id !== ctx.user.id) throw new HttpError(404, 'Booking not found.');
  return b;
}
const servicesOf = (id) => store.all('SELECT s.slug, s.name, ms.price FROM mechanic_services ms JOIN services s ON s.id = ms.service_id WHERE ms.mechanic_id = ? ORDER BY s.sort', id);

// ---- Profile / availability / location ----
router.get('/api/mechanic/profile', G, (ctx) => {
  const m = me(ctx);
  const u = store.get('SELECT full_name AS fullName, email, phone FROM users WHERE id = ?', ctx.user.id);
  const docs = store.all("SELECT id, kind, original_name AS name, mime FROM files WHERE owner_user_id = ? AND kind != 'repair_photo'", ctx.user.id);
  const r = store.get("SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE mechanic_id = ? AND status='visible'", ctx.user.id);
  return { profile: { ...u, garageName: m.garage_name, address: m.address, city: m.city, lat: m.lat, lng: m.lng, experienceYears: m.experience_years, specialty: m.specialty,
    verificationStatus: m.verification_status, verificationNote: m.verification_note, available: !!m.is_available, services: servicesOf(ctx.user.id), documents: docs,
    rating: r.n ? Math.round(r.avg * 10) / 10 : null, reviewCount: r.n } };
});

router.put('/api/mechanic/profile', G, (ctx) => {
  const b = ctx.body, errors = {};
  const fullName = V.str(b.fullName, 100), phone = V.normPhone(b.phone);
  const garageName = V.str(b.garageName, 120), address = V.str(b.address, 300), city = V.str(b.city, 80);
  const exp = V.int(b.experienceYears, 0, 60);
  const lat = V.num(b.lat, -90, 90), lng = V.num(b.lng, -180, 180);
  if (fullName.length < 2) errors.fullName = 'Enter your name.';
  if (!V.PHONE_RE.test(phone)) errors.phone = 'Enter a valid phone number.';
  if (garageName.length < 2) errors.garageName = 'Enter your garage name.';
  if (address.length < 5) errors.address = 'Enter your address.';
  if (city.length < 2) errors.city = 'Enter your city.';
  if (exp === null) errors.experienceYears = 'Enter years of experience.';
  if (lat === null || lng === null) errors.address = 'Locate your garage on the map first.';
  const svcRows = store.all('SELECT id, slug FROM services WHERE active = 1');
  const offered = [];
  for (const s of Array.isArray(b.services) ? b.services : []) {
    const svc = svcRows.find((x) => x.slug === s.slug), price = V.int(s.price, 1, 100000);
    if (svc && price) offered.push({ id: svc.id, price });
  }
  if (!offered.length) errors.services = 'Offer at least one service with a price.';
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  store.tx(() => {
    store.run('UPDATE users SET full_name=?, phone=? WHERE id=?', fullName, phone, ctx.user.id);
    store.run('UPDATE mechanics SET garage_name=?, address=?, city=?, lat=?, lng=?, experience_years=?, specialty=? WHERE user_id=?', garageName, address, city, lat, lng, exp, V.str(b.specialty, 120) || null, ctx.user.id);
    store.run('DELETE FROM mechanic_services WHERE mechanic_id = ?', ctx.user.id);
    for (const o of offered) store.run('INSERT INTO mechanic_services (mechanic_id,service_id,price) VALUES (?,?,?)', ctx.user.id, o.id, o.price);
  });
  return { ok: true, message: 'Profile saved.' };
});

router.post('/api/mechanic/availability', G, (ctx) => {
  approved(ctx);
  store.run('UPDATE mechanics SET is_available = ? WHERE user_id = ?', ctx.body.available === true ? 1 : 0, ctx.user.id);
  return { ok: true, available: ctx.body.available === true };
});

router.post('/api/mechanic/location', G, (ctx) => {
  approved(ctx);
  const lat = V.num(ctx.body.lat, -90, 90), lng = V.num(ctx.body.lng, -180, 180);
  if (lat === null || lng === null) throw new HttpError(400, 'Invalid location.');
  if (!auth.rateLimit('loc:' + ctx.user.id, 60, 60e3)) throw new HttpError(429, 'Slow down.');
  store.run('UPDATE mechanics SET last_lat=?, last_lng=?, last_location_at=? WHERE user_id=?', lat, lng, Date.now(), ctx.user.id);
  return { ok: true };
});

// ---- Jobs ----
router.get('/api/mechanic/jobs/available', G, (ctx) => {
  const m = approved(ctx);
  const baseLat = m.last_lat ?? m.lat, baseLng = m.last_lng ?? m.lng;
  const prices = Object.fromEntries(store.all('SELECT service_id, price FROM mechanic_services WHERE mechanic_id = ?', m.user_id).map((r) => [r.service_id, r.price]));
  const rows = store.all(B.BASE_SQL + ` WHERE (b.status = 'open' AND NOT EXISTS (SELECT 1 FROM booking_rejections r WHERE r.booking_id = b.id AND r.mechanic_id = ?))
      OR (b.status = 'pending_mechanic' AND b.mechanic_id = ?) ORDER BY b.created_at DESC LIMIT 100`, m.user_id, m.user_id);
  const jobs = [];
  for (const b of rows) {
    if (!(b.service_id in prices)) continue;
    const km = V.haversineKm(baseLat, baseLng, b.lat, b.lng);
    if (b.status === 'open' && km > 25) continue;
    jobs.push({ ...B.view(b, 'mechanic'), directRequest: b.status === 'pending_mechanic', yourPrice: prices[b.service_id], distanceKm: Math.round(km * 10) / 10, etaMinutes: V.etaMinutes(km) });
  }
  return { jobs: jobs.sort((a, b) => a.distanceKm - b.distanceKm) };
});

router.get('/api/mechanic/bookings', G, (ctx) => ({
  bookings: store.all(B.BASE_SQL + ' WHERE b.mechanic_id = ? ORDER BY b.created_at DESC LIMIT 200', ctx.user.id).map((b) => B.view(b, 'mechanic')),
}));
router.get('/api/mechanic/bookings/:id', G, (ctx) => ({ booking: B.view(ownBooking(ctx), 'mechanic') }));

router.post('/api/mechanic/bookings/:id/accept', G, (ctx) => {
  const m = approved(ctx);
  if (!m.is_available) throw new HttpError(409, 'Set yourself as available before accepting jobs.');
  const id = V.int(ctx.params.id, 1, 1e9);
  const b = id && store.get('SELECT * FROM bookings WHERE id = ?', id);
  if (!b) throw new HttpError(404, 'Booking not found.');
  const price = store.get('SELECT price FROM mechanic_services WHERE mechanic_id = ? AND service_id = ?', m.user_id, b.service_id);
  if (!price) throw new HttpError(409, 'You do not offer this service.');
  if (store.get('SELECT 1 AS x FROM booking_rejections WHERE booking_id = ? AND mechanic_id = ?', id, m.user_id)) throw new HttpError(409, 'You already declined this job.');
  const busy = store.get("SELECT COUNT(*) AS n FROM bookings WHERE mechanic_id = ? AND status IN ('accepted','en_route','arrived','inspecting','estimate_sent','in_progress')", m.user_id).n;
  if (busy >= 3) throw new HttpError(409, 'Finish your current jobs before accepting more.');
  const otp = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const now = Date.now();
  const r = b.status === 'pending_mechanic' && b.mechanic_id === m.user_id
    ? store.run("UPDATE bookings SET status='accepted', otp=?, accepted_at=?, visit_fee=? WHERE id=? AND status='pending_mechanic' AND mechanic_id=?", otp, now, price.price, id, m.user_id)
    : store.run("UPDATE bookings SET mechanic_id=?, status='accepted', otp=?, accepted_at=?, visit_fee=? WHERE id=? AND status='open'", m.user_id, otp, now, price.price, id);
  if (!r.changes) throw new HttpError(409, 'This job is no longer available.');
  return { ok: true, booking: B.view(B.loadBooking(id), 'mechanic') };
});

router.post('/api/mechanic/bookings/:id/reject', G, (ctx) => {
  const m = approved(ctx);
  const id = V.int(ctx.params.id, 1, 1e9);
  const b = id && store.get('SELECT * FROM bookings WHERE id = ?', id);
  if (!b) throw new HttpError(404, 'Booking not found.');
  store.tx(() => {
    if (b.status === 'pending_mechanic' && b.mechanic_id === m.user_id) {
      // The customer picked you and you declined: the request is released to other nearby mechanics.
      store.run("UPDATE bookings SET status='open', mechanic_id=NULL WHERE id=? AND status='pending_mechanic'", id);
    } else if (b.status !== 'open') throw new HttpError(409, 'This job can no longer be declined.');
    store.run('INSERT OR IGNORE INTO booking_rejections (booking_id,mechanic_id,created_at) VALUES (?,?,?)', id, m.user_id, Date.now());
  });
  return { ok: true };
});

router.post('/api/mechanic/bookings/:id/status', G, (ctx) => {
  approved(ctx);
  const b = ownBooking(ctx), next = ctx.body.status;
  let r;
  if (next === 'en_route') r = store.run("UPDATE bookings SET status='en_route' WHERE id=? AND status='accepted'", b.id);
  else if (next === 'arrived') r = store.run("UPDATE bookings SET status='arrived', arrived_at=? WHERE id=? AND status IN ('accepted','en_route')", Date.now(), b.id);
  else throw new HttpError(400, 'Unknown status.');
  if (!r.changes) throw new HttpError(409, 'That update is not possible at this stage.');
  return { ok: true, booking: B.view(B.loadBooking(b.id), 'mechanic') };
});

// OTP-verified job start: the customer reads the 4-digit code to the mechanic in person
router.post('/api/mechanic/bookings/:id/start', G, (ctx) => {
  approved(ctx);
  const b = ownBooking(ctx);
  if (b.status !== 'arrived') throw new HttpError(409, 'Mark yourself as arrived before starting the job.');
  if (b.otp_attempts >= 5) throw new HttpError(423, 'Too many wrong codes. Ask the customer to cancel and rebook, or contact support.');
  const given = String(ctx.body.otp || '');
  const ok = /^\d{4}$/.test(given) && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(b.otp)));
  if (!ok) {
    store.run('UPDATE bookings SET otp_attempts = otp_attempts + 1 WHERE id = ?', b.id);
    throw new HttpError(400, `Incorrect code. ${4 - b.otp_attempts} attempt(s) left.`);
  }
  store.run("UPDATE bookings SET status='inspecting', started_at=?, otp=NULL WHERE id=? AND status='arrived'", Date.now(), b.id);
  return { ok: true, booking: B.view(B.loadBooking(b.id), 'mechanic') };
});

router.post('/api/mechanic/bookings/:id/estimate', G, (ctx) => {
  approved(ctx);
  const b = ownBooking(ctx);
  const amount = V.int(ctx.body.amount, 1, 500000), notes = V.str(ctx.body.notes, 800);
  if (!amount) throw new HttpError(400, 'Enter the repair estimate in rupees.', { amount: 'Enter an amount.' });
  if (notes.length < 3) throw new HttpError(400, 'Describe what needs to be done.', { notes: 'Describe the work and parts.' });
  const r = store.run("UPDATE bookings SET status='estimate_sent', estimate_amount=?, estimate_notes=?, estimate_status='pending' WHERE id=? AND status='inspecting'", amount, notes, b.id);
  if (!r.changes) throw new HttpError(409, 'You can send an estimate right after inspecting.');
  return { ok: true, booking: B.view(B.loadBooking(b.id), 'mechanic') };
});

router.post('/api/mechanic/bookings/:id/complete', G, (ctx) => {
  approved(ctx);
  const b = ownBooking(ctx);
  const r = store.run("UPDATE bookings SET status='completed', completed_at=? WHERE id=? AND status IN ('inspecting','in_progress')", Date.now(), b.id);
  if (!r.changes) throw new HttpError(409, 'The job cannot be completed at this stage (waiting for the customer to approve the estimate?).');
  return { ok: true, booking: B.view(B.loadBooking(b.id), 'mechanic') };
});

router.post('/api/mechanic/bookings/:id/photos', G, (ctx) => {
  approved(ctx);
  const b = ownBooking(ctx);
  if (!['inspecting', 'estimate_sent', 'in_progress', 'completed'].includes(b.status)) throw new HttpError(409, 'Photos can be added once the job has started.');
  if (store.get("SELECT COUNT(*) AS n FROM files WHERE booking_id = ? AND kind = 'repair_photo'", b.id).n >= 8) throw new HttpError(409, 'Up to 8 photos per job.');
  const id = files.saveUpload({ ownerId: ctx.user.id, kind: 'repair_photo', file: ctx.body, bookingId: b.id, caption: ctx.body.caption, imagesOnly: true });
  return { ok: true, id };
}, { bodyLimit: 7 * 1024 * 1024 });

router.post('/api/mechanic/bookings/:id/cash-received', G, (ctx) => {
  approved(ctx);
  const b = ownBooking(ctx);
  const p = store.get("SELECT * FROM payments WHERE booking_id=? AND method='cash' AND status='pending_cash' ORDER BY id DESC LIMIT 1", b.id);
  if (b.status !== 'completed' || !p) throw new HttpError(409, 'The customer has not chosen to pay cash for this job.');
  store.tx(() => {
    store.run("UPDATE payments SET status='paid', paid_at=? WHERE id=?", Date.now(), p.id);
    store.run("UPDATE bookings SET status='paid' WHERE id=?", b.id);
  });
  return { ok: true, booking: B.view(B.loadBooking(b.id), 'mechanic') };
});

router.get('/api/mechanic/earnings', G, (ctx) => {
  const paid = store.get("SELECT COALESCE(SUM(p.amount),0) AS total, COUNT(*) AS n FROM payments p JOIN bookings b ON b.id=p.booking_id WHERE b.mechanic_id=? AND p.status='paid'", ctx.user.id);
  const pending = store.all("SELECT b.id, b.visit_fee, b.estimate_amount, b.estimate_status FROM bookings b WHERE b.mechanic_id=? AND b.status='completed'", ctx.user.id);
  const recent = store.all(`SELECT p.booking_id AS bookingId, p.amount, p.method, p.paid_at AS paidAt, s.name AS service FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN services s ON s.id=b.service_id
      WHERE b.mechanic_id=? AND p.status='paid' ORDER BY p.paid_at DESC LIMIT 50`, ctx.user.id);
  return { totalEarned: paid.total, paidJobs: paid.n, awaitingPayment: pending.reduce((a, b) => a + B.totalDue(b), 0), awaitingJobs: pending.length, recent };
});
