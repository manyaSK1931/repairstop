(function () {
  'use strict';
  const { $, $$, esc, money, badge } = RS;
  const msg = $('#msg');
  const say = (t, type = 'ok') => { RS.alert(msg, type, t); if (t) window.scrollTo({ top: 0, behavior: 'smooth' }); };
  let bookings = [], lastJson = '', current = 'bookings';
  const highlight = parseInt(new URLSearchParams(location.search).get('b') || '0', 10);

  (async function init() {
    const user = await RS.requireRole('customer'); if (!user) return;
    await RS.mountChrome();
    $('#hello').textContent = 'Hello, ' + user.fullName.split(' ')[0];
    $('#who').textContent = user.email + ' · ' + (user.phone || '');
    $('#logout').addEventListener('click', RS.logout);
    RS.tabs((name) => { current = name; load(name); });
    setInterval(() => { if (!document.hidden && current === 'bookings') refreshBookings(true); }, 5000);
  })();

  function load(name) {
    if (name === 'bookings' || name === 'history' || name === 'reviews') refreshBookings(false);
    if (name === 'payments') loadPayments();
    if (name === 'reviews') loadReviews();
    if (name === 'profile' || name === 'safety') loadProfile();
  }

  // ---------- Bookings ----------
  async function refreshBookings(silent) {
    try {
      const { bookings: b } = await RS.get('/api/customer/bookings');
      const json = JSON.stringify(b); const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && $('#activeList').contains(document.activeElement);
      if (silent && (json === lastJson || typing)) return;
      lastJson = json; bookings = b; renderBookings(); renderHistory(); renderReviewTodo();
    } catch (e) { if (!silent) say(e.message, 'error'); }
  }
  const ACTIVE = ['open', 'pending_mechanic', 'accepted', 'en_route', 'arrived', 'inspecting', 'estimate_sent', 'in_progress', 'completed'];
  const CANCELLABLE = ['open', 'pending_mechanic', 'accepted', 'en_route', 'arrived'];

  function reviewForm(b) {
    if (!b.mechanic || b.review || !['completed', 'paid'].includes(b.status)) return '';
    return `<form class="stack" data-review="${b.id}" style="border-top:1px solid var(--line);padding-top:14px"><div class="label">How was ${esc(b.mechanic.garageName)}?</div>
      <div class="starpick" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div>
      <div class="field"><textarea name="comment" maxlength="1000" placeholder="Tell other drivers about your experience (optional)" aria-label="Review"></textarea></div>
      <button class="btn sm primary" type="submit" style="align-self:flex-start">Submit review</button></form>`;
  }

  function card(b) {
    const m = b.mechanic, live = b.mechanicLocation;
    let h = `<div class="card stack" id="bk${b.id}"><div class="row between"><div><h3 style="font-size:19px">${esc(b.service)} <span class="muted small">#${b.id}</span></h3><div class="muted small">${RS.when(b.createdAt)}</div></div>${badge(b.status)}</div>${RS.timeline(b.status)}`;
    if (b.status === 'open') h += '<div class="alert info">Nearby verified mechanics have been notified. The first to accept gets your job and you will see them here.</div>';
    if (b.status === 'pending_mechanic') h += `<div class="alert info">Waiting for ${esc(m ? m.garageName : 'the mechanic')} to accept. If they do not respond, cancel and choose another mechanic.</div>`;
    h += `<dl class="kv"><dt>Vehicle location</dt><dd>${esc(b.address)}</dd>${b.vehicle ? `<dt>Vehicle</dt><dd>${esc(b.vehicle)}</dd>` : ''}${m ? `<dt>Mechanic</dt><dd>${esc(m.garageName)}${m.ownerName ? ' (' + esc(m.ownerName) + ')' : ''}${m.phone ? ` · <a href="tel:${esc(m.phone)}" style="color:var(--orange)">${esc(m.phone)}</a>` : ''}</dd>` : ''}<dt>Visit fee</dt><dd>${money(b.visitFee)}</dd>${b.estimateAmount ? `<dt>Repair estimate</dt><dd>${money(b.estimateAmount)} <span class="badge ${b.estimateStatus === 'approved' ? 'teal' : 'orange'}">${esc(b.estimateStatus)}</span></dd>` : ''}${['completed', 'paid'].includes(b.status) ? `<dt>Total</dt><dd><strong>${money(b.totalDue)}</strong></dd>` : ''}</dl>`;
    if (live && ['accepted', 'en_route', 'arrived'].includes(b.status)) {
      h += `<div>${RS.mapSvg()}<div class="small muted" style="margin-top:6px">Live: mechanic is about <strong>${b.distanceKm} km</strong> away (~${b.etaMinutes} min, estimated). Updated ${RS.when(live.updatedAt)}.</div></div>`;
    }
    if (b.otp) h += `<div class="stack" style="gap:8px"><div class="label">Your start code</div><div><span class="otp">${esc(b.otp)}</span></div><div class="small muted">Give this code to the mechanic only after they arrive and you recognise them. The job cannot start without it.</div></div>`;
    if (b.status === 'estimate_sent') h += `<div class="alert info stack" style="gap:10px"><div><strong>Repair estimate: ${money(b.estimateAmount)}</strong></div><div>${esc(b.estimateNotes || '')}</div><div class="small">Approve to start the repair. Decline and you pay only the visit fee (${money(b.visitFee)}).</div><div class="row"><button class="btn teal sm" data-act="approve" data-id="${b.id}">Approve estimate</button><button class="btn sm danger" data-act="decline" data-id="${b.id}">Decline</button></div></div>`;
    if (b.estimateStatus === 'declined') h += `<div class="small muted">You declined the repair. <a href="/book?service=towing" style="color:var(--orange)">Book a tow to a garage</a> if needed.</div>`;
    if (b.photos.length) h += `<div><div class="label">Photos from the mechanic</div><div class="row" style="margin-top:8px">${b.photos.map((p) => `<a href="/files/${p.id}" target="_blank" rel="noopener"><img src="/files/${p.id}" alt="${esc(p.caption || 'Repair photo')}" style="width:96px;height:96px;object-fit:cover;border-radius:10px;border:1px solid var(--line)"></a>`).join('')}</div></div>`;
    if (b.status === 'completed') {
      if (b.paymentMethod === 'cash' && b.payment && b.payment.status === 'pending_cash') h += `<div class="alert info">Hand ${money(b.totalDue)} in cash to the mechanic. This booking closes when they confirm receipt.</div>`;
      else h += `<div class="alert info stack" style="gap:10px"><div><strong>Amount due: ${money(b.totalDue)}</strong></div><div class="row"><button class="btn primary sm" data-act="payOnline" data-id="${b.id}">Pay online</button><button class="btn sm" data-act="payCash" data-id="${b.id}">Pay cash to mechanic</button></div></div>`;
    }
    if (b.status === 'paid' && b.payment) h += `<div class="small muted">Paid ${money(b.payment.amount)} by ${esc(b.payment.method)}${b.payment.paidAt ? ' on ' + RS.when(b.payment.paidAt) : ''}.</div>`;
    h += reviewForm(b);
    const acts = [];
    if (CANCELLABLE.includes(b.status)) acts.push(`<button class="btn sm danger" data-act="cancel" data-id="${b.id}">Cancel booking</button>`);
    if (['accepted', 'en_route', 'arrived', 'inspecting', 'estimate_sent', 'in_progress'].includes(b.status)) acts.push(`<button class="btn sm danger" data-act="sos" data-id="${b.id}">SOS</button><a class="btn sm" href="/police">Nearby police</a>`);
    if (acts.length) h += `<div class="row">${acts.join('')}</div>`;
    return h + '</div>';
  }

  function renderBookings() {
    const act = bookings.filter((b) => ACTIVE.includes(b.status)), box = $('#activeList');
    box.innerHTML = act.length ? act.map(card).join('') : `<div class="card stack" style="text-align:center"><h3 style="font-size:20px">No active bookings</h3><p class="muted" style="margin:0">When you request help, you can follow your mechanic here live.</p><div><a class="btn primary" href="/book">Book roadside assistance</a></div></div>`;
    act.forEach((b) => { if (b.mechanicLocation && ['accepted', 'en_route', 'arrived'].includes(b.status)) { const svg = $('#bk' + b.id + ' svg.map'); if (svg) RS.drawMap(svg, { lat: b.lat, lng: b.lng }, [{ lat: b.mechanicLocation.lat, lng: b.mechanicLocation.lng, label: b.mechanic.garageName }]); } });
    wireStars(box);
    if (highlight) { const el = $('#bk' + highlight); if (el && !renderBookings.done) { el.scrollIntoView({ block: 'center' }); renderBookings.done = true; } }
  }
  function renderHistory() {
    const h = bookings.filter((b) => !ACTIVE.includes(b.status) || b.status === 'paid');
    $('#historyList').innerHTML = h.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>#</th><th>Date</th><th>Service</th><th>Mechanic</th><th>Total</th><th>Status</th></tr></thead><tbody>${h.map((b) => `<tr><td>${b.id}</td><td>${RS.when(b.createdAt)}</td><td>${esc(b.service)}</td><td>${esc(b.mechanic ? b.mechanic.garageName : '—')}</td><td>${b.status === 'cancelled' ? '—' : money(b.totalDue)}</td><td>${badge(b.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card muted">No past bookings yet.</div>';
  }
  function renderReviewTodo() {
    const todo = bookings.filter((b) => b.mechanic && !b.review && ['completed', 'paid'].includes(b.status));
    $('#reviewTodo').innerHTML = todo.length ? `<h2 style="font-size:20px">Waiting for your review</h2>` + todo.map((b) => `<div class="card stack"><div><strong>${esc(b.service)}</strong> <span class="muted small">#${b.id} · ${esc(b.mechanic.garageName)}</span></div>${reviewForm(b)}</div>`).join('') : '';
    wireStars($('#reviewTodo'));
  }
  async function loadReviews() {
    try {
      const { reviews } = await RS.get('/api/customer/reviews');
      $('#reviewList').innerHTML = (reviews.length ? '<h2 style="font-size:20px">Your reviews</h2>' : '') + (reviews.length ? reviews.map((r) => `<div class="card tight"><div class="row between"><strong>${esc(r.garageName)}</strong><span class="stars">${RS.stars(r.rating)}</span></div><div>${esc(r.comment || '')}</div><div class="muted small">${RS.when(r.createdAt)}${r.status === 'hidden' ? ' · hidden by moderators' : ''}</div></div>`).join('') : '<div class="card muted">You have not reviewed any service yet.</div>');
    } catch (e) { say(e.message, 'error'); }
  }
  function wireStars(root) {
    $$('form[data-review]', root).forEach((f) => {
      if (f.dataset.wired) return; f.dataset.wired = 1; let rating = 0;
      $$('[data-star]', f).forEach((b) => b.addEventListener('click', () => { rating = +b.dataset.star; $$('[data-star]', f).forEach((x) => x.classList.toggle('on', +x.dataset.star <= rating)); }));
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); if (!rating) return say('Choose a star rating first.', 'error');
        try { await RS.post(`/api/customer/bookings/${f.dataset.review}/review`, { rating, comment: f.elements.comment.value }); say('Thanks for your review.'); lastJson = ''; refreshBookings(false); loadReviews(); } catch (err) { say(err.message, 'error'); }
      });
    });
  }

  // ---------- Actions ----------
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.dataset.id, act = b.dataset.act; b.disabled = true; RS.alert(msg, '', '');
    try {
      if (act === 'cancel') { if (!confirm('Cancel this booking?')) return; await RS.post(`/api/customer/bookings/${id}/cancel`, {}); }
      else if (act === 'approve' || act === 'decline') await RS.post(`/api/customer/bookings/${id}/estimate`, { approve: act === 'approve' });
      else if (act === 'payCash') { const r = await RS.post(`/api/customer/bookings/${id}/pay`, { method: 'cash' }); say(r.message, 'ok'); }
      else if (act === 'payOnline') await payOnline(id);
      else if (act === 'sos') await sos(parseInt(id, 10));
      lastJson = ''; await refreshBookings(false);
    } catch (err) { say(err.message, 'error'); } finally { b.disabled = false; }
  });

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the payment window. Check your connection or pay in cash.')); document.head.appendChild(s); });
  }
  async function payOnline(id) {
    const o = await RS.post(`/api/customer/bookings/${id}/pay`, { method: 'online' });
    await loadRazorpay();
    await new Promise((resolve, reject) => {
      const rz = new window.Razorpay({ key: o.keyId, order_id: o.orderId, amount: o.amount * 100, currency: 'INR', name: 'RepairStop', description: 'Booking #' + id, theme: { color: '#C2410C' },
        handler: async (resp) => { try { await RS.post(`/api/customer/bookings/${id}/pay/verify`, resp); say('Payment received. Thank you!'); resolve(); } catch (e) { reject(e); } },
        modal: { ondismiss: () => reject(new Error('Payment was cancelled. You can try again.')) } });
      rz.on('payment.failed', () => reject(new Error('Payment failed. You were not charged, or the amount will be refunded. Please try again.')));
      rz.open();
    });
  }
  async function sos(bookingId) {
    if (!confirm('Send an SOS alert to your trusted contact?')) return;
    let pos = {}; try { pos = await RS.getPosition(); } catch {}
    const r = await RS.post('/api/customer/sos', { bookingId, lat: pos.lat, lng: pos.lng });
    if (r.notified) say(`SOS sent to ${r.trustedName || 'your trusted contact'} with your last known location. If you are in danger, call 112 now.`, 'ok');
    else say(`${r.hasTrustedContact ? 'We could not send the email.' : 'You have not added a trusted contact email yet (see “SOS and trusted contact”).'} If you are in danger, call 112 now.${r.trustedPhone ? ' Call ' + r.trustedPhone + '.' : ''}`, 'error');
  }

  // ---------- Payments ----------
  async function loadPayments() {
    try {
      const { payments } = await RS.get('/api/customer/payments');
      $('#payList').innerHTML = payments.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>Booking</th><th>Service</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead><tbody>${payments.map((p) => `<tr><td>${RS.when(p.paidAt || p.createdAt)}</td><td>#${p.bookingId}</td><td>${esc(p.service)}</td><td>${esc(p.method)}</td><td>${money(p.amount)}</td><td>${p.status === 'paid' ? '<span class="badge teal">Paid</span>' : '<span class="badge orange">Awaiting cash confirmation</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card muted">No payments yet.</div>';
    } catch (e) { say(e.message, 'error'); }
  }

  // ---------- Profile / safety / password ----------
  async function loadProfile() {
    try {
      const { profile: p } = await RS.get('/api/customer/profile');
      const f = $('#profileForm'), s = $('#safetyForm');
      f.fullName.value = p.fullName || ''; f.phone.value = p.phone || ''; $('#pemail').value = p.email; f.address.value = p.address || ''; f.city.value = p.city || ''; f.vehicle.value = p.vehicle || '';
      s.trustedName.value = p.trustedName || ''; s.trustedPhone.value = p.trustedPhone || ''; s.trustedEmail.value = p.trustedEmail || '';
      loadProfile.data = p;
    } catch (e) { say(e.message, 'error'); }
  }
  async function saveProfile(form, extra) {
    const p = loadProfile.data || (await RS.get('/api/customer/profile')).profile;
    const body = { fullName: p.fullName, phone: p.phone, address: p.address, city: p.city, vehicle: p.vehicle, trustedName: p.trustedName, trustedPhone: p.trustedPhone, trustedEmail: p.trustedEmail, ...extra };
    RS.showFieldErrors(form, {});
    try { const r = await RS.put('/api/customer/profile', body); say(r.message); await loadProfile(); } catch (err) { RS.showFieldErrors(form, err.fields); say(err.message, 'error'); }
  }
  $('#profileForm').addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; saveProfile(f, { fullName: f.fullName.value, phone: f.phone.value, address: f.address.value, city: f.city.value, vehicle: f.vehicle.value }); });
  $('#safetyForm').addEventListener('submit', (e) => { e.preventDefault(); const f = e.target; saveProfile(f, { trustedName: f.trustedName.value, trustedPhone: f.trustedPhone.value, trustedEmail: f.trustedEmail.value }); });
  $('#sosBtn').addEventListener('click', async () => { try { const act = bookings.find((b) => ['accepted', 'en_route', 'arrived', 'inspecting', 'estimate_sent', 'in_progress'].includes(b.status)); await sos(act ? act.id : undefined); } catch (e) { say(e.message, 'error'); } });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; RS.showFieldErrors(f, {});
    try { const r = await RS.post('/api/auth/change-password', { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value, confirmPassword: f.confirmPassword.value }); say(r.message); f.reset(); } catch (err) { RS.showFieldErrors(f, err.fields); say(err.message, 'error'); }
  });
})();
