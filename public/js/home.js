(function () {
  'use strict';
  const { $, $$, esc, money } = RS;
  const SEL_STYLE = "min-height:44px;padding:0 16px;border-radius:22px;border:2px solid #C2410C;background:#FFF1EA;color:#7C2D0E;font:700 14px 'DM Sans'";
  const OFF_STYLE = "min-height:44px;padding:0 16px;border-radius:22px;border:1px solid #B8B2A3;background:#fff;font:500 14px 'DM Sans'";
  const state = { service: 'tyre-puncture', lat: null, lng: null, address: '', typed: '' };

  // ---- Logged-in state in the nav ----
  RS.me().then((u) => {
    if (!u) return;
    const b = $('#navLogin'); b.textContent = 'My account'; b.dataset.href = u.home;
  });

  // ---- Live data ----
  RS.get('/api/public/config').then((c) => { if (c.supportPhone) $('#helpline').textContent = 'Helpline: ' + c.supportPhone; }).catch(() => {});
  RS.get('/api/public/stats').then((s) => {
    if (s.medianEtaMinutes !== null) $('#stEta').textContent = (s.medianEtaMinutes < 1 ? '<1' : s.medianEtaMinutes) + ' min';
    if (s.averageRating !== null) $('#stRating').textContent = s.averageRating.toFixed(1);
    if (s.verifiedMechanics) $('#stMech').textContent = s.verifiedMechanics.toLocaleString('en-IN');
  }).catch(() => {});
  RS.get('/api/public/areas').then(({ areas }) => {
    const list = $('#areaList'), last = list.lastElementChild;
    areas.forEach((c) => { const s = document.createElement('span'); s.setAttribute('style', "padding:10px 18px;border:1px solid #B8B2A3;background:#fff;border-radius:22px;font-weight:500;font-size:15px"); s.textContent = c; list.insertBefore(s, last); });
  }).catch(() => {});
  RS.get('/api/public/reviews?limit=6').then(({ reviews }) => {
    if (!reviews.length) return;
    const list = $('#reviewList'); $('#reviewEmpty').remove();
    list.innerHTML = reviews.map((r) => `<div style="flex:1 1 280px;background:#fff;border:1px solid #E2DED4;border-radius:14px;padding:24px"><div style="font-weight:700;color:#C2410C;margin-bottom:10px">${r.rating} out of 5</div><p style="margin:0 0 16px;line-height:1.6">${esc(r.comment)}</p><div style="font-weight:700">${esc(r.name)}</div><div style="font-size:14px;color:#4B5563">${esc([r.vehicle, r.city].filter(Boolean).join(' · '))}</div></div>`).join('');
  }).catch(() => {});

  // ---- Hero: service chips ----
  function selectService(slug) {
    state.service = slug;
    $$('.chip').forEach((c) => { const on = c.dataset.service === slug; c.setAttribute('style', on ? SEL_STYLE : OFF_STYLE); c.setAttribute('aria-pressed', on); });
  }
  $$('.chip').forEach((c) => c.addEventListener('click', () => selectService(c.dataset.service)));

  // ---- Hero: location ----
  const loc = $('#loc'), msg = $('#heroMsg');
  const say = (t) => { msg.style.display = t ? 'block' : 'none'; msg.textContent = t || ''; };
  loc.addEventListener('input', () => { state.lat = state.lng = null; });
  loc.addEventListener('keydown', (e) => { if (e.key === 'Enter') findMechanics(); });

  $('#useLoc').addEventListener('click', async (e) => {
    const b = e.currentTarget; say(''); b.disabled = true; const old = b.textContent; b.textContent = 'Locating…';
    try {
      const p = await RS.getPosition();
      state.lat = p.lat; state.lng = p.lng; state.address = await RS.reverseGeocode(p.lat, p.lng); loc.value = state.address;
      await findMechanics();
    } catch (err) { say(err.message); }
    finally { b.disabled = false; b.textContent = old; }
  });

  // ---- Hero: nearby mechanics (real database results only) ----
  const CARD = "background:#fff;border-radius:12px;padding:14px 16px;display:flex;justify-content:space-between;align-items:center;gap:12px;cursor:pointer;text-align:left;width:100%;border:0;font:inherit;color:inherit";
  function renderList(mechs, sentinel) {
    const list = $('#mechList');
    if (sentinel) { list.innerHTML = `<div style="background:#fff;border-radius:12px;padding:14px 16px;font-size:13px;color:#4B5563;line-height:1.5">${esc(sentinel)}</div>`; return; }
    list.innerHTML = mechs.slice(0, 3).map((m) => `<button type="button" data-id="${m.id}" style="${CARD}">
      <div><div style="font-weight:700">${esc(m.garageName)}</div><div style="font-size:13px;color:#4B5563">${m.rating !== null ? '★ ' + m.rating.toFixed(1) + ' (' + m.reviewCount + ')' : 'New'} · ${esc(m.specialty || '')}</div><div style="font-size:12px;color:#4B5563;margin-top:2px">${m.distanceKm} km away</div></div>
      <div style="text-align:right"><div style="font-weight:700;color:#0F766E">~${m.etaMinutes} min</div><div style="font-size:13px;color:#4B5563">from ${money(m.startingPrice)}</div></div></button>`).join('')
      + (mechs.length > 3 ? `<button type="button" data-all="1" style="background:transparent;border:0;color:#9A3412;font:700 14px 'DM Sans';cursor:pointer;padding:4px;text-align:left">See all ${mechs.length} mechanics near you →</button>` : '');
    $$('[data-id]', list).forEach((b) => b.addEventListener('click', () => go(b.dataset.id)));
    const all = $('[data-all]', list); if (all) all.addEventListener('click', () => go(null));
  }
  function go(mechanicId) {
    RS.saveSearch({ lat: state.lat, lng: state.lng, address: loc.value.trim(), service: state.service });
    location.href = '/book?service=' + state.service + (mechanicId ? '&mechanic=' + mechanicId : '');
  }

  async function findMechanics() {
    say('');
    const text = loc.value.trim();
    if (!text) { say('Enter where your vehicle is, or tap “Use my location”.'); loc.focus(); return; }
    const btn = $('#findBtn'); btn.disabled = true; btn.textContent = 'Searching…';
    try {
      if (state.lat === null) { const g = await RS.geocode(text); state.lat = g.lat; state.lng = g.lng; state.address = text; }
      const { mechanics, radiusKm } = await RS.get(`/api/public/mechanics?lat=${state.lat}&lng=${state.lng}&service=${state.service}`);
      RS.drawMap($('#heroMap'), { lat: state.lat, lng: state.lng }, mechanics.slice(0, 5).map((m) => ({ lat: m.lat, lng: m.lng, label: m.garageName })));
      renderList(mechanics, mechanics.length ? null : `No verified mechanics are available for this service within ${radiusKm} km right now. Try another service, or check back soon.`);
      $('#mechList').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch (err) { say(err.message); }
    finally { btn.disabled = false; btn.textContent = 'Find mechanics near me'; }
  }
  $('#findBtn').addEventListener('click', findMechanics);

  // ---- Service cards -> booking process ----
  $$('.svc-card').forEach((c) => {
    const open = () => { RS.saveSearch({ lat: state.lat, lng: state.lng, address: loc.value.trim(), service: c.dataset.service }); location.href = '/book?service=' + c.dataset.service; };
    c.addEventListener('click', open);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });

  // Pre-fill from an earlier search in this tab
  const prev = RS.loadSearch();
  if (prev && prev.address) { loc.value = prev.address; if (prev.service) selectService(prev.service); }
})();
