'use strict';
// Browser check of Settings → Files → Google Drive storage with GOOGLE_DRIVE_OAUTH=on: a Manager connects a (fake)
// Google account's My Drive through the (fake) consent screen, comes back to Settings, sees it connected, and
// disconnects it; desktop and phone widths. Throwaway database, fake Monday and a fake Google: nothing real is contacted.
//   node test/drive-ui-check.js [outDir]
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User, DriveConnection } = require('../src/models');
const { hashPassword } = require('../src/auth');
const fx = require('./fixtures/fake-integrations');
const { createFakeGoogleOAuth } = require('./fixtures/fake-google-oauth');

const OUT = path.resolve(process.argv[2] || 'drive-ui-out');
fs.mkdirSync(OUT, { recursive: true });
const BROWSER = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => fs.existsSync(p));
const PW = 'correct-horse-battery', CLIENT_ID = 'fake-ui-client.apps.googleusercontent.com', CLIENT_SECRET = 'fake-ui-secret';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const wait = new Map();
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const send = (method, params) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; };
  return { send, ev, close: () => ws.close() };
}

(async () => {
  if (!BROWSER) throw new Error('No Chrome or Edge found.');
  const fake = fx.createFakeServer(); await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const google = createFakeGoogleOAuth({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, email: 'blackhouse.files.fake@example.com' });
  await new Promise((r) => google.listen(0, '127.0.0.1', r)); const g = `http://127.0.0.1:${google.address().port}`;
  const mem = await MongoMemoryServer.create();
  const port = await freePort();   // a real port: Google's redirect URI is this server's own address
  const { server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_drive_ui'), PORT: String(port), HOST: '127.0.0.1', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111',
    MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: `http://127.0.0.1:${fake.address().port}/monday`,
    GOOGLE_DRIVE_OAUTH: 'on', GOOGLE_CLIENT_ID: CLIENT_ID, GOOGLE_CLIENT_SECRET: CLIENT_SECRET, GOOGLE_DRIVE_TOKEN_KEY: crypto.randomBytes(32).toString('base64'),
    GOOGLE_AUTH_URL: g + '/auth', GOOGLE_TOKEN_URL: g + '/token', GOOGLE_JWKS_URL: g + '/certs', GOOGLE_REVOKE_URL: g + '/revoke',
    GOOGLE_DRIVE_API_URL: g + '/drive/v3', GOOGLE_DRIVE_UPLOAD_URL: g + '/upload/drive/v3', LOI_SIGNING: 'on', LOI_PDF_CONVERTER: 'drive' }, ['node', 'server.js']);
  const base = `http://127.0.0.1:${port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash }, { email: 'ana@example.com', name: 'Ana Agent', role: 'VA', vaLabel: 'Ana', modules: { team: 'view' }, passwordHash }]);

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bhdrive-'));
  const dport = 9300 + Math.floor(Math.random() * 500);
  const br = spawn(BROWSER, ['--headless=new', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${dport}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail != null && detail !== '' ? ' — ' + detail : '')); };
  try {
    let tabs; for (let i = 0; i < 50 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); } catch (e) { await sleep(200); } }
    const c = await cdp(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await c.send('Page.enable'); await c.send('Runtime.enable');
    const until = async (expr, ms = 20000) => { const t = Date.now(); for (;;) { if (await c.ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) return true; if (Date.now() - t > ms) throw new Error('timed out waiting for: ' + expr); await sleep(120); } };
    const shot = async (name) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };
    const panel = () => c.ev(`(() => { const h = [...document.querySelectorAll('.panel h3')].find((x) => /Google Drive storage/.test(x.textContent)); return h ? h.parentElement.textContent.replace(/\\s+/g, ' ') : ''; })()`);
    const signIn = async (who) => {
      await c.send('Network.clearBrowserCookies'); await c.send('Page.navigate', { url: base + '/' }); await sleep(300); await c.ev('localStorage.clear()'); await c.send('Page.navigate', { url: base + '/' });
      await until(`!!document.querySelector('#loginForm')`);
      await c.ev(`(() => { document.querySelector('#lEmail').value = '${who}@example.com'; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
      await until(`!!document.querySelector('[data-act="nav"]')`, 30000);
      await c.ev('window.confirm = () => true');
    };
    const files = async (mobile) => {
      if (mobile) { await c.ev(`(() => { const b = document.querySelector('.nav-burger'); b && b.click(); })()`); await sleep(250); }
      await c.ev(`document.querySelector('[data-act="nav"][data-v="team"]').click()`);
      await until(`!!document.querySelector('[data-act="settab"][data-v="files"]')`);
      await c.ev(`document.querySelector('[data-act="settab"][data-v="files"]').click()`);
      await until(`/Google Drive storage/.test(document.body.textContent) && !/Loading…/.test(document.querySelector('.panel').textContent)`);
    };

    for (const [label, w, h, mobile] of [['desktop', 1440, 1000, false], ['phone', 390, 844, true]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
      const tag = mobile ? ' (phone)' : '';
      await signIn('boss'); await files(mobile);
      check(`not connected: says what connecting does, with the Manager's Connect button${tag}`, /Not connected yet/.test(await panel()) && await c.ev(`!!document.querySelector('[data-act="driveconnect"]')`), await panel());
      await shot(`1-not-connected-${label}`);
      // Connect: Google's consent (the fake approves at once) and back to Settings → Files
      await c.ev(`document.querySelector('[data-act="driveconnect"]').click()`);
      await until(`/Saving to the My Drive of/.test(document.body.textContent)`, 30000);
      const p = await panel();
      check(`connected: back in Settings → Files with the account, the folders and a confirmation${tag}`, /Google Drive storage is connected\./.test(p) && /blackhouse\.files\.fake@example\.com/.test(p) && /Blackhouse Portal/.test(p) && /Signed LOIs ready · Deal files ready/.test(p), p);
      check(`the address bar no longer carries the result code${tag}`, !(await c.ev('location.hash')), await c.ev('location.href'));
      check(`no token or secret in the page${tag}`, !/fake-(refresh|access)-|fake-ui-secret/.test(await c.ev('document.documentElement.outerHTML')));
      check(`no sideways scrolling${tag}`, await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
      await shot(`2-connected-${label}`);
      check(`the connection is stored once${tag}`, (await DriveConnection.countDocuments()) === 1);
      // Disconnect (confirmed; the return from Google reloaded the page, so the test's confirm() answer is set again)
      await c.ev('window.confirm = () => true');
      await c.ev(`document.querySelector('[data-act="drivedisconnect"]').click()`);
      await until(`/Not connected yet/.test(document.body.textContent)`);
      check(`disconnect: back to not connected; the token given back to Google${tag}`, (await DriveConnection.countDocuments()) === 0 && google.calls.some((x) => x.path === '/revoke'));
      await shot(`3-disconnected-${label}`);
    }
    // a VA with Settings view access sees the state, but no Connect button
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await signIn('ana'); await files(false);
    check('a VA sees the state but cannot connect', /Not connected yet/.test(await panel()) && !(await c.ev(`!!document.querySelector('[data-act="driveconnect"]')`)), await panel());
  } catch (err) { check('run completed', false, err.message); }
  finally {
    br.kill(); server.close(); fake.close(); google.close(); await mongoose.disconnect(); await mem.stop();
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots in ${OUT}`);
    process.exit(failed ? 1 : 0);
  }
})();
