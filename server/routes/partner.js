'use strict';
const store = require('../db');
const auth = require('../auth');
const files = require('../files');
const { router } = require('../http');
const { validateAccountFields } = require('./auth');
const V = require('../validate');
const { HttpError } = V;

const DOC_KINDS = ['id_proof', 'address_proof', 'garage_license'];

router.post('/api/partner/register', null, async (ctx) => {
  if (!auth.rateLimit('partner:' + ctx.ip, 15, 3600e3)) throw new HttpError(429, 'Too many attempts. Try again later.');
  const b = ctx.body, errors = {};
  const f = validateAccountFields(b, errors);
  const garageName = V.str(b.garageName, 120), address = V.str(b.address, 300), city = V.str(b.city, 80);
  const experience = V.int(b.experienceYears, 0, 60);
  const lat = V.num(b.lat, -90, 90), lng = V.num(b.lng, -180, 180);
  if (garageName.length < 2) errors.garageName = 'Enter your garage or business name.';
  if (address.length < 5) errors.address = 'Enter your full address.';
  if (city.length < 2) errors.city = 'Enter your city.';
  if (experience === null) errors.experienceYears = 'Enter years of experience (0 to 60).';
  if (lat === null || lng === null) errors.address = 'We could not locate this address. Use "Locate my garage" or refine the address.';
  // Services offered with the partner's own price for each
  const svcRows = store.all('SELECT id, slug FROM services WHERE active = 1');
  const offered = [];
  for (const s of Array.isArray(b.services) ? b.services : []) {
    const svc = svcRows.find((x) => x.slug === s.slug);
    const price = V.int(s.price, 1, 100000);
    if (svc && price) offered.push({ id: svc.id, price });
  }
  if (!offered.length) errors.services = 'Select at least one service and enter your starting price for it.';
  const docs = Array.isArray(b.documents) ? b.documents.slice(0, 3) : [];
  if (!docs.some((d) => d && d.kind === 'id_proof')) errors.documents = 'Upload a government ID (required).';
  if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);
  if (store.get('SELECT 1 AS x FROM users WHERE email = ?', f.email)) throw new HttpError(409, 'This email is already registered.', { email: 'This email is already registered. Try logging in.' });

  // Validate every file before touching the database
  const prepared = docs.map((d) => {
    if (!DOC_KINDS.includes(d.kind)) throw new HttpError(400, 'Unknown document type.');
    return d;
  });
  const savedFiles = [];
  try {
    store.tx(() => {
      const r = store.run('INSERT INTO users (role,full_name,email,phone,password_hash,created_at) VALUES (?,?,?,?,?,?)', 'mechanic', f.fullName, f.email, f.phone, auth.hashPassword(b.password), Date.now());
      const id = Number(r.lastInsertRowid);
      store.run('INSERT INTO mechanics (user_id,garage_name,address,city,lat,lng,experience_years) VALUES (?,?,?,?,?,?,?)', id, garageName, address, city, lat, lng, experience);
      for (const o of offered) store.run('INSERT INTO mechanic_services (mechanic_id,service_id,price) VALUES (?,?,?)', id, o.id, o.price);
      for (const d of prepared) savedFiles.push(files.saveUpload({ ownerId: id, kind: d.kind, file: d }));
    });
  } catch (e) {
    for (const id of savedFiles) { try { require('fs').unlinkSync(require('path').join(require('../config').uploadDir, id)); } catch {} }
    store.run('DELETE FROM files WHERE id IN (' + (savedFiles.map(() => '?').join(',') || "''") + ')', ...savedFiles);
    throw e;
  }
  return { ok: true, message: 'Application received. You can log in while our team reviews your documents. You will be notified once approved.' };
}, { bodyLimit: 18 * 1024 * 1024 });
