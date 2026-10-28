'use strict';
// Browser check of the portal at desktop and phone widths, in MongoDB mode with a throwaway database and the local
// fake Monday.com / respond.io (fictional data; no real service is contacted, nothing is sent).
// Drives headless Chrome or Edge over the DevTools protocol (Node's built-in WebSocket, nothing to install).
//   node test/ui-check.js [outDir]      screenshots + results.json go to outDir (default ./ui-check-out)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { WRITE_MUTATION } = require('../src/integrations/monday');
const { User } = require('../src/models');
const { hashPassword } = require('../src/auth');
const fx = require('./fixtures/fake-integrations');

const OUT = path.resolve(process.argv[2] || 'ui-check-out');
fs.mkdirSync(OUT, { recursive: true });
const BROWSER = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => fs.existsSync(p));
const PW = 'correct-horse-battery';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fictional extras on the fake boards: an owner number, Taguig / BGC listings, and a lead whose chat check fails
const B = fx.BOARDS['2222222'];
B.columns.push({ id: 'ph', title: 'Phone', type: 'phone', settings_str: '{}' });
// the real boards' column kinds for the allowlisted Monday updates: Availability labels, Budget is a number column
B.columns.find((c) => c.id === 'av').settings_str = JSON.stringify({ labels: { 0: 'Availability Inquired', 1: 'Closed', 2: 'Available', 3: 'Remove' } });
fx.BOARDS['1111111'].columns.find((c) => c.id === 'bud').type = 'numbers';
B.items[0].v.ph = '+63 900 555 0101';
B.items.push({ id: '7004', name: 'Owner D', group: 'Available Units', v: { bn: 'Grand Hyatt Residences', loc: '', lt: 'For Rent', bed: '2 BR', pr: '210000', av: 'Available', ph: '0900 555 0104' }, assets: [['30011', 'png']] },
  { id: '7005', name: 'Owner E', group: 'Available Units', v: { bn: 'Demo Taguig Tower', loc: 'Taguig', lt: 'For Rent', bed: '2 BR', pr: '190000', av: 'Available' } },
  // an incomplete listing (no price, bedrooms, city or photo) and a complete one with a photo that misses the budget:
  // blank fields must not rank the incomplete one higher
  { id: '7008', name: 'Owner H', group: 'Incomplete', v: { bn: 'Blank Fields Tower', lt: 'For Rent', av: 'Available' } },
  { id: '7009', name: 'Owner I', group: 'Available Units', v: { bn: 'Priced Photo Tower', loc: 'Pasig', lt: 'For Rent', bed: '3 BR', pr: '400000', av: 'Available' }, assets: [['30030', 'png']] });
fx.BOARDS['1111111'].items.push({ id: '9007', name: 'BH-T7', group: 'ALL CLIENTS', v: { cn: 'Check Fails Client', va1: 'Ana', inq: 'Rent', rid: '555777', dq: '2026-10-20', na: 'Unresponsive' } });
// Client Requirements: two active Property Sourcing clients without a respond.io ID (Ana's rental, Bea's sale with a building)
fx.BOARDS['1111111'].columns.push({ id: 'bldg', title: 'Building Name', type: 'text', settings_str: '{}' },
  { id: 'pets', title: 'Pets', type: 'status', settings_str: JSON.stringify({ labels: { 0: 'No Pets', 1: 'With Pets', 2: 'Not Applicable' } }) },
  { id: 'creq', title: 'Client Requirements', type: 'text', settings_str: '{}' });
fx.BOARDS['1111111'].items.push({ id: '9008', name: 'BH-T8', group: 'ALL CLIENTS', v: { cn: 'Sourcing Client Rent', ph: '+63 900 555 0008', va1: 'Ana', inq: 'Rent', na: 'New Inquiry', city: 'Makati', bud: '₱150k', br: '2', dq: '2026-10-22', pets: 'Not Applicable', creq: 'Fake requirements note near BGC c/o Demo Person 0900 555 0199' } },
  { id: '9009', name: 'BH-T9', group: 'ALL CLIENTS', v: { cn: 'Sourcing Client Sale', ph: '+63 900 555 0009', va1: 'Bea', inq: 'Buy', na: 'New Inquiry', city: '', bud: '25M', br: '3', bldg: 'Demo Sale Tower', dq: '2026-10-23', creq: 'Fake requirements note: Taguig, ask Demo Person' } });
// Calendar board: the real board's Status labels and LOI Creation Date; two viewings that already happened for Ana's
// client 9010 with no result yet (Pending Broker Feedback), one recorded per screen size
const daysAgo = (n) => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ymdIn = (n) => daysAgo(-n);
const todayManila = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const CB = fx.BOARDS['3333333'];
CB.columns.find((c) => c.id === 'st').settings_str = JSON.stringify({ labels: { 0: 'Viewing Scheduled', 1: 'Under Negotiations', 2: 'Failed', 3: 'Confirmed', 4: 'Pending' } });
CB.columns.push({ id: 'lcd', title: 'LOI Creation Date', type: 'date', settings_str: '{}' });
fx.BOARDS['1111111'].items.push({ id: '9010', name: 'BH-T10', group: 'ALL CLIENTS', v: { cn: 'Viewing Client', ph: '+63 900 555 0010', va1: 'Ana', inq: 'Rent', na: 'Schedule Viewing', city: 'Makati', br: '2', dq: daysAgo(12) } });
// deals and a lease on the Calendar board (the real board's column titles and kinds), for a client of Bea's (9011)
CB.columns.push({ id: 'ccd', title: 'Contract Date', type: 'date', settings_str: '{}' }, { id: 'bc', title: 'Blackhouse Commission', type: 'numbers', settings_str: '{}' },
  { id: 'mcp', title: 'Monthly Contract Price', type: 'numbers', settings_str: '{}' }, { id: 'dop', title: 'Date of Payment', type: 'date', settings_str: '{}' },
  { id: 'ced', title: 'Contract Expiration Date', type: 'date', settings_str: '{}' }, { id: 'typ', title: 'Type', type: 'dropdown', settings_str: JSON.stringify({ labels: { 0: 'Property Sale', 1: 'Property Rental', 2: 'Property Renewal' } }) });
fx.BOARDS['1111111'].items.push({ id: '9011', name: 'BH-T11', group: 'ALL CLIENTS', v: { cn: 'Lease Client', ph: '+63 900 555 0011', va1: 'Bea', inq: 'Rent', na: 'Schedule Viewing', city: 'Makati', br: '2', dq: daysAgo(90) } });
CB.items.push({ id: '6301', name: 'Deal 1', group: 'Closed', created: daysAgo(70), v: { fs: daysAgo(60), cl: { linked: ['9011'] }, b: 'Demo Lease Tower', c: 'Makati', tm: '10:00', sp: 'Gia Cruz', st: 'Closed',
  ccd: daysAgo(50), bc: '120000', tp: '120000', mcp: '120000', dop: daysAgo(20), ced: ymdIn(25), typ: 'Property Rental' } });
CB.items.push({ id: '6201', name: 'Viewing 3', group: 'Viewings', created: daysAgo(6), v: { fs: daysAgo(2), cl: { linked: ['9010'] }, b: 'Demo Pending Tower', c: 'Makati', tm: '3:00 PM', sp: 'Ely Santos', st: 'Viewing Scheduled' } },
  { id: '6202', name: 'Viewing 4', group: 'Viewings', created: daysAgo(6), v: { fs: daysAgo(3), cl: { linked: ['9010'] }, b: 'Demo LOI Tower', c: 'Makati', tm: '11:00 AM', sp: 'Ely Santos', st: 'Viewing Scheduled' } });

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
  // fake services: the shared fixture, plus one respond.io contact whose check always fails (HTTP 500)
  const fixture = fx.createFakeServer(); await new Promise((r) => fixture.listen(0, '127.0.0.1', r));
  const fixBase = `http://127.0.0.1:${fixture.address().port}`;
  const front = http.createServer(async (req, res) => {
    if (/\/respond\/contact\/id:555777/.test(req.url)) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{}'); }
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      const r = await fetch(fixBase + req.url, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '' }, body: req.method === 'GET' ? undefined : body });
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
    });
  });
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  const fake = `http://127.0.0.1:${front.address().port}`;
  const mem = await MongoMemoryServer.create();
  const { server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_ui'), PORT: '0', HOST: '127.0.0.1',
    MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333',
    MONDAY_API_URL: fake + '/monday', RESPOND_TOKEN: 'rtest', RESPOND_API_URL: fake + '/respond', RESPOND_LIST_CHECKS: 'on' }, ['node', 'server.js']);
  const base = `http://127.0.0.1:${server.address().port}`;
  await User.create([{ email: 'boss@example.com', name: 'Demo Manager', role: 'Manager', passwordHash: await hashPassword(PW) },
    { email: 'ana@example.com', name: 'Ana Demo', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit', propreq: 'view' }, passwordHash: await hashPassword(PW) },
    { email: 'cora@example.com', name: 'Cora Demo', role: 'VA', vaLabel: 'Cora Fake', modules: { leads: 'edit' }, passwordHash: await hashPassword(PW) },
    { email: 'vcal@example.com', name: 'Vcal Demo', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit', calendar: 'view' }, passwordHash: await hashPassword(PW) },
    { email: 'brk@example.com', name: 'Broker Demo', role: 'Broker', modules: { leads: 'view', calendar: 'edit' }, passwordHash: await hashPassword(PW) }]);

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bhui-'));
  const port = 9300 + Math.floor(Math.random() * 500);
  const br = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail != null && detail !== '' ? ' — ' + detail : '')); };
  try {
    let tabs; for (let i = 0; i < 50 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch (e) { await sleep(200); } }
    const c = await cdp(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await c.send('Page.enable'); await c.send('Runtime.enable');
    const until = async (expr, ms = 10000) => { const t = Date.now(); for (;;) { if (await c.ev(expr)) return true; if (Date.now() - t > ms) throw new Error('timed out waiting for: ' + expr); await sleep(120); } };
    const shot = async (name) => { const r = await c.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };
    const click = (sel) => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('missing ' + ${JSON.stringify(sel)}); e.click(); return true; })()`);
    const text = (sel) => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : ''; })()`);
    const noSideScroll = () => c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1');

    for (const [label, w, h, mobile] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await c.send('Network.clearBrowserCookies');
      await c.send('Page.navigate', { url: base + '/' }); await sleep(400);
      await c.ev(`localStorage.clear()`);
      await c.send('Page.navigate', { url: base + '/' });
      await until(`!!document.querySelector('#loginForm')`);
      await c.ev(`(() => { document.querySelector('#lEmail').value = 'boss@example.com'; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
      await until(`document.querySelectorAll('#list .row[data-id]').length >= 4`, 20000);

      // 1) reply checks settle per lead: none left on "Checking…", the failing chat says so
      await until(`!document.querySelector('#list .wait.unk') || ![...document.querySelectorAll('#list .wait')].some(x => /Checking/.test(x.textContent))`, 20000);
      await sleep(500);
      const badges = await c.ev(`Object.fromEntries([...document.querySelectorAll('#list .row[data-id]')].map(r => [r.dataset.id, (r.querySelector('.wait') || {}).textContent || '']))`);
      check(`${label}: reply checks settled for every lead (no "Checking…")`, !Object.values(badges).some((t) => /Checking/.test(t)), JSON.stringify(badges));
      check(`${label}: the lead whose chat check fails shows "Check failed"`, badges['9007'] === 'Check failed', badges['9007']);
      check(`${label}: an empty / missing chat counts as checked, not "Reply unchecked"`, badges['9003'] === '', JSON.stringify(badges['9003']));
      check(`${label}: no sideways scrolling on the lead list`, await noSideScroll());
      await shot(`${label}-1-leads`);

      // 2) property filters + 5) Asking for Availability on lead 9001
      await c.ev(`document.querySelector('#list .row[data-id="9001"]').click()`);
      await until(`document.querySelector('#drawer.open h2') && /Test Client One/.test(document.querySelector('#drawer h2').textContent)`);
      await sleep(400);   // let the panel finish sliding in, as a person would
      await click('#drawer .tab[data-v="props"]');
      await until(`!!document.querySelector('#dbody .pfbox')`);
      const before = await text('#propsResults [role=status]');
      await c.ev(`document.querySelector('#dbody .pfbox').open = true`);
      await click('#dbody [data-act="pfchip"][data-k="cities"][data-v="Taguig (BGC)"]');
      await until(`/2 matching/.test(document.querySelector('#propsResults [role=status]').textContent)`);
      const cards = await c.ev(`[...document.querySelectorAll('#propsResults .lcard .lt')].map(x => x.textContent)`);
      check(`${label}: city filter narrows to the Taguig (BGC) listings`, cards.length === 2 && cards.every((t) => /Grand Hyatt|Demo Taguig/.test(t)), before + ' → ' + JSON.stringify(cards));
      await c.ev(`(() => { const f = HTMLElement.prototype.focus; HTMLElement.prototype.focus = function (...a) { if (this.id === 'drawerTitle' || this.tagName === 'H2') window.__h2stack = new Error().stack; return f.apply(this, a); }; })()`);
      const focusedBefore = await c.ev(`(() => { const i = document.querySelector('#dbody [data-in="pfq"]'); i.focus(); return document.activeElement === i; })()`);
      await c.ev(`(() => { const i = document.querySelector('#dbody [data-in="pfq"]'); i.value = 'grand'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await until(`document.querySelectorAll('#propsResults .lcard').length === 1`);
      const focusAfter = await c.ev(`(() => { const a = document.activeElement; return a ? a.tagName + '.' + (a.dataset.in || a.dataset.act || a.id || a.className) : 'none'; })()`);
      check(`${label}: typing in the search keeps focus and narrows the list`, focusAfter === 'INPUT.pfq', `focused before: ${focusedBefore}, after: ${focusAfter}` + (focusAfter === 'INPUT.pfq' ? '' : ' · ' + String(await c.ev('window.__h2stack || ""')).split('\n').slice(1, 5).join(' < ')));
      await click('#dbody .pf-ck [data-act="pfclear"]').catch(() => click('#propsResults [data-act="pfclear"]'));
      await until(`document.querySelectorAll('#propsResults .lcard').length >= 3`);
      check(`${label}: Clear all filters restores the matches`, (await text('#propsResults [role=status]')) === before, await text('#propsResults [role=status]'));
      // photos in lead matching: real photos load through the server; a listing with blank fields doesn't outrank a
      // complete one, and a listing without photos says so
      await c.ev(`document.querySelectorAll('#propsResults img.lphoto').forEach(i => i.scrollIntoView())`); await sleep(1200);
      const mp = await c.ev(`[...document.querySelectorAll('#propsResults .lcard')].map(card => { const p = card.querySelector('.lph'), i = p.querySelector('img.lphoto');
        return { t: card.querySelector('.lt').textContent, photo: !i ? 'none' : i.complete && i.naturalWidth > 0 ? 'shown' : p.classList.contains('ph-err') ? 'placeholder' : 'pending', ph: p.querySelector('.ini').textContent }; })`);
      const at = (t) => mp.findIndex((x) => x.t === t);
      check(`${label}: lead matching shows listing photos (Fake Tower, Priced Photo Tower)`, mp[at('Fake Tower')].photo === 'shown' && mp[at('Priced Photo Tower')].photo === 'shown', JSON.stringify(mp.map((x) => x.t + ':' + x.photo)));
      check(`${label}: a listing with no price / bedrooms / city ranks below a complete one`, at('Blank Fields Tower') > at('Priced Photo Tower') && at('Priced Photo Tower') >= 0, mp.map((x) => x.t).join(' > '));
      check(`${label}: a listing without photos shows a clear "No photo" placeholder`, mp[at('Blank Fields Tower')].photo === 'none' && /No photo$/.test(mp[at('Blank Fields Tower')].ph), mp[at('Blank Fields Tower')].ph);
      check(`${label}: a photo the server refuses shows "Photo unavailable"`, mp[at('Svg Tower')].photo === 'placeholder' && /Photo unavailable$/.test(mp[at('Svg Tower')].ph)
        && await c.ev(`[...document.querySelectorAll('#propsResults .lcard')].some(c => /Svg Tower/.test(c.textContent) && getComputedStyle(c.querySelector('.ini')).display !== 'none')`), JSON.stringify(mp[at('Svg Tower')]));
      await shot(`${label}-2-filters`);
      // ask twice for the same unit → one record
      await click('#propsResults [data-act="askadd"][data-id="7004"]');
      await until(`!!document.querySelector('#propsResults [data-act="tab"][data-v="asking"]')`);
      const n1 = await c.ev(`fetch('/api/leads/monday/9001/asking').then(r => r.json()).then(d => d.requests.length)`);
      const dup = await c.ev(`fetch('/api/leads/monday/9001/asking', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listingId: '7004' }) }).then(r => r.json())`);
      const n2 = await c.ev(`fetch('/api/leads/monday/9001/asking').then(r => r.json()).then(d => d.requests.length)`);
      check(`${label}: Ask availability saves one record; asking again doesn't add another`, n1 === 1 && n2 === 1 && dup.already === true, `${n1} → ${n2}`);
      check(`${label}: Asking tab shows the count`, /Asking for Availability \(1\)/.test(await text('#drawer .tab[data-v="asking"]')), await text('#drawer .tab[data-v="asking"]'));
      await click('#drawer .tab[data-v="asking"]');
      await until(`!!document.querySelector('#dbody .askcard')`);
      const links = await c.ev(`[...document.querySelectorAll('#dbody .ask-links a')].map(a => a.getAttribute('href'))`);
      check(`${label}: owner Call / WhatsApp / Viber links from the listing's number`, JSON.stringify(links) === JSON.stringify(['tel:+639005550104', 'https://wa.me/639005550104', 'viber://chat?number=%2B639005550104']), JSON.stringify(links));
      // tapping a link: the device would open it (blocked here); the portal only logs the tap
      await c.ev(`(() => { const a = document.querySelector('#dbody .ask-links a[data-via="whatsapp"]'); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); })()`);
      await until(`/Last contact: WhatsApp/.test(document.querySelector('#dbody .askcard').textContent)`);
      check(`${label}: a tap is logged on the card (nothing sent)`, true, await text('#dbody .ask-owner .sub:last-child'));
      await click('#dbody [data-act="askstatus"][data-v="available"]');
      await until(`/Owner confirmed available/.test(document.querySelector('#dbody .askcard').textContent)`);
      check(`${label}: Owner confirmed available is saved`, true);
      check(`${label}: no sideways scrolling in the lead panel`, await c.ev(`document.querySelector('#drawer').scrollWidth <= document.querySelector('#drawer').clientWidth + 1`));
      await shot(`${label}-3-asking`);
      await click('#dbody [data-act="askdel"]');
      await until(`!document.querySelector('#dbody .askcard')`);

      // 6) Failed as a portal override (9007: Client Status "Unresponsive" isn't on this fake board's labels; Monday untouched)
      await c.ev(`document.querySelector('#drawer [data-act="close"]').click()`);
      await c.ev(`document.querySelector('#list .row[data-id="9007"]').click()`);
      await until(`/Check Fails Client/.test(document.querySelector('#drawer h2').textContent)`);
      await click('#dbody [data-act="failmodal"]');
      await until(`!!document.querySelector('#failQuick')`);
      check(`${label}: Monday updates switched off (default): no "Update on Monday" box in lead details`, !(await c.ev(`!!document.querySelector('#dbody .mwbox')`)));
      check(`${label}: the dialog says it's a portal override and Monday is not changed`, /portal override[\s\S]*Nothing is written to Monday\.com/.test(await text('#modal')));
      await c.ev(`(() => { document.querySelector('#failQuick').value = 'Not responsive'; document.querySelector('#modalForm').requestSubmit(); })()`);
      await until(`!document.querySelector('#modal.open')`);
      await until(`/Failed · override/.test(document.querySelector('#dbody .aicard').textContent)`);
      check(`${label}: AI Status shows Failed, labelled as a portal override`, /Portal override/.test(await text('#dbody .aicard')), await text('#dbody .aicard > div'));
      await shot(`${label}-4-failed-override`);
      await c.ev(`window.confirm = () => true`);
      await click('#dbody [data-act="unfail"]');
      await until(`!document.querySelector('#dbody .ovr-tag') && !/Failed · override/.test(document.querySelector('#dbody .aicard').textContent)`);
      check(`${label}: the override can be removed`, !!(await c.ev(`!!document.querySelector('#dbody [data-act="failmodal"]')`)), await text('#dbody .aicard .pill'));
      await c.ev(`document.querySelector('#drawer [data-act="close"]').click()`);

      // 3) + 4) Inventory: Taguig (BGC) counted once each, photos load through the server
      await c.ev(`(() => { const b = document.querySelector('[data-act="nav"][data-v="invdash"]'); b.click(); })()`);
      await until(`!!document.querySelector('#invGrid .lcard')`);
      const tg = await c.ev(`[...document.querySelectorAll('.cards .card')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()).find(t => /Taguig/.test(t))`);
      const row = await c.ev(`[...document.querySelectorAll('table.t tr')].map(r => [...r.cells].map(c => c.textContent.trim())).find(r => r[0] === 'Taguig (BGC)')`);
      const total = await c.ev(`[...document.querySelectorAll('table.t tbody tr')].reduce((a, r) => a + Number(r.cells[1].textContent), 0)`);
      const listings = await c.ev(`document.querySelectorAll('#invGrid .lcard').length`);
      check(`${label}: Taguig (BGC) card and by-city row both count 2`, /^2\s*Taguig \(BGC\)/.test(tg) && row && row[1] === '2', tg + ' | ' + JSON.stringify(row));
      check(`${label}: by-city rows add up to the number of listings (no double counting)`, total === listings, `${total} vs ${listings}`);
      await c.ev(`document.querySelectorAll('#invGrid img.lphoto').forEach(i => i.scrollIntoView())`); await sleep(1200);
      // the fake board's "Svg Tower" (7003) has an SVG with a script in it as its only "photo": the proxy must refuse it
      const ph = await c.ev(`Object.fromEntries([...document.querySelectorAll('#invGrid .lph')].filter(p => p.querySelector('img.lphoto')).map(p => { const i = p.querySelector('img.lphoto'); return [p.querySelector('.phl').dataset.pid, i.complete && i.naturalWidth > 0 ? 'shown' : p.classList.contains('ph-err') ? 'placeholder' : 'pending']; }))`);
      check(`${label}: listing photos preview in the Inventory Dashboard; an unsafe file falls back to the placeholder`, ph['7001'] === 'shown' && ph['7004'] === 'shown' && ph['7009'] === 'shown' && ph['7003'] === 'placeholder', JSON.stringify(ph));
      check(`${label}: Inventory: a listing without photos shows "No photo"`, await c.ev(`[...document.querySelectorAll('#invGrid .lcard')].some(c => /Blank Fields Tower/.test(c.textContent) && !c.querySelector('img.lphoto') && /No photo$/.test(c.querySelector('.ini').textContent))`));
      check(`${label}: no sideways scrolling on the inventory`, await noSideScroll());
      check(`${label}: Monday updates switched off (default): no Availability control on Monday listings`, !(await c.ev(`!!document.querySelector('[data-ch="mwavail"], [data-ch="avail"]')`)));
      check(`${label}: with updates off the page says Monday is read-only`, /read-only: nothing is written to Monday/.test(await text('#modebar')));
      await c.ev(`window.scrollTo(0, 0)`); await shot(`${label}-5-inventory`);

      // Client Requirements: generated from the loaded leads, numbered clients only, Copy message (clipboard stubbed)
      if (mobile) { await c.ev(`(() => { const b = document.querySelector('.nav-burger'); b && b.click(); })()`); await sleep(250); }
      await c.ev(`document.querySelector('[data-act="nav"][data-v="clientreq"]').click()`);
      await until(`!!document.querySelector('#crText')`);
      const cr = await text('#crText');
      const crRaw = await c.ev(`document.querySelector('#crText').textContent`);
      check(`${label}: Client Requirements lists the two sourcing clients (no respond.io ID needed)`, /^Client Requirements for [A-Z][a-z]+ \d{1,2}, \d{4}/.test(crRaw) && (crRaw.match(/^\d+\. Client \d+$/gm) || []).length === 2, crRaw.split('\n').filter((x) => /Client \d|RENT|SALE|Building/.test(x)).join(' | '));
      check(`${label}: rent first with furnishing/pets lines; sale has Building Name and no rent-only lines`,
        /1\. Client 1\nRENT\nLocation: Makati[\s\S]*Furnished\/Unfurnished: Not specified\nPet Friendly\/Not Pet Friendly: Not specified\nBudget: ₱150,000\/month\n\n2\. Client 2\nSALE\nBuilding Name: Demo Sale Tower\nLocation: Not specified[\s\S]*Budget: ₱25,000,000$/.test(crRaw), '');
      check(`${label}: no names, phones, emails or lead codes; failed / unresponsive / other-stage leads left out`, !/Sourcing Client|Test Client|Check Fails|\+63|@|BH-T|900 555/.test(crRaw), cr.slice(0, 60));
      await c.ev(`window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } } })`);
      await click('#crCopy');
      await until(`window.__copied !== null`);
      check(`${label}: Copy message copies exactly the message shown`, (await c.ev(`window.__copied === document.querySelector('#crText').textContent`)) && /Copied/.test(await text('#crCopy')), await text('#toast'));
      check(`${label}: no sideways scrolling on Client Requirements`, await noSideScroll());
      check(`${label}: Location comes from City only; the free-text Client Requirements text never appears`, /^Location: Makati$/m.test(crRaw) && /^Location: Not specified$/m.test(crRaw) && !/Fake requirements|Demo Person|c\/o|0199/.test(crRaw), (crRaw.match(/^Location: .*$/gm) || []).join(' | '));
      check(`${label}: Monday pets "Not Applicable" shows "Not specified", never "Pet Friendly"`, /^Pet Friendly\/Not Pet Friendly: Not specified$/m.test(crRaw) && !/: Pet Friendly$/m.test(crRaw), (crRaw.match(/^Pet Friendly.*$/m) || [''])[0]);
      await shot(`${label}-6-client-requirements`);

      // Property Requirements: same Location rule (City only, no free text)
      if (mobile) { await c.ev(`(() => { const b = document.querySelector('.nav-burger'); b && b.click(); })()`); await sleep(250); }
      await c.ev(`document.querySelector('[data-act="nav"][data-v="propreq"]').click()`);
      await until(`!!document.querySelector('#prText')`);
      const pr = await c.ev(`document.querySelector('#prText').textContent`);
      check(`${label}: Property Requirements Location is City only; free text never appears`, /^Location: Makati$/m.test(pr) && /^Location: Not specified$/m.test(pr) && !/Fake requirements|Demo Person|c\/o|0199/.test(pr) && /^Pet Friendly\/Not Pet Friendly: Not specified$/m.test(pr), (pr.match(/^(Location|Pet).*$/gm) || []).join(' | '));
      check(`${label}: no sideways scrolling on Property Requirements`, await noSideScroll());
      await shot(`${label}-6b-property-requirements`);

      // Daily Report: numeric lead IDs only (Monday item names "BH-T…" and client names never appear), Copy text copies it
      if (mobile) { await c.ev(`(() => { const b = document.querySelector('.nav-burger'); b && b.click(); })()`); await sleep(250); }
      await c.ev(`document.querySelector('[data-act="nav"][data-v="daily"]').click()`);
      await until(`!!document.querySelector('#drText')`);
      const dr = await c.ev(`document.querySelector('#drText').textContent`);
      check(`${label}: Daily Report uses numeric lead IDs only`, /Lead #9\d{3}/.test(dr) && !/BH-T|Test Client|Sourcing Client|Check Fails|Hot Client|Lease Client|Viewing Client|\+63|@/.test(dr), dr.split('\n').filter((x) => /^•/.test(x)).join(' | ').slice(0, 200));
      await c.ev(`window.__copied = null`);
      await click('[data-act="copydaily"]');
      await until(`window.__copied !== null`);
      check(`${label}: Daily Report copy matches the screen`, await c.ev(`window.__copied === document.querySelector('#drText').textContent`));
      check(`${label}: no sideways scrolling on Daily Report`, await noSideScroll());
      await shot(`${label}-7-daily-report`);
      await c.ev(`fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })`);
    }
    // a VA (edit access to Leads) can use Asking for Availability but not the Failed override
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await c.send('Network.clearBrowserCookies');
    await c.send('Page.navigate', { url: base + '/' });
    await until(`!!document.querySelector('#loginForm')`);
    await c.ev(`(() => { document.querySelector('#lEmail').value = 'ana@example.com'; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
    await until(`!!document.querySelector('[data-act="nav"][data-v="leads"]')`, 20000);
    await c.ev(`document.querySelector('[data-act="nav"][data-v="leads"]').click()`);   // the browser remembers the last page
    await until(`!!document.querySelector('#list .row[data-id="9001"]')`, 20000);
    await c.ev(`document.querySelector('#list .row[data-id="9001"]').click()`);
    await until(`!!document.querySelector('#dbody .aicard')`); await sleep(300);
    check('VA: no "Mark as Failed" button (Managers only)', !(await c.ev(`!!document.querySelector('#dbody [data-act="failmodal"]')`)));
    const vaPut = await c.ev(`fetch('/api/leads/monday/9001/override', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'x' }) }).then(r => r.status)`);
    check('VA: the server refuses the override too', vaPut === 403, vaPut);
    await click('#drawer .tab[data-v="props"]');
    await until(`!!document.querySelector('#propsResults [data-act="askadd"]')`);
    check('VA: Ask availability is available', true);
    await shot('va-details');
    // Client Requirements follows the Property Requirements permission and the VA's own leads only
    await c.ev(`document.querySelector('#drawer [data-act="close"]').click()`);
    await c.ev(`document.querySelector('[data-act="nav"][data-v="clientreq"]').click()`);
    await until(`!!document.querySelector('#crText')`);
    const vaCr = await c.ev(`document.querySelector('#crText').textContent`);
    check('VA: Client Requirements shows only her own sourcing client (not Bea\'s)', (vaCr.match(/^\d+\. Client \d+$/gm) || []).length === 1 && /RENT/.test(vaCr) && !/SALE|Demo Sale Tower/.test(vaCr), vaCr.split('\n').slice(2, 4).join(' | '));
    // a VA without Property Requirements access doesn't get the page either
    await c.send('Network.clearBrowserCookies'); await c.send('Page.navigate', { url: base + '/' });
    await until(`!!document.querySelector('#loginForm')`);
    await c.ev(`(() => { document.querySelector('#lEmail').value = 'cora@example.com'; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
    await until(`!!document.querySelector('[data-act="nav"][data-v="leads"]')`, 20000);
    const coraNav = await c.ev(`[...document.querySelectorAll('[data-act="nav"]')].map((b) => b.dataset.v).join(',')`);
    check('VA without Property Requirements access: no Client Requirements page', !/clientreq|propreq/.test(coraNav), coraNav);

    // with Monday updates off (the default), nothing was written to Monday or respond.io, and photos were only read
    check('read-only: Monday got queries only, respond.io GETs only, file host GETs without the token',
      fx.calls.monday.every((x) => /^\s*query\b/.test(x.body.query)) && fx.calls.respond.every((x) => x.method === 'GET') && fx.calls.files.every((x) => x.method === 'GET' && !x.auth),
      `${fx.calls.monday.length} Monday, ${fx.calls.respond.length} respond.io, ${fx.calls.files.length} file reads`);
    const beforeWrites = fx.calls.monday.length;

    // ---- Monday updates switched ON (a second local server, same fake boards): explicit, confirmed, allowlisted ----
    const app2 = createApp(loadConfig({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_ui'), PORT: '0', HOST: '127.0.0.1', MONDAY_TOKEN: 'mtest',
      MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: fake + '/monday', MONDAY_WRITES: 'on' }, ['node', 'server.js']));
    const server2 = await new Promise((r) => { const s = app2.listen(0, '127.0.0.1', () => r(s)); });
    const base2 = `http://127.0.0.1:${server2.address().port}`;
    const signIn = async (email) => {
      await c.send('Network.clearBrowserCookies'); await c.send('Page.navigate', { url: base2 + '/' }); await sleep(300);
      await c.ev(`localStorage.clear()`); await c.send('Page.navigate', { url: base2 + '/' });
      await until(`!!document.querySelector('#loginForm')`);
      await c.ev(`(() => { document.querySelector('#lEmail').value = ${JSON.stringify(email)}; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
      await until(`document.querySelectorAll('#list .row[data-id]').length >= 3`, 20000);
    };
    const navTo = async (v, mobile) => { if (mobile) { await c.ev(`(() => { const b = document.querySelector('.nav-burger'); b && b.click(); })()`); await sleep(250); } await c.ev(`document.querySelector('[data-act="nav"][data-v="${v}"]').click()`); };
    const choose = (sel, v) => c.ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const writesSent = () => fx.calls.monday.slice(beforeWrites).filter((x) => /^\s*mutation\b/.test(x.body.query));
    const plan = [['desktop', 1440, 900, false, 'Remove', 'leadBudget', '175000', '6201', 'failed'], ['phone', 390, 844, true, 'Available', 'leadInquiry', 'Buy', '6202', 'loi']];
    for (const [label, w, h, mobile, avail, field, value, calItem, calOutcome] of plan) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
      await signIn('boss@example.com');
      // Inventory: the board's own Availability labels; Cancel sends nothing; Confirm updates Monday
      await navTo('invdash', mobile);
      await until(`!!document.querySelector('[data-ch="mwavail"][data-id="7005"]')`, 15000);
      const opts = await c.ev(`[...document.querySelector('[data-ch="mwavail"][data-id="7005"]').options].map((o) => o.textContent)`);
      check(`${label} (writes on): Availability offers exactly the Monday board's labels`, JSON.stringify(opts.filter((o) => !/current|not set/.test(o))) === JSON.stringify(['Availability Inquired', 'Closed', 'Available', 'Remove']), opts.join(', '));
      const n0 = writesSent().length;
      await choose('[data-ch="mwavail"][data-id="7005"]', avail);
      await until(`document.querySelector('#modal').classList.contains('open')`);
      await click('#modal [data-act="mclose"]');
      check(`${label} (writes on): Cancel in the confirmation sends nothing and keeps the old value`, writesSent().length === n0 && (await c.ev(`document.querySelector('[data-ch="mwavail"][data-id="7005"]').value`)) !== avail);
      await choose('[data-ch="mwavail"][data-id="7005"]', avail);
      await until(`document.querySelector('#modal').classList.contains('open')`);
      const dlg = await text('#modal');
      check(`${label} (writes on): the confirmation names the board, field, old and new value`, /Update Monday\.com\?/.test(dlg) && /Availability/.test(dlg) && /Listings/.test(dlg) && new RegExp(avail).test(dlg) && /can't be undone from the portal/.test(dlg), dlg.slice(0, 160));
      check(`${label} (writes on): the Availability confirmation warns about Monday automations`, /may trigger automations/.test(dlg), (dlg.match(/⚠[^\n]*/) || [''])[0]);
      await shot(`${label}-8-monday-confirm`);
      await c.ev(`document.querySelector('#modalForm').requestSubmit()`);
      await until(`!document.querySelector('#modal').classList.contains('open') && document.querySelector('[data-ch="mwavail"][data-id="7005"]').value === ${JSON.stringify(avail)}`, 15000);
      check(`${label} (writes on): Availability updated on (fake) Monday and shown`, writesSent().length === n0 + 1 && /Monday updated/.test(await text('#toast')), await text('#toast'));
      check(`${label} (writes on): no sideways scrolling on the inventory`, await noSideScroll());
      check(`${label} (writes on): the page no longer claims Monday is read-only, and says what is written`, !/read-only/.test(await text('#modebar')) && /Only the changes you confirm/.test(await text('#modebar')), (await text('.src-note')).slice(0, 120));
      // Lead details: "Update on Monday" (one field at a time, confirmed)
      await navTo('leads', mobile);
      await until(`!!document.querySelector('#list .row[data-id="9008"]')`);
      await c.ev(`document.querySelector('#list .row[data-id="9008"]').click()`);
      await until(`!!document.querySelector('#dbody .mwbox')`, 15000); await sleep(300);
      const rows = await c.ev(`[...document.querySelectorAll('#dbody .mwrow > span')].map((s) => s.textContent)`);
      // the board has a Pets column, but Pets is not on the allowlist; Nationality has no column on this fake board
      check(`${label} (writes on): lead details offer only the allowlisted fields present on the board (no Pets)`, JSON.stringify(rows) === JSON.stringify(['Budget', 'Target Move-in Date', 'Inquiry Type']), rows.join(', '));
      await c.ev(`(() => { const i = document.querySelector('#dbody [data-mwin="${field}"]'); i.value = ${JSON.stringify(value)}; })()`);
      await click(`#dbody [data-act="mwsave"][data-k="${field}"]`);
      await until(`document.querySelector('#modal').classList.contains('open')`);
      check(`${label} (writes on): lead update asks first, naming the Direct Clients board, with readable old and new values`, /Direct Clients/.test(await text('#modal')) && !/NaN|undefined/.test(await text('#modal')), (await text('#modal')).slice(0, 140));
      await c.ev(`document.querySelector('#modalForm').requestSubmit()`);
      await until(`!document.querySelector('#modal').classList.contains('open')`, 15000);
      check(`${label} (writes on): lead field updated on (fake) Monday`, writesSent().length === n0 + 2 && /Monday updated/.test(await text('#toast')), await text('#toast'));
      check(`${label} (writes on): no sideways scrolling in the lead panel`, await c.ev(`document.querySelector('#drawer').scrollWidth <= document.querySelector('#drawer').clientWidth + 1`));
      await shot(`${label}-9-monday-lead-update`);
      await c.ev(`document.querySelector('#drawer [data-act="close"]').click()`);
      // Calendar → Pending Broker Feedback → record the result; the viewing's Status is written on (fake) Monday after confirming
      // Create LOI sets the Monday Status (after a confirmation); Failed changes nothing on Monday (as the Apps Script)
      const loi = calOutcome === 'loi', target = loi ? 'Under Negotiations' : 'Viewing Scheduled';
      await sleep(300); await navTo('calendar', mobile);
      await until(`!!document.querySelector('#pendingFb [data-act="pfbres"][data-id="${calItem}"]')`, 15000);
      check(`${label} (writes on): Pending Broker Feedback lists the viewing that happened, with Open client, Create LOI and Failed`,
        await c.ev(`(() => { const row = document.querySelector('#pendingFb [data-act="pfbres"][data-id="${calItem}"]').closest('.pfb-row'); return !!row.querySelector('[data-act=pfbopen]') && row.querySelectorAll('[data-act=pfbres]').length === 2; })()`));
      check(`${label} (writes on): no sideways scrolling on the Calendar with the feedback panel`, await noSideScroll());
      await shot(`${label}-10-calendar-pending`);
      await click(`#pendingFb [data-act="pfbres"][data-id="${calItem}"][data-v="${calOutcome}"]`);
      await until(`document.querySelector('#modal').classList.contains('open') && !!document.querySelector('#vFeedback')`);
      check(`${label} (writes on): the viewing dialog has its result (Status) and Broker feedback enabled, ${calOutcome} chosen`,
        await c.ev(`!document.querySelector('#vFeedback').disabled && !document.querySelector('#modal fieldset.vres').disabled && document.querySelector('#modal input[name=vOutcome][value="${calOutcome}"]').checked && !!document.querySelector('#vSave')`));
      if (calOutcome === 'loi') await c.ev(`(() => { document.querySelector('#vConf').value = '75'; document.querySelector('#vState').value = 'Owner reviewing'; })()`);
      else await click('#modal input[name=vTag][value="too_small"]');
      await c.ev(`document.querySelector('#vFeedback').value = 'Demo feedback from the broker'`);
      const n1 = writesSent().length;
      await click('#vSave');
      if (loi) {
        await until(`!!document.querySelector('#vConfirm .vconfirm')`);
        const conf = await text('#vConfirm');
        check(`${label} (writes on): Create LOI asks first, naming the Monday Status change (old → new) and automations`, /Viewing Scheduled/.test(conf) && conf.includes(target) && /automations/.test(conf) && writesSent().length === n1, conf.slice(0, 160));
        await shot(`${label}-11-calendar-result-confirm`);
        await click('#modal [data-act="vconfirm"]');
      }
      await until(`!document.querySelector('#modal').classList.contains('open')`, 15000);
      const t2 = await text('#toast');
      check(`${label} (writes on): ${loi ? 'Create LOI saved — Status and LOI Creation Date on (fake) Monday' : 'Failed saved — nothing on Monday'}, broker feedback kept in the portal`,
        (loi ? t2.includes('Status → ' + target) : /Monday was not changed/.test(t2)) && /saved in the portal/.test(t2) && writesSent().length === n1 + (loi ? 2 : 0), t2);
      await until(`!document.querySelector('#pendingFb [data-id="${calItem}"]')`, 10000);
      check(`${label} (writes on): the viewing left Pending Broker Feedback`, true);
      await click(`[data-act="viewing"][data-id="${calItem}"]`);
      await until(`document.querySelector('#modal').classList.contains('open')`);
      check(`${label} (writes on): reopened, the viewing shows ${loi ? 'the new' : 'the unchanged'} Monday Status and the saved feedback`,
        (await text('#vMonStatus')) === target && (await c.ev(`document.querySelector('#vFeedback').value`)) === 'Demo feedback from the broker', await text('#vMonStatus'));
      check(`${label} (writes on): no sideways scrolling in the viewing dialog`, await c.ev(`document.querySelector('#modal .box').scrollWidth <= document.querySelector('#modal .box').clientWidth + 1`));
      await shot(`${label}-12-calendar-result-saved`);
      await click('#modal [data-act="mclose"]');
    }
    // a VA with Calendar view access only: the viewing's result and feedback stay read-only, with the reason shown
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await signIn('vcal@example.com');
    await navTo('calendar', false);
    await until(`!!document.querySelector('[data-act="viewing"][data-id="6201"]')`, 15000);
    await click('[data-act="viewing"][data-id="6201"]');
    await until(`document.querySelector('#modal').classList.contains('open')`);
    check('VA with Calendar view only: result and Broker feedback are disabled, no Save, and it says why',
      await c.ev(`document.querySelector('#vFeedback').disabled && document.querySelector('#modal fieldset.vres').disabled && !document.querySelector('#vSave') && /view-only/.test(document.querySelector('#modal').textContent)`));
    await click('#modal [data-act="mclose"]');
    // Team & Access: a Manager sets a broker's exact Monday Salesperson label (picked from the board's labels)
    await signIn('boss@example.com');
    await navTo('team', false);
    await until(`!!document.querySelector('[data-act="user"][data-v="brk@example.com"]')`, 15000);
    await sleep(800);
    check('Team & Access: a broker without a Salesperson label is flagged (sees no Monday viewings)', /No Salesperson label/.test(await text('[data-act="user"][data-v="brk@example.com"]')));
    await click('[data-act="user"][data-v="brk@example.com"]');
    await until(`!!document.querySelector('#mSales')`);
    const sOpts = await c.ev(`[...document.querySelector('#mSales').options].map((o) => o.value)`);
    check('Team & Access: the Salesperson choices are the board\'s exact labels (no free text)', ['Ely Santos', 'Gia Cruz', 'Hal Fake'].every((x) => sOpts.includes(x)) && sOpts[0] === '', sOpts.join(', '));
    await choose('#mSales', 'Ely Santos');
    await c.ev(`document.querySelector('#modalForm').requestSubmit()`);
    await until(`!document.querySelector('#modal').classList.contains('open')`, 15000);
    await until(`/Ely Santos/.test((document.querySelector('[data-act="user"][data-v="brk@example.com"]') || {}).textContent || '')`, 10000);
    check('Team & Access: the label is saved and matches a Salesperson on the board', /Ely Santos \(Salesperson\)/.test(await text('[data-act="user"][data-v="brk@example.com"]')) && /✓ Salesperson/.test(await text('[data-act="user"][data-v="brk@example.com"]')), await text('[data-act="user"][data-v="brk@example.com"]'));

    // ---- Apps Script parity screens (Manager, Monday data; nothing may be written to Monday or sent to respond.io) ----
    const mutBefore = writesSent().length, respondBefore = fx.calls.respond.length;
    for (const [label, w, h, mobile] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
      // Leads Report → Closed Deals — Commission Collected
      await navTo('ldash', mobile);
      await until(`/Closed Deals — Commission Collected/.test(document.body.textContent) && /Commission collected/.test(document.body.textContent)`, 15000);
      const ld = await text('#view');
      check(`${label}: Leads Report shows Closed Deals — Commission Collected from the Calendar board (₱120,000, by city and building)`, /₱120,000/.test(ld) && /Demo Lease Tower/.test(ld) && /By city/.test(ld), (ld.match(/Commission collected[^A-Z]*/) || [''])[0].slice(0, 80));
      check(`${label}: no sideways scrolling on the Leads Report`, await noSideScroll());
      // Broker Management: the board's own Salesperson labels, per period
      await navTo('brokers', mobile);
      await until(`/Per period/.test(document.body.textContent) && !/Loading the Monday/.test(document.body.textContent)`, 15000);
      const brk = await c.ev(`[...document.querySelectorAll('#view table:first-of-type tbody tr td:first-child')].map((x) => x.textContent.trim())`);
      check(`${label}: Broker Management lists the Monday Salesperson labels, not fictional names`, brk.includes('Ely Santos') && brk.includes('Gia Cruz') && !brk.includes('Fritz Lim'), brk.join(', '));
      // Renewals: the lease from the Calendar board, its Message (copy + "I sent it" log)
      await navTo('renewals', mobile);
      await until(`!!document.querySelector('[data-act="rnmsg"][data-id="9011"]')`, 15000);
      check(`${label}: Renewals lists the Calendar lease due in 25 days, with the Contract Expiration Date`, /Demo Lease Tower/.test(await text('#view')) && /25 d/.test(await text('#view')), (await text('#view')).slice(0, 120));
      await click('[data-act="rnmsg"][data-id="9011"]');
      await until(`!!document.querySelector('#rnText')`);
      const msg = await c.ev(`document.querySelector('#rnText').value`);
      check(`${label}: Message fills the 30-day renewal template (first name, building, days)`, /^Hi Lease, your lease at Demo Lease Tower ends on/.test(msg) && /only 25 days/.test(msg), msg.slice(0, 90));
      await c.ev(`window.__copied = ''; navigator.clipboard.writeText = (t) => { window.__copied = t; return Promise.resolve(); }`);
      await click('#modal [data-act="rncopy"]');
      await sleep(200);
      check(`${label}: Copy puts the message on the clipboard`, (await c.ev('window.__copied')) === msg);
      await click('#modal [data-act="rnsent"]');
      await until(`!document.querySelector('#modal').classList.contains('open')`, 10000);
      await until(`/Renewal — 30 days/.test(document.querySelector('#view').textContent)`, 10000);
      check(`${label}: "I sent it from respond.io" records the message on the lease (no sending)`, /Recorded: Renewal — 30 days\. Nothing was sent/.test(await text('#toast')), await text('#toast'));
      check(`${label}: no sideways scrolling on Renewals`, await noSideScroll());
      // P&L: commission per month from the Calendar board; a cost line saved in the portal
      await navTo('pl', mobile);
      await until(`/Total Estimated Commission/.test(document.body.textContent) && !!document.querySelector('[data-ch="plcell"]')`, 15000);
      const pl = await text('#view');
      check(`${label}: P&L shows the Calendar commission (₱120,000 collected) and the Data Check`, /Collected Commission Revenue/.test(pl) && /₱120,000/.test(pl) && /Data Check/.test(pl), pl.slice(0, 100));
      if (!mobile) {
        await c.ev(`(() => { const i = document.querySelector('[data-ch="plcell"][data-line="salaries"]'); i.value = '20000'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await until(`/Saved in the portal/.test(document.querySelector('#toast').textContent)`, 10000);
        check('desktop: a P&L cost line is saved in the portal and counted in operating expenses', /₱20,000/.test(await text('#view')));
      }
      // Daily Report: date, sections, own lines, Clear — the generated part stays free of names and numbers
      await navTo('daily', mobile);
      await until(`!!document.querySelector('[data-ch="drdate"]')`, 10000);
      await c.ev(`(() => { const s = document.querySelector('[data-ch="drsec"][data-k="new"]'); s.checked = false; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(200);
      await c.ev(`(() => { const t = document.querySelector('[data-ch="drnote"][data-k="extra"]'); t.value = 'Team meeting at 4pm'; t.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await until(`/NOTES\\nTeam meeting at 4pm/.test(document.querySelector('#drText').textContent)`, 10000);
      const drt = await text('#drText');
      check(`${label}: Daily Report leaves out an unticked section and adds the team's own lines`, !/NEW CLIENT REQUIREMENTS/.test(drt) && /NOTES Team meeting at 4pm/.test(drt) && !/Lease Client|Sourcing Client|\+63/.test(drt), drt.slice(0, 140));
      await click('[data-act="drclear"]');
      await until(`/NEW CLIENT REQUIREMENTS/.test(document.querySelector('#drText').textContent) && !/NOTES/.test(document.querySelector('#drText').textContent)`, 10000);
      check(`${label}: Clear brings back every section and removes the extra lines`, true);
      check(`${label}: no sideways scrolling on the Daily Report`, await noSideScroll());
    }
    check('parity screens: nothing written to Monday, nothing sent to respond.io', writesSent().length === mutBefore && fx.calls.respond.slice(respondBefore).every((x) => x.method === 'GET'));
    // a VA with Leads edit (no Inventory access): lead fields are Managers only, so no Monday updates at all
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await signIn('ana@example.com');
    await c.ev(`document.querySelector('#list .row[data-id="9008"]').click()`);
    await until(`!!document.querySelector('#dbody') && /Budget/.test(document.querySelector('#dbody').textContent)`, 15000); await sleep(1500);
    check('VA (writes on): no "Update on Monday" in her own lead (Managers only); no Inventory page',
      !(await c.ev(`!!document.querySelector('#dbody .mwbox')`)) && !(await c.ev(`!!document.querySelector('[data-act="nav"][data-v="invdash"]')`)));
    const sent = writesSent().map((x) => [x.body.query === WRITE_MUTATION, x.body.variables]);
    check('writes on: exactly the 6 confirmed changes reached (fake) Monday (none for the Failed viewing), each the fixed single-column mutation',
      JSON.stringify(sent) === JSON.stringify([[true, { b: '2222222', i: '7005', c: 'av', v: 'Remove' }], [true, { b: '1111111', i: '9008', c: 'bud', v: '175000' }],
        [true, { b: '2222222', i: '7005', c: 'av', v: 'Available' }], [true, { b: '1111111', i: '9008', c: 'inq', v: 'Buy' }],
        [true, { b: '3333333', i: '6202', c: 'st', v: 'Under Negotiations' }], [true, { b: '3333333', i: '6202', c: 'lcd', v: todayManila }]]), JSON.stringify(sent));
    check('writes on: every other Monday call was a read query; respond.io untouched', fx.calls.monday.slice(beforeWrites).every((x) => /^\s*query\b/.test(x.body.query) || x.body.query === WRITE_MUTATION) && fx.calls.respond.every((x) => x.method === 'GET'));
    server2.close();
    const errs = await c.ev(`(window.__errs || []).join(' | ')`);
    check('no uncaught page errors', !errs, errs);
    c.close();
  } finally {
    br.kill(); server.close(); fixture.close(); front.close(); await mongoose.disconnect(); await mem.stop();
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} browser checks passed · screenshots in ${OUT}`);
    process.exitCode = failed ? 1 : 0;
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
