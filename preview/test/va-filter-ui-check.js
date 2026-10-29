'use strict';
// Browser check of the Leads VA filter (and the Monday load for members without Leads access) at desktop and phone
// widths, in MongoDB mode with a throwaway database and the local fake Monday.com (fictional data; nothing is written).
//   node test/va-filter-ui-check.js [outDir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User, Lead } = require('../src/models');
const { hashPassword } = require('../src/auth');
const fx = require('./fixtures/fake-integrations');

const OUT = path.resolve(process.argv[2] || 'va-ui-out');
fs.mkdirSync(OUT, { recursive: true });
const BROWSER = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => fs.existsSync(p));
const PW = 'correct-horse-battery';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the reported cases on the fake Direct Clients board: a lower-case spelling, double spaces, an unassigned lead, a
// VA label only on the board. Carlo and Dina (the preview's fictional list) are not on this board.
const L = fx.BOARDS['1111111'];
L.items.push({ id: '9201', name: 'BH-V1', group: 'ALL CLIENTS', v: { cn: 'Lower Case Ana Client', va1: 'ana', inq: 'Rent', dq: '2026-10-20' } },
  { id: '9202', name: 'BH-V2', group: 'ALL CLIENTS', v: { cn: 'Double Space Cora Client', va1: 'Cora  Fake', inq: 'Rent', dq: '2026-10-21' } },
  { id: '9203', name: 'BH-V3', group: 'ALL CLIENTS', v: { cn: 'Nobody Assigned', inq: 'Rent', dq: '2026-10-22' } },
  { id: '9205', name: 'BH-V5', group: 'ALL CLIENTS', v: { cn: 'Ghost Client', va1: 'Zed Ghost', inq: 'Rent', dq: '2026-10-23' } });

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
  const fakeBase = `http://127.0.0.1:${fake.address().port}`;
  const mem = await MongoMemoryServer.create();
  const { server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_va_ui'), PORT: '0', HOST: '127.0.0.1',
    MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: fakeBase + '/monday' }, ['node', 'server.js']);
  const base = `http://127.0.0.1:${server.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana VA', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view' }, passwordHash },
    { email: 'bea@example.com', name: 'Bea VA', role: 'VA', vaLabel: 'Bea', modules: { leads: 'view' }, passwordHash },
    { email: 'pages@example.com', name: 'Pages Only', role: 'VA', vaLabel: '', modules: { pages: 'view' }, passwordHash }]);
  await Lead.create({ code: 'BH-M1', name: 'Mongo Client', va: 'Ana' });
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bhva-'));
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
    const rows = () => c.ev(`[...document.querySelectorAll('#list .row[data-id]')].map((r) => r.dataset.id).sort().join(',')`);
    const signIn = async (email, { fresh = true } = {}) => {
      if (fresh) { await c.send('Network.clearBrowserCookies'); await c.send('Page.navigate', { url: base + '/' }); await sleep(300); await c.ev('localStorage.clear()'); await c.send('Page.navigate', { url: base + '/' }); }
      await until(`!!document.querySelector('#loginForm')`);
      await c.ev(`(() => { document.querySelector('#lEmail').value = ${JSON.stringify(email)}; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
      await until(`!!document.querySelector('[data-act="nav"]')`);
      await c.ev('window.confirm = () => true');
    };
    const pickVa = (v) => c.ev(`(() => { const s = document.querySelector('select[data-ch="va"]'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);

    for (const [label, w, h, mobile] of [['desktop', 1440, 900, false], ['phone', 390, 844, true]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
      const tag = mobile ? ' (phone)' : '';
      // the Ana VA's own view (server scoping), to compare with the Manager's VA=Ana filter
      await signIn('ana@example.com'); await until(`document.querySelectorAll('#list .row[data-id]').length >= 1`);
      const anaOwn = await rows();
      await signIn('boss@example.com'); await until(`document.querySelectorAll('#list .row[data-id]').length >= 6`);
      if (mobile) { await c.ev(`document.querySelector('[data-act="filtersheet"]').click()`); await until(`!!document.querySelector('#modal select[data-ch="va"]')`); }
      const opts = await c.ev(`[...document.querySelector('select[data-ch="va"]').options].map((o) => o.text).join(' | ')`);
      check(`Monday VA choices are the board's labels, one per VA${tag}`, opts === 'All | Unassigned | Ana | Bea | Cora Fake | Zed Ghost', opts);
      await pickVa('Ana'); await sleep(300);
      if (mobile) { await c.ev(`document.querySelector('#modal [data-act="mclose"], #modal .actions .btn.primary').click()`); await sleep(300); }
      const mgrAna = await rows();
      check(`VA=Ana shows exactly what the Ana VA sees (every spelling)${tag}`, mgrAna === anaOwn && mgrAna.includes('9201'), `manager ${mgrAna} · Ana ${anaOwn}`);
      if (!mobile) {
        await pickVa('__none'); await sleep(300);
        check('Unassigned shows only unassigned leads', (await rows()) === '9203', await rows());
        await pickVa('Cora Fake'); await sleep(300);
        check('one "Cora Fake" choice matches both spellings', (await rows()) === '9005,9202', await rows());
        // a chosen VA that the data no longer has: still shown and selected, with its chip
        await pickVa('Zed Ghost'); await sleep(300);
        await c.ev(`document.querySelector('[data-act="source"][data-v="mongo"]').click()`);
        await until(`!!document.querySelector('.demo-tag') && /MongoDB/.test(document.querySelector('.demo-tag').textContent) && !!document.querySelector('select[data-ch="va"]')`);
        await sleep(400);
        const sel = await c.ev(`(() => { const s = document.querySelector('select[data-ch="va"]'); return s.options[s.selectedIndex].text; })()`);
        const chip = await c.ev(`[...document.querySelectorAll('.fchip')].map((x) => x.textContent).join(' ')`);
        check('a VA filter missing from the data stays visible in the select (not "All")', /Zed Ghost \(no leads\)/.test(sel) && /VA: Zed Ghost/.test(chip), `${sel} · ${chip}`);
        await shot('1-missing-va-desktop');
        await c.ev(`document.querySelector('[data-act="source"][data-v="monday"]').click()`); await until(`document.querySelectorAll('#list .row[data-id]').length >= 1`, 20000);
        // sign-out clears the filters: the next person in this tab starts with none
        await pickVa('Ana'); await sleep(200);
        await c.ev(`document.querySelector('[data-act="logout"]').click()`);
        await signIn('bea@example.com', { fresh: false });
        await until(`document.querySelectorAll('#list .row[data-id]').length >= 1`);
        const beaChips = await c.ev(`[...document.querySelectorAll('.fchip')].map((x) => x.textContent).join(' ')`);
        check('after sign-out, the next VA has no leftover VA filter', !/VA:/.test(beaChips) && /9003/.test(await rows()), `${beaChips} · ${await rows()}`);
        // a member without Leads access: no Monday read, so no red 403 banner
        await c.ev(`document.querySelector('[data-act="logout"]').click()`);
        await signIn('pages@example.com', { fresh: false }); await sleep(800);
        const errs = await c.ev(`[...document.querySelectorAll('.src-err')].map((x) => x.textContent).join(' ')`);
        const note = await c.ev(`(document.querySelector('#modebar .src-note') || {}).textContent || ''`);
        check('member without Leads access: no Monday error banner, a plain note instead', !errs && /needs Leads access/.test(note), errs || note);
        await shot('2-pages-only-desktop');
      } else {
        check('phone: no sideways scrolling with a VA filter', await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
        await shot('3-va-filter-phone');
      }
    }
    const pageErrs = await c.ev(`(window.__errs || []).join(' | ')`);
    check('no uncaught page errors', !pageErrs, pageErrs);
    c.close();
  } catch (err) { check('run completed', false, err.message); }
  finally {
    br.kill(); server.close(); fake.close(); await mongoose.disconnect(); await mem.stop();
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots in ${OUT}`);
    process.exit(failed ? 1 : 0);
  }
})();
