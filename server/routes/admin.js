'use strict';
const store = require('../db');
const mail = require('../mail');
const auth = require('../auth');
const { router, guards } = require('../http');
const B = require('../bookings');
const V = require('../validate');
const { HttpError } = V;

const G = guards.admin;
const idParam = (ctx) => { const id = V.int(ctx.params.id, 1, 1e9); if (!id) throw new HttpError(400, 'Invalid id.'); return id; };

router.get('/api/admin/stats', G, () => {
  const n = (sql, ...p) => store.get(sql, ...p).n;
  return {
    customers: n("SELECT COUNT(*) AS n FROM users WHERE role='customer'"),
    mechanics: n("SELECT COUNT(*) AS n FROM mechanics WHERE verification_status='approved'"),
    pendingVerifications: n("SELECT COUNT(*) AS n FROM mechanics WHERE verification_status='pending'"),
    totalBookings: n('SELECT COUNT(*) AS n FROM bookings'),
    activeBookings: n("SELECT COUNT(*) AS n FROM bookings WHERE status IN ('open','pending_mechanic','accepted','en_route','arrived','inspecting','estimate_sent','in_progress')"),
    completedBookings: n("SELECT COUNT(*) AS n FROM bookings WHERE status IN ('completed','paid')"),
    cancelledBookings: n("SELECT COUNT(*) AS n FROM bookings WHERE status='cancelled'"),
    revenue: n("SELECT COALESCE(SUM(amount),0) AS n FROM payments WHERE status='paid'"),
  };
});

router.get('/api/admin/customers', G, () => ({
  customers: store.all(`SELECT u.id, u.full_name AS fullName, u.email, u.phone, u.status, u.created_at AS createdAt,
      (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = u.id) AS bookings FROM users u WHERE u.role='customer' ORDER BY u.created_at DESC LIMIT 500`),
}));

router.get('/api/admin/mechanics', G, (ctx) => {
  const st = ['pending', 'approved', 'rejected'].includes(ctx.query.status) ? ctx.query.status : null;
  return { mechanics: store.all(`SELECT u.id, u.full_name AS fullName, u.email, u.phone, u.status AS accountStatus, m.garage_name AS garageName, m.city, m.address,
      m.experience_years AS experienceYears, m.verification_status AS verificationStatus, m.verification_note AS verificationNote, m.is_available AS available, u.created_at AS createdAt
      FROM mechanics m JOIN users u ON u.id = m.user_id ${st ? 'WHERE m.verification_status = ?' : ''} ORDER BY (m.verification_status='pending') DESC, u.created_at DESC LIMIT 500`, ...(st ? [st] : [])) };
});

router.get('/api/admin/mechanics/:id', G, (ctx) => {
  const id = idParam(ctx);
  const m = store.get(`SELECT u.id, u.full_name AS fullName, u.email, u.phone, m.garage_name AS garageName, m.city, m.address, m.lat, m.lng, m.experience_years AS experienceYears,
      m.verification_status AS verificationStatus, m.verification_note AS verificationNote FROM mechanics m JOIN users u ON u.id = m.user_id WHERE m.user_id = ?`, id);
  if (!m) throw new HttpError(404, 'Mechanic not found.');
  m.services = store.all('SELECT s.name, ms.price FROM mechanic_services ms JOIN services s ON s.id = ms.service_id WHERE ms.mechanic_id = ?', id);
  m.documents = store.all("SELECT id, kind, original_name AS name, mime FROM files WHERE owner_user_id = ? AND kind != 'repair_photo'", id);
  return { mechanic: m };
});

router.post('/api/admin/mechanics/:id/verify', G, (ctx) => {
  const id = idParam(ctx);
  const decision = ctx.body.decision, note = V.str(ctx.body.note, 300);
  if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'Choose approve or reject.');
  if (decision === 'reject' && !note) throw new HttpError(400, 'Give a reason so the applicant knows what to fix.');
  const m = store.get('SELECT m.user_id, u.full_name, u.email FROM mechanics m JOIN users u ON u.id = m.user_id WHERE m.user_id = ?', id);
  if (!m) throw new HttpError(404, 'Mechanic not found.');
  store.run('UPDATE mechanics SET verification_status=?, verification_note=?, verified_at=?, is_available = CASE WHEN ?=1 THEN is_available ELSE 0 END WHERE user_id=?',
    decision === 'approve' ? 'approved' : 'rejected', note || null, Date.now(), decision === 'approve' ? 1 : 0, id);
  mail.sendTemplate(m.email, mail.templates.mechanicDecision(m.full_name, decision === 'approve', note)).catch((e) => console.error('[mail]', e.message));
  return { ok: true };
});

router.patch('/api/admin/users/:id/status', G, (ctx) => {
  const id = idParam(ctx);
  const status = ctx.body.status;
  if (!['active', 'suspended'].includes(status)) throw new HttpError(400, 'Invalid status.');
  if (id === ctx.user.id) throw new HttpError(400, 'You cannot suspend your own account.');
  const u = store.get('SELECT role FROM users WHERE id = ?', id);
  if (!u || u.role === 'admin') throw new HttpError(404, 'User not found.');
  store.run('UPDATE users SET status = ? WHERE id = ?', status, id);
  if (status === 'suspended') { auth.destroyUserSessions(id); store.run('UPDATE mechanics SET is_available = 0 WHERE user_id = ?', id); }
  return { ok: true };
});

// ---- Services ----
router.get('/api/admin/services', G, () => ({ services: store.all('SELECT id, slug, name, description, base_price AS basePrice, active FROM services ORDER BY sort, id') }));
router.post('/api/admin/services', G, (ctx) => {
  const name = V.str(ctx.body.name, 80), desc = V.str(ctx.body.description, 200), price = V.int(ctx.body.basePrice, 0, 100000);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!name || !slug || price === null) throw new HttpError(400, 'Enter a name and a base price.');
  if (store.get('SELECT 1 AS x FROM services WHERE slug = ?', slug)) throw new HttpError(409, 'A service with this name exists.');
  const sort = store.get('SELECT COALESCE(MAX(sort),0)+1 AS n FROM services').n;
  store.run('INSERT INTO services (slug,name,description,base_price,sort) VALUES (?,?,?,?,?)', slug, name, desc || null, price, sort);
  return { ok: true };
});
router.put('/api/admin/services/:id', G, (ctx) => {
  const id = idParam(ctx);
  const name = V.str(ctx.body.name, 80), desc = V.str(ctx.body.description, 200), price = V.int(ctx.body.basePrice, 0, 100000);
  if (!name || price === null) throw new HttpError(400, 'Enter a name and a base price.');
  const r = store.run('UPDATE services SET name=?, description=?, base_price=?, active=? WHERE id=?', name, desc || null, price, ctx.body.active === false ? 0 : 1, id);
  if (!r.changes) throw new HttpError(404, 'Service not found.');
  return { ok: true };
});

// ---- Coverage areas ----
router.get('/api/admin/areas', G, () => ({ areas: store.all('SELECT id, city, active FROM service_areas ORDER BY city') }));
router.post('/api/admin/areas', G, (ctx) => {
  const city = V.str(ctx.body.city, 80);
  if (city.length < 2) throw new HttpError(400, 'Enter a city name.');
  if (store.get('SELECT 1 AS x FROM service_areas WHERE city = ? COLLATE NOCASE', city)) throw new HttpError(409, 'This city is already listed.');
  store.run('INSERT INTO service_areas (city) VALUES (?)', city);
  return { ok: true };
});
router.delete('/api/admin/areas/:id', G, (ctx) => { store.run('DELETE FROM service_areas WHERE id = ?', idParam(ctx)); return { ok: true }; });

// ---- Payments / reviews / bookings ----
router.get('/api/admin/payments', G, () => ({
  payments: store.all(`SELECT p.id, p.booking_id AS bookingId, p.amount, p.method, p.status, p.provider_payment_id AS providerPaymentId, p.created_at AS createdAt, p.paid_at AS paidAt,
      cu.full_name AS customer, m.garage_name AS garage FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN users cu ON cu.id=b.customer_id LEFT JOIN mechanics m ON m.user_id=b.mechanic_id ORDER BY p.created_at DESC LIMIT 500`),
}));
router.get('/api/admin/reviews', G, () => ({
  reviews: store.all(`SELECT r.id, r.rating, r.comment, r.status, r.created_at AS createdAt, cu.full_name AS customer, m.garage_name AS garage
      FROM reviews r JOIN users cu ON cu.id=r.customer_id JOIN mechanics m ON m.user_id=r.mechanic_id ORDER BY r.created_at DESC LIMIT 500`),
}));
router.patch('/api/admin/reviews/:id', G, (ctx) => {
  const status = ctx.body.status;
  if (!['visible', 'hidden'].includes(status)) throw new HttpError(400, 'Invalid status.');
  const r = store.run('UPDATE reviews SET status = ? WHERE id = ?', status, idParam(ctx));
  if (!r.changes) throw new HttpError(404, 'Review not found.');
  return { ok: true };
});
router.get('/api/admin/bookings', G, () => ({
  bookings: store.all(B.BASE_SQL + ' ORDER BY b.created_at DESC LIMIT 500').map((b) => B.view(b, 'admin')),
}));
