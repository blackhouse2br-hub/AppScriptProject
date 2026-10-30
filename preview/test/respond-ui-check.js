'use strict';
// (clicks are run as user gestures, as a person's click is, so the browser allows the new tab)
// Browser check of the lead drawer's "Message Lead" and "Call on respond.io" (and the phone number's tel: link), desktop
// and phone: the right lead's respond.io conversation opens in a new tab; a lead with a mistyped Respond ID explains why
// and offers the phone call instead; nothing is sent. Throwaway database and the fake Monday board; respond.io itself
// is never reached (the browser can't resolve outside hosts here, so the new tab's address is checked).
//   node test/respond-ui-check.js [outDir]
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User } = require('../src/models');
const { hashPassword } = require('../src/auth');
const fx = require('./fixtures/fake-integrations');

const OUT = path.resolve(process.argv[2] || 'respond-ui-out');
fs.mkdirSync(OUT, { recursive: true });
const BROWSER = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => fs.existsSync(p));
const PW = 'correct-horse-battery';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
fx.BOARDS['1111111'].items.push({ id: '9701', name: 'BH-C1', group: 'ALL CLIENTS', v: { cn: 'Two Ids Tess', va1: 'Ana', inq: 'Rent', cs: 'Qualified', rid: '555701 / 555702', ph: '+63 917 555 0170', dq: '2026-10-25' } });

async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const wait = new Map();
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } };
  const send = (method, params) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description)); return r.result.result.value; };
  return { send, ev, close: () => ws.close() };
}

(async () => {
  if (!BROWSER) throw new Error('No Chrome or Edge found.');
  const fake = fx.createFakeServer(); await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const mem = await MongoMemoryServer.create();
  const port = await freePort();
  const { server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_rio_ui'), PORT: String(port), HOST: '127.0.0.1', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111',
    MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: `http://127.0.0.1:${fake.address().port}/monday`,
    RESPOND_TOKEN: 'rtest', RESPOND_API_URL: `http://127.0.0.1:${fake.address().port}/respond`, RESPOND_SPACE_ID: '424242' }, ['node', 'server.js']);
  const base = `http://127.0.0.1:${port}`;
  await User.create([{ email: 'ana@example.com', name: 'Ana Agent', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view' }, passwordHash: await hashPassword(PW) }]);

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bhrio-'));
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
    const pages = async () => (await (await fetch(`http://127.0.0.1:${dport}/json`)).json()).filter((t) => t.type === 'page');
    const closeOthers = async () => { for (const t of (await pages()).filter((t) => !t.url.startsWith(base) && t.url !== 'about:blank' || /respond\.io/.test(t.url))) await fetch(`http://127.0.0.1:${dport}/json/close/${t.id}`); };

    for (const [label, w, h, mobile] of [['desktop', 1440, 1000, false], ['phone', 390, 844, true]]) {
      const tag = mobile ? ' (phone)' : '';
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await c.send('Network.clearBrowserCookies'); await c.send('Page.navigate', { url: base + '/' }); await sleep(300); await c.ev('localStorage.clear()'); await c.send('Page.navigate', { url: base + '/' });
      await until(`!!document.querySelector('#loginForm')`);
      await c.ev(`(() => { document.querySelector('#lEmail').value = 'ana@example.com'; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
      await until(`!!document.querySelector('#list .row[data-id="9001"]')`, 30000);
      await c.ev(`document.querySelector('#list .row[data-id="9001"]').click()`);
      await until(`!!document.querySelector('[data-act="rioopen"][data-v="message"]')`);
      const tel = await c.ev(`(document.querySelector('.quick a[href^="tel:"]') || {}).getAttribute ? document.querySelector('.quick a[href^="tel:"]').getAttribute('href') : ''`);
      check(`the lead's phone number is a tel: link for a call from this device${tag}`, tel === 'tel:+639005550001', tel);
      // Message Lead: a new tab at this lead's conversation; nothing else
      await closeOthers();
      await c.ev(`document.querySelector('[data-act="rioopen"][data-v="message"]').click()`);
      let opened = ''; for (let i = 0; i < 40 && !opened; i++) { opened = ((await pages()).find((t) => /respond\.io/.test(t.url)) || {}).url || ''; if (!opened) await sleep(150); }
      check(`Message Lead opens this lead's own respond.io conversation in a new tab${tag}`, opened === 'https://app.respond.io/space/424242/inbox/555001', opened);
      await until(`/Nothing was sent/.test(document.querySelector('#toast').textContent)`, 5000).then(() => check(`it says nothing was sent${tag}`, true), () => check(`it says nothing was sent${tag}`, false, '(no toast)'));
      await closeOthers();
      await c.ev(`document.querySelector('[data-act="rioopen"][data-v="call"]').click()`);
      await until(`/Press the phone icon/.test(document.querySelector('#toast').textContent)`, 5000).then(() => check(`Call on respond.io opens the conversation and says the call starts there, not that it started${tag}`, true), () => check(`Call explains where to press${tag}`, false));
      await shot(`1-drawer-${label}`);
      await closeOthers();
      // a lead whose Respond ID cell holds two numbers: explained, never guessed; the phone call offered instead
      await c.ev(`document.querySelector('#list .row[data-id="9701"]') ? document.querySelector('#list .row[data-id="9701"]').click() : null`);
      await until(`document.querySelector('#drawer h2') && /Two Ids Tess/.test(document.querySelector('#drawer').textContent) && !!document.querySelector('[data-act="rioopen"][data-v="call"]')`);
      await c.ev(`document.querySelector('[data-act="rioopen"][data-v="call"]').click()`);
      await until(`document.querySelector('#modal.open') && /isn't a single number/.test(document.querySelector('#modal').textContent)`, 8000);
      const modal = await c.ev(`document.querySelector('#modal').textContent.replace(/\\s+/g, ' ')`);
      check(`a mistyped Respond ID is explained, with the phone call offered instead${tag}`, /Fix it on the Monday board/.test(modal) && await c.ev(`!!document.querySelector('#modal a[href="tel:+639175550170"]')`), modal);
      check(`no respond.io tab was opened for it${tag}`, !(await pages()).some((t) => /respond\.io/.test(t.url)));
      check(`no sideways scrolling${tag}`, await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
      await shot(`2-bad-id-${label}`);
      await c.ev(`document.querySelector('#modal [data-act="mclose"]').click()`);
    }
  } catch (err) { check('run completed', false, err.message); }
  finally {
    br.kill(); server.close(); fake.close(); await mongoose.disconnect(); await mem.stop();
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots in ${OUT}`);
    process.exit(failed ? 1 : 0);
  }
})();
