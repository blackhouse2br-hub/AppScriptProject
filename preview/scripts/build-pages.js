'use strict';
// GitHub Pages output, into preview/dist-pages/ (ignored by Git). Two kinds:
//
// 1. Redirect (current setup): a static page that sends people to the portal hosted on Railway.
//      node scripts/build-pages.js --redirect=https://<service>.up.railway.app
//      (or RAILWAY_APP_URL in the environment, as the GitHub Actions workflow passes it)
//    Before writing anything it checks <url>/healthz answers as this portal (MongoDB mode, Google sign-in, database
//    connected). No script, no cookie, no setting: sign-in happens on the Railway address, so no custom domain is needed.
//
// 2. Full page (only with a domain you own): the portal's own files, calling the Railway API on a sibling subdomain.
//      node scripts/build-pages.js --api=https://api.yourdomain.com --portal=https://portal.yourdomain.com
//      (or PORTAL_API_URL / PORTAL_URL)
//
// The page gets only public settings: the API address and the sign-in method. Every secret (MongoDB, Google client
// secret, Monday and respond.io tokens) stays on the Railway server. The build fails if the output looks like it
// contains one, or if the portal and API are not on the same site (cookies would be third-party; see DEPLOYMENT.md).
const fs = require('fs');
const path = require('path');
const { siteOf } = require('../src/deploy');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
// the page's own files only (no server code, tests or configuration)
const FILES = ['index.html', 'styles.css', 'app.js', 'shared.js', 'demo-data.js', 'prop-report.js', 'client-req.js', 'daily-report.js', 'api-client.js'];
// shapes of credentials that must never be in the page
const SECRET_PATTERNS = [/mongodb(\+srv)?:\/\//i, /GOCSPX-/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./, /client_secret/i,
  /(MONDAY|RESPOND)_TOKEN\s*[=:]\s*["']?[A-Za-z0-9]/, /GOOGLE_CLIENT_SECRET\s*[=:]\s*["']?[A-Za-z0-9]/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

function origin(name, value) {
  let u;
  try { u = new URL(String(value || '').trim()); } catch (e) { throw new Error(`${name} must be a full https:// address (got "${value || ''}").`); }
  if (u.protocol !== 'https:') throw new Error(`${name} must use https://.`);
  if (u.username || u.password || u.search || u.hash) throw new Error(`${name} must not contain a user name, password, query or #fragment.`);
  return u;
}

function build({ api, portal, out = path.join(ROOT, 'dist-pages') }) {
  const a = origin('The API address (--api / PORTAL_API_URL)', api);
  const p = origin('The portal address (--portal / PORTAL_URL)', portal);
  if (a.pathname !== '/') throw new Error('The API address must be just the origin, e.g. https://api.yourdomain.com');
  if (siteOf(a.hostname) !== siteOf(p.hostname)) {
    throw new Error(`The portal (${p.hostname}) and the API (${a.hostname}) are different sites, so sign-in cookies would be blocked by many browsers. `
      + 'Use one domain you own, e.g. portal.yourdomain.com and api.yourdomain.com (DEPLOYMENT.md).');
  }
  const cfg = { mode: 'mongo', apiBase: a.origin, auth: 'google' };
  const csp = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", `img-src 'self' data: ${a.origin}`,
    `connect-src ${a.origin}`, "form-action 'none'", "base-uri 'none'", "object-src 'none'"].join('; ');

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of FILES) {
    let text = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    if (f === 'index.html') {
      // GitHub Pages can't send headers, so the policy goes in the page; the API keeps its own headers
      text = text.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">\n  <meta name="referrer" content="no-referrer">`)
        .replace('Loading the demo preview…', 'Loading the portal…').replace('<title>Blackhouse Leads Preview</title>', '<title>Blackhouse Leads Portal</title>');
      if (!text.includes('Content-Security-Policy')) throw new Error('index.html changed: could not add the security policy.');
    }
    fs.writeFileSync(path.join(out, f), text);
  }
  fs.writeFileSync(path.join(out, 'config.js'), `window.BH_CONFIG = ${JSON.stringify(cfg)};\n`);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');

  for (const f of fs.readdirSync(out)) {
    const text = fs.readFileSync(path.join(out, f), 'utf8');
    const hit = SECRET_PATTERNS.find((re) => re.test(text));
    if (hit) { fs.rmSync(out, { recursive: true, force: true }); throw new Error(`Build stopped: ${f} contains something that looks like a credential (${hit}). Nothing was written.`); }
  }
  return { out, config: cfg, csp, files: fs.readdirSync(out) };
}

const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Asks <origin>/healthz whether it is this portal, ready for people: MongoDB mode, Google sign-in, database connected. */
async function verifyPortal(origin, fetchImpl = fetch) {
  let res, body = null;
  try { res = await fetchImpl(origin + '/healthz', { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new Error(`Could not reach ${origin}/healthz (${e.name === 'TimeoutError' ? 'timed out' : 'network error'}). Check the Railway service is running and the address is right.`); }
  try { body = await res.json(); } catch (e) { /* not JSON */ }
  if (!body || body.app !== 'blackhouse-leads-portal') throw new Error(`${origin} did not answer as the Blackhouse Leads Portal (HTTP ${res.status}). Check the address and that the latest code is deployed.`);
  if (body.mode !== 'mongo') throw new Error(`${origin} is running in "${body.mode}" mode, not MongoDB mode (APP_MODE=mongo on Railway).`);
  if (body.auth !== 'google') throw new Error(`${origin} does not use Google sign-in (AUTH_PROVIDER=google on Railway).`);
  if (!body.ok || body.db !== 'connected') throw new Error(`${origin} reports its database as "${body.db}". Check MONGODB_URI and Atlas network access.`);
  return body;
}

/** The GitHub Pages redirect: plain HTML, no script; also served for any other path (404.html). */
async function buildRedirect({ app, out = path.join(ROOT, 'dist-pages'), verify = true, fetchImpl }) {
  const u = origin('The Railway app address (--redirect / RAILWAY_APP_URL)', app);
  if (u.pathname !== '/') throw new Error('The Railway app address must be just the origin, e.g. https://appscriptproject-production.up.railway.app');
  const target = u.origin + '/';
  if (verify) await verifyPortal(u.origin, fetchImpl);
  const a = escAttr(target);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0; url=${a}">
  <link rel="canonical" href="${a}">
  <title>Blackhouse Leads Portal</title>
  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;background:#0f1218;color:#e6e9ef}a{color:#4c8dff}</style>
</head>
<body>
  <p>Opening the Blackhouse Leads Portal… <a href="${a}">Continue to the portal</a></p>
</body>
</html>
`;
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  for (const f of ['index.html', '404.html']) fs.writeFileSync(path.join(out, f), html);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');
  for (const f of fs.readdirSync(out)) {
    const hit = SECRET_PATTERNS.find((re) => re.test(fs.readFileSync(path.join(out, f), 'utf8')));
    if (hit) { fs.rmSync(out, { recursive: true, force: true }); throw new Error(`Build stopped: ${f} looks like it contains a credential.`); }
  }
  return { out, target, files: fs.readdirSync(out) };
}

if (require.main === module) {
  const arg = (k) => (process.argv.find((x) => x.startsWith(`--${k}=`)) || '').slice(k.length + 3);
  const redirect = arg('redirect') || process.env.RAILWAY_APP_URL;
  (async () => {
    if (redirect) {
      const r = await buildRedirect({ app: redirect, verify: !process.argv.includes('--no-verify') });
      console.log(`Built a redirect page (${r.files.length} files) to ${r.target}${process.argv.includes('--no-verify') ? ' (not verified)' : ' (verified: portal, MongoDB, Google sign-in, database connected)'}.`);
    } else {
      const r = build({ api: arg('api') || process.env.PORTAL_API_URL, portal: arg('portal') || process.env.PORTAL_URL });
      console.log(`Built ${r.files.length} files into ${path.relative(process.cwd(), r.out) || r.out} for API ${r.config.apiBase} (Google sign-in).`);
    }
  })().catch((err) => { console.error('[build-pages] ' + err.message); process.exit(1); });
}

module.exports = { build, buildRedirect, verifyPortal, SECRET_PATTERNS };
