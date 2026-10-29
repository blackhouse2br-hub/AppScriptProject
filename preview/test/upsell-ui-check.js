'use strict';
// Browser check of Upselling at desktop and phone widths: a throwaway MongoDB, the fake Monday board and a fake
// respond.io that records every send (fictional clients; nothing real is sent).   node test/upsell-ui-check.js [outDir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User } = require('../src/models');
const { hashPassword } = require('../src/auth');
const fx = require('./fixtures/fake-integrations');
const { PNG } = require('./fixtures/fake-google-ai');

const OUT = path.resolve(process.argv[2] || 'up-ui-out');
fs.mkdirSync(OUT, { recursive: true });
const BROWSER = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const PW = 'correct-horse-battery', sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fx.BOARDS['1111111'].items.push({ id: '9302', name: 'BH-U2', group: 'ALL CLIENTS', v: { cn: 'Window Wendy', va1: 'Bea', inq: 'Rent', cs: 'Qualified', city: 'Taguig', rid: '555302' } });

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
  const fakeBase = `http://127.0.0.1:${fake.address().port}`, posts = [];
  const front = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      if (req.method === 'POST' && req.url.startsWith('/respond/')) {
        posts.push({ path: req.url.slice(8), body: JSON.parse(body || 'null') });
        if (/id:555302\/message/.test(req.url)) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ message: 'Outside of the 24 hour messaging window' })); }
      }
      const r = await fetch(fakeBase + req.url, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '' }, body: req.method === 'GET' ? undefined : body });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
    });
  });
  await new Promise((r) => front.listen(0, '127.0.0.1', r)); const f = `http://127.0.0.1:${front.address().port}`;
  const mem = await MongoMemoryServer.create();
  const { server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_up_ui'), PORT: '0', HOST: '127.0.0.1', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222',
    MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: f + '/monday', RESPOND_TOKEN: 'rtest', RESPOND_API_URL: f + '/respond', RESPOND_SENDS: 'on' }, ['node', 'server.js']);
  const base = `http://127.0.0.1:${server.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Jonjo Boss', role: 'Manager', passwordHash }, { email: 'viewer@example.com', name: 'Viewer', role: 'VA', vaLabel: 'Bea', modules: { upsell: 'view' }, passwordHash }]);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bhup-')), dport = 9300 + Math.floor(Math.random() * 500);
  const br = spawn(BROWSER, ['--headless=new', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${dport}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail != null && detail !== '' ? ' — ' + detail : '')); };
  try {
    let tabs; for (let i = 0; i < 50 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); } catch (e) { await sleep(200); } }
    const c = await cdp(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await c.send('Page.enable'); await c.send('Runtime.enable');
    const until = async (expr, ms = 20000) => { const t = Date.now(); for (;;) { if (await c.ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) return true; if (Date.now() - t > ms) throw new Error('timed out waiting for: ' + expr); await sleep(120); } };
    const shot = async (name) => { const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };
    const click = (sel) => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('missing'); e.click(); return true; })()`);
    const setVal = (sel, v) => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const signIn = async (email) => {
      await c.send('Network.clearBrowserCookies'); await c.send('Page.navigate', { url: base + '/' }); await sleep(300); await c.ev('localStorage.clear()'); await c.send('Page.navigate', { url: base + '/' });
      await until(`!!document.querySelector('#loginForm')`);
      await c.ev(`(() => { document.querySelector('#lEmail').value = ${JSON.stringify(email)}; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
      await until(`!!document.querySelector('[data-act="nav"]')`);
      await c.ev(`window.confirm = () => true; window.prompt = (q, d) => 'UI check offer'`);
    };
    const go = async (v, mobile) => { if (mobile) { await c.ev(`(() => { const b = document.querySelector('.nav-burger'); b && b.click(); })()`); await sleep(250); } await click(`[data-act="nav"][data-v="${v}"]`); };

    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await signIn('boss@example.com'); await go('upsell');
    await until(`!!document.querySelector('[data-act="upnew"]')`);
    check('Upselling opens (no longer a placeholder)', !/isn't in this portal yet/.test(await c.ev('document.body.textContent')));
    await click('[data-act="upnew"]'); await until(`!!document.querySelector('[data-up="text"]') && /Concierge/.test(document.querySelector('[data-up="text"]').value)`);
    check('a new offer starts from the Concierge text', true);
    // works with browser prompts blocked (no prompt is used); an unsent draft can be deleted
    await c.ev(`window.prompt = () => { throw new Error('prompt blocked'); }`);
    await click('[data-act="upnew"]'); await until(`document.querySelectorAll('[data-ch="upsel"] option').length === 2`);
    check('+ New offer works without a browser prompt', /New offer created/.test(await c.ev(`document.querySelector('#toast').textContent`)));
    check('an unsent draft shows Delete draft', await c.ev(`!!document.querySelector('[data-act="updelete"]')`));
    await click('[data-act="updelete"]'); await until(`document.querySelectorAll('[data-ch="upsel"] option').length === 1 && !!document.querySelector('[data-up="text"]')`);
    check('the draft is deleted; the other offer opens', /Draft deleted/.test(await c.ev(`document.querySelector('#toast').textContent`)));
    await setVal('[data-up="preset"]', 'all'); await setVal('[data-up="text"]', 'Hi {firstName}! Concierge offer from {va}.');
    await click('[data-act="upsave"]'); await until(`/Offer saved/.test(document.querySelector('#toast').textContent)`);
    await until(`document.querySelectorAll('.up-t tbody tr').length >= 4`);
    const names = await c.ev(`[...document.querySelectorAll('.up-t tbody tr td:nth-child(2)')].map((t) => t.textContent).join(',')`);
    check('audience lists the board\'s clients on respond.io', /Test Client One/.test(names) && /Window Wendy/.test(names) && !/Failed Client/.test(names), names);
    check('saving and reviewing sent nothing', posts.length === 0, posts.length);
    // image (a real PNG through the file input)
    await c.ev(`(() => { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(PNG(1).toString('base64'))}), (x) => x.charCodeAt(0))], 'offer.png', { type: 'image/png' }));
      const i = document.querySelector('[data-ch="upimg"]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await until(`!!document.querySelector('.up-img img')`);
    check('image attached and shown', await c.ev(`(async () => (await fetch(document.querySelector('.up-img img').src)).headers.get('content-type'))()`) === 'image/png');
    // review: list, example, image; Send stays off until the tick; Cancel sends nothing
    await click('[data-act="upreview"][data-v="message"]'); await until(`!!document.querySelector('#upGo')`);
    const modal = await c.ev(`document.querySelector('#modal').textContent`);
    check('review shows the count, the recipients and a rendered example', /Send to \d+ client/.test(modal) && /Window Wendy/.test(modal) && /Hi \w+! Concierge offer from Jonjo\./.test(modal), modal.slice(0, 120));
    check('review shows the image', await c.ev(`!!document.querySelector('#modal .up-pv img')`));
    check('Send is disabled until "I\'ve reviewed" is ticked', await c.ev(`document.querySelector('#upGo').disabled`));
    await shot('1-review-desktop');
    await click('#modal [data-act="mclose"]'); await sleep(300);
    check('cancel sends nothing', posts.length === 0);
    await click('[data-act="upreview"][data-v="message"]'); await until(`!!document.querySelector('#upGo')`);
    await c.ev(`(() => { const k = document.querySelector('#upConfirm'); k.checked = true; k.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await click('#upGo'); await until(`/Sent \\d+ · failed/.test(document.querySelector('#toast').textContent)`, 30000);
    const toastTxt = await c.ev(`document.querySelector('#toast').textContent`);
    check('send result: sent and failed counted (no contact, closed 24 h window)', /Sent 2/.test(toastTxt) && /failed 2/.test(toastTxt), toastTxt);
    await until(`/24 hours/.test(document.querySelector('.up-t').textContent)`);
    const rowsTxt = await c.ev(`[...document.querySelectorAll('.up-t tbody tr')].map((r) => r.children[1].textContent + ': ' + r.lastElementChild.textContent.trim()).join(' | ')`);
    check('per-client status in the table, with the reason for a failure', /Test Client One: Sent/.test(rowsTxt) && /Window Wendy: Failed.*24 hours/.test(rowsTxt), rowsTxt);
    const msgPosts = posts.filter((p) => /\/message$/.test(p.path));
    check('each client got the image and then the text', msgPosts.some((p) => p.body.message.type === 'attachment') && msgPosts.some((p) => p.body.message.type === 'text' && /^Hi \w+! Concierge offer from Jonjo\.$/.test(p.body.message.text)));
    const n = posts.length;
    check('nobody left to send to (no repeats); retry offered for the failure', await c.ev(`document.querySelector('[data-act="upreview"][data-v="message"]').disabled`) && await c.ev(`!!document.querySelector('[data-act="upreview"][data-v="retry"]')`));
    check('no extra sends after the batch', posts.length === n);
    check('a sent offer can\'t be deleted (no Delete draft)', await c.ev(`!document.querySelector('[data-act="updelete"]')`));
    await shot('2-sent-desktop');
    // a viewer: no send / edit controls
    await signIn('viewer@example.com'); await go('upsell'); await until(`!!document.querySelector('[data-up="text"]')`);
    check('view access: no send, tag or edit controls', await c.ev(`!document.querySelector('[data-act="upreview"]') && !document.querySelector('[data-act="upnew"]') && document.querySelector('[data-up="text"]').disabled`));
    // phone
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await signIn('boss@example.com'); await go('upsell', true); await until(`document.querySelectorAll('.up-t tbody tr').length >= 1`);
    check('phone: no sideways scrolling', await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
    await shot('3-upsell-phone');
    const pageErrs = await c.ev(`(window.__errs || []).join(' | ')`);
    check('no uncaught page errors', !pageErrs, pageErrs);
    c.close();
  } catch (err) { check('run completed', false, err.message); }
  finally {
    br.kill(); server.close(); front.close(); fake.close(); await mongoose.disconnect(); await mem.stop();
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots in ${OUT}`);
    process.exit(failed ? 1 : 0);
  }
})();
