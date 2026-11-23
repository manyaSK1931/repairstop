# RepairStop – roadside assistance platform

The original RepairStop design (orange / cream / teal, DM Sans + Sora) with a real backend:
customers, mechanics and an admin, password reset, bookings with OTP-verified start,
live tracking, estimates, payments, reviews, SOS.

## Run it (5 minutes)

Requires **Node.js 22.13+** (uses the built-in SQLite and crypto – there are **no npm dependencies** to install).

```bash
cp .env.example .env        # then edit .env (see below)
npm start                   # http://localhost:3000
```

### 1. E-mail (optional)
Account registration and login do not require email verification. Configure `SMTP_*` and `MAIL_FROM` in `.env` to send password-reset,
SOS, and mechanic application notification emails. Gmail example: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`
(STARTTLS), `SMTP_USER=you@gmail.com`, `SMTP_PASS=<Google App Password>` (Google Account → Security → 2-Step Verification → App passwords).
For port 465 use `SMTP_SECURE=true`. Set `APP_URL` to your public address – it is used inside reset links.
Without SMTP, registration and login work, but those email features are unavailable.

### 2. First administrator
Either set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` (created on start) or run
`npm run create-admin -- admin@yourdomain.com "Str0ng#Password" "Your Name"`. There are no default credentials.
Log in at `/login`; you are sent to `/admin`.

### 3. Payments (Razorpay **test mode**)
Create a Razorpay account → Dashboard → Test mode → API Keys → put `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in `.env`.
Without keys, "Pay online" returns a clear message and customers can still pay cash (mechanic confirms receipt).
The secret stays on the server; only the public key id is sent to the browser. Signatures are verified server-side (HMAC-SHA256).

### 4. Maps
No key needed: address search / reverse geocoding use OpenStreetMap Nominatim, police stations use OpenStreetMap Overpass,
and the site's own SVG map plots real coordinates. Nominatim's usage policy is for light traffic; for production use a
commercial geocoder (Google, Mapbox, LocationIQ) by editing `RS.geocode` / `RS.reverseGeocode` in `public/js/common.js`.

### 5. Optional
`SUPPORT_PHONE`, `SUPPORT_EMAIL` (footer + /contact), `TRUST_PROXY=true` behind a reverse proxy, `DB_FILE`, `UPLOAD_DIR`.

## How it works
| Role | Where | Can do |
|---|---|---|
| Visitor | `/` | search mechanics near a location, see real stats/coverage/reviews |
| Customer | `/register` → `/customer` | book, track live, get OTP, approve estimate, pay, review, SOS/trusted contact |
| Mechanic | `/partner` → `/mechanic` | apply with documents; after admin approval: go online, accept jobs, update status, OTP start, estimate, photos, cash receipt, earnings |
| Admin | `/admin` | verify mechanics (documents), suspend users, services, coverage cities, bookings, payments, moderate reviews |

Booking flow: `pending_mechanic/open → accepted → en_route → arrived → (OTP) inspecting → estimate_sent → in_progress → completed → paid`.
Customer pays visit fee + approved estimate. Declining the estimate = visit fee only.

No fake data is shipped: the database starts empty (only the six services). Stats show "—", coverage shows only "More coming soon"
and reviews show an empty state until real data exists.

## Security summary
scrypt password hashing · HttpOnly/SameSite cookies (Secure on https) · server-side sessions revoked on password change/reset ·
single-use, hashed, expiring password-reset tokens (30 min) · no account enumeration on forgot-password · login rate limit + 5-strike lockout ·
role checks on every API route · CSRF protection (custom header + Origin check) · strict CSP (no inline scripts) · uploads validated by type **and** magic bytes,
stored outside the web root with random names, served only to authorised users · OTP limited to 5 attempts · secrets only from environment.

## Tests
`npm test` – backend tests against a real local SMTP server (registration, login, lockout, reset, RBAC, bookings, OTP, payments signature, reviews, admin…).
`NODE_PATH=<path to playwright> npm run test:ui` – 48-step browser run through the real pages (two browsers + admin) and responsive checks.

## Deploying
Put it behind HTTPS (Caddy/nginx), set `NODE_ENV=production`, `APP_URL=https://…`, `TRUST_PROXY=true`, and back up `data/`.
Keep `.env` out of git (already in `.gitignore`).

## Moving to MySQL
All SQL lives in `server/db.js` (schema) and the route files. It uses plain SQL with `?` placeholders, so porting means swapping the
`db.js` adapter for `mysql2` and adjusting a few SQLite-isms (`INSERT OR IGNORE`, `COLLATE NOCASE`, `AUTOINCREMENT`, `COALESCE` is fine).
