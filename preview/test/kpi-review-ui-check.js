'use strict';
// Browser check of KPI Review at desktop and phone widths, in MongoDB mode with a throwaway database and the local fake
// Monday.com (fictional data and accounts; no real service is contacted, nothing is written to Monday).
//   node test/kpi-review-ui-check.js [outDir]                 screenshots + results.json in outDir (default ./kpi-ui-out)
//   node test/kpi-review-ui-check.js [outDir] --serve=4180    then keeps a fresh test-data portal running on that port
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { connectDb } = require('../src/db');
const { User } = require('../src/models');
const { hashPassword } = require('../src/auth');
const SH = require('../public/shared');
const fx = require('./fixtures/fake-integrations');

const args = process.argv.slice(2), serve = Number((args.find((a) => a.startsWith('--serve=')) || '').slice(8)) || 0;
const OUT = path.resolve(args.find((a) => !a.startsWith('--')) || 'kpi-ui-out');
fs.mkdirSync(OUT, { recursive: true });
const BROWSER = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => fs.existsSync(p));
const PW = 'local-review-only-pw';   // fictional test accounts in a throwaway database
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TODAY = SH.manilaDay();
const ACCOUNTS = [
  ['toby.reviewer@example.com', 'Toby (test reviewer)', 'Broker', ''], ['jonjo.reviewer@example.com', 'Jonjo (test reviewer)', 'Manager', ''],
  ['blackhouse2br@gmail.com', 'blackhouse (test copy)', 'Manager', ''], ['lara.va@example.com', 'Lara', 'VA', 'Lara'], ['ana.va@example.com', 'Ana (test VA)', 'VA', 'Ana'],
];
const SECRET = 'UI-private-coaching-7731';

// Lara's own VA label and clients on the fake Direct Clients board, this month, with one viewing
const L = fx.BOARDS['1111111'];
L.columns.find((c) => c.id === 'va1').settings_str = JSON.stringify({ labels: { 0: 'Ana', 1: 'Bea', 2: 'Cora Fake', 3: 'Dev Fake', 4: 'Lara' } });
L.items.push({ id: '9101', name: 'BH-L1', group: 'ALL CLIENTS', v: { cn: 'Lara Client One', va1: 'Lara', inq: 'Rent', cs: 'Qualified', dq: TODAY } },
  { id: '9102', name: 'BH-L2', group: 'ALL CLIENTS', v: { cn: 'Lara Client Two', va1: 'Lara', inq: 'Rent', cs: 'Failed', dq: TODAY } });
fx.BOARDS['3333333'].items.push({ id: '6101', name: 'Viewing L', group: 'Viewings', created: TODAY, v: { fs: TODAY, cl: { linked: ['9101'] }, b: 'Fake Tower', c: 'Makati', tm: '10:00', sp: 'Ely Santos', st: 'Done' } });

/** A portal on fake Monday + its own in-memory MongoDB, with the test accounts. */
async function portal(fakeBase, port) {
  const mem = await MongoMemoryServer.create();
  await connectDb(mem.getUri('bh_kpi_ui'));
  const cfg = loadConfig({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_kpi_ui'), PORT: String(port), HOST: '127.0.0.1',
    MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: fakeBase + '/monday',
    KPI_REVIEWER_TOBY_EMAIL: ACCOUNTS[0][0], KPI_REVIEWER_JONJO_EMAIL: ACCOUNTS[1][0] }, ['node', 'server.js']);
  const passwordHash = await hashPassword(PW);
  await User.create(ACCOUNTS.map(([email, name, role, vaLabel]) => ({ email, name, role, vaLabel, passwordHash, modules: role === 'VA' ? { leads: 'view' } : {} })));
  const srv = await new Promise((r) => { const s = createApp(cfg).listen(port, '127.0.0.1', () => r(s)); });
  return { srv, mem, base: `http://127.0.0.1:${srv.address().port}` };
}

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
  const { srv, base } = await portal(fakeBase, 0);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bhkpi-'));
  const dport = 9300 + Math.floor(Math.random() * 500);
  const br = spawn(BROWSER, ['--headless=new', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${dport}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail != null && detail !== '' ? ' — ' + detail : '')); };
  try {
    let tabs; for (let i = 0; i < 50 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); } catch (e) { await sleep(200); } }
    const c = await cdp(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await c.send('Page.enable'); await c.send('Runtime.enable');
    // waits for a condition; one that throws (element not drawn yet) counts as not yet true
    const until = async (expr, ms = 15000) => { const t = Date.now(); for (;;) { if (await c.ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) return true; if (Date.now() - t > ms) throw new Error('timed out waiting for: ' + expr); await sleep(120); } };
    const shot = async (name) => { const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };
    const html = () => c.ev('document.documentElement.outerHTML');
    const navs = () => c.ev(`[...document.querySelectorAll('[data-act="nav"]')].map((b) => b.dataset.v).join(',')`);
    const signIn = async (email) => {
      await c.send('Network.clearBrowserCookies'); await c.send('Page.navigate', { url: base + '/' }); await sleep(300);
      await c.ev('localStorage.clear()'); await c.send('Page.navigate', { url: base + '/' });
      await until(`!!document.querySelector('#loginForm')`);
      await c.ev(`(() => { document.querySelector('#lEmail').value = ${JSON.stringify(email)}; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
      await until(`!!document.querySelector('[data-act="nav"]')`, 20000);
      await c.ev('window.confirm = () => true');
    };
    const go = async (v, mobile) => {
      if (mobile) { await c.ev(`(() => { const b = document.querySelector('.nav-burger'); b && b.click(); })()`); await sleep(250); }
      await c.ev(`document.querySelector('[data-act="nav"][data-v="${v}"]').click()`);
    };
    const type = (k, v) => c.ev(`(() => { const t = document.querySelector('textarea[data-k="${k}"]'); t.value = ${JSON.stringify(v)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    // one Action plan / Commitment date input in the editable section
    const act = (i, f, v) => c.ev(`(() => { const t = document.querySelectorAll('.kr-col input[data-in="kraction"][data-f="${f}"]')[${i}]; t.value = ${JSON.stringify(v)}; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    const pickLara = async () => { await until(`[...document.querySelector('[data-ch="kremp"]').options].some((o) => /^Lara/.test(o.text))`); await c.ev(`(() => { const s = document.querySelector('[data-ch="kremp"]'); s.value = [...s.options].find((o) => /^Lara/.test(o.text)).value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`); };

    for (const [label, w, h, mobile] of [['desktop', 1440, 1000, false], ['phone', 390, 844, true]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
      const tag = label === 'desktop' ? '' : ' (phone)';
      // Toby: KPI Review, Lara's own section, her KPIs, his column editable and Jonjo's read-only
      await signIn(ACCOUNTS[0][0]);
      check(`Toby sees KPI Review${tag}`, /kpireview/.test(await navs()), await navs());
      await go('kpireview', mobile);
      await until(`!!document.querySelector('[data-ch="kremp"]') && !document.querySelector('#view .empty[role="status"]')`);
      const opts = await c.ev(`[...document.querySelector('[data-ch="kremp"]').options].map((o) => o.text).join(' | ')`);
      check(`Lara is her own employee in the list${tag}`, /(^|\| )Lara( \||$)/.test(opts) && /Ana \(test VA\)/.test(opts) && /Bea \(not on Team & Access\)/.test(opts), opts);
      await pickLara();
      await until(`/Employee ID [a-f0-9]{24}/.test(document.querySelector('.kr-emp h3').textContent) && /Lara/.test(document.querySelector('.kr-emp h3').textContent)`);
      const kp = await c.ev(`[...document.querySelectorAll('.kr-kpis .card')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()).join(' | ')`);
      check(`Lara's KPIs and labels shown${tag}`, /2\s*Clients assigned in the month/.test(kp) && /50%\s*To viewing/.test(kp) && /50%\s*Lost/.test(kp) && /2\s*Leads/.test(kp), kp);
      check(`live data labelled as live${tag}`, /Live review data/.test(await c.ev(`document.querySelector('.kr-banner').textContent`)));
      const cols = await c.ev(`[...document.querySelectorAll('.kr-col')].map((x) => x.querySelector('h3').textContent + (x.querySelector('textarea') ? ' [edit]' : ' [read]')).join(' | ')`);
      check(`separate Toby / Jonjo columns, only Toby's editable${tag}`, /Toby — coaching yours \[edit\] \| Jonjo — coaching \[read\]/.test(cols), cols);
      const pos = await c.ev(`[...document.querySelectorAll('.kr-col')].map((x) => [Math.round(x.getBoundingClientRect().top), Math.round(x.getBoundingClientRect().left)])`);
      check(mobile ? 'phone: columns stacked' : 'desktop: columns side by side', mobile ? pos[1][0] > pos[0][0] && pos[1][1] === pos[0][1] : pos[1][0] === pos[0][0] && pos[1][1] > pos[0][1], JSON.stringify(pos));
      check(`no sideways scrolling${tag}`, await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
      // every control in the KPI Review bar is fully inside the window (a clipped one wouldn't make the page scroll)
      const clipped = await c.ev(`[...document.querySelectorAll('.kr-bar label, .kr-bar .seg')].filter((x) => x.getBoundingClientRect().right > window.innerWidth + 1).map((x) => x.textContent.trim().slice(0, 20)).join(', ')`);
      check(`month and employee pickers fully visible${tag}`, !clipped, clipped);
      if (label === 'desktop') {
        // the coaching form (kpi ref.png): the four parts, in order, in each reviewer's section; five action rows to start
        const parts = await c.ev(`[...document.querySelectorAll('.kr-col')].map((x) => [...x.querySelectorAll('.kr-bar2')].map((b) => b.textContent.trim().toLowerCase()).join('/')).join(' | ')`);
        check('both sections use the coaching-form layout', parts === 'performance achievements / gaps/action plan/commitment date/acknowledgment | performance achievements / gaps/action plan/commitment date/acknowledgment' || /^performance achievements \/ gaps\/action plan\/commitment date\/acknowledgment \| /.test(parts), parts);
        check('five action plan rows, each with a commitment date', (await c.ev(`document.querySelectorAll('.kr-col')[0].querySelectorAll('input[data-f="text"]').length`)) === 5 && (await c.ev(`document.querySelectorAll('.kr-col')[0].querySelectorAll('input[type="date"][data-f="date"]').length`)) === 5);
        check('acknowledgment part shows the employee and the reviewer slots', /Employee \(Lara\)/.test(await c.ev(`document.querySelector('.kr-col .kr-ack').textContent`)) && /Toby \(reviewer's own record\)/.test(await c.ev(`document.querySelector('.kr-col .kr-ack').textContent`)));
        await type('achievements', SECRET);
        await act(0, 'text', 'Toby feedback for Lara'); await act(0, 'date', '2026-11-30'); await act(1, 'text', 'Second action, no date yet');
        await c.ev(`document.querySelector('[data-act="krsave"]').click()`);
        await until(`/aved by Toby/.test(document.querySelector('.kr-col').textContent)`);
        check('Toby\'s save shows success', /Review saved/.test(await c.ev(`document.querySelector('#toast').textContent`)));
        // a save that the server refuses shows an error and keeps the text
        await type('achievements', ''); await act(0, 'text', ''); await act(0, 'date', ''); await act(1, 'text', '');
        await c.ev(`document.querySelector('[data-act="krsave"]').click()`);
        check('empty save shows an error', /can't be left empty/.test(await c.ev(`document.querySelector('.kr-col .src-err').textContent`)));
        await c.ev(`document.querySelector('[data-act="krreload"]') ; location.reload()`);
        await until(`!!document.querySelector('[data-ch="kremp"]')`); await c.ev('window.confirm = () => true');
        await pickLara(); await until(`!!document.querySelector('.kr-col textarea')`);
        check('Toby\'s review persists after reload (achievements, actions with dates)', (await c.ev(`document.querySelector('textarea[data-k="achievements"]').value`)) === SECRET
          && (await c.ev(`[...document.querySelectorAll('.kr-col')[0].querySelectorAll('input[data-in="kraction"]')].slice(0, 4).map((i) => i.value).join('|')`)) === 'Toby feedback for Lara|2026-11-30|Second action, no date yet|');
        // creating a snapshot with unsaved text asks to save first (the snapshot would reload the review and drop it)
        await type('achievements', SECRET + ' (edited, not saved)');
        await c.ev(`document.querySelector('[data-act="krsnap"]').click()`);
        check('snapshot with unsaved text: asks to save first, keeps the text', /Save your review first/.test(await c.ev(`document.querySelector('#toast').textContent`))
          && (await c.ev(`document.querySelector('textarea[data-k="achievements"]').value`)) === SECRET + ' (edited, not saved)' && !(await c.ev(`!!document.querySelector('.kr-banner.snap')`)));
        await type('achievements', SECRET); await c.ev(`document.querySelector('[data-act="krsave"]').click()`); await sleep(800);
        await c.ev(`document.querySelector('[data-act="krdiscussed"]').click()`);
        await until(`/Reviewer recorded discussion/.test(document.querySelector('.kr-col').textContent)`);
        check('reviewer discussion record shown separately from employee acknowledgment', /Not acknowledged by Lara yet/.test(await c.ev(`document.body.textContent`)));
        await shot('1-toby-lara-desktop');

        // Jonjo: sees Toby's text read-only, writes his own
        await signIn(ACCOUNTS[1][0]); await go('kpireview'); await until(`!!document.querySelector('[data-ch="kremp"]')`); await pickLara();
        await until(`document.querySelectorAll('.kr-col').length === 2 && !!document.querySelectorAll('.kr-col')[1].querySelector('textarea')`);
        check('Jonjo reads Toby\'s review, edits only his own', (await c.ev(`document.querySelectorAll('.kr-col')[0].textContent`)).includes(SECRET) && !(await c.ev(`!!document.querySelectorAll('.kr-col')[0].querySelector('textarea')`)));
        await type('achievements', 'Jonjo feedback for Lara'); await c.ev(`document.querySelector('[data-act="krsave"]').click()`);
        await until(`/aved by Jonjo/.test(document.querySelectorAll('.kr-col')[1].textContent)`);
        check('Jonjo\'s save leaves Toby\'s column unchanged', (await c.ev(`document.querySelectorAll('.kr-col')[0].textContent`)).includes(SECRET));
        check('each section shows who last saved it and when', /Last saved by Toby \(test reviewer\) · .*Manila/.test(await c.ev(`document.querySelectorAll('.kr-col')[0].querySelector('.kr-saved').textContent`)) && /Last saved by Jonjo/.test(await c.ev(`document.querySelectorAll('.kr-col')[1].querySelector('.kr-saved').textContent`)));
        // a VA with no Team & Access member yet (Bea): reviewable, in two different months
        const pickVa = (re) => c.ev(`(() => { const s = document.querySelector('[data-ch="kremp"]'); s.value = [...s.options].find((o) => ${re}.test(o.text)).value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        for (const idx of [0, 1]) {
          await c.ev(`(() => { const s = document.querySelector('[data-ch="krperiod"]'); s.selectedIndex = ${idx}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
          await pickVa('/^Bea/'); await until(`document.querySelectorAll('.kr-col').length === 2 && !!document.querySelectorAll('.kr-col')[1].querySelector('textarea') && /Bea/.test(document.querySelector('.kr-emp h3').textContent)`);
          await type('achievements', 'Jonjo coaching Bea m' + idx); await act(0, 'text', 'Jonjo action Bea m' + idx);
          await c.ev(`document.querySelector('[data-act="krsave"]').click()`);
          await until(`/Last saved by Jonjo/.test(document.querySelectorAll('.kr-col')[1].querySelector('.kr-saved').textContent)`);
        }
        check('Jonjo saves for a VA not yet on Team & Access, in two months', true);

        // the Blackhouse account (a Manager): no KPI Review in the UI, nothing private in the page, direct API calls refused
        await signIn(ACCOUNTS[2][0]);
        check('Blackhouse: no KPI Review or acknowledgment screen in the menu', !/kpireview|kpiack/.test(await navs()), await navs());
        await c.ev(`localStorage.setItem('bh_preview_prefs_v1', JSON.stringify({ view: 'kpireview' })); location.reload()`);
        await until(`!!document.querySelector('[data-act="nav"]')`, 20000); await sleep(500);
        check('Blackhouse: a remembered KPI Review page falls back, nothing private shown', !/KPI Review/.test(await c.ev(`document.querySelector('.ptitle').textContent`)) && !(await html()).includes(SECRET), await c.ev(`document.querySelector('.ptitle').textContent`));
        const direct = await c.ev(`(async () => { const ids = await (await fetch('/api/kpi-review/employees')).status; const s = await fetch('/api/kpi-review/snapshots'); return ids + ',' + s.status; })()`);
        check('Blackhouse: direct API requests from the browser are refused (403)', direct === '403,403', direct);
        check('Blackhouse: the rest of the app still works', /leads/.test(await navs()) && /team/.test(await navs()), await navs());
        // Team & Access still saves members: KPI Review screens are not module settings
        await go('team'); await until(`!!document.querySelector('[data-act="user"][data-v="ana.va@example.com"]')`);
        await c.ev(`document.querySelector('[data-act="user"][data-v="ana.va@example.com"]').click()`);
        await until(`!!document.querySelector('#modalForm [data-mod]')`);
        const mods = await c.ev(`[...document.querySelectorAll('#modalForm [data-mod]')].map((s) => s.dataset.mod).join(',')`);
        check('Team & Access: no KPI Review module settings in the member form', !/kpireview|kpiack/.test(mods), mods);
        await c.ev(`(() => { document.querySelector('#modalForm [data-mod="pages"]').value = 'view'; document.querySelector('#modalForm').requestSubmit(); })()`);
        await until(`!document.querySelector('#modal').classList.contains('open')`);
        check('Team & Access: saving a member (Project Pages view) works', /Project Pages \(view\)/.test(await c.ev(`document.querySelector('#view').textContent`)), await c.ev(`document.querySelector('#toast').textContent`));

        // Lara: only the acknowledgment screen, without the review text; she confirms the discussion
        await signIn(ACCOUNTS[3][0]);
        check('Lara: Review acknowledgment only, no KPI Review', /kpiack/.test(await navs()) && !/kpireview/.test(await navs()), await navs());
        await go('kpiack'); await until(`!!document.querySelector('[data-act="krack"]')`);
        check('Lara: the page has no coaching or feedback', !(await html()).includes(SECRET) && !/Jonjo feedback/.test(await html()));
        check('Lara: acknowledgment says it is not agreement', /not that you agree/.test(await c.ev('document.body.textContent')));
        await c.ev(`document.querySelector('[data-act="krack"]').click()`);
        check('Lara: acknowledging needs the tick first', /Tick/.test(await c.ev(`document.querySelector('#toast').textContent`)));
        await c.ev(`(() => { const k = document.querySelector('[data-ch="krackck"]'); k.checked = true; k.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await c.ev(`document.querySelector('[data-act="krack"]').click()`);
        await until(`/You confirmed/.test(document.querySelector('#view').textContent)`);
        check('Lara: acknowledgment saved', true);
        await shot('2-lara-acknowledgment-desktop');

        // Toby: sees Lara's acknowledgment; creates the snapshot; views it read-only
        await signIn(ACCOUNTS[0][0]); await go('kpireview'); await until(`!!document.querySelector('[data-ch="kremp"]')`); await pickLara();
        await until(`/Lara<\\/b> confirmed/.test(document.querySelector('#view').innerHTML)`);
        check('Toby sees Lara\'s own acknowledgment', true);
        await pickVa('/^Bea/'); await until(`/Bea/.test(document.querySelector('.kr-emp h3').textContent) && document.querySelectorAll('.kr-col').length === 2`);
        check('Toby reads Jonjo\'s section for Bea, read-only; his own is empty and editable',
          /Jonjo coaching Bea m0/.test(await c.ev(`document.querySelectorAll('.kr-col')[1].textContent`)) && !(await c.ev(`!!document.querySelectorAll('.kr-col')[1].querySelector('textarea')`))
          && (await c.ev(`document.querySelectorAll('.kr-col')[0].querySelector('textarea[data-k="achievements"]').value`)) === ''
          && /Jonjo action Bea m0/.test(await c.ev(`document.querySelectorAll('.kr-col')[1].querySelector('.kr-plan').textContent`)));
        await pickVa('/^Lara/'); await until(`/Lara/.test(document.querySelector('.kr-emp h3').textContent)`);
        await c.ev(`document.querySelector('[data-act="krsnap"]').click()`);
        await until(`/Snapshot saved/.test(document.querySelector('#toast').textContent)`);
        await until(`!!document.querySelector('[data-act="krmode"][data-v="snap"].btn')`);
        await c.ev(`document.querySelector('.kr-bar [data-act="krmode"][data-v="snap"]').click()`);
        await until(`!!document.querySelector('.kr-banner.snap')`);
        const snap = await c.ev(`document.querySelector('#view').textContent`);
        check('snapshot view is labelled read-only and keeps names, comments, reviewers, acknowledgment', /Saved snapshot/.test(snap) && /Read-only/.test(snap) && snap.includes(SECRET) && /Jonjo feedback for Lara/.test(snap) && /Employee acknowledged discussion: Lara/.test(snap));
        check('snapshot view has no edit controls', !(await c.ev(`!!document.querySelector('#view textarea')`)));
        await shot('3-snapshot-desktop');
        await c.ev(`document.querySelector('.kr-bar [data-act="krmode"][data-v="live"]').click()`);
        await until(`/Saved on/.test(document.querySelector('#view').textContent)`);
        check('a second snapshot for the month is not offered', !(await c.ev(`!!document.querySelector('[data-act="krsnap"]')`)));
        // empty state: a month with no snapshot
        await c.ev(`(() => { const s = document.querySelector('[data-ch="krperiod"]'); s.selectedIndex = 3; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await c.ev(`document.querySelector('.kr-bar [data-act="krmode"][data-v="snap"]').click()`);
        await until(`/No snapshot for/.test(document.querySelector('#view').textContent)`);
        check('month with no snapshot shows an empty state', true);
      } else {
        await shot('4-toby-lara-phone');
        await c.ev(`document.querySelector('.kr-bar [data-act="krmode"][data-v="snap"]').click()`);
        await until(`!!document.querySelector('.kr-banner.snap')`);
        check('phone: snapshot readable without sideways scrolling, action plan and dates side by side', (await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1')) && (await c.ev(`(() => { const c = document.querySelector('.kr-plan .kr-cell:nth-of-type(2)') || document.querySelector('.kr-plan .kr-bar2:nth-of-type(2)'); const a = document.querySelector('.kr-plan .kr-bar2'); return !!c && a.getBoundingClientRect().top === document.querySelectorAll('.kr-plan .kr-bar2')[1].getBoundingClientRect().top; })()`)));
        check('phone: snapshot readable without sideways scrolling (page)', await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
        await shot('5-snapshot-phone');
        await signIn(ACCOUNTS[3][0]); await go('kpiack', true); await until(`/You confirmed/.test(document.querySelector('#view').textContent)`);
        check('phone: Lara\'s acknowledgment screen fits', await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
        await shot('6-lara-phone');
      }
    }
    c.close();
  } catch (err) { check('run completed', false, err.message); }
  finally { br.kill(); srv.close(); }
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots in ${OUT}`);
  if (!serve) { fake.close(); process.exit(failed ? 1 : 0); }
  // a fresh portal for reviewing by hand: new empty database, the same fictional accounts and fake Monday board
  const mongoose = require('mongoose'); await mongoose.disconnect();
  const r = await portal(fakeBase, serve);
  console.log(`\nLocal review portal (test data only): ${r.base}/`);
  console.log(`Sign in with any of these fictional accounts, password: ${PW}`);
  ACCOUNTS.forEach(([e, n, role]) => console.log(`  ${e.padEnd(30)} ${n} · ${role}`));
  console.log('Fake Monday.com board, throwaway in-memory MongoDB (lost when this stops). Ctrl+C to stop.');
})();
