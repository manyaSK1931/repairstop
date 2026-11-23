'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

fs.mkdirSync(path.dirname(cfg.dbFile), { recursive: true });
fs.mkdirSync(cfg.uploadDir, { recursive: true });

const db = new DatabaseSync(cfg.dbFile);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('customer','mechanic','admin')),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  address TEXT, city TEXT, vehicle TEXT,
  trusted_name TEXT, trusted_phone TEXT, trusted_email TEXT
);
CREATE TABLE IF NOT EXISTS mechanics (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  garage_name TEXT NOT NULL,
  address TEXT NOT NULL, city TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  experience_years INTEGER NOT NULL DEFAULT 0,
  specialty TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','approved','rejected')),
  verification_note TEXT,
  verified_at INTEGER,
  is_available INTEGER NOT NULL DEFAULT 0,
  last_lat REAL, last_lng REAL, last_location_at INTEGER
);
CREATE TABLE IF NOT EXISTS admins (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  base_price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mechanic_services (
  mechanic_id INTEGER NOT NULL REFERENCES mechanics(user_id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  price INTEGER NOT NULL,
  PRIMARY KEY (mechanic_id, service_id)
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  original_name TEXT, mime TEXT NOT NULL, size INTEGER NOT NULL,
  booking_id INTEGER,
  caption TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(user_id),
  mechanic_id INTEGER REFERENCES mechanics(user_id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  status TEXT NOT NULL CHECK (status IN ('open','pending_mechanic','accepted','en_route','arrived','inspecting','estimate_sent','in_progress','completed','paid','cancelled')),
  lat REAL NOT NULL, lng REAL NOT NULL, address TEXT NOT NULL,
  vehicle TEXT, notes TEXT,
  visit_fee INTEGER NOT NULL DEFAULT 0,
  estimate_amount INTEGER, estimate_notes TEXT,
  estimate_status TEXT CHECK (estimate_status IN ('pending','approved','declined')),
  otp TEXT, otp_attempts INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('online','cash')),
  cancel_reason TEXT,
  created_at INTEGER NOT NULL, accepted_at INTEGER, arrived_at INTEGER,
  started_at INTEGER, completed_at INTEGER, cancelled_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_mechanic ON bookings(mechanic_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE TABLE IF NOT EXISTS booking_rejections (
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  mechanic_id INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (booking_id, mechanic_id)
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  amount INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('online','cash')),
  status TEXT NOT NULL CHECK (status IN ('created','pending_cash','paid','failed')),
  provider_order_id TEXT, provider_payment_id TEXT,
  created_at INTEGER NOT NULL, paid_at INTEGER
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  customer_id INTEGER NOT NULL REFERENCES customers(user_id),
  mechanic_id INTEGER NOT NULL REFERENCES mechanics(user_id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, used_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS service_areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sos_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(user_id),
  booking_id INTEGER, lat REAL, lng REAL,
  notified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

// The six services shown on the website. Prices are editable by admins.
const DEFAULT_SERVICES = [
  ['tyre-puncture', 'Tyre and puncture', 'Repair or swap on the spot.', 300],
  ['battery-jump-start', 'Battery jump-start', 'Jump-start or battery replacement.', 300],
  ['fuel-delivery', 'Fuel delivery', 'Fuel brought to your location.', 250],
  ['minor-repairs', 'Minor repairs', 'Brakes, clutch, belts and electrical faults.', 400],
  ['towing', 'Towing', 'Tow to the garage you choose.', 800],
  ['pick-a-garage', 'Pick a garage', 'Book your preferred garage and see its price list.', 200],
];
if (!db.prepare('SELECT COUNT(*) AS n FROM services').get().n) {
  const ins = db.prepare('INSERT INTO services (slug,name,description,base_price,sort) VALUES (?,?,?,?,?)');
  DEFAULT_SERVICES.forEach((s, i) => ins.run(s[0], s[1], s[2], s[3], i));
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (err) { db.exec('ROLLBACK'); throw err; }
}

module.exports = {
  db, tx,
  get: (sql, ...p) => db.prepare(sql).get(...p),
  all: (sql, ...p) => db.prepare(sql).all(...p),
  run: (sql, ...p) => db.prepare(sql).run(...p),
};
