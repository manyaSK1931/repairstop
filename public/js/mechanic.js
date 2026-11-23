(function () {
  'use strict';
  const { $, $$, esc, money, badge } = RS;
  const msg = $('#msg');
  const say = (t, type = 'ok') => { RS.alert(msg, type, t); if (t) window.scrollTo({ top: 0, behavior: 'smooth' }); };
  let profile = null, bookings = [], jobsJson = '', actJson = '', current = 'jobs', coords = null, lastSent = 0, watchId = null;
  const approved = () => profile && profile.verificationStatus === 'approved';
  const ACTIVE = ['accepted', 'en_route', 'arrived', 'inspecting', 'estimate_sent', 'in_progress', 'completed'];

  (async function init() {
    const user = await RS.requireRole('mechanic'); if (!user) return;
    await RS.mountChrome();
    $('#logout').addEventListener('click', RS.logout);
    await loadProfile();
    RS.tabs((n) => { current = n; load(n); });
    setInterval(() => { if (document.hidden || !approved()) return; if (current === 'jobs') loadJobs(true); if (current === 'active') loadBookings(true); }, 8000);
    if (approved()) { loadJobs(true); startTracking(); }
  })();

  function load(n) {
    if (!approved() && ['jobs', 'active', 'earnings'].includes(n)) { const msgHtml = '<div class="card muted">This section unlocks once an administrator verifies your account.</div>'; if (n === 'jobs') $('#jobList').innerHTML = msgHtml; if (n === 'active') $('#activeList').innerHTML = msgHtml; if (n === 'earnings') $('#earnBox').innerHTML = msgHtml; return; }
    if (n === 'jobs') loadJobs(false);
    if (n === 'active' || n === 'history') loadBookings(false);
    if (n === 'earnings') loadEarnings();
  }

  // ---------- Profile / verification / availability ----------
  async function loadProfile() {
    const { profile: p } = await RS.get('/api/mechanic/profile'); profile = p;
    $('#hello').textContent = p.garageName; $('#who').textContent = `${p.fullName} · ${p.email}` + (p.rating !== null ? ` · ★ ${p.rating.toFixed(1)} (${p.reviewCount})` : ' · no reviews yet');
    const banner = $('#banner');
    if (p.verificationStatus === 'pending') RS.alert(banner, 'info', 'Your application is awaiting administrator verification. You will receive an email once approved. You can review your profile meanwhile.');
    else if (p.verificationStatus === 'rejected') RS.alert(banner, 'error', 'Your application was not approved.' + (p.verificationNote ? ' Reason: ' + p.verificationNote : '') + ' Contact support to resubmit.');
    else RS.alert(banner, '', '');
    const t = $('#availToggle'); t.checked = p.available; t.disabled = !approved(); setAvail(p.available);
    fillProfile(p);
  }
  function setAvail(on) { $('#availLabel').textContent = on ? 'Online - receiving jobs' : 'Offline'; }
  $('#availToggle').addEventListener('change', async (e) => {
    try { const r = await RS.post('/api/mechanic/availability', { available: e.target.checked }); setAvail(r.available); if (r.available) { startTracking(); setTimeout(() => sendLocation(true), 800); loadJobs(false); } }
    catch (err) { e.target.checked = !e.target.checked; say(err.message, 'error'); }
  });

  // ---------- Live location sharing ----------
  // watchPosition only fires when the position CHANGES, so we also send immediately (going online, accepting,
  // status changes) and on a 15-second heartbeat while online or on a job.
  const sharing = () => $('#availToggle').checked || bookings.some((b) => ['accepted', 'en_route', 'arrived'].includes(b.status));
  function sendLocation(force) {
    if (!coords || !approved() || (!force && !sharing()) || Date.now() - lastSent < 3000) return;
    lastSent = Date.now(); RS.post('/api/mechanic/location', coords).catch(() => {});
  }
  function startTracking() {
    if (watchId !== null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition((p) => {
      coords = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (Date.now() - lastSent > 15000) sendLocation(false);
    }, () => { $('#locHint').textContent = 'Turn on location permission so customers can track you and you see jobs near you.'; }, { enableHighAccuracy: true, maximumAge: 10000 });
    setInterval(() => { if (!document.hidden) sendLocation(false); }, 15000);
  }

  // ---------- Jobs ----------
  async function loadJobs(silent) {
    try {
      const { jobs } = await RS.get('/api/mechanic/jobs/available');
      const json = JSON.stringify(jobs); if (silent && json === jobsJson) return; jobsJson = json;
      const c = $('#jobCount'); c.textContent = jobs.length; c.classList.toggle('hidden', !jobs.length);
      $('#locHint').textContent = $('#availToggle').checked ? 'You are online. Jobs within 25 km that match your services appear here.' : 'You are offline. Switch to online (top right) to accept jobs.';
      $('#jobList').innerHTML = jobs.length ? jobs.map((j) => `<div class="card stack"><div class="row between"><div><h3 style="font-size:19px">${esc(j.service)}</h3><div class="muted small">${esc(j.customerFirstName)} · ${j.distanceKm} km away · ~${j.etaMinutes} min</div></div>${j.directRequest ? '<span class="badge orange">Chosen you</span>' : '<span class="badge">Open request</span>'}</div>
        ${j.vehicle ? `<div class="small">Vehicle: ${esc(j.vehicle)}</div>` : ''}${j.notes ? `<div class="small">Note: ${esc(j.notes)}</div>` : ''}<div>Your visit fee: <strong>${money(j.yourPrice)}</strong></div>
        <div class="small muted">The exact address and phone number are shown after you accept.</div>
        <div class="row"><button class="btn teal sm" data-act="accept" data-id="${j.id}">Accept job</button><button class="btn sm danger" data-act="reject" data-id="${j.id}">Decline</button></div></div>`).join('') : '<div class="card muted">No jobs nearby right now. Keep this page open while online and new requests will appear.</div>';
    } catch (e) { if (!silent) say(e.message, 'error'); }
  }

  // ---------- My bookings ----------
  async function loadBookings(silent) {
    try {
      const { bookings: b } = await RS.get('/api/mechanic/bookings'); bookings = b;
      const act = b.filter((x) => ACTIVE.includes(x.status)), json = JSON.stringify(act);
      const typing = document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && $('#activeList').contains(document.activeElement);
      if (!(silent && (json === actJson || typing))) { actJson = json; renderActive(act); }
      const hist = b.filter((x) => !ACTIVE.includes(x.status) || x.status === 'paid');
      $('#historyList').innerHTML = hist.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>#</th><th>Date</th><th>Service</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead><tbody>${hist.map((x) => `<tr><td>${x.id}</td><td>${RS.when(x.createdAt)}</td><td>${esc(x.service)}</td><td>${esc(x.customerName || x.customerFirstName)}</td><td>${x.status === 'cancelled' ? '—' : money(x.totalDue)}</td><td>${badge(x.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card muted">No finished jobs yet.</div>';
    } catch (e) { if (!silent) say(e.message, 'error'); }
  }

  function photoBox(b) { return `<div class="row"><label class="btn sm" style="cursor:pointer">Upload repair photo<input type="file" accept="image/jpeg,image/png,image/webp" data-photo="${b.id}" class="sr"></label><span class="small muted">${b.photos.length} uploaded</span></div>`; }
  function controls(b) {
    const s = b.status;
    if (s === 'accepted') return `<div class="row"><button class="btn sm primary" data-act="status" data-st="en_route" data-id="${b.id}">I am on my way</button><button class="btn sm" data-act="status" data-st="arrived" data-id="${b.id}">I have arrived</button></div>`;
    if (s === 'en_route') return `<button class="btn sm primary" data-act="status" data-st="arrived" data-id="${b.id}">I have arrived</button>`;
    if (s === 'arrived') return `<form class="row" data-form="start" data-id="${b.id}"><div class="field"><input name="otp" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="4-digit code" aria-label="Customer start code" style="max-width:170px" required></div><button class="btn sm primary" type="submit">Start job</button><span class="small muted">Ask the customer for the code shown in their app.</span></form>`;
    if (s === 'inspecting') return `<form class="stack" data-form="estimate" data-id="${b.id}"><div class="label">Inspection done? Send the repair estimate</div><div class="grid cols-2"><div class="field"><input name="amount" type="number" min="1" placeholder="Repair cost (₹), excluding visit fee" aria-label="Estimate amount" required></div><div class="field"><textarea name="notes" maxlength="800" placeholder="What is wrong, and what will you do / replace?" aria-label="Estimate details" required></textarea></div></div><div class="row"><button class="btn sm primary" type="submit">Send estimate</button><button type="button" class="btn sm" data-act="complete" data-id="${b.id}">Fixed on the spot, no extra cost</button></div>${photoBox(b)}</form>`;
    if (s === 'estimate_sent') return `<div class="alert info">Waiting for the customer to approve your estimate of ${money(b.estimateAmount)}.</div>${photoBox(b)}`;
    if (s === 'in_progress') return `<div class="row"><button class="btn sm teal" data-act="complete" data-id="${b.id}">Mark job complete</button></div>${photoBox(b)}`;
    if (s === 'completed') return b.paymentMethod === 'cash' && b.payment && b.payment.status === 'pending_cash' ? `<div class="alert info stack" style="gap:8px">Customer chose cash. Collect <strong>${money(b.totalDue)}</strong>.<div><button class="btn sm teal" data-act="cash" data-id="${b.id}">Cash received</button></div></div>` : `<div class="alert info">Job complete. Waiting for the customer to pay ${money(b.totalDue)}.</div>`;
    return '';
  }
  function renderActive(act) {
    $('#activeList').innerHTML = act.length ? act.map((b) => `<div class="card stack" id="bk${b.id}"><div class="row between"><div><h3 style="font-size:19px">${esc(b.service)} <span class="muted small">#${b.id}</span></h3><div class="muted small">${RS.when(b.createdAt)}</div></div>${badge(b.status)}</div>${RS.timeline(b.status)}
      <dl class="kv"><dt>Customer</dt><dd>${esc(b.customerName)} · <a href="tel:${esc(b.customerPhone)}" style="color:var(--orange)">${esc(b.customerPhone)}</a></dd><dt>Location</dt><dd>${esc(b.address)} · <a href="https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}" target="_blank" rel="noopener" style="color:var(--orange)">Directions</a></dd>${b.vehicle ? `<dt>Vehicle</dt><dd>${esc(b.vehicle)}</dd>` : ''}${b.notes ? `<dt>Notes</dt><dd>${esc(b.notes)}</dd>` : ''}<dt>Visit fee</dt><dd>${money(b.visitFee)}</dd>${b.estimateAmount ? `<dt>Estimate</dt><dd>${money(b.estimateAmount)} (${esc(b.estimateStatus)})</dd>` : ''}</dl>${controls(b)}</div>`).join('') : '<div class="card muted">No active jobs. Accept one from “Nearby jobs”.</div>';
  }

  // ---------- Earnings ----------
  async function loadEarnings() {
    try {
      const e = await RS.get('/api/mechanic/earnings');
      $('#earnBox').innerHTML = `<div class="grid cols-3"><div class="stat"><div class="v">${money(e.totalEarned)}</div><div class="l">Total earned (${e.paidJobs} paid jobs)</div></div><div class="stat"><div class="v">${money(e.awaitingPayment)}</div><div class="l">Awaiting payment (${e.awaitingJobs} jobs)</div></div></div>`
        + (e.recent.length ? `<div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>Booking</th><th>Service</th><th>Method</th><th>Amount</th></tr></thead><tbody>${e.recent.map((r) => `<tr><td>${RS.when(r.paidAt)}</td><td>#${r.bookingId}</td><td>${esc(r.service)}</td><td>${esc(r.method)}</td><td>${money(r.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card muted">No payments received yet.</div>');
    } catch (err) { say(err.message, 'error'); }
  }

  // ---------- Actions ----------
  const readFile = (f) => new Promise((res, rej) => { if (f.size > 4 * 1024 * 1024) return rej(new Error('Photo must be 4 MB or smaller.')); const r = new FileReader(); r.onload = () => res({ filename: f.name, mime: f.type, data: String(r.result).split(',')[1] }); r.onerror = () => rej(new Error('Could not read file.')); r.readAsDataURL(f); });
  async function run(fn) { RS.alert(msg, '', ''); try { await fn(); sendLocation(true); actJson = ''; jobsJson = ''; await loadBookings(false); if (current === 'jobs') await loadJobs(false); } catch (err) { say(err.message, 'error'); } }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return; const id = b.dataset.id, a = b.dataset.act;
    run(async () => {
      if (a === 'accept') { await RS.post(`/api/mechanic/bookings/${id}/accept`); say('Job accepted. Open “My active jobs”.'); }
      else if (a === 'reject') await RS.post(`/api/mechanic/bookings/${id}/reject`);
      else if (a === 'status') await RS.post(`/api/mechanic/bookings/${id}/status`, { status: b.dataset.st });
      else if (a === 'complete') { if (!confirm('Mark this job as complete?')) return; await RS.post(`/api/mechanic/bookings/${id}/complete`); }
      else if (a === 'cash') await RS.post(`/api/mechanic/bookings/${id}/cash-received`);
    });
  });
  document.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault(); const id = f.dataset.id;
    run(async () => {
      if (f.dataset.form === 'start') await RS.post(`/api/mechanic/bookings/${id}/start`, { otp: f.elements.otp.value.trim() });
      if (f.dataset.form === 'estimate') await RS.post(`/api/mechanic/bookings/${id}/estimate`, { amount: +f.elements.amount.value, notes: f.elements.notes.value });
    });
  });
  document.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-photo]'); if (!inp || !inp.files[0]) return;
    run(async () => { const f = await readFile(inp.files[0]); await RS.post(`/api/mechanic/bookings/${inp.dataset.photo}/photos`, f); say('Photo uploaded.'); });
  });

  // ---------- Profile form ----------
  let svcState = [];
  function fillProfile(p) {
    const f = $('#profileForm');
    f.fullName.value = p.fullName; f.phone.value = p.phone || ''; f.garageName.value = p.garageName; f.experienceYears.value = p.experienceYears; f.address.value = p.address; f.city.value = p.city; f.specialty.value = p.specialty || '';
    fillProfile.pos = { lat: p.lat, lng: p.lng }; $('#coordText').textContent = `Garage location saved: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`;
    $('#verifyInfo').innerHTML = `<span class="badge ${p.verificationStatus === 'approved' ? 'teal' : 'orange'}">Verification: ${esc(p.verificationStatus)}</span>`;
    $('#docList').innerHTML = p.documents.length ? p.documents.map((d) => `<a href="/files/${d.id}" target="_blank" rel="noopener" style="color:var(--orange)">${esc(d.kind.replace('_', ' '))} (${esc(d.name)})</a>`).join(' · ') : 'None';
    RS.get('/api/public/services').then(({ services }) => {
      const mine = Object.fromEntries(p.services.map((s) => [s.slug, s.price]));
      $('#svcList').innerHTML = services.map((s) => `<div class="row between" style="border:1px solid var(--line);border-radius:12px;padding:10px 14px"><label class="check"><input type="checkbox" data-svc="${esc(s.slug)}" ${s.slug in mine ? 'checked' : ''}> <strong>${esc(s.name)}</strong></label><label class="row" style="gap:6px">₹ <input type="number" min="1" data-price="${esc(s.slug)}" value="${mine[s.slug] ?? ''}" placeholder="${s.basePrice}" style="width:110px;min-height:40px;border:1px solid var(--line-strong);border-radius:10px;padding:0 10px;font:400 15px 'DM Sans'" ${s.slug in mine ? '' : 'disabled'}></label></div>`).join('');
      $$('[data-svc]').forEach((c) => c.addEventListener('change', () => { const i = $(`[data-price="${c.dataset.svc}"]`); i.disabled = !c.checked; if (c.checked && !i.value) i.value = i.placeholder; }));
    });
  }
  $('#relocate').addEventListener('click', async () => {
    const f = $('#profileForm');
    try { const g = await RS.geocode(f.address.value + ', ' + f.city.value); fillProfile.pos = { lat: g.lat, lng: g.lng }; $('#coordText').textContent = `Located: ${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}`; } catch (e) { say(e.message, 'error'); }
  });
  $('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; RS.showFieldErrors(f, {}); $('#svcErr').textContent = '';
    const services = $$('[data-svc]').filter((c) => c.checked).map((c) => ({ slug: c.dataset.svc, price: parseInt($(`[data-price="${c.dataset.svc}"]`).value, 10) }));
    try {
      await RS.put('/api/mechanic/profile', { fullName: f.fullName.value, phone: f.phone.value, garageName: f.garageName.value, experienceYears: +f.experienceYears.value, address: f.address.value, city: f.city.value, specialty: f.specialty.value, lat: fillProfile.pos.lat, lng: fillProfile.pos.lng, services });
      say('Profile saved.'); await loadProfile();
    } catch (err) { RS.showFieldErrors(f, err.fields); if (err.fields && err.fields.services) $('#svcErr').textContent = err.fields.services; say(err.message, 'error'); }
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; RS.showFieldErrors(f, {});
    try { const r = await RS.post('/api/auth/change-password', { currentPassword: f.currentPassword.value, newPassword: f.newPassword.value, confirmPassword: f.confirmPassword.value }); say(r.message); f.reset(); } catch (err) { RS.showFieldErrors(f, err.fields); say(err.message, 'error'); }
  });
})();
