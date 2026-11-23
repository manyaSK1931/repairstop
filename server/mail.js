'use strict';
// Dependency-free SMTP client: implicit TLS (465), STARTTLS (587) or plain (local relays), AUTH PLAIN/LOGIN.
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const cfg = require('./config');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const addrOf = (s) => (s.match(/<([^>]+)>/) || [null, s])[1].trim();

function buildMessage({ from, to, subject, text, html }) {
  const boundary = 'rs_' + crypto.randomBytes(12).toString('hex');
  const wrap = (s) => b64(s).replace(/(.{76})/g, '$1\r\n');
  const domain = addrOf(from).split('@')[1] || 'localhost';
  return [
    `From: ${from}`, `To: ${to}`, `Subject: ${encHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', wrap(html || text),
    `--${boundary}--`, '',
  ].join('\r\n');
}

function send(msg, smtp = cfg.smtp) {
  if (!smtp.host) return Promise.reject(new Error('SMTP is not configured (set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in .env)'));
  return new Promise((resolve, reject) => {
    let sock, buf = '', waiting = null, done = false;
    const fail = (err) => { if (done) return; done = true; try { sock && sock.destroy(); } catch {} reject(err); };
    const timer = setTimeout(() => fail(new Error('SMTP timeout')), 20000);

    function attach(s) {
      sock = s;
      sock.setEncoding('utf8');
      sock.on('data', (d) => { buf += d; pump(); });
      sock.on('error', fail);
      sock.on('close', () => { if (!done && waiting) fail(new Error('SMTP connection closed')); });
    }
    function pump() {
      // A reply is complete when its last line is "NNN text" (no dash)
      const lines = buf.split('\r\n');
      if (lines.length < 2) return;
      const complete = lines.filter(Boolean);
      const last = complete[complete.length - 1];
      if (!/^\d{3} /.test(last) && !/^\d{3}$/.test(last)) return;
      if (!buf.endsWith('\r\n')) return;
      const reply = { code: parseInt(last.slice(0, 3), 10), text: complete.join('\n') };
      buf = '';
      if (waiting) { const w = waiting; waiting = null; w(reply); }
    }
    const read = () => new Promise((res) => { waiting = res; pump(); });
    const cmd = async (line, ok) => {
      sock.write(line + '\r\n');
      const r = await read();
      if (!ok.includes(r.code)) throw new Error(`SMTP error after "${line.split(' ')[0]}": ${r.text}`);
      return r;
    };

    (async () => {
      const connect = smtp.secure
        ? (cb) => tls.connect({ host: smtp.host, port: smtp.port, servername: smtp.host }, cb)
        : (cb) => net.connect({ host: smtp.host, port: smtp.port }, cb);
      await new Promise((res) => attach(connect(res)));
      let r = await read(); if (r.code !== 220) throw new Error('SMTP greeting failed: ' + r.text);
      r = await cmd('EHLO repairstop.local', [250]);
      if (!smtp.secure && /STARTTLS/i.test(r.text)) {
        await cmd('STARTTLS', [220]);
        const plain = sock; plain.removeAllListeners('data'); buf = '';
        await new Promise((res, rej) => {
          const t = tls.connect({ socket: plain, servername: smtp.host }, res); t.on('error', rej); attach(t);
        });
        r = await cmd('EHLO repairstop.local', [250]);
      }
      if (smtp.user) {
        if (!smtp.secure && !(sock instanceof tls.TLSSocket) && smtp.host !== 'localhost' && smtp.host !== '127.0.0.1')
          throw new Error('Refusing to send SMTP credentials over an unencrypted connection');
        if (/AUTH[^\n]*PLAIN/i.test(r.text)) await cmd('AUTH PLAIN ' + b64(`\0${smtp.user}\0${smtp.pass}`), [235]);
        else { await cmd('AUTH LOGIN', [334]); await cmd(b64(smtp.user), [334]); await cmd(b64(smtp.pass), [235]); }
      }
      await cmd(`MAIL FROM:<${addrOf(msg.from || smtp.from)}>`, [250]);
      await cmd(`RCPT TO:<${addrOf(msg.to)}>`, [250, 251]);
      await cmd('DATA', [354]);
      const body = buildMessage({ from: msg.from || smtp.from, ...msg }).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
      await cmd(body + '\r\n.', [250]);
      try { sock.write('QUIT\r\n'); } catch {}
      done = true; clearTimeout(timer); sock.end(); resolve();
    })().catch((e) => { clearTimeout(timer); fail(e); });
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function layout(title, bodyHtml) {
  return `<div style="background:#F6F4EF;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#14181F">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E2DED4;border-radius:14px;overflow:hidden">
    <div style="background:#C2410C;color:#fff;padding:16px 24px;font-size:20px;font-weight:700">RepairStop</div>
    <div style="padding:24px;line-height:1.6;font-size:15px"><h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>${bodyHtml}</div>
  </div></div>`;
}
const button = (url, label) => `<p style="margin:20px 0"><a href="${esc(url)}" style="background:#C2410C;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">${esc(label)}</a></p><p style="font-size:13px;color:#4B5563">If the button does not work, copy this link into your browser:<br>${esc(url)}</p>`;

const templates = {
  reset: (name, url, mins) => ({
    subject: 'Reset your RepairStop password',
    text: `Hi ${name},\n\nWe received a request to reset your RepairStop password. Use this link within ${mins} minutes:\n${url}\n\nIf you did not request this, ignore this email - your password stays unchanged.`,
    html: layout('Reset your password', `<p>Hi ${esc(name)}, we received a request to reset your RepairStop password. The link below works once and expires in ${mins} minutes.</p>${button(url, 'Reset password')}<p style="font-size:13px;color:#4B5563">If you did not request this, ignore this email. Your password stays unchanged.</p>`),
  }),
  passwordChanged: (name) => ({
    subject: 'Your RepairStop password was changed',
    text: `Hi ${name},\n\nYour RepairStop password was just changed. If this was not you, reset your password immediately and contact support.`,
    html: layout('Password changed', `<p>Hi ${esc(name)}, your RepairStop password was just changed.</p><p>If this was not you, reset your password immediately and contact support.</p>`),
  }),
  mechanicDecision: (name, approved, note) => ({
    subject: approved ? 'Your RepairStop partner account is approved' : 'Update on your RepairStop partner application',
    text: approved
      ? `Hi ${name},\n\nYour partner account is verified. Log in, set yourself available and start receiving nearby jobs.`
      : `Hi ${name},\n\nWe could not approve your partner application yet.${note ? '\nReason: ' + note : ''}\nYou can contact support to resubmit.`,
    html: layout(approved ? 'You are verified' : 'Application update', approved
      ? `<p>Hi ${esc(name)}, your partner account is verified. Log in, set yourself available and start receiving nearby jobs.</p>`
      : `<p>Hi ${esc(name)}, we could not approve your partner application yet.</p>${note ? `<p><b>Reason:</b> ${esc(note)}</p>` : ''}<p>You can contact support to resubmit.</p>`),
  }),
  sos: (customer, mapUrl, bookingLine) => ({
    subject: `SOS alert from ${customer}`,
    text: `${customer} pressed SOS in RepairStop and listed you as a trusted contact.\n${bookingLine}\nLast known location: ${mapUrl}\n\nPlease call them now. If they may be in danger, call the emergency number 112.`,
    html: layout('SOS alert', `<p><b>${esc(customer)}</b> pressed SOS in RepairStop and listed you as a trusted contact.</p><p>${esc(bookingLine)}</p>${button(mapUrl, 'Open last known location')}<p>Please call them now. If they may be in danger, call the emergency number <b>112</b>.</p>`),
  }),
};

async function sendTemplate(to, tpl) { return send({ to, ...tpl }); }

module.exports = { send, sendTemplate, templates, buildMessage };
