/* Shared helpers for every page. No inline scripts anywhere (strict CSP). */
(function () {
  'use strict';
  const RS = (window.RS = {});

  RS.$ = (s, r = document) => r.querySelector(s);
  RS.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  RS.esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  RS.money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  RS.when = (ms) => (ms ? new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  RS.stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
  RS.safeNext = (v) => (typeof v === 'string' && /^\/[a-zA-Z0-9\-_/?=&%.#]*$/.test(v) && !v.startsWith('//') ? v : null);

  // ---- API ----
  RS.api = async function (method, url, body) {
    let res;
    try {
      res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { const e = new Error('Cannot reach the server. Check your connection and try again.'); e.network = true; throw e; }
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; e.fields = data.fields || {}; throw e; }
    return data;
  };
  RS.get = (u) => RS.api('GET', u);
  RS.post = (u, b = {}) => RS.api('POST', u, b);
  RS.put = (u, b) => RS.api('PUT', u, b);
  RS.patch = (u, b) => RS.api('PATCH', u, b);
  RS.del = (u) => RS.api('DELETE', u);

  // ---- Forms ----
  RS.showFieldErrors = function (form, fields) {
    RS.$$('.field', form).forEach((f) => { f.classList.remove('invalid'); const e = RS.$('.err', f); if (e) e.textContent = ''; });
    let first = null;
    for (const [name, msg] of Object.entries(fields || {})) {
      const input = form.elements[name]; if (!input) continue;
      const f = input.closest('.field'); if (!f) continue;
      f.classList.add('invalid'); let e = RS.$('.err', f);
      if (!e) { e = document.createElement('div'); e.className = 'err'; f.appendChild(e); }
      e.textContent = msg; first = first || input;
    }
    if (first) first.focus();
  };
  RS.alert = function (el, type, msg) {
    if (!el) return;
    if (!msg) { el.className = 'hidden'; el.textContent = ''; return; }
    el.className = 'alert ' + type; el.setAttribute('role', type === 'error' ? 'alert' : 'status'); el.textContent = msg;
  };
  RS.busy = function (btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> ' + RS.esc(label || 'Please wait'); }
    else { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; }
  };
  RS.wirePasswordToggles = function (root = document) {
    RS.$$('.pw', root).forEach((w) => {
      const input = RS.$('input', w), b = RS.$('button', w); if (!b || b.dataset.wired) return; b.dataset.wired = 1;
      b.addEventListener('click', () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; b.textContent = show ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', show); });
    });
  };
  RS.passwordProblem = function (pw) {
    if (pw.length < 8) return 'Use at least 8 characters.';
    if (!/[a-z]/.test(pw)) return 'Add a lowercase letter.';
    if (!/[A-Z]/.test(pw)) return 'Add an uppercase letter.';
    if (!/[0-9]/.test(pw)) return 'Add a number.';
    if (!/[^A-Za-z0-9]/.test(pw)) return 'Add a special character (for example ! @ # $).';
    return null;
  };

  // ---- Location (browser GPS + OpenStreetMap Nominatim; no API key needed) ----
  RS.getPosition = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Your browser does not support location. Type your address instead.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission was denied. Allow it in your browser, or type your address.' : 'We could not get your location. Type your address instead.')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  });
  RS.geocode = async function (q) {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' } }).catch(() => null);
    if (!r || !r.ok) throw new Error('Address lookup is unavailable right now. Use "Use my location" instead.');
    const j = await r.json();
    if (!j.length) throw new Error('We could not find that address. Add the area or city, or use "Use my location".');
    return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), label: j[0].display_name };
  };
  RS.reverseGeocode = async function (lat, lng) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { Accept: 'application/json' } });
      const j = await r.json(); return j.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    } catch { return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; }
  };
  RS.saveSearch = (s) => { try { sessionStorage.setItem('rs_search', JSON.stringify(s)); } catch {} };
  RS.loadSearch = () => { try { return JSON.parse(sessionStorage.getItem('rs_search') || 'null'); } catch { return null; } };

  // ---- Simple SVG map: vehicle at the centre, mechanics plotted relative to it ----
  RS.drawMap = function (svg, vehicle, points, opts = {}) {
    const W = 440, H = 240, cx = 210, cy = 130;
    const kx = Math.cos((vehicle.lat * Math.PI) / 180);
    const rel = points.map((p) => ({ ...p, dx: (p.lng - vehicle.lng) * kx, dy: -(p.lat - vehicle.lat) }));
    const mx = Math.max(1e-6, ...rel.map((p) => Math.abs(p.dx))), my = Math.max(1e-6, ...rel.map((p) => Math.abs(p.dy)));
    const s = Math.min(170 / mx, 90 / my);
    const pos = rel.map((p) => ({ ...p, x: cx + p.dx * s, y: cy + p.dy * s }));
    const route = RS.$('#mapRoute', svg), mech = RS.$('#mapMech', svg);
    if (route) route.innerHTML = pos.length ? `<path d="M${pos[0].x.toFixed(1)} ${pos[0].y.toFixed(1)} L${cx} ${cy}" stroke="#C2410C" stroke-width="4" stroke-dasharray="8 6" fill="none"></path>` : '';
    if (mech) mech.innerHTML = pos.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="#0F766E"><title>${RS.esc(p.label || '')}</title></circle>`).join('');
  };

  RS.mapSvg = (extra = '') => `<svg class="map" viewBox="0 0 440 240" role="img" aria-label="Map showing the vehicle and the mechanic"><path d="M0 170 L440 90 M120 0 L190 240 M300 0 L260 240" stroke="#D5D0C2" stroke-width="14" fill="none"></path><g id="mapRoute"></g><g id="mapMech"></g><circle cx="210" cy="130" r="12" fill="#14181F"></circle><circle cx="210" cy="130" r="4" fill="#fff"></circle>${extra}</svg>`;

  // ---- Navigation helpers ----
  RS.bindHref = function (root = document) {
    RS.$$('[data-href]', root).forEach((el) => {
      if (el.dataset.bound) return; el.dataset.bound = 1;
      el.addEventListener('click', () => {
        const h = el.dataset.href;
        if (h.startsWith('#')) { const t = RS.$(h); if (t) { t.scrollIntoView({ behavior: 'smooth' }); const i = RS.$('input', t); if (i) setTimeout(() => i.focus({ preventScroll: true }), 400); } }
        else location.href = h;
      });
    });
  };
  RS.me = async () => { try { return (await RS.get('/api/auth/me')).user; } catch { return null; } };
  RS.logout = async () => { try { await RS.post('/api/auth/logout'); } catch {} location.href = '/login'; };

  // Inner-page chrome that mirrors the home navigation and footer
  RS.mountChrome = async function () {
    const nav = RS.$('#chrome-nav'), foot = RS.$('#chrome-foot');
    const user = await RS.me();
    if (nav) nav.innerHTML = `<nav class="nav"><a class="logo" href="/" aria-label="RepairStop home"><img src="/assets/logo.png" alt="RepairStop logo"></a>
      <div class="links"><a href="/#how">How it works</a><a href="/#services">Services</a><a href="/#mechanics">For mechanics</a><a href="/#help">Help</a><a href="/police">Nearby police stations</a></div>
      <div class="btns"><button class="nbtn" data-href="${user ? RS.esc({ customer: '/customer', mechanic: '/mechanic', admin: '/admin' }[user.role]) : '/login'}">${user ? 'My account' : 'Log in'}</button><button class="nbtn solid" data-href="/book">Book help now</button></div></nav>`;
    if (foot) foot.innerHTML = `<footer class="foot"><div>© 2026 RepairStop. All rights reserved.</div><div class="fl"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/contact">Contact</a></div></footer>`;
    RS.bindHref(document);
    return user;
  };

  // Gate for protected pages; redirects to login (and back afterwards)
  RS.requireRole = async function (role) {
    const user = await RS.me();
    if (!user) { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search + location.hash)); return null; }
    if (user.role !== role) { location.replace(user.home); return null; }
    return user;
  };

  // Tabs: <button class="tab" data-tab="x"> + <section data-panel="x">
  RS.tabs = function (onChange) {
    const tabs = RS.$$('.tab[data-tab]'), panels = RS.$$('[data-panel]');
    function show(name, push = true) {
      if (!tabs.some((t) => t.dataset.tab === name)) name = tabs[0].dataset.tab;
      tabs.forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
      panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
      if (push) history.replaceState(null, '', '#' + name);
      if (onChange) onChange(name);
    }
    tabs.forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
    window.addEventListener('hashchange', () => show(location.hash.slice(1), false));
    show(location.hash.slice(1) || tabs[0].dataset.tab, false);
    return show;
  };

  RS.modal = function (html) {
    const bg = document.createElement('div'); bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    document.body.appendChild(bg);
    RS.$$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
    return { el: bg, close };
  };

  RS.STATUS = {
    open: ['Finding a mechanic', 'orange'], pending_mechanic: ['Waiting for mechanic', 'orange'], accepted: ['Mechanic accepted', 'teal'], en_route: ['On the way', 'teal'],
    arrived: ['Mechanic arrived', 'teal'], inspecting: ['Inspecting', 'teal'], estimate_sent: ['Estimate awaiting approval', 'orange'], in_progress: ['Repair in progress', 'teal'],
    completed: ['Completed - payment due', 'orange'], paid: ['Paid', 'dark'], cancelled: ['Cancelled', ''],
  };
  RS.badge = (status) => { const [t, c] = RS.STATUS[status] || [status, '']; return `<span class="badge ${c}">${RS.esc(t)}</span>`; };
  RS.FLOW = ['accepted', 'en_route', 'arrived', 'inspecting', 'estimate_sent', 'in_progress', 'completed', 'paid'];
  RS.FLOW_LABEL = { accepted: 'Accepted', en_route: 'On the way', arrived: 'Arrived', inspecting: 'Inspecting', estimate_sent: 'Estimate', in_progress: 'Repair', completed: 'Pay', paid: 'Paid' };
  RS.timeline = (status) => {
    if (!RS.FLOW.includes(status)) return '';
    const at = RS.FLOW.indexOf(status);
    return '<div class="steps">' + RS.FLOW.map((s, i) => `<span class="step ${i < at ? 'done' : i === at ? 'now' : ''}">${RS.FLOW_LABEL[s]}</span>`).join('') + '</div>';
  };

  document.addEventListener('DOMContentLoaded', () => { RS.bindHref(document); RS.wirePasswordToggles(document); });
})();
