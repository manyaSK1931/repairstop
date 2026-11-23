(function () {
  'use strict';
  const { $, $$, esc, money, badge } = RS;
  const msg = $('#msg');
  const say = (t, type = 'ok') => { RS.alert(msg, type, t); if (t) window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const table = (head, rows) => rows.length ? `<div class="tablewrap"><table class="t"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : '<div class="card muted">Nothing here yet.</div>';
  const yn = (v) => (v ? '<span class="badge teal">yes</span>' : '<span class="badge">no</span>');

  (async function init() {
    const user = await RS.requireRole('admin'); if (!user) return;
    await RS.mountChrome(); $('#who').textContent = user.email;
    $('#logout').addEventListener('click', RS.logout);
    RS.tabs(load); refreshPending();
  })();

  const loaders = { overview, verifications, mechanics, customers, bookings, services, areas, payments, reviews };
  function load(n) { Promise.resolve(loaders[n]()).catch((e) => say(e.message, 'error')); }
  async function refreshPending() { try { const s = await RS.get('/api/admin/stats'); const c = $('#pendCount'); c.textContent = s.pendingVerifications; c.classList.toggle('hidden', !s.pendingVerifications); } catch {} }

  async function overview() {
    const s = await RS.get('/api/admin/stats');
    const items = [['Total customers', s.customers], ['Verified mechanics', s.mechanics], ['Pending verifications', s.pendingVerifications], ['Total bookings', s.totalBookings], ['Active bookings', s.activeBookings], ['Completed bookings', s.completedBookings], ['Cancelled bookings', s.cancelledBookings], ['Revenue collected', money(s.revenue)]];
    $('#statsBox').innerHTML = items.map(([l, v]) => `<div class="stat"><div class="v">${esc(v)}</div><div class="l">${l}</div></div>`).join('');
    refreshPending();
  }

  // ---- Mechanic verification ----
  async function verifications() {
    const { mechanics } = await RS.get('/api/admin/mechanics?status=pending');
    $('#verifyList').innerHTML = mechanics.length ? mechanics.map((m) => `<div class="card stack" data-m="${m.id}"><div class="row between"><div><h3 style="font-size:19px">${esc(m.garageName)}</h3><div class="muted small">${esc(m.fullName)} · ${esc(m.email)} · ${esc(m.phone)}</div></div></div>
      <div class="small">${esc(m.address)}, ${esc(m.city)} · ${m.experienceYears} yrs experience · applied ${RS.when(m.createdAt)}</div><div class="row"><button class="btn sm" data-review="${m.id}">Review documents</button></div></div>`).join('') : '<div class="card muted">No applications waiting for verification.</div>';
  }
  document.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-review]'); if (!r) return;
    try {
      const { mechanic: m } = await RS.get('/api/admin/mechanics/' + r.dataset.review);
      const modal = RS.modal(`<div class="stack"><h2 style="font-size:22px">${esc(m.garageName)}</h2>
        <dl class="kv"><dt>Owner</dt><dd>${esc(m.fullName)}</dd><dt>Email</dt><dd>${esc(m.email)}</dd><dt>Phone</dt><dd>${esc(m.phone)}</dd><dt>Address</dt><dd>${esc(m.address)}, ${esc(m.city)} <a style="color:var(--orange)" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${m.lat},${m.lng}">map</a></dd><dt>Experience</dt><dd>${m.experienceYears} years</dd><dt>Services</dt><dd>${m.services.map((s) => esc(s.name) + ' ' + money(s.price)).join(', ')}</dd></dl>
        <div><div class="label">Documents</div><div class="row" style="margin-top:8px">${m.documents.map((d) => `<a class="btn sm" target="_blank" rel="noopener" href="/files/${d.id}">${esc(d.kind.replace('_', ' '))} (${d.mime === 'application/pdf' ? 'download PDF' : 'view'})</a>`).join('') || 'None'}</div></div>
        <div class="field"><label for="vnote">Reason (required to reject)</label><input id="vnote" maxlength="300" placeholder="e.g. ID photo is unreadable"></div>
        <div class="row"><button class="btn teal" data-d="approve">Approve</button><button class="btn danger" data-d="reject">Reject</button><button class="btn" data-close>Close</button></div></div>`);
      $$('[data-d]', modal.el).forEach((b) => b.addEventListener('click', async () => {
        try { await RS.post(`/api/admin/mechanics/${m.id}/verify`, { decision: b.dataset.d, note: $('#vnote', modal.el).value }); modal.close(); say(b.dataset.d === 'approve' ? 'Mechanic approved and notified.' : 'Application rejected and applicant notified.'); verifications(); refreshPending(); }
        catch (err) { say(err.message, 'error'); modal.close(); }
      }));
    } catch (err) { say(err.message, 'error'); }
  });

  async function mechanics() {
    const { mechanics } = await RS.get('/api/admin/mechanics');
    $('#mechTable').innerHTML = table(['Garage', 'Owner', 'Contact', 'City', 'Verification', 'Online', 'Account', ''], mechanics.map((m) => `<tr><td><strong>${esc(m.garageName)}</strong></td><td>${esc(m.fullName)}</td><td>${esc(m.email)}<br>${esc(m.phone)}</td><td>${esc(m.city)}</td><td>${badge2(m.verificationStatus)}</td><td>${yn(m.available)}</td><td>${esc(m.accountStatus)}</td><td class="row" style="gap:6px"><button class="btn sm" data-review="${m.id}">Details</button><button class="btn sm ${m.accountStatus === 'active' ? 'danger' : ''}" data-suspend="${m.id}" data-to="${m.accountStatus === 'active' ? 'suspended' : 'active'}">${m.accountStatus === 'active' ? 'Suspend' : 'Reactivate'}</button></td></tr>`));
  }
  const badge2 = (s) => `<span class="badge ${s === 'approved' ? 'teal' : s === 'pending' ? 'orange' : ''}">${esc(s)}</span>`;
  async function customers() {
    const { customers } = await RS.get('/api/admin/customers');
    $('#custTable').innerHTML = table(['Name', 'Email', 'Phone', 'Bookings', 'Joined', 'Account', ''], customers.map((c) => `<tr><td>${esc(c.fullName)}</td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${c.bookings}</td><td>${RS.when(c.createdAt)}</td><td>${esc(c.status)}</td><td><button class="btn sm ${c.status === 'active' ? 'danger' : ''}" data-suspend="${c.id}" data-to="${c.status === 'active' ? 'suspended' : 'active'}">${c.status === 'active' ? 'Suspend' : 'Reactivate'}</button></td></tr>`));
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-suspend]'); if (!b) return;
    if (b.dataset.to === 'suspended' && !confirm('Suspend this account? They will be logged out immediately.')) return;
    try { await RS.patch(`/api/admin/users/${b.dataset.suspend}/status`, { status: b.dataset.to }); say('Account updated.'); customers(); mechanics(); } catch (err) { say(err.message, 'error'); }
  });
  async function bookings() {
    const { bookings } = await RS.get('/api/admin/bookings');
    $('#bookTable').innerHTML = table(['#', 'Date', 'Service', 'Customer', 'Mechanic', 'Location', 'Total', 'Status'], bookings.map((b) => `<tr><td>${b.id}</td><td>${RS.when(b.createdAt)}</td><td>${esc(b.service)}</td><td>${esc(b.customer ? b.customer.name : '')}</td><td>${esc(b.mechanic ? b.mechanic.garageName : '—')}</td><td>${esc(b.address)}</td><td>${b.status === 'cancelled' ? '—' : money(b.totalDue)}</td><td>${badge(b.status)}</td></tr>`));
  }

  // ---- Services ----
  async function services() {
    const { services } = await RS.get('/api/admin/services');
    $('#svcTable').innerHTML = table(['Service', 'Description', 'Base price (₹)', 'Active', ''], services.map((s) => `<tr data-s="${s.id}"><td><input value="${esc(s.name)}" data-f="name" aria-label="Name" style="width:100%;min-height:38px;border:1px solid var(--line-strong);border-radius:8px;padding:0 8px"></td><td><input value="${esc(s.description || '')}" data-f="description" aria-label="Description" style="width:100%;min-height:38px;border:1px solid var(--line-strong);border-radius:8px;padding:0 8px"></td><td><input type="number" min="0" value="${s.basePrice}" data-f="basePrice" aria-label="Base price" style="width:100px;min-height:38px;border:1px solid var(--line-strong);border-radius:8px;padding:0 8px"></td><td><input type="checkbox" data-f="active" ${s.active ? 'checked' : ''} aria-label="Active"></td><td><button class="btn sm primary" data-savesvc="${s.id}">Save</button></td></tr>`));
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-savesvc]'); if (!b) return; const tr = b.closest('tr'), g = (f) => $(`[data-f="${f}"]`, tr);
    try { await RS.put('/api/admin/services/' + b.dataset.savesvc, { name: g('name').value, description: g('description').value, basePrice: g('basePrice').value, active: g('active').checked }); say('Service saved.'); } catch (err) { say(err.message, 'error'); }
  });
  $('#svcForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await RS.post('/api/admin/services', { name: f.name.value, description: f.description.value, basePrice: f.basePrice.value }); f.reset(); say('Service added.'); services(); } catch (err) { say(err.message, 'error'); } });

  // ---- Coverage ----
  async function areas() {
    const { areas } = await RS.get('/api/admin/areas');
    $('#areaBox').innerHTML = areas.length ? areas.map((a) => `<span class="badge" style="font-size:14px;padding:8px 14px">${esc(a.city)} <button class="link" data-delarea="${a.id}" aria-label="Remove ${esc(a.city)}" style="margin-left:6px;color:var(--orange-dark)">✕</button></span>`).join('') : '<div class="card muted" style="width:100%">No cities listed yet. The website shows only “More coming soon” until you add cities.</div>';
  }
  document.addEventListener('click', async (e) => { const b = e.target.closest('[data-delarea]'); if (!b) return; try { await RS.del('/api/admin/areas/' + b.dataset.delarea); areas(); } catch (err) { say(err.message, 'error'); } });
  $('#areaForm').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; try { await RS.post('/api/admin/areas', { city: f.city.value }); f.reset(); areas(); } catch (err) { say(err.message, 'error'); } });

  async function payments() {
    const { payments } = await RS.get('/api/admin/payments');
    $('#payTable').innerHTML = table(['Date', 'Booking', 'Customer', 'Garage', 'Method', 'Amount', 'Status', 'Provider ref'], payments.map((p) => `<tr><td>${RS.when(p.paidAt || p.createdAt)}</td><td>#${p.bookingId}</td><td>${esc(p.customer)}</td><td>${esc(p.garage || '—')}</td><td>${esc(p.method)}</td><td>${money(p.amount)}</td><td>${esc(p.status)}</td><td>${esc(p.providerPaymentId || '')}</td></tr>`));
  }
  async function reviews() {
    const { reviews } = await RS.get('/api/admin/reviews');
    $('#revTable').innerHTML = table(['Date', 'Customer', 'Garage', 'Rating', 'Comment', 'Status', ''], reviews.map((r) => `<tr><td>${RS.when(r.createdAt)}</td><td>${esc(r.customer)}</td><td>${esc(r.garage)}</td><td class="stars">${RS.stars(r.rating)}</td><td>${esc(r.comment || '')}</td><td>${esc(r.status)}</td><td><button class="btn sm" data-rev="${r.id}" data-to="${r.status === 'visible' ? 'hidden' : 'visible'}">${r.status === 'visible' ? 'Hide' : 'Show'}</button></td></tr>`));
  }
  document.addEventListener('click', async (e) => { const b = e.target.closest('[data-rev]'); if (!b) return; try { await RS.patch('/api/admin/reviews/' + b.dataset.rev, { status: b.dataset.to }); reviews(); } catch (err) { say(err.message, 'error'); } });
})();
