'use strict';
const http = require('http');
const cfg = require('./config');
require('./db');
const { handle } = require('./http');
require('./routes/auth');
require('./routes/public');
require('./routes/partner');
require('./routes/customer');
require('./routes/mechanic');
require('./routes/admin');
const { createAdmin } = require('./admin-bootstrap');

function start(port = cfg.port) {
  if (cfg.admin.email && cfg.admin.password) {
    try { const r = createAdmin(cfg.admin); if (r.created) console.log(`[admin] created administrator ${cfg.admin.email}`); }
    catch (e) { console.error('[admin] bootstrap failed:', e.message); }
  }
  if (!cfg.smtp.host) console.warn('[mail] SMTP_HOST is not set - password-reset and notification emails cannot be sent until you configure SMTP in .env');
  const server = http.createServer(handle);
  server.requestTimeout = 30000;
  return new Promise((resolve) => server.listen(port, () => { console.log(`RepairStop running at ${cfg.appUrl.replace(/:\d+$/, '')}:${server.address().port}`); resolve(server); }));
}
module.exports = { start };
if (require.main === module) start();
