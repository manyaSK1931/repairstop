'use strict';
const store = require('../db');
const cfg = require('../config');
const files = require('../files');
const { router, guards, raw } = require('../http');
const V = require('../validate');
const { HttpError } = V;

router.get('/api/public/config', () => ({
  supportPhone: cfg.supportPhone, supportEmail: cfg.supportEmail,
  paymentsEnabled: !!(cfg.razorpay.keyId && cfg.razorpay.keySecret),
  razorpayKeyId: cfg.razorpay.keyId || null,   // key id is public by design; the secret never leaves the server
}));

router.get('/api/public/services', () => ({ services: store.all('SELECT id, slug, name, description, base_price AS basePrice FROM services WHERE active = 1 ORDER BY sort, id') }));

router.get('/api/public/areas', () => ({ areas: store.all('SELECT city FROM service_areas WHERE active = 1 ORDER BY city').map((a) => a.city) }));

router.get('/api/public/stats', () => {
  const eta = store.all("SELECT (arrived_at - accepted_at) AS d FROM bookings WHERE arrived_at IS NOT NULL AND accepted_at IS NOT NULL ORDER BY d").map((r) => r.d);
  const median = eta.length ? Math.round(eta[Math.floor(eta.length / 2)] / 60000) : null;
  const rv = store.get("SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE status = 'visible'");
  const mech = store.get("SELECT COUNT(*) AS n FROM mechanics WHERE verification_status = 'approved'").n;
  return { medianEtaMinutes: median, averageRating: rv.n ? Math.round(rv.avg * 10) / 10 : null, reviewCount: rv.n, verifiedMechanics: mech };
});

router.get('/api/public/reviews', (ctx) => {
  const limit = V.int(ctx.query.limit, 1, 20) || 6;
  const rows = store.all(`
    SELECT r.rating, r.comment, r.created_at AS createdAt, u.full_name AS name, b.vehicle, m.city
      FROM reviews r JOIN bookings b ON b.id = r.booking_id
      JOIN users u ON u.id = r.customer_id JOIN mechanics m ON m.user_id = r.mechanic_id
     WHERE r.status = 'visible' AND r.comment IS NOT NULL AND r.comment != '' ORDER BY r.created_at DESC LIMIT ?`, limit);
  // Only the first name is public
  return { reviews: rows.map((r) => ({ ...r, name: r.name.split(' ')[0] })) };
});

function ratingFor(id) {
  const r = store.get("SELECT AVG(rating) AS avg, COUNT(*) AS n FROM reviews WHERE mechanic_id = ? AND status = 'visible'", id);
  return { rating: r.n ? Math.round(r.avg * 10) / 10 : null, reviewCount: r.n };
}

function searchMechanics({ lat, lng, serviceId, radiusKm, excludeIds = [] }) {
  const rows = store.all(`SELECT m.user_id AS id, m.garage_name AS garageName, m.city, m.lat, m.lng, m.experience_years AS experienceYears, m.specialty, u.full_name AS ownerName
      FROM mechanics m JOIN users u ON u.id = m.user_id
     WHERE m.verification_status = 'approved' AND m.is_available = 1 AND u.status = 'active'`);
  const out = [];
  for (const m of rows) {
    if (excludeIds.includes(m.id)) continue;
    const km = V.haversineKm(lat, lng, m.lat, m.lng);
    if (km > radiusKm) continue;
    const prices = store.all('SELECT s.id, s.slug, s.name, ms.price FROM mechanic_services ms JOIN services s ON s.id = ms.service_id WHERE ms.mechanic_id = ? AND s.active = 1 ORDER BY s.sort', m.id);
    let startingPrice;
    if (serviceId) { const p = prices.find((x) => x.id === serviceId); if (!p) continue; startingPrice = p.price; }
    else { if (!prices.length) continue; startingPrice = Math.min(...prices.map((p) => p.price)); }
    out.push({
      id: m.id, garageName: m.garageName, city: m.city, lat: m.lat, lng: m.lng, experienceYears: m.experienceYears,
      specialty: m.specialty || prices.slice(0, 2).map((p) => p.name).join(', '),
      distanceKm: Math.round(km * 10) / 10, etaMinutes: V.etaMinutes(km), startingPrice, available: true,
      ...ratingFor(m.id),
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

router.get('/api/public/mechanics', (ctx) => {
  const lat = V.num(ctx.query.lat, -90, 90), lng = V.num(ctx.query.lng, -180, 180);
  if (lat === null || lng === null) throw new HttpError(400, 'Location is required to find mechanics.');
  let serviceId = null;
  if (ctx.query.service) {
    const s = store.get('SELECT id FROM services WHERE slug = ? AND active = 1', String(ctx.query.service));
    if (!s) throw new HttpError(400, 'Unknown service.');
    serviceId = s.id;
  }
  const radiusKm = V.num(ctx.query.radius, 1, 100) || 30;
  return { mechanics: searchMechanics({ lat, lng, serviceId, radiusKm }).slice(0, 20), radiusKm };
});

router.get('/api/public/mechanics/:id', (ctx) => {
  const id = V.int(ctx.params.id, 1, 1e9);
  const m = id && store.get(`SELECT m.user_id AS id, m.garage_name AS garageName, m.city, m.address, m.experience_years AS experienceYears, m.specialty, m.is_available AS available, u.full_name AS ownerName
      FROM mechanics m JOIN users u ON u.id = m.user_id WHERE m.user_id = ? AND m.verification_status = 'approved' AND u.status = 'active'`, id);
  if (!m) throw new HttpError(404, 'Mechanic not found.');
  const services = store.all('SELECT s.slug, s.name, ms.price FROM mechanic_services ms JOIN services s ON s.id = ms.service_id WHERE ms.mechanic_id = ? AND s.active = 1 ORDER BY s.sort', id);
  const reviews = store.all(`SELECT r.rating, r.comment, r.created_at AS createdAt, u.full_name AS name FROM reviews r JOIN users u ON u.id = r.customer_id
      WHERE r.mechanic_id = ? AND r.status = 'visible' ORDER BY r.created_at DESC LIMIT 5`, id).map((r) => ({ ...r, name: r.name.split(' ')[0] }));
  return { mechanic: { ...m, available: !!m.available, services, reviews, ...ratingFor(id) } };
});

// ---- Authenticated file access (documents, repair photos) ----
router.get('/files/:id', guards.anyUser, (ctx) => {
  const f = /^[a-f0-9]{32}$/.test(ctx.params.id) && store.get('SELECT * FROM files WHERE id = ?', ctx.params.id);
  if (!f) throw new HttpError(404, 'File not found.');
  let allowed = ctx.user.role === 'admin' || f.owner_user_id === ctx.user.id;
  if (!allowed && f.booking_id) {
    const b = store.get('SELECT customer_id, mechanic_id FROM bookings WHERE id = ?', f.booking_id);
    allowed = !!b && (b.customer_id === ctx.user.id || b.mechanic_id === ctx.user.id);
  }
  if (!allowed) throw new HttpError(403, 'You do not have access to this file.');
  return raw(files.readUpload(f.id), {
    'Content-Type': f.mime, 'Content-Disposition': `${f.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename="file-${f.id.slice(0, 8)}${f.mime === 'application/pdf' ? '.pdf' : ''}"`,
    'Cache-Control': 'private, max-age=300', 'Content-Security-Policy': "default-src 'none'; sandbox",
  });
});

module.exports = { searchMechanics, ratingFor };
