(function () {
  'use strict';
  const { $, $$, esc } = RS; RS.mountChrome();
  const form = $('#partnerForm'), msg = $('#msg'), loc = { lat: null, lng: null, text: '' };
  let services = [];

  RS.get('/api/public/services').then((r) => {
    services = r.services;
    $('#svcList').innerHTML = services.map((s) => `<div class="row between" style="gap:12px;border:1px solid var(--line);border-radius:12px;padding:10px 14px">
      <label class="check" style="flex:1 1 200px"><input type="checkbox" data-svc="${esc(s.slug)}"> <span><strong>${esc(s.name)}</strong><br><span class="muted small">${esc(s.description || '')}</span></span></label>
      <label class="row" style="gap:6px">₹ <input type="number" min="1" max="100000" data-price="${esc(s.slug)}" placeholder="${s.basePrice}" aria-label="Starting price for ${esc(s.name)}" style="width:110px;min-height:40px;border:1px solid var(--line-strong);border-radius:10px;padding:0 10px;font:400 15px 'DM Sans'" disabled></label></div>`).join('');
    $$('[data-svc]').forEach((c) => c.addEventListener('change', () => { const p = $(`[data-price="${c.dataset.svc}"]`); p.disabled = !c.checked; if (c.checked && !p.value) p.value = p.placeholder; }));
  });

  const status = (t) => { $('#locStatus').textContent = t; };
  async function locate() {
    const addr = form.elements.address.value.trim();
    if (addr.length < 5) { status('Type your garage address first, or use GPS.'); return false; }
    try { const g = await RS.geocode(addr + (form.elements.city.value ? ', ' + form.elements.city.value : '')); loc.lat = g.lat; loc.lng = g.lng; loc.text = addr; status(`Located: ${g.lat.toFixed(4)}, ${g.lng.toFixed(4)}. Check that this is correct.`); return true; }
    catch (e) { status(e.message); return false; }
  }
  $('#locateGarage').addEventListener('click', async () => {
    if (form.elements.address.value.trim().length >= 5) return locate();
    try { const p = await RS.getPosition(); loc.lat = p.lat; loc.lng = p.lng; form.elements.address.value = await RS.reverseGeocode(p.lat, p.lng); loc.text = form.elements.address.value; status(`GPS location captured: ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}.`); } catch (e) { status(e.message); }
  });
  form.elements.address.addEventListener('input', () => { loc.lat = loc.lng = null; });

  const readFile = (input) => new Promise((resolve, reject) => {
    const f = input.files[0]; if (!f) return resolve(null);
    if (f.size > 4 * 1024 * 1024) return reject(new Error(`${f.name} is larger than 4 MB.`));
    const r = new FileReader(); r.onload = () => resolve({ filename: f.name, mime: f.type, data: String(r.result).split(',')[1] }); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(f);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const btn = $('button[type=submit]', form);
    RS.alert(msg, '', ''); RS.showFieldErrors(form, {}); $('#svcErr').textContent = ''; $('.err', $('#docErr')).textContent = '';
    const v = (n) => form.elements[n].value.trim(), errors = {};
    if (v('fullName').length < 2) errors.fullName = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v('email'))) errors.email = 'Enter a valid email address.';
    if (!/^\+?[0-9]{10,13}$/.test(v('phone').replace(/[\s-]/g, ''))) errors.phone = 'Enter a valid phone number.';
    const pw = RS.passwordProblem(form.elements.password.value); if (pw) errors.password = pw;
    else if (form.elements.password.value !== form.elements.confirmPassword.value) errors.confirmPassword = 'Passwords do not match.';
    if (v('garageName').length < 2) errors.garageName = 'Enter your garage name.';
    if (v('address').length < 5) errors.address = 'Enter your garage address.';
    if (v('city').length < 2) errors.city = 'Enter your city.';
    if (form.elements.experienceYears.value === '' || +form.elements.experienceYears.value < 0) errors.experienceYears = 'Enter years of experience.';
    const offered = $$('[data-svc]').filter((c) => c.checked).map((c) => ({ slug: c.dataset.svc, price: parseInt($(`[data-price="${c.dataset.svc}"]`).value, 10) }));
    if (!offered.length || offered.some((o) => !(o.price > 0))) $('#svcErr').textContent = 'Select at least one service and enter a starting price for each selected service.';
    if (!$('#doc_id_proof').files[0]) $('.err', $('#docErr')).textContent = 'Upload a government ID.';
    if (Object.keys(errors).length || $('#svcErr').textContent || $('.err', $('#docErr')).textContent) { RS.showFieldErrors(form, errors); window.scrollTo({ top: 0, behavior: 'smooth' }); RS.alert(msg, 'error', 'Please fix the highlighted fields.'); return; }
    RS.busy(btn, true, 'Submitting');
    try {
      if (loc.lat === null && !(await locate())) { RS.showFieldErrors(form, { address: 'We could not locate this address. Refine it or use GPS.' }); return; }
      const documents = [];
      for (const k of ['id_proof', 'address_proof', 'garage_license']) { const f = await readFile($('#doc_' + k)); if (f) documents.push({ kind: k, ...f }); }
      const r = await RS.post('/api/partner/register', { fullName: v('fullName'), email: v('email'), phone: v('phone'), password: form.elements.password.value, confirmPassword: form.elements.confirmPassword.value,
        garageName: v('garageName'), address: v('address'), city: v('city'), experienceYears: +v('experienceYears'), lat: loc.lat, lng: loc.lng, services: offered, documents });
      form.classList.add('hidden'); RS.alert(msg, 'ok', r.message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) { RS.alert(msg, 'error', err.message); RS.showFieldErrors(form, err.fields); }
    finally { RS.busy(btn, false); }
  });
})();
