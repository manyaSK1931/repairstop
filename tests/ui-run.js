'use strict';
// Browser end-to-end run (needs Playwright):  NODE_PATH=<dir with playwright> node tests/ui-run.js
const path = require('path');
const H = require('./helpers');
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const SHOTS = process.env.SHOTS || path.join(H.tmp, 'shots');
require('fs').mkdirSync(SHOTS, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const issues = [];
let step = 0;
const log = (m) => console.log(`  ${String(++step).padStart(2, '0')} ok  ${m}`);

(async () => {
  const smtp = await H.startFakeSmtp();
  Object.assign(process.env, { DB_FILE: path.join(H.tmp, 'ui.db'), UPLOAD_DIR: path.join(H.tmp, 'uiup'), APP_URL: 'http://localhost:3101', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtp.port), SMTP_USER: 'smtp-user', SMTP_PASS: 'smtp-pass',
    ADMIN_EMAIL: 'admin@repairstop.test', ADMIN_PASSWORD: 'Admin#Pass123' });
  const server = await require('../server/index').start(3101);
  const base = 'http://localhost:3101';
  const mails = (to) => smtp.messages.filter((m) => m.to.toLowerCase() === to.toLowerCase());
  const waitMail = async (to, n = 1) => { for (let i = 0; i < 40 && mails(to).length < n; i++) await new Promise((r) => setTimeout(r, 100)); return H.bodyOf(mails(to)[n - 1].raw); };

  const browser = await chromium.launch();
  const ctx = async (geo) => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, geolocation: geo, permissions: geo ? ['geolocation'] : [] });
    // Stub only the external OpenStreetMap geocoder (no internet in the sandbox)
    await c.route('https://nominatim.openstreetmap.org/**', (route) => {
      const u = route.request().url();
      route.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: u.includes('/reverse') ? JSON.stringify({ display_name: 'MG Road, Bengaluru' }) : JSON.stringify([{ lat: '12.9716', lon: '77.5946', display_name: 'MG Road, Bengaluru' }]) });
    });
    return c;
  };
  const watch = (page, tag) => {
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource: the server responded with a status of (4\d\d)/.test(m.text())) issues.push(`[${tag}] ${m.type()}: ${m.text()} @ ${page.url()}`); });
    page.on('pageerror', (e) => issues.push(`[${tag}] pageerror: ${e.message} @ ${page.url()}`));
  };
  const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });

  const CUST = { name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', pw: 'Strong#Pass1', pw2: 'NewStrong#Pass2' };
  const cc = await ctx({ latitude: 12.9716, longitude: 77.5946 }), mc = await ctx({ latitude: 12.98, longitude: 77.6 }), ac = await ctx();
  const cp = await cc.newPage(), mp = await mc.newPage(), ap = await ac.newPage();
  watch(cp, 'customer'); watch(mp, 'mechanic'); watch(ap, 'admin');

  console.log('Customer: register / login');
  await cp.goto(base + '/register');
  await cp.fill('#fullName', CUST.name); await cp.fill('#email', CUST.email); await cp.fill('#phone', CUST.phone);
  await cp.fill('#password', 'weak'); await cp.fill('#confirmPassword', 'weak'); await cp.click('button[type=submit]');
  assert.match(await cp.textContent('#registerForm'), /Add|Use at least/); log('weak password blocked client-side');
  await cp.fill('#password', CUST.pw); await cp.fill('#confirmPassword', CUST.pw);
  await cp.click('#password ~ button'); assert.equal(await cp.getAttribute('#password', 'type'), 'text'); log('show/hide password works');
  await cp.click('button[type=submit]');
  await cp.waitForSelector('.alert.ok'); log('registered; ' + (await cp.textContent('.alert.ok')).slice(0, 60));
  await cp.goto(base + '/login'); await cp.fill('#email', CUST.email); await cp.fill('#password', CUST.pw); await cp.click('button[type=submit]');
  await cp.waitForURL('**/customer'); log('login works without email verification');
  await cp.goto(base + '/login'); await cp.fill('#email', 'asha@example.com'); await cp.fill('#password', 'Wrong#Pass1'); await cp.click('button[type=submit]');
  await cp.waitForSelector('.alert.error'); assert.match(await cp.textContent('.alert.error'), /Invalid email or password/); log('invalid login shows error');
  await cp.fill('#password', CUST.pw); await cp.check('#remember'); await cp.click('button[type=submit]');
  await cp.waitForURL('**/customer'); await cp.waitForSelector('#hello'); assert.match(await cp.textContent('#hello'), /Asha/); log('login redirects to customer dashboard');
  await shot(cp, 'customer-dashboard-empty');

  console.log('Forgot password / reset');
  const fp = await (await ctx()).newPage(); watch(fp, 'forgot');
  await fp.goto(base + '/forgot-password'); await fp.fill('#email', 'nobody@example.com'); await fp.click('button[type=submit]'); await fp.waitForSelector('.alert.ok');
  const unknownMsg = await fp.textContent('.alert.ok'); log('unknown email gets same confirmation');
  await fp.goto(base + '/forgot-password'); await fp.fill('#email', CUST.email); await fp.click('button[type=submit]'); await fp.waitForSelector('.alert.ok');
  assert.equal(await fp.textContent('.alert.ok'), unknownMsg);
  const reset = await waitMail(CUST.email, 1); assert.match(reset.subject, /Reset/); assert.ok(!reset.text.includes(CUST.pw)); log('reset email received (link only, no password)');
  await fp.goto(H.linkIn(reset.text)); await fp.waitForSelector('#resetForm:not(.hidden)');
  await fp.fill('#password', CUST.pw2); await fp.fill('#confirmPassword', 'Mismatch#1'); await fp.click('button[type=submit]'); assert.match(await fp.textContent('#resetForm'), /do not match/); log('mismatched passwords rejected');
  await fp.fill('#confirmPassword', CUST.pw2); await fp.click('button[type=submit]'); await fp.waitForURL('**/login?reset=1'); log('password reset, redirected to login');
  await fp.goto(H.linkIn(reset.text)); await fp.waitForSelector('.alert.error'); log('reset link cannot be reused');
  await fp.goto(base + '/login'); await fp.fill('#email', CUST.email); await fp.fill('#password', CUST.pw); await fp.click('button[type=submit]'); await fp.waitForSelector('.alert.error'); log('old password rejected');
  await fp.fill('#password', CUST.pw2); await fp.click('button[type=submit]'); await fp.waitForURL('**/customer'); log('new password logs in');
  await cp.reload(); await cp.waitForURL(/login/); log('old customer session was revoked by the reset');
  await cp.fill('#email', CUST.email); await cp.fill('#password', CUST.pw2); await cp.click('button[type=submit]'); await cp.waitForURL('**/customer');

  console.log('Mechanic: partner registration');
  await mp.goto(base + '/partner'); await mp.waitForSelector('[data-svc]');
  await mp.click('button[type=submit]'); assert.match(await mp.textContent('#msg'), /fix the highlighted/); log('empty application is rejected with field errors');
  await mp.fill('#fullName', 'Ravi Kumar'); await mp.fill('#phone', '9123456780'); await mp.fill('#email', 'ravi@garage.test'); await mp.fill('#password', 'Garage#Pass1'); await mp.fill('#confirmPassword', 'Garage#Pass1');
  await mp.fill('#garageName', 'Ravi Auto Works'); await mp.fill('#address', '12 MG Road'); await mp.fill('#city', 'Bengaluru'); await mp.fill('#experienceYears', '8');
  await mp.check('[data-svc="tyre-puncture"]'); await mp.fill('[data-price="tyre-puncture"]', '350'); await mp.check('[data-svc="battery-jump-start"]'); await mp.fill('[data-price="battery-jump-start"]', '400');
  await mp.setInputFiles('#doc_id_proof', { name: 'id.png', mimeType: 'image/png', buffer: PNG });
  await mp.click('#locateGarage'); await mp.waitForFunction(() => /Located/.test(document.querySelector('#locStatus').textContent));
  await mp.click('button[type=submit]'); await mp.waitForSelector('.alert.ok'); log('partner application submitted');
  await shot(mp, 'partner-submitted');
  await mp.goto(base + '/login'); await mp.fill('#email', 'ravi@garage.test'); await mp.fill('#password', 'Garage#Pass1'); await mp.click('button[type=submit]'); await mp.waitForURL('**/mechanic');
  await mp.waitForSelector('#banner:not(.hidden)'); assert.match(await mp.textContent('#banner'), /awaiting administrator/); assert.equal(await mp.isDisabled('#availToggle'), true); log('pending mechanic sees banner and cannot go online');

  console.log('Admin: approve mechanic');
  await ap.goto(base + '/login'); await ap.fill('#email', 'admin@repairstop.test'); await ap.fill('#password', 'Admin#Pass123'); await ap.click('button[type=submit]'); await ap.waitForURL('**/admin');
  await ap.click('[data-tab=verifications]'); await ap.waitForSelector('[data-review]'); await ap.click('[data-review]');
  await ap.waitForSelector('.modal'); await shot(ap, 'admin-review-modal'); await ap.click('[data-d=reject]'); await ap.waitForSelector('.alert.error'); log('rejecting without a reason is refused');
  await ap.click('[data-review]'); await ap.waitForSelector('.modal'); await ap.click('[data-d=approve]'); await ap.waitForSelector('.alert.ok'); log('admin approved the mechanic');
  await ap.click('[data-tab=overview]'); await ap.waitForSelector('#statsBox .stat'); await shot(ap, 'admin-overview');
  for (const t of ['mechanics', 'customers', 'bookings', 'services', 'areas', 'payments', 'reviews']) { await ap.click(`[data-tab=${t}]`); await ap.waitForTimeout(250); }
  await ap.click('[data-tab=areas]'); await ap.fill('#acity', 'Bengaluru'); await ap.click('#areaForm button'); await ap.waitForSelector('[data-delarea]'); log('admin tabs load; coverage city added');
  await mp.reload(); await mp.waitForSelector('#availToggle:not([disabled])'); await mp.check('#availToggle'); await mp.waitForFunction(() => /Online/.test(document.querySelector('#availLabel').textContent)); log('approved mechanic goes online');

  console.log('Customer: home search -> book');
  const hp = await cc.newPage(); watch(hp, 'home');
  await hp.goto(base + '/'); await hp.waitForFunction(() => document.querySelector('#stMech').textContent === '1');
  assert.equal(await hp.textContent('#stRating'), '—'); await hp.waitForSelector('#areaList span:has-text("Bengaluru")'); log('home shows real counts, "—" for no rating, coverage city from DB');
  await hp.click('.chip[data-service="battery-jump-start"]'); assert.equal(await hp.getAttribute('.chip[data-service="battery-jump-start"]', 'aria-pressed'), 'true');
  await hp.click('#useLoc'); await hp.waitForSelector('#mechList button[data-id]'); const card = await hp.textContent('#mechList'); assert.match(card, /Ravi Auto Works/); assert.match(card, /from ₹400/); log('GPS search lists the real mechanic with price, ETA, distance');
  await shot(hp, 'home-with-results');
  await hp.click('#mechList button[data-id]'); await hp.waitForURL(/\/book\?service=battery-jump-start&mechanic=/); await hp.waitForSelector('#confirmBtn:not(.hidden)');
  await hp.click('.mcard + button.link'); await hp.waitForSelector('.modal'); assert.match(await hp.textContent('.modal'), /Price list/); await hp.click('.modal [data-close]'); log('mechanic details modal');
  await hp.fill('#vehicle', 'Swift KA01 AB 1234'); await hp.click('#confirmBtn'); await hp.waitForURL(/\/customer\?b=\d+#bookings/); await hp.waitForSelector('.card:has-text("Waiting for Ravi Auto Works")'); log('booking created, customer dashboard shows it');
  await shot(hp, 'customer-pending');

  console.log('Mechanic accepts and works the job');
  await mp.click('[data-tab=jobs]'); await mp.waitForSelector('[data-act=accept]'); assert.ok(!/MG Road/.test(await mp.textContent('#jobList'))); await mp.click('[data-act=accept]'); await mp.waitForSelector('.alert.ok'); log('mechanic accepts (address hidden until then)');
  await mp.click('[data-tab=active]'); await mp.waitForSelector('[data-act=status][data-st=en_route]'); await mp.click('[data-st=en_route]');
  await mp.waitForSelector('[data-st=arrived]'); await hp.reload(); await hp.waitForSelector('.otp'); const otp = (await hp.textContent('.otp')).trim(); assert.match(otp, /^\d{4}$/); log('customer sees status + OTP: ' + otp);
  await hp.waitForSelector('svg.map'); log('live map shown to customer');
  await mp.click('[data-st=arrived]'); await mp.waitForSelector('[data-form=start]');
  await mp.fill('[name=otp]', otp === '0000' ? '1111' : '0000'); await mp.click('[data-form=start] button'); await mp.waitForSelector('.alert.error'); log('wrong OTP rejected in UI');
  await mp.fill('[name=otp]', otp); await mp.click('[data-form=start] button'); await mp.waitForSelector('[data-form=estimate]'); log('correct OTP starts inspection');
  await shot(mp, 'mechanic-active');
  await mp.setInputFiles('[data-photo]', { name: 'tyre.png', mimeType: 'image/png', buffer: PNG }); await mp.waitForSelector('.alert.ok:has-text("Photo")'); log('mechanic uploads repair photo');
  await mp.fill('[name=amount]', '900'); await mp.fill('[name=notes]', 'Replace the battery terminal and charge'); await mp.click('[data-form=estimate] button[type=submit]'); await mp.waitForSelector('.alert:has-text("Waiting for the customer")'); log('mechanic sends estimate');
  await hp.waitForSelector('[data-act=approve]', { timeout: 9000 }); assert.match(await hp.textContent('body'), /₹900/); await shot(hp, 'customer-estimate');
  await hp.click('[data-act=approve]'); await hp.waitForSelector('.badge:has-text("Repair in progress")'); log('customer approves the estimate');
  await mp.click('[data-tab=history]'); await mp.click('[data-tab=active]'); await mp.waitForSelector('[data-act=complete]', { timeout: 9000 }); mp.once('dialog', (d) => d.accept()); await mp.click('[data-act=complete]'); log('mechanic completes the job');
  await hp.waitForSelector('[data-act=payCash]', { timeout: 9000 }); assert.match(await hp.textContent('.alert.info:has([data-act=payCash])'), /₹1,300/); log('amount due = visit fee + estimate (₹1,300)');
  await hp.click('[data-act=payCash]'); await hp.waitForSelector('.alert:has-text("Hand")'); log('customer chooses cash');
  await mp.click('[data-tab=history]'); await mp.click('[data-tab=active]'); await mp.waitForSelector('[data-act=cash]', { timeout: 9000 }); await mp.click('[data-act=cash]'); await mp.waitForFunction(() => !document.querySelector('[data-act=cash]')); log('mechanic confirms cash receipt');
  await hp.click('[data-tab=reviews]'); await hp.waitForSelector('form[data-review]'); await hp.click('form[data-review] [data-star="5"]'); await hp.fill('form[data-review] textarea', 'Arrived quickly and explained the cost clearly.'); await hp.click('form[data-review] button[type=submit]'); await hp.waitForSelector('.alert.ok'); log('customer submits review');
  await hp.click('[data-tab=payments]'); await hp.waitForSelector('#payList table'); assert.match(await hp.textContent('#payList'), /₹1,300/); log('payment history shows the payment');
  await mp.click('[data-tab=earnings]'); await mp.waitForSelector('.stat'); assert.match(await mp.textContent('#earnBox'), /₹1,300/); log('mechanic earnings updated');
  await shot(mp, 'mechanic-earnings');

  console.log('Public pages reflect the real review');
  const pp = await (await ctx()).newPage(); watch(pp, 'public'); await pp.goto(base + '/');
  await pp.waitForSelector('#reviewList p'); assert.match(await pp.textContent('#reviewList'), /explained the cost clearly/); assert.equal(await pp.textContent('#stRating'), '5.0'); log('home shows genuine review and rating 5.0');
  await pp.click('details summary >> nth=0'); assert.equal(await pp.evaluate(() => document.querySelector('details').open), true); log('FAQ expands');
  await pp.click('.svc-card[data-service="towing"]'); await pp.waitForURL(/\/book\?service=towing/); log('service card opens the booking flow');
  await pp.goto(base + '/customer'); await pp.waitForURL(/login\?next=/); log('protected page redirects to login');
  await shot(pp, 'login-page');

  console.log('Responsive');
  for (const [w, h, name] of [[375, 800, 'mobile'], [768, 900, 'tablet']]) {
    const c = await browser.newContext({ viewport: { width: w, height: h } }); const p = await c.newPage(); watch(p, name);
    for (const [u, n] of [['/', 'home'], ['/login', 'login'], ['/partner', 'partner'], ['/book', 'book']]) {
      await p.goto(base + u); await p.waitForTimeout(500);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 1, `${name} ${u}: horizontal overflow ${over}px`); if (n === 'home' || n === 'login') await shot(p, `${name}-${n}`);
    }
    log(`${name} ${w}px: no horizontal overflow on home, login, partner, book`);
    if (name === 'mobile') { await c.addCookies(await cc.cookies()); await p.goto(base + '/customer'); await p.waitForSelector('#hello'); const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert.ok(o <= 1, 'customer dashboard overflow ' + o); await shot(p, 'mobile-customer'); log('mobile customer dashboard fits'); }
    await c.close();
  }

  await browser.close(); server.close(); smtp.server.close();
  console.log('\nConsole/CSP/page errors captured during the run:', issues.length ? '\n' + issues.join('\n') : 'none');
  console.log('Screenshots:', SHOTS);
  process.exit(issues.length ? 2 : 0);
})().catch((e) => { console.error('\nUI RUN FAILED:', e.message.split('\n').slice(0, 8).join('\n')); console.error(issues.join('\n')); process.exit(1); });
