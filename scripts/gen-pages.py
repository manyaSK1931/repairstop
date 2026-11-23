# Generates the simple inner HTML pages (same chrome as the home page). Run: python3 scripts/gen-pages.py
import os
OUT=os.path.join(os.path.dirname(__file__),'..','public')
def page(name,title,main,script=None,body_attr=''):
    html=f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} – RepairStop</title>
<link rel="icon" href="/assets/logo.png">
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/base.css">
<link rel="stylesheet" href="/css/app.css">
</head>
<body class="app" {body_attr}>
<div id="chrome-nav"></div>
<main>
{main}
</main>
<div id="chrome-foot"></div>
<script src="/js/common.js"></script>
{f'<script src="/js/{script}.js?v=2"></script>' if script else ''}
</body>
</html>
'''
    open(os.path.join(OUT,name+'.html'),'w').write(html)

PW=lambda id,label,auto,extra='': f'''<div class="field"><label for="{id}">{label}</label><div class="pw"><input id="{id}" name="{id}" type="password" autocomplete="{auto}" required{extra}><button type="button" aria-label="Show or hide password">Show</button></div><div class="err"></div></div>'''
F=lambda id,label,typ='text',auto='',extra='': f'''<div class="field"><label for="{id}">{label}</label><input id="{id}" name="{id}" type="{typ}" autocomplete="{auto}"{extra}><div class="err"></div></div>'''

page('login','Log in',f'''<div class="container narrow"><div class="card stack">
<div><div class="eyebrow">Welcome back</div><h1 style="font-size:28px">Log in to RepairStop</h1></div>
<div id="msg" class="hidden"></div>
<form id="loginForm" class="stack" novalidate>
{F('email','Email address','email','email',' required')}
{PW('password','Password','current-password')}
<div class="row between"><label class="check"><input type="checkbox" id="remember" name="remember"> Remember me</label><a href="/forgot-password" style="color:var(--orange);font-weight:500">Forgot password?</a></div>
<button class="btn primary block" type="submit">Log in</button>
</form>
<div class="muted" style="text-align:center">New to RepairStop? <a href="/register" style="color:var(--orange);font-weight:700">Create an account</a><br><span class="small">Mechanic or garage owner? <a href="/partner" style="color:var(--orange)">Join as a partner</a></span></div>
</div></div>''','auth','data-page="login"')

page('register','Create account',f'''<div class="container narrow"><div class="card stack">
<div><div class="eyebrow">Join RepairStop</div><h1 style="font-size:28px">Create your account</h1><p class="lead" style="font-size:15px">Create an account and log in right away.</p></div>
<div id="msg" class="hidden"></div>
<form id="registerForm" class="stack" novalidate>
{F('fullName','Full name','text','name',' required maxlength="100"')}
{F('email','Email address','email','email',' required')}
{F('phone','Phone number','tel','tel',' required placeholder="10-digit mobile number"')}
{PW('password','Password','new-password')}
<div class="hint">At least 8 characters with upper and lower case letters, a number and a special character.</div>
{PW('confirmPassword','Confirm password','new-password')}
<button class="btn primary block" type="submit">Register</button>
</form>
<div class="muted" style="text-align:center">Already have an account? <a href="/login" style="color:var(--orange);font-weight:700">Log in</a></div>
</div></div>''','auth','data-page="register"')

page('forgot-password','Forgot password',f'''<div class="container narrow"><div class="card stack">
<div><div class="eyebrow">Password help</div><h1 style="font-size:28px">Forgot your password?</h1><p class="lead" style="font-size:15px">Enter your registered email address. We will send a secure link to create a new password. We never email your current password.</p></div>
<div id="msg" class="hidden"></div>
<form id="forgotForm" class="stack" novalidate>
{F('email','Registered email address','email','email',' required')}
<button class="btn primary block" type="submit">Send reset link</button>
</form>
<div class="muted" style="text-align:center"><a href="/login" style="color:var(--orange);font-weight:700">Back to log in</a></div>
</div></div>''','auth','data-page="forgot"')

page('reset-password','Reset password',f'''<div class="container narrow"><div class="card stack">
<div><div class="eyebrow">Password help</div><h1 style="font-size:28px">Create a new password</h1></div>
<div id="msg" class="hidden"></div>
<form id="resetForm" class="stack hidden" novalidate>
{PW('password','New password','new-password')}
<div class="hint">At least 8 characters with upper and lower case letters, a number and a special character.</div>
{PW('confirmPassword','Confirm new password','new-password')}
<button class="btn primary block" type="submit">Update password</button>
</form>
<div id="again" class="hidden muted" style="text-align:center"><a href="/forgot-password" style="color:var(--orange);font-weight:700">Request a new reset link</a></div>
</div></div>''','auth','data-page="reset"')

# ---------- Partner registration ----------
page('partner','Join as a partner',f'''<div class="container mid"><div class="stack">
<div><div class="eyebrow">For mechanics and garages</div><h1 style="font-size:34px">Join RepairStop as a partner</h1><p class="lead">Get nearby jobs, set your own rates and receive payments directly. Our team verifies your ID and details before you go live.</p></div>
<div id="msg" class="hidden"></div>
<form id="partnerForm" class="stack" novalidate>
<div class="card stack"><h2 style="font-size:20px">1. Your details</h2>
<div class="grid cols-2">{F('fullName','Full name','text','name',' required maxlength="100"')}{F('phone','Phone number','tel','tel',' required')}</div>
{F('email','Email address','email','email',' required')}
<div class="grid cols-2">{PW('password','Password','new-password')}{PW('confirmPassword','Confirm password','new-password')}</div>
<div class="hint">At least 8 characters with upper and lower case letters, a number and a special character.</div></div>
<div class="card stack"><h2 style="font-size:20px">2. Garage</h2>
{F('garageName','Garage or business name','text','organization',' required maxlength="120"')}
{F('address','Garage address','text','street-address',' required maxlength="300"')}
<div class="grid cols-2">{F('city','City','text','address-level2',' required maxlength="80"')}{F('experienceYears','Years of experience','number','',' required min="0" max="60"')}</div>
<div class="row"><button class="btn sm" type="button" id="locateGarage">Locate my garage</button><span class="hint" id="locStatus">Customers see you by distance, so we need your garage location. Type the address and tap Locate, or use GPS while at the garage.</span></div></div>
<div class="card stack"><h2 style="font-size:20px">3. Services and your starting prices</h2>
<div id="svcList" class="stack"></div><div class="err" id="svcErr" style="color:var(--orange-dark);font-size:13px;font-weight:500"></div></div>
<div class="card stack"><h2 style="font-size:20px">4. Identification documents</h2>
<p class="muted small" style="margin:0">JPG, PNG, WebP or PDF, up to 4 MB each. Only RepairStop administrators can view these.</p>
<div class="field"><label for="doc_id_proof">Government ID (required)</label><input id="doc_id_proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style="padding:10px 14px"></div>
<div class="field"><label for="doc_address_proof">Address proof (optional)</label><input id="doc_address_proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style="padding:10px 14px"></div>
<div class="field"><label for="doc_garage_license">Garage licence / registration (optional)</label><input id="doc_garage_license" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" style="padding:10px 14px"></div>
<div class="field" id="docErr"><div class="err"></div></div></div>
<button class="btn primary block" type="submit">Submit application</button>
</form>
<div class="muted" style="text-align:center">Already a partner? <a href="/login" style="color:var(--orange);font-weight:700">Log in</a></div>
</div></div>''','partner')

# ---------- Booking ----------
page('book','Book roadside help','''<div class="container"><div class="stack">
<div><div class="eyebrow">Book roadside assistance</div><h1 style="font-size:34px">Stuck on the road? A mechanic comes to you.</h1><p class="lead">No payment until a mechanic accepts. Price is shown before work starts.</p></div>
<div id="msg" class="hidden"></div>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
<div class="card stack">
<div class="field"><label for="loc">Where is your vehicle?</label><div class="row" style="flex-wrap:wrap"><input id="loc" placeholder="Type a landmark or address" style="flex:1 1 220px;min-height:48px;border:1px solid var(--line-strong);border-radius:10px;padding:0 14px;font:400 16px 'DM Sans'"><button class="btn" id="useLoc" type="button">Use my location</button></div></div>
<div class="label">What happened?</div><div class="row" id="chips" role="group" aria-label="Service"></div>
<button class="btn primary block" id="findBtn" type="button">Find mechanics near me</button>
<div class="hint">Estimated arrival times are based on distance and are not a guarantee.</div>
</div>
<div class="card stack" style="background:var(--sand);border-color:var(--sand)">
<div id="mapBox"></div>
<div class="label">Nearest mechanics</div>
<div id="mechList" class="stack"><div class="muted small" style="background:#fff;border-radius:12px;padding:14px 16px">Enter your location and choose a service to see mechanics near you.</div></div>
<div id="confirmBox" class="stack hidden" style="background:#fff;border-radius:12px;padding:16px">
<div id="selSummary"></div>
<div class="field"><label for="vehicle">Vehicle (make, model, number)</label><input id="vehicle" maxlength="100" placeholder="e.g. Swift KA01 AB 1234"></div>
<div class="field"><label for="notes">Anything the mechanic should know? (optional)</label><textarea id="notes" maxlength="500"></textarea></div>
<button class="btn primary block" id="confirmBtn" type="button">Request this mechanic</button>
<button class="btn block" id="autoBtn" type="button">Let nearby mechanics accept instead</button>
</div></div></div></div></div>''','book')

# ---------- Police ----------
page('police','Nearby police stations','''<div class="container mid"><div class="stack">
<div><div class="eyebrow">Safety</div><h1 style="font-size:34px">Nearby police stations</h1><p class="lead">If you feel unsafe, move to a lit, public place and call the emergency number.</p></div>
<div class="alert error"><strong>Emergency (India): call 112.</strong> This page lists stations from OpenStreetMap, which may be incomplete. In an emergency always call first.</div>
<div class="card stack"><div class="row"><input id="q" placeholder="Type an address or area" style="flex:1 1 220px;min-height:48px;border:1px solid var(--line-strong);border-radius:10px;padding:0 14px;font:400 16px 'DM Sans'"><button class="btn" id="gps" type="button">Use my location</button><button class="btn primary" id="go" type="button">Search</button></div>
<div id="msg" class="hidden"></div><div id="list" class="stack"></div></div></div></div>''','police')

# ---------- Legal / contact ----------
LEGAL_NOTE='<div class="alert info small">This is a starter template. Have it reviewed by a lawyer and adapt it to your company before launch.</div>'
page('terms','Terms of service',f'''<div class="container mid"><div class="card stack"><h1 style="font-size:30px">Terms of service</h1>{LEGAL_NOTE}
<p><strong>1. The service.</strong> RepairStop connects vehicle owners with independent, verified mechanics and garages. Mechanics are independent partners, not employees of RepairStop.</p>
<p><strong>2. Pricing.</strong> You pay a visit fee shown before you book. After inspecting, the mechanic sends a repair estimate that you may approve or decline. Declining means you pay only the visit fee.</p>
<p><strong>3. Accounts.</strong> You must provide accurate information and keep your password confidential. RepairStop does not verify email ownership. Share your start code only with the mechanic who is physically with you.</p>
<p><strong>4. Cancellations.</strong> You may cancel until the mechanic arrives. Repeated misuse may lead to suspension.</p>
<p><strong>5. Payments.</strong> Payments are made online through our payment partner or in cash to the mechanic, who confirms receipt.</p>
<p><strong>6. Reviews.</strong> Only customers with a completed booking can post reviews. We may hide reviews that break our rules.</p>
<p><strong>7. Safety.</strong> The SOS feature alerts your trusted contact by email. It does not replace emergency services; call 112 in danger.</p>
<p><strong>8. Liability.</strong> To the extent permitted by law, RepairStop is not liable for indirect losses arising from work done by independent mechanics.</p></div></div>''')
page('privacy','Privacy policy',f'''<div class="container mid"><div class="card stack"><h1 style="font-size:30px">Privacy policy</h1>{LEGAL_NOTE}
<p><strong>What we collect.</strong> Account details (name, email, phone), booking details (location, vehicle, service), partner documents, payment status, reviews, and an optional trusted contact.</p>
<p><strong>How we use it.</strong> To run bookings, verify partners, send service emails (verification, password reset, SOS), process payments and keep the platform safe.</p>
<p><strong>Who sees it.</strong> A mechanic sees your exact location and phone number only after accepting your booking. Public reviews show only your first name. Partner documents are visible only to administrators.</p>
<p><strong>Security.</strong> Passwords are stored as salted hashes, never in plain text. Sessions use secure cookies. Payment card data is handled by our payment provider and never stored by us.</p>
<p><strong>Location.</strong> Your browser asks permission before sharing GPS. Address search and nearby police results use OpenStreetMap services.</p>
<p><strong>Your choices.</strong> You can edit your profile any time and contact us to delete your account.</p></div></div>''')
page('contact','Contact','''<div class="container mid"><div class="card stack"><h1 style="font-size:30px">Contact RepairStop</h1>
<p class="muted">We are available 24/7 for booking support.</p><div id="contactInfo" class="stack"></div>
<p class="muted small">In an emergency call <strong>112</strong>. For a job in progress, use the SOS button in your dashboard.</p></div></div>''','contact')

# ---------- Customer dashboard ----------
page('customer','My account','''<div class="container"><div class="stack" style="gap:24px">
<div class="row between"><div><div class="eyebrow">Customer dashboard</div><h1 style="font-size:30px" id="hello">Welcome</h1><div class="muted" id="who"></div></div>
<div class="row"><a class="btn primary" href="/book">Book roadside assistance</a><button class="btn" id="logout" type="button">Log out</button></div></div>
<div id="msg" class="hidden"></div>
<div class="tabs" role="tablist">
<button class="tab" data-tab="bookings">My bookings</button><button class="tab" data-tab="history">Booking history</button><button class="tab" data-tab="payments">Payment history</button>
<button class="tab" data-tab="reviews">Reviews and ratings</button><button class="tab" data-tab="profile">Edit profile</button><button class="tab" data-tab="safety">SOS and trusted contact</button><button class="tab" data-tab="password">Change password</button></div>
<section data-panel="bookings" class="stack"><div id="activeList" class="stack"></div></section>
<section data-panel="history" class="stack"><div id="historyList" class="stack"></div></section>
<section data-panel="payments"><div id="payList"></div></section>
<section data-panel="reviews" class="stack"><div id="reviewTodo" class="stack"></div><div id="reviewList" class="stack"></div></section>
<section data-panel="profile"><form id="profileForm" class="card stack" novalidate style="max-width:640px"><h2 style="font-size:20px">Your profile</h2>
<div class="grid cols-2"><div class="field"><label for="fullName">Full name</label><input id="fullName" name="fullName" autocomplete="name"><div class="err"></div></div><div class="field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel" autocomplete="tel"><div class="err"></div></div></div>
<div class="field"><label for="pemail">Email (cannot be changed)</label><input id="pemail" disabled></div>
<div class="field"><label for="address">Home address</label><input id="address" name="address" autocomplete="street-address"><div class="err"></div></div>
<div class="grid cols-2"><div class="field"><label for="city">City</label><input id="city" name="city"><div class="err"></div></div><div class="field"><label for="vehicle">Usual vehicle</label><input id="vehicle" name="vehicle" placeholder="e.g. Swift KA01 AB 1234"><div class="err"></div></div></div>
<button class="btn primary" type="submit" style="align-self:flex-start">Save profile</button></form></section>
<section data-panel="safety"><form id="safetyForm" class="card stack" novalidate style="max-width:640px"><h2 style="font-size:20px">SOS and trusted contact</h2>
<p class="muted" style="margin:0">If you press SOS during a job, we email your trusted contact your last known location. Always call <strong>112</strong> in danger.</p>
<div class="grid cols-2"><div class="field"><label for="trustedName">Contact name</label><input id="trustedName" name="trustedName"><div class="err"></div></div><div class="field"><label for="trustedPhone">Contact phone</label><input id="trustedPhone" name="trustedPhone" type="tel"><div class="err"></div></div></div>
<div class="field"><label for="trustedEmail">Contact email (used to send SOS alerts)</label><input id="trustedEmail" name="trustedEmail" type="email"><div class="err"></div></div>
<div class="row"><button class="btn primary" type="submit">Save trusted contact</button><button class="btn danger" type="button" id="sosBtn">Send SOS now</button><a class="btn" href="/police">Nearby police stations</a></div></form></section>
<section data-panel="password"><form id="pwForm" class="card stack" novalidate style="max-width:520px"><h2 style="font-size:20px">Change password</h2>
<div class="field"><label for="currentPassword">Current password</label><div class="pw"><input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password"><button type="button">Show</button></div><div class="err"></div></div>
<div class="field"><label for="newPassword">New password</label><div class="pw"><input id="newPassword" name="newPassword" type="password" autocomplete="new-password"><button type="button">Show</button></div><div class="err"></div></div>
<div class="field"><label for="confirmPassword">Confirm new password</label><div class="pw"><input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password"><button type="button">Show</button></div><div class="err"></div></div>
<button class="btn primary" type="submit" style="align-self:flex-start">Change password</button></form></section>
</div></div>''','customer')

# ---------- Mechanic dashboard ----------
page('mechanic','Mechanic dashboard','''<div class="container"><div class="stack" style="gap:24px">
<div class="row between"><div><div class="eyebrow">Mechanic dashboard</div><h1 style="font-size:30px" id="hello">Welcome</h1><div class="muted" id="who"></div></div>
<div class="row"><label class="check card tight" style="padding:10px 16px"><input type="checkbox" id="availToggle"> <strong id="availLabel">Offline</strong></label><button class="btn" id="logout" type="button">Log out</button></div></div>
<div id="banner" class="hidden"></div><div id="msg" class="hidden"></div>
<div class="tabs" role="tablist">
<button class="tab" data-tab="jobs">Nearby jobs<span class="count hidden" id="jobCount"></span></button><button class="tab" data-tab="active">My active jobs</button><button class="tab" data-tab="history">Booking history</button><button class="tab" data-tab="earnings">Earnings</button><button class="tab" data-tab="profile">Profile</button><button class="tab" data-tab="password">Change password</button></div>
<section data-panel="jobs" class="stack"><div class="hint" id="locHint"></div><div id="jobList" class="stack"></div></section>
<section data-panel="active" class="stack"><div id="activeList" class="stack"></div></section>
<section data-panel="history" class="stack"><div id="historyList"></div></section>
<section data-panel="earnings"><div id="earnBox" class="stack"></div></section>
<section data-panel="profile"><form id="profileForm" class="card stack" novalidate style="max-width:760px"><h2 style="font-size:20px">Mechanic profile</h2><div id="verifyInfo"></div>
<div class="grid cols-2"><div class="field"><label for="fullName">Full name</label><input id="fullName" name="fullName"><div class="err"></div></div><div class="field"><label for="phone">Phone</label><input id="phone" name="phone" type="tel"><div class="err"></div></div></div>
<div class="grid cols-2"><div class="field"><label for="garageName">Garage name</label><input id="garageName" name="garageName"><div class="err"></div></div><div class="field"><label for="experienceYears">Years of experience</label><input id="experienceYears" name="experienceYears" type="number" min="0" max="60"><div class="err"></div></div></div>
<div class="field"><label for="address">Garage address</label><input id="address" name="address"><div class="err"></div></div>
<div class="grid cols-2"><div class="field"><label for="city">City</label><input id="city" name="city"><div class="err"></div></div><div class="field"><label for="specialty">Specialty (shown to customers)</label><input id="specialty" name="specialty" maxlength="120"><div class="err"></div></div></div>
<div class="row"><button class="btn sm" type="button" id="relocate">Re-locate garage from address</button><span class="hint" id="coordText"></span></div>
<div class="label">Services and starting prices</div><div id="svcList" class="stack"></div><div class="err" id="svcErr" style="color:var(--orange-dark);font-size:13px"></div>
<div><div class="label">Documents on file</div><div id="docList" class="muted small"></div></div>
<button class="btn primary" type="submit" style="align-self:flex-start">Save profile</button></form></section>
<section data-panel="password"><form id="pwForm" class="card stack" novalidate style="max-width:520px"><h2 style="font-size:20px">Change password</h2>
<div class="field"><label for="currentPassword">Current password</label><div class="pw"><input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password"><button type="button">Show</button></div><div class="err"></div></div>
<div class="field"><label for="newPassword">New password</label><div class="pw"><input id="newPassword" name="newPassword" type="password" autocomplete="new-password"><button type="button">Show</button></div><div class="err"></div></div>
<div class="field"><label for="confirmPassword">Confirm new password</label><div class="pw"><input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password"><button type="button">Show</button></div><div class="err"></div></div>
<button class="btn primary" type="submit" style="align-self:flex-start">Change password</button></form></section>
</div></div>''','mechanic')

# ---------- Admin dashboard ----------
page('admin','Admin dashboard','''<div class="container" style="max-width:1280px"><div class="stack" style="gap:24px">
<div class="row between"><div><div class="eyebrow">Administrator</div><h1 style="font-size:30px">RepairStop admin</h1><div class="muted" id="who"></div></div><button class="btn" id="logout" type="button">Log out</button></div>
<div id="msg" class="hidden"></div>
<div class="tabs" role="tablist">
<button class="tab" data-tab="overview">Overview</button><button class="tab" data-tab="verifications">Verifications<span class="count hidden" id="pendCount"></span></button><button class="tab" data-tab="mechanics">Mechanics</button><button class="tab" data-tab="customers">Customers</button><button class="tab" data-tab="bookings">Bookings</button><button class="tab" data-tab="services">Services</button><button class="tab" data-tab="areas">Coverage</button><button class="tab" data-tab="payments">Payments</button><button class="tab" data-tab="reviews">Reviews</button></div>
<section data-panel="overview"><div id="statsBox" class="grid cols-4"></div></section>
<section data-panel="verifications" class="stack"><div id="verifyList" class="stack"></div></section>
<section data-panel="mechanics"><div id="mechTable"></div></section>
<section data-panel="customers"><div id="custTable"></div></section>
<section data-panel="bookings"><div id="bookTable"></div></section>
<section data-panel="services" class="stack"><div id="svcTable"></div>
<form id="svcForm" class="card row" novalidate style="align-items:flex-end"><div class="field" style="flex:1 1 180px"><label for="sname">New service name</label><input id="sname" name="name"></div><div class="field" style="flex:2 1 220px"><label for="sdesc">Description</label><input id="sdesc" name="description"></div><div class="field" style="width:140px"><label for="sprice">Base price (₹)</label><input id="sprice" name="basePrice" type="number" min="0"></div><button class="btn primary" type="submit">Add service</button></form></section>
<section data-panel="areas" class="stack"><div id="areaBox" class="row"></div>
<form id="areaForm" class="card row" novalidate style="align-items:flex-end;max-width:480px"><div class="field" style="flex:1 1 200px"><label for="acity">Add a city</label><input id="acity" name="city"></div><button class="btn primary" type="submit">Add city</button></form></section>
<section data-panel="payments"><div id="payTable"></div></section>
<section data-panel="reviews"><div id="revTable"></div></section>
</div></div>''','admin')
