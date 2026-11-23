RS.mountChrome();
RS.get('/api/public/config').then((c) => {
  const box = RS.$('#contactInfo'), rows = [];
  if (c.supportPhone) rows.push(`<div><strong>Helpline:</strong> <a href="tel:${RS.esc(c.supportPhone.replace(/[^+\d]/g, ''))}" style="color:var(--orange)">${RS.esc(c.supportPhone)}</a></div>`);
  if (c.supportEmail) rows.push(`<div><strong>Email:</strong> <a href="mailto:${RS.esc(c.supportEmail)}" style="color:var(--orange)">${RS.esc(c.supportEmail)}</a></div>`);
  box.innerHTML = rows.join('') || '<div class="alert info">Support contact details have not been configured yet (set SUPPORT_PHONE and SUPPORT_EMAIL).</div>';
});
