'use strict';
// Usage: node scripts/create-admin.js you@example.com "StrongPass#1" "Your Name"
const { createAdmin } = require('../server/admin-bootstrap');
const [email, password, name] = process.argv.slice(2);
if (!email || !password) { console.error('Usage: npm run create-admin -- <email> <password> [name]'); process.exit(1); }
try { const r = createAdmin({ email, password, name }); console.log(r.created ? 'Administrator created.' : 'Administrator already exists.'); }
catch (e) { console.error(e.message); process.exit(1); }
