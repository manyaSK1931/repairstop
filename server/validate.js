'use strict';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9]{10,13}$/;

class HttpError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const normEmail = (v) => str(v, 254).toLowerCase();
const normPhone = (v) => str(v, 20).replace(/[\s-]/g, '');

function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters.';
  if (pw.length > 128) return 'Password must be at most 128 characters.';
  if (!/[a-z]/.test(pw)) return 'Password needs a lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password needs an uppercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password needs a number.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password needs a special character.';
  return null;
}
function num(v, min, max) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
const int = (v, min, max) => { const n = num(v, min, max); return n === null ? null : Math.round(n); };

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
// Estimated arrival: ~5 min dispatch + 25 km/h average urban speed. Shown as an estimate, never as a guarantee.
const etaMinutes = (km) => Math.max(5, Math.round(5 + (km / 25) * 60));

module.exports = { EMAIL_RE, PHONE_RE, HttpError, str, normEmail, normPhone, passwordProblem, num, int, haversineKm, etaMinutes };
