'use strict';
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

// A tiny but real SMTP server: speaks ESMTP over TCP, requires AUTH, captures every message.
function startFakeSmtp() {
  const messages = [];
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    let inData = false, data = '', buf = '', mail = {};
    const w = (s) => sock.write(s + '\r\n');
    w('220 fake.smtp ESMTP ready');
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\r\n')) !== -1) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; messages.push({ ...mail, raw: data }); data = ''; mail = {}; w('250 queued'); }
          else data += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
          continue;
        }
        const u = line.toUpperCase();
        if (u.startsWith('EHLO')) { sock.write('250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n'); }
        else if (u.startsWith('AUTH PLAIN')) {
          const [, user, pass] = Buffer.from(line.split(' ')[2], 'base64').toString().split('\0');
          if (user === 'smtp-user' && pass === 'smtp-pass') { mail.authed = true; w('235 ok'); } else w('535 bad credentials');
        }
        else if (u.startsWith('MAIL FROM')) { mail.from = line.slice(10).replace(/[<>]/g, ''); w('250 ok'); }
        else if (u.startsWith('RCPT TO')) { mail.to = line.slice(8).replace(/[<>]/g, ''); w('250 ok'); }
        else if (u === 'DATA') { inData = true; w('354 go'); }
        else if (u === 'QUIT') { w('221 bye'); sock.end(); }
        else w('250 ok');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, messages, port: server.address().port })));
}

// Decode the text/plain part of a captured message
function bodyOf(raw) {
  const parts = raw.split(/--rs_[a-f0-9]+/);
  const plain = parts.find((p) => /text\/plain/.test(p));
  const b64 = plain.split(/\r\n\r\n/).slice(1).join('').replace(/\s+/g, '');
  return { subject: decodeSubject(raw), text: Buffer.from(b64, 'base64').toString('utf8') };
}
function decodeSubject(raw) {
  const m = raw.match(/^Subject: (.*)$/m)[1];
  const enc = m.match(/=\?UTF-8\?B\?(.*)\?=/);
  return enc ? Buffer.from(enc[1], 'base64').toString('utf8') : m;
}
const linkIn = (text) => text.match(/https?:\/\/[^\s]+/)[0];
const tokenIn = (text) => new URL(linkIn(text)).searchParams.get('token');

// HTTP client with a cookie jar
function client(base) {
  let cookie = '';
  async function call(method, url, body) {
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) { const c = sc.split(';')[0]; cookie = c.endsWith('=') ? '' : c; }
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  }
  return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), put: (u, b) => call('PUT', u, b), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u), raw: call, clear: () => { cookie = ''; }, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-test-'));
module.exports = { startFakeSmtp, bodyOf, linkIn, tokenIn, client, tmp };
