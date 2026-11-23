'use strict';
const store = require('../db');
const mail = require('../mail');
const pay = require('../payments');
const { router, guards } = require('../http');
const B = require('../bookings');
const V = require('../validate');
const { HttpError } = V;

const G = guards.customer;

function ownBooking(ctx) {
  const id = V.int(ctx.params.id, 1, 1e9);
  const b = id && B.loadBooking(id);
  if (!b || b.customer_id !== ctx.user.id) throw new HttpError(404, 'Booking not found.');
  return b;
}

// ---- Profile ----
router.get('/api/customer/profile', G, (ctx) => {
  const u = store.get('SELECT full_name AS fullName, email, phone, created_at AS createdAt FROM users WHERE id = ?', ctx.user.id);
  const c = store.get('SELECT address, city, vehicle, trusted_name AS trustedName, trusted_phone AS trustedPhone, trusted_email AS trustedEmail FROM customers WHERE user_id = ?', ctx.user.id);
  return { profile: { ...u, ...c } };
});

router.put('/api/customer/profile', G, (ctx) => {
  const b = ctx.body, errors = {};
  const fullName = V.str(b.fullName, 100), phone = V.normPhone(b.phone);
  const trustedEmail = V.normEmail(b.trustedEmail), trustedPhone = V.normPhone(b.trustedPhone);
  if (fullName.length < 2) errors.fullName = 'Enter your full name.';
  if (!V.PHONE_RE.test(phone)) errors.phone = 'Enter a valid phone number.';
  if (trustedEmail && !V.EMAIL_RE.test(trustedEmail)) errors.trustedEmail = 'Enter a valid email address.';
  if (trustedPhone && !V.PHONE_RE.test(trustedPhone)) errors.trustedPhone = 'Enter a valid phone number.';
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  store.tx(() => {
    store.run('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', fullName, phone, ctx.user.id);
    store.run('UPDATE customers SET address=?, city=?, vehicle=?, trusted_name=?, trusted_phone=?, trusted_email=? WHERE user_id=?',
      V.str(b.address, 300) || null, V.str(b.city, 80) || null, V.str(b.vehicle, 100) || null, V.str(b.trustedName, 100) || null, trustedPhone || null, trustedEmail || null, ctx.user.id);
  });
  return { ok: true, message: 'Profile saved.' };
});

// ---- Bookings ----
router.post('/api/customer/bookings', G, (ctx) => {
  const b = ctx.body, errors = {};
  const svc = store.get('SELECT * FROM services WHERE slug = ? AND active = 1', String(b.serviceSlug || ''));
  const lat = V.num(b.lat, -90, 90), lng = V.num(b.lng, -180, 180);
  const address = V.str(b.address, 300);
  if (!svc) errors.serviceSlug = 'Choose a service.';
  if (lat === null || lng === null) errors.address = 'Share your vehicle location first.';
  if (address.length < 3) errors.address = 'Enter where your vehicle is.';
  if (Object.keys(errors).length) throw new HttpError(400, 'Please complete the booking details.', errors);
  const active = store.get(`SELECT COUNT(*) AS n FROM bookings WHERE customer_id = ? AND status IN ('open','pending_mechanic','accepted','en_route','arrived','inspecting','estimate_sent','in_progress')`, ctx.user.id).n;
  if (active >= 3) throw new HttpError(409, 'You already have 3 active bookings. Complete or cancel one first.');

  let mechanicId = null, fee = svc.base_price, status = 'open';
  if (b.mechanicId !== undefined && b.mechanicId !== null && b.mechanicId !== '') {
    mechanicId = V.int(b.mechanicId, 1, 1e9);
    const m = mechanicId && store.get(`SELECT m.lat, m.lng, ms.price FROM mechanics m JOIN users u ON u.id = m.user_id
        JOIN mechanic_services ms ON ms.mechanic_id = m.user_id AND ms.service_id = ?
       WHERE m.user_id = ? AND m.verification_status = 'approved' AND m.is_available = 1 AND u.status = 'active'`, svc.id, mechanicId);
    if (!m) throw new HttpError(409, 'That mechanic is not available for this service right now. Please choose another.');
    if (V.haversineKm(lat, lng, m.lat, m.lng) > 100) throw new HttpError(409, 'That mechanic is too far from your location.');
    fee = m.price; status = 'pending_mechanic';
  }
  const r = store.run(`INSERT INTO bookings (customer_id,mechanic_id,service_id,status,lat,lng,address,vehicle,notes,visit_fee,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ctx.user.id, mechanicId, svc.id, status, lat, lng, address, V.str(b.vehicle, 100) || null, V.str(b.notes, 500) || null, fee, Date.now());
  return { ok: true, booking: B.view(B.loadBooking(Number(r.lastInsertRowid)), 'customer') };
});

router.get('/api/customer/bookings', G, (ctx) => {
  const rows = store.all(B.BASE_SQL + ' WHERE b.customer_id = ? ORDER BY b.created_at DESC LIMIT 200', ctx.user.id);
  return { bookings: rows.map((b) => B.view(b, 'customer')) };
});
router.get('/api/customer/bookings/:id', G, (ctx) => ({ booking: B.view(ownBooking(ctx), 'customer') }));

router.post('/api/customer/bookings/:id/cancel', G, (ctx) => {
  const b = ownBooking(ctx);
  const r = store.run(`UPDATE bookings SET status='cancelled', cancelled_at=?, cancel_reason=? WHERE id=? AND (status IN ('open','pending_mechanic','accepted','en_route') OR (status='arrived' AND otp_attempts >= 5))`,
    Date.now(), V.str(ctx.body.reason, 200) || null, b.id);
  if (!r.changes) throw new HttpError(409, 'This booking can no longer be cancelled because the mechanic has already arrived.');
  return { ok: true, booking: B.view(B.loadBooking(b.id), 'customer') };
});

// Inspect first, price after: the customer approves or declines the mechanic's quote
router.post('/api/customer/bookings/:id/estimate', G, (ctx) => {
  const b = ownBooking(ctx);
  const approve = ctx.body.approve === true;
  const now = Date.now();
  const r = approve
    ? store.run(`UPDATE bookings SET status='in_progress', estimate_status='approved' WHERE id=? AND status='estimate_sent'`, b.id)
    : store.run(`UPDATE bookings SET status='completed', estimate_status='declined', completed_at=? WHERE id=? AND status='estimate_sent'`, now, b.id);
  if (!r.changes) throw new HttpError(409, 'There is no estimate waiting for your decision.');
  return { ok: true, booking: B.view(B.loadBooking(b.id), 'customer') };
});

// ---- Payment ----
router.post('/api/customer/bookings/:id/pay', G, async (ctx) => {
  const b = ownBooking(ctx);
  if (b.status !== 'completed') throw new HttpError(409, 'Payment opens once the job is marked complete.');
  const method = ctx.body.method;
  if (!['online', 'cash'].includes(method)) throw new HttpError(400, 'Choose online or cash.');
  const amount = B.totalDue(b);
  if (method === 'cash') {
    store.tx(() => {
      store.run("UPDATE payments SET status='failed' WHERE booking_id=? AND status IN ('created','pending_cash')", b.id);
      store.run("INSERT INTO payments (booking_id,amount,method,status,created_at) VALUES (?,?,'cash','pending_cash',?)", b.id, amount, Date.now());
      store.run("UPDATE bookings SET payment_method='cash' WHERE id=?", b.id);
    });
    return { ok: true, method, amount, message: 'Hand the cash to the mechanic. They will confirm receipt and the booking will be closed.' };
  }
  const orderId = await pay.createOrder(amount, `bk${b.id}`);
  store.tx(() => {
    store.run("UPDATE payments SET status='failed' WHERE booking_id=? AND status IN ('created','pending_cash')", b.id);
    store.run("INSERT INTO payments (booking_id,amount,method,status,provider_order_id,created_at) VALUES (?,?,'online','created',?,?)", b.id, amount, orderId, Date.now());
    store.run("UPDATE bookings SET payment_method='online' WHERE id=?", b.id);
  });
  return { ok: true, method, amount, orderId, keyId: require('../config').razorpay.keyId };
});

router.post('/api/customer/bookings/:id/pay/verify', G, (ctx) => {
  const b = ownBooking(ctx);
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: sig } = ctx.body;
  const p = store.get("SELECT * FROM payments WHERE booking_id=? AND provider_order_id=? AND status='created'", b.id, String(orderId || ''));
  if (!p || !pay.verifySignature(orderId, paymentId, sig)) throw new HttpError(400, 'Payment could not be verified. If money was debited, contact support with your booking number.');
  store.tx(() => {
    store.run("UPDATE payments SET status='paid', provider_payment_id=?, paid_at=? WHERE id=?", String(paymentId).slice(0, 60), Date.now(), p.id);
    store.run("UPDATE bookings SET status='paid' WHERE id=? AND status='completed'", b.id);
  });
  return { ok: true, message: 'Payment received. Thank you!' };
});

router.get('/api/customer/payments', G, (ctx) => ({
  payments: store.all(`SELECT p.id, p.booking_id AS bookingId, p.amount, p.method, p.status, p.created_at AS createdAt, p.paid_at AS paidAt, s.name AS service
      FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN services s ON s.id = b.service_id
     WHERE b.customer_id = ? AND p.status IN ('paid','pending_cash') ORDER BY p.created_at DESC`, ctx.user.id),
}));

// ---- Reviews ----
router.post('/api/customer/bookings/:id/review', G, (ctx) => {
  const b = ownBooking(ctx);
  if (!['completed', 'paid'].includes(b.status) || !b.mechanic_id) throw new HttpError(409, 'You can review a service once it has been completed.');
  const rating = V.int(ctx.body.rating, 1, 5);
  if (!rating) throw new HttpError(400, 'Choose a rating from 1 to 5.');
  if (store.get('SELECT 1 AS x FROM reviews WHERE booking_id = ?', b.id)) throw new HttpError(409, 'You have already reviewed this booking.');
  store.run('INSERT INTO reviews (booking_id,customer_id,mechanic_id,rating,comment,created_at) VALUES (?,?,?,?,?,?)', b.id, ctx.user.id, b.mechanic_id, rating, V.str(ctx.body.comment, 1000) || null, Date.now());
  return { ok: true, message: 'Thanks for your review.' };
});
router.get('/api/customer/reviews', G, (ctx) => ({
  reviews: store.all(`SELECT r.booking_id AS bookingId, r.rating, r.comment, r.status, r.created_at AS createdAt, m.garage_name AS garageName
      FROM reviews r JOIN mechanics m ON m.user_id = r.mechanic_id WHERE r.customer_id = ? ORDER BY r.created_at DESC`, ctx.user.id),
}));

// ---- SOS ----
router.post('/api/customer/sos', G, async (ctx) => {
  const lat = V.num(ctx.body.lat, -90, 90), lng = V.num(ctx.body.lng, -180, 180);
  const c = store.get('SELECT trusted_name, trusted_phone, trusted_email FROM customers WHERE user_id = ?', ctx.user.id);
  const bookingId = V.int(ctx.body.bookingId, 1, 1e9);
  const booking = bookingId && store.get('SELECT id, address FROM bookings WHERE id = ? AND customer_id = ?', bookingId, ctx.user.id);
  const ev = store.run('INSERT INTO sos_events (customer_id,booking_id,lat,lng,created_at) VALUES (?,?,?,?,?)', ctx.user.id, booking ? booking.id : null, lat, lng, Date.now());
  let notified = false;
  if (c && c.trusted_email) {
    const mapUrl = lat !== null && lng !== null ? `https://www.google.com/maps?q=${lat},${lng}` : 'https://www.google.com/maps';
    try {
      await mail.sendTemplate(c.trusted_email, mail.templates.sos(ctx.user.full_name, mapUrl, booking ? `Booking #${booking.id}, vehicle at: ${booking.address}` : 'No active booking.'));
      notified = true; store.run('UPDATE sos_events SET notified = 1 WHERE id = ?', ev.lastInsertRowid);
    } catch (e) { console.error('[mail] SOS email failed:', e.message); }
  }
  return { ok: true, notified, hasTrustedContact: !!(c && (c.trusted_email || c.trusted_phone)), trustedName: c && c.trusted_name, trustedPhone: c && c.trusted_phone };
});
