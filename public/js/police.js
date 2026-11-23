(function () {
  const { $, esc } = RS; RS.mountChrome();
  const msg = $('#msg'), list = $('#list');
  async function search(lat, lng) {
    RS.alert(msg, 'info', 'Searching within 6 km…'); list.innerHTML = '';
    const q = `[out:json][timeout:20];(node(around:6000,${lat},${lng})[amenity=police];way(around:6000,${lat},${lng})[amenity=police];);out center 25;`;
    let j;
    try { const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); if (!r.ok) throw 0; j = await r.json(); }
    catch { RS.alert(msg, 'error', 'The map service is busy. Try again in a minute, and call 112 if you need help now.'); return; }
    const toRad = (d) => (d * Math.PI) / 180;
    const items = j.elements.map((e) => {
      const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon; if (la == null) return null;
      const dx = toRad(lo - lng) * Math.cos(toRad(lat)), dy = toRad(la - lat), km = 6371 * Math.sqrt(dx * dx + dy * dy);
      const t = e.tags || {}; return { name: t.name || 'Police station', phone: t.phone || t['contact:phone'] || '', addr: [t['addr:street'], t['addr:city']].filter(Boolean).join(', '), la, lo, km };
    }).filter(Boolean).sort((a, b) => a.km - b.km).slice(0, 10);
    if (!items.length) { RS.alert(msg, 'info', 'No police stations found within 6 km on the map. Call 112.'); return; }
    RS.alert(msg, '', '');
    list.innerHTML = items.map((p) => `<div class="card tight row between"><div><div style="font-weight:700">${esc(p.name)}</div><div class="muted small">${p.km.toFixed(1)} km away${p.addr ? ' · ' + esc(p.addr) : ''}</div>${p.phone ? `<div class="small">Phone: <a href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}" style="color:var(--orange)">${esc(p.phone)}</a></div>` : ''}</div><a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.la},${p.lo}">Directions</a></div>`).join('');
  }
  $('#gps').addEventListener('click', async () => { try { const p = await RS.getPosition(); await search(p.lat, p.lng); } catch (e) { RS.alert(msg, 'error', e.message); } });
  $('#go').addEventListener('click', async () => { const q = $('#q').value.trim(); if (!q) return RS.alert(msg, 'error', 'Type an address or use your location.'); try { const g = await RS.geocode(q); await search(g.lat, g.lng); } catch (e) { RS.alert(msg, 'error', e.message); } });
})();
