(function () {
  'use strict';
  const { $, $$, esc, money } = RS; RS.mountChrome();
  const params = new URLSearchParams(location.search);
  const saved = RS.loadSearch() || {};
  const st = { service: params.get('service') || saved.service || 'tyre-puncture', lat: saved.lat ?? null, lng: saved.lng ?? null, mechanics: [], selected: params.get('mechanic') ? parseInt(params.get('mechanic'), 10) : null, services: [] };
  const loc = $('#loc'), msg = $('#msg');
  if (saved.address) loc.value = saved.address;

  RS.get('/api/public/services').then(({ services }) => {
    st.services = services;
    if (!services.some((s) => s.slug === st.service)) st.service = services[0].slug;
    $('#chips').innerHTML = services.map((s) => `<button type="button" class="chip" data-service="${esc(s.slug)}" aria-pressed="false">${esc(s.name)}</button>`).join('');
    $$('.chip').forEach((c) => c.addEventListener('click', () => { pick(c.dataset.service); if (st.lat !== null) search(); }));
    pick(st.service);
    if (st.lat !== null || loc.value) search();
  });
  function pick(slug) { st.service = slug; $$('.chip').forEach((c) => { const on = c.dataset.service === slug; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); }); }
  const note = (t, type = 'error') => RS.alert(msg, type, t);
  loc.addEventListener('input', () => { st.lat = st.lng = null; });
  loc.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

  $('#useLoc').addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true; note('');
    try { const p = await RS.getPosition(); st.lat = p.lat; st.lng = p.lng; loc.value = await RS.reverseGeocode(p.lat, p.lng); await search(); } catch (err) { note(err.message); } finally { b.disabled = false; }
  });
  $('#findBtn').addEventListener('click', search);

  async function search() {
    note('');
    if (!loc.value.trim()) { note('Enter where your vehicle is, or tap “Use my location”.'); return; }
    const btn = $('#findBtn'); btn.disabled = true; btn.textContent = 'Searching…';
    try {
      if (st.lat === null) { const g = await RS.geocode(loc.value.trim()); st.lat = g.lat; st.lng = g.lng; }
      RS.saveSearch({ lat: st.lat, lng: st.lng, address: loc.value.trim(), service: st.service });
      const r = await RS.get(`/api/public/mechanics?lat=${st.lat}&lng=${st.lng}&service=${st.service}`);
      st.mechanics = r.mechanics; if (st.selected && !st.mechanics.some((m) => m.id === st.selected)) st.selected = null;
      render(r.radiusKm);
    } catch (err) { note(err.message); } finally { btn.disabled = false; btn.textContent = 'Find mechanics near me'; }
  }

  function render(radiusKm) {
    const box = $('#mapBox'); box.innerHTML = RS.mapSvg();
    RS.drawMap(box.firstElementChild, { lat: st.lat, lng: st.lng }, st.mechanics.slice(0, 8).map((m) => ({ lat: m.lat, lng: m.lng, label: m.garageName })));
    const list = $('#mechList');
    if (!st.mechanics.length) { list.innerHTML = `<div class="muted small" style="background:#fff;border-radius:12px;padding:14px 16px">No verified mechanics are available for this service within ${radiusKm} km right now. You can still post an open request below and nearby mechanics who come online can accept it.</div>`; }
    else list.innerHTML = st.mechanics.map((m) => `<div class="stack" style="gap:6px"><button type="button" class="mcard ${m.id === st.selected ? 'sel' : ''}" data-id="${m.id}" aria-pressed="${m.id === st.selected}">
      <div><div class="name">${esc(m.garageName)}</div><div class="sub">${m.rating !== null ? '★ ' + m.rating.toFixed(1) + ' (' + m.reviewCount + ')' : 'New'} · ${esc(m.specialty || '')}</div><div class="sub">${m.distanceKm} km away · ${m.experienceYears} yrs experience</div></div>
      <div class="eta"><div>~${m.etaMinutes} min</div><div class="sub" style="font-weight:400">from ${money(m.startingPrice)}</div></div></button><button type="button" class="link small" data-details="${m.id}" style="align-self:flex-start">View details</button></div>`).join('');
    $$('[data-id]', list).forEach((b) => b.addEventListener('click', () => { st.selected = parseInt(b.dataset.id, 10); render(radiusKm); }));
    $$('[data-details]', list).forEach((b) => b.addEventListener('click', () => details(parseInt(b.dataset.details, 10))));
    const sel = st.mechanics.find((m) => m.id === st.selected);
    $('#confirmBox').classList.remove('hidden');
    $('#selSummary').innerHTML = sel ? `<strong>${esc(sel.garageName)}</strong><div class="muted small">Visit fee ${money(sel.startingPrice)} · arrives in about ${sel.etaMinutes} min. The repair cost is quoted after inspection and needs your approval.</div>` : '<div class="muted small">Pick a mechanic above, or let nearby mechanics accept your request.</div>';
    $('#confirmBtn').classList.toggle('hidden', !sel);
    $('#autoBtn').textContent = sel ? 'Let nearby mechanics accept instead' : 'Post an open request to nearby mechanics';
  }

  async function details(id) {
    try {
      const { mechanic: m } = await RS.get('/api/public/mechanics/' + id);
      RS.modal(`<div class="stack"><div><h2 style="font-size:22px">${esc(m.garageName)}</h2><div class="muted small">${esc(m.city)} · ${m.experienceYears} years experience · ${m.rating !== null ? '★ ' + m.rating.toFixed(1) + ' (' + m.reviewCount + ' reviews)' : 'No reviews yet'}</div></div>
        <div><div class="label">Price list (visit fee)</div><dl class="kv" style="margin-top:8px">${m.services.map((s) => `<dt>${esc(s.name)}</dt><dd>${money(s.price)}</dd>`).join('')}</dl></div>
        <div><div class="label">Recent reviews</div>${m.reviews.length ? m.reviews.map((r) => `<div style="margin-top:8px"><span class="stars">${RS.stars(r.rating)}</span> <span class="muted small">${esc(r.name)}</span><div>${esc(r.comment || '')}</div></div>`).join('') : '<div class="muted small">No reviews yet.</div>'}</div>
        <div class="row"><button class="btn primary" data-pick>Choose this mechanic</button><button class="btn" data-close>Close</button></div></div>`).el.querySelector('[data-pick]').addEventListener('click', (e) => { st.selected = id; e.target.closest('.modal-bg').remove(); render(30); });
    } catch (e) { note(e.message); }
  }

  async function book(mechanicId) {
    note('');
    const user = await RS.me();
    const draft = { mechanicId, vehicle: $('#vehicle').value, notes: $('#notes').value };
    if (!user) { sessionStorage.setItem('rs_draft', JSON.stringify(draft)); location.href = '/login?next=' + encodeURIComponent('/book?service=' + st.service + (mechanicId ? '&mechanic=' + mechanicId : '')); return; }
    if (user.role !== 'customer') { note('Only customer accounts can book help. Log in with a customer account.'); return; }
    const btn = mechanicId ? $('#confirmBtn') : $('#autoBtn'); btn.disabled = true;
    try {
      const r = await RS.post('/api/customer/bookings', { serviceSlug: st.service, mechanicId, lat: st.lat, lng: st.lng, address: loc.value.trim(), vehicle: $('#vehicle').value.trim(), notes: $('#notes').value.trim() });
      location.href = '/customer?b=' + r.booking.id + '#bookings';
    } catch (err) { note(err.message); btn.disabled = false; }
  }
  $('#confirmBtn').addEventListener('click', () => book(st.selected));
  $('#autoBtn').addEventListener('click', () => book(null));
  try { const d = JSON.parse(sessionStorage.getItem('rs_draft') || 'null'); if (d) { $('#vehicle').value = d.vehicle || ''; $('#notes').value = d.notes || ''; sessionStorage.removeItem('rs_draft'); } } catch {}
})();
