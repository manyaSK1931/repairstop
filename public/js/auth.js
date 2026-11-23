(function () {
  'use strict';
  const { $, alert: say } = RS;
  const page = document.body.dataset.page;
  const msg = $('#msg');
  RS.mountChrome();

  function form(id, onSubmit) {
    const f = $(id); if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const btn = $('button[type=submit]', f);
      say(msg, '', ''); RS.showFieldErrors(f, {});
      RS.busy(btn, true, 'Please wait');
      try { await onSubmit(f); } catch (err) { say(msg, 'error', err.message); RS.showFieldErrors(f, err.fields); }
      finally { if (btn.isConnected) RS.busy(btn, false); }
    });
  }
  const val = (f, n) => f.elements[n].value;
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  if (page === 'login') {
    const next = RS.safeNext(new URLSearchParams(location.search).get('next'));
    RS.me().then((u) => { if (u) location.replace(u.home); });
    if (new URLSearchParams(location.search).get('reset')) say(msg, 'ok', 'Password updated. Log in with your new password.');
    form('#loginForm', async (f) => {
      const errors = {};
      if (!EMAIL.test(val(f, 'email').trim())) errors.email = 'Enter a valid email address.';
      if (!val(f, 'password')) errors.password = 'Enter your password.';
      if (Object.keys(errors).length) { RS.showFieldErrors(f, errors); return; }
      const r = await RS.post('/api/auth/login', { email: val(f, 'email').trim(), password: val(f, 'password'), remember: f.elements.remember.checked });
      const ok = next && ((r.user.role === 'customer' && /^\/(book|customer)/.test(next)) || next.startsWith(r.redirect));
      location.href = ok ? next : r.redirect;
    });
  }

  if (page === 'register') {
    form('#registerForm', async (f) => {
      const errors = {}, v = (n) => val(f, n).trim();
      if (v('fullName').length < 2) errors.fullName = 'Enter your full name.';
      if (!EMAIL.test(v('email'))) errors.email = 'Enter a valid email address.';
      if (!/^\+?[0-9]{10,13}$/.test(v('phone').replace(/[\s-]/g, ''))) errors.phone = 'Enter a valid phone number (10 to 13 digits).';
      const pw = RS.passwordProblem(val(f, 'password')); if (pw) errors.password = pw;
      else if (val(f, 'password') !== val(f, 'confirmPassword')) errors.confirmPassword = 'Passwords do not match.';
      if (Object.keys(errors).length) { RS.showFieldErrors(f, errors); return; }
      const r = await RS.post('/api/auth/register', { fullName: v('fullName'), email: v('email'), phone: v('phone'), password: val(f, 'password'), confirmPassword: val(f, 'confirmPassword') });
      f.classList.add('hidden'); say(msg, 'ok', r.message);
    });
  }

  if (page === 'forgot') {
    form('#forgotForm', async (f) => {
      if (!EMAIL.test(val(f, 'email').trim())) { RS.showFieldErrors(f, { email: 'Enter a valid email address.' }); return; }
      const r = await RS.post('/api/auth/forgot', { email: val(f, 'email').trim() });
      f.classList.add('hidden'); say(msg, 'ok', r.message);
    });
  }

  if (page === 'reset') {
    const token = new URLSearchParams(location.search).get('token') || '';
    RS.get('/api/auth/reset-check?token=' + encodeURIComponent(token)).then((r) => {
      if (r.valid) $('#resetForm').classList.remove('hidden');
      else { say(msg, 'error', 'This reset link is invalid, already used, or has expired.'); $('#again').classList.remove('hidden'); }
    }).catch((e) => say(msg, 'error', e.message));
    form('#resetForm', async (f) => {
      const pw = RS.passwordProblem(val(f, 'password'));
      if (pw) { RS.showFieldErrors(f, { password: pw }); return; }
      if (val(f, 'password') !== val(f, 'confirmPassword')) { RS.showFieldErrors(f, { confirmPassword: 'Passwords do not match.' }); return; }
      try { await RS.post('/api/auth/reset', { token, password: val(f, 'password'), confirmPassword: val(f, 'confirmPassword') }); }
      catch (err) { if (!err.fields || !Object.keys(err.fields).length) $('#again').classList.remove('hidden'); throw err; }
      f.classList.add('hidden'); say(msg, 'ok', 'Password updated. Redirecting you to log in…');
      setTimeout(() => (location.href = '/login?reset=1'), 1800);
    });
  }

})();
