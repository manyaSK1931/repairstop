'use strict';
const store = require('./db');
const V = require('./validate');

const ACTIVE = ['open', 'pending_mechanic', 'accepted', 'en_route', 'arrived', 'inspecting', 'estimate_sent', 'in_progress', 'completed'];
const totalDue = (b) => b.visit_fee + (b.estimate_status === 'approved' ? b.estimate_amount || 0 : 0);

const BASE_SQL = `SELECT b.*, s.name AS service_name, s.slug AS service_slug,
    cu.full_name AS customer_name, cu.phone AS customer_phone,
    mu.full_name AS mechanic_owner, mu.phone AS mechanic_phone,
    m.garage_name, m.last_lat, m.last_lng, m.last_location_at, m.lat AS garage_lat, m.lng AS garage_lng
  FROM bookings b
  JOIN services s ON s.id = b.service_id
  JOIN users cu ON cu.id = b.customer_id
  LEFT JOIN users mu ON mu.id = b.mechanic_id
  LEFT JOIN mechanics m ON m.user_id = b.mechanic_id`;
const loadBooking = (id) => store.get(BASE_SQL + ' WHERE b.id = ?', id);

// role: 'customer' | 'mechanic' | 'admin'. Sensitive fields are only included when the viewer is entitled to them.
function view(b, role) {
  const assigned = !!b.mechanic_id && !['open', 'pending_mechanic'].includes(b.status);
  const photos = store.all('SELECT id, caption, created_at AS createdAt FROM files WHERE booking_id = ? AND kind = ? ORDER BY created_at', b.id, 'repair_photo');
  const pay = store.get('SELECT method, status, amount, paid_at AS paidAt FROM payments WHERE booking_id = ? ORDER BY id DESC LIMIT 1', b.id);
  const review = store.get('SELECT rating, comment FROM reviews WHERE booking_id = ?', b.id);
  const out = {
    id: b.id, status: b.status, service: b.service_name, serviceSlug: b.service_slug, vehicle: b.vehicle, notes: b.notes,
    visitFee: b.visit_fee, estimateAmount: b.estimate_amount, estimateNotes: b.estimate_notes, estimateStatus: b.estimate_status,
    totalDue: totalDue(b), paymentMethod: b.payment_method, payment: pay || null, review: review || null, photos,
    createdAt: b.created_at, acceptedAt: b.accepted_at, arrivedAt: b.arrived_at, startedAt: b.started_at, completedAt: b.completed_at, cancelledAt: b.cancelled_at, cancelReason: b.cancel_reason,
  };
  if (role === 'customer' || role === 'admin') {
    out.address = b.address; out.lat = b.lat; out.lng = b.lng;
    out.mechanic = b.mechanic_id ? { id: b.mechanic_id, garageName: b.garage_name, ownerName: b.mechanic_owner } : null;
    if (b.mechanic_id && assigned) out.mechanic.phone = b.mechanic_phone;
    if (assigned && b.last_lat != null && ['accepted', 'en_route', 'arrived', 'inspecting', 'estimate_sent', 'in_progress'].includes(b.status)) {
      out.mechanicLocation = { lat: b.last_lat, lng: b.last_lng, updatedAt: b.last_location_at };
      out.distanceKm = Math.round(V.haversineKm(b.lat, b.lng, b.last_lat, b.last_lng) * 10) / 10;
      out.etaMinutes = V.etaMinutes(out.distanceKm);
    }
    // The start code is shown to the customer only until the mechanic has entered it
    if (role === 'customer' && ['accepted', 'en_route', 'arrived'].includes(b.status)) out.otp = b.otp;
    out.customer = role === 'admin' ? { name: b.customer_name, phone: b.customer_phone } : undefined;
  }
  if (role === 'mechanic' || role === 'admin') {
    out.customerFirstName = b.customer_name.split(' ')[0];
    if (assigned || role === 'admin') { out.customerName = b.customer_name; out.customerPhone = b.customer_phone; out.address = b.address; out.lat = b.lat; out.lng = b.lng; }
  }
  return out;
}

module.exports = { ACTIVE, totalDue, loadBooking, view, BASE_SQL };
