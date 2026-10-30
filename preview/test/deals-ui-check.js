'use strict';
// Browser check of the lead deal tabs (LOI Client / Owner, Contract), Settings → Files, and the audit fixes (no
// fictional names with live data, load-error states that don't show zeros, the Calendar broker filter), at desktop and
// phone widths. MongoDB mode with a throwaway database, the local fake Monday.com and a made-up LOI template: nothing
// is sent, signed or written to a real service.
//   node test/deals-ui-check.js [outDir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User, Loi, ServiceRequest, DealFile } = require('../src/models');
const { fakeServiceAccount, createFakeGoogle } = require('./fixtures/fake-google-ai');
const { hashPassword } = require('../src/auth');
const docx = require('../src/docx');
const fx = require('./fixtures/fake-integrations');

const OUT = path.resolve(process.argv[2] || 'deals-ui-out');
fs.mkdirSync(OUT, { recursive: true });
const BROWSER = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
  .find((p) => fs.existsSync(p));
const PW = 'correct-horse-battery';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ymd = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

// a Calendar deal for Bea's client 9003: Contract Date 20 days ago, no Signed Contract file (the 5-day rule)
const CB = fx.BOARDS['3333333'];
CB.columns.push({ id: 'ccd', title: 'Contract Date', type: 'date', settings_str: '{}' }, { id: 'rr', title: 'Rental Rate', type: 'numbers', settings_str: '{}' },
  { id: 'sfc', title: 'Signed Contract', type: 'file', settings_str: '{}' });
CB.items.push({ id: '6501', name: 'Deal B', group: 'Deals', created: ymd(-30), v: { fs: ymd(-25), cl: { linked: ['9003'] }, b: 'Other', c: 'Pasig', tm: '10:00', sp: 'Gia Cruz', st: 'Waiting for payment', dl: ymd(-24), ccd: ymd(-20), rr: '55000' } });

// a made-up lease LOI (the team's real templates are never used in tests)
const P = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const ROW = (a, b) => `<w:tr><w:tc>${P(a)}</w:tc><w:tc>${b == null ? '<w:p/>' : P(b)}</w:tc></w:tr>`;
const TEMPLATE = docx.zip([{ name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>') }, { name: 'word/document.xml', data: Buffer.from(
  `<w:document xmlns:w="w"><w:body>${P('Date: _______________')}${P('To: _______________')}${P('RE: LETTER OF INTENT TO LEASE')}${P('Dear _______________:')}<w:tbl>${ROW('Lessor')}${ROW('Lessee')}${ROW('Monthly Rental')}${ROW("Broker's Commission", 'Equivalent to _____% (_____ percent)')}</w:tbl></w:body></w:document>`) }]);

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
  const mem = await MongoMemoryServer.create();
  // a fake Google Drive with the LOI and deal folders, for signed copies, PDFs and deal files (writer service account)
  const sa = fakeServiceAccount('portal-writer@blackhouse-demo.iam.gserviceaccount.com');
  const google = createFakeGoogle(sa, { LoiFolderAAAAAAAAAAA: { name: 'LOIs (fake)', mimeType: 'application/vnd.google-apps.folder' }, DealsFolderAAAAAAAAA: { name: 'Deals (fake)', mimeType: 'application/vnd.google-apps.folder' } });
  await new Promise((r) => google.listen(0, '127.0.0.1', r)); const g = `http://127.0.0.1:${google.address().port}`;
  const { server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_deals_ui'), PORT: '0', HOST: '127.0.0.1', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111',
    MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333', MONDAY_API_URL: `http://127.0.0.1:${fake.address().port}/monday`,
    GOOGLE_DRIVE_WRITER_SERVICE_ACCOUNT_JSON: sa.json, GOOGLE_DRIVE_API_URL: g + '/drive/v3', GOOGLE_DRIVE_UPLOAD_URL: g + '/upload/drive/v3', GOOGLE_DRIVE_TOKEN_URL: g + '/token',
    GOOGLE_DRIVE_LOI_FOLDER_ID: 'LoiFolderAAAAAAAAAAA', GOOGLE_DRIVE_DEALS_FOLDER_ID: 'DealsFolderAAAAAAAAA', LOI_SIGNING: 'on', LOI_PDF_CONVERTER: 'drive' }, ['node', 'server.js']);
  const base = `http://127.0.0.1:${server.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash }]);
  // the Manager uploads the made-up template (Settings → Files does the same request)
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'boss@example.com', password: PW }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const up = await fetch(base + '/api/loi/templates/lease', { method: 'POST', headers: { cookie, 'content-type': 'application/octet-stream', 'x-file-name': 'Made-up lease LOI.docx' }, body: TEMPLATE });
  if (up.status !== 201) throw new Error('template upload ' + up.status);
  // an open Asking for Availability record (the test database) for the VA Portal's "Asking owner"
  const ask = await fetch(base + '/api/leads/monday/9001/asking', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ listingId: '7001' }) });
  if (![200, 201].includes(ask.status)) throw new Error('asking ' + ask.status);
  // a service request found in a client's reply (as "Check replies" would store it; test data)
  await ServiceRequest.create({ source: 'monday', leadId: '9001', svc: 'movers', interest: 'interested', summary: 'Moving out next Saturday, 2 bedrooms', details: { date: 'next Saturday' }, offeredAt: new Date(), lastReply: new Date() });
  const pdfFile = path.join(OUT, 'made-up-contract.pdf'); fs.writeFileSync(pdfFile, '%PDF-1.4\n% a made-up signed contract\n%%EOF');

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bhdeal-'));
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
    const txt = (sel) => c.ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`);
    // failAt: API paths that answer 500 in this page (a service outage), to check the error states
    const signIn = async (failAt) => {
      await c.send('Network.clearBrowserCookies'); await c.send('Page.navigate', { url: base + '/' }); await sleep(300); await c.ev('localStorage.clear()'); await c.send('Page.navigate', { url: base + '/' });
      await until(`!!document.querySelector('#loginForm')`);
      if (failAt) await c.ev(`(() => { const f = window.fetch, re = new RegExp(${JSON.stringify(failAt)}); window.fetch = (u, o) => (re.test(String(u)) ? Promise.resolve(new Response(JSON.stringify({ error: 'Test outage' }), { status: 500, headers: { 'content-type': 'application/json' } })) : f(u, o)); })()`);
      await c.ev(`(() => { document.querySelector('#lEmail').value = 'boss@example.com'; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
      await until(`document.querySelectorAll('#list .row[data-id]').length >= 3`, 30000);
      await c.ev('window.confirm = () => true');
    };
    const nav = async (v, mobile) => { if (mobile) { await c.ev(`(() => { const b = document.querySelector('.nav-burger'); b && b.click(); })()`); await sleep(250); } await c.ev(`document.querySelector('[data-act="nav"][data-v="${v}"]').click()`); };
    const openTab = async (lead, tab) => {
      await c.ev(`document.querySelector('#list .row[data-id="${lead}"]').click()`); await until(`!!document.querySelector('#drawer [data-act="tab"][data-v="${tab}"]')`);
      await c.ev(`document.querySelector('#drawer [data-act="tab"][data-v="${tab}"]').click()`);
    };

    for (const [label, w, h, mobile] of [['desktop', 1440, 1000, false], ['phone', 390, 844, true]]) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
      const tag = mobile ? ' (phone)' : '';
      await signIn();
      // LOI (Client): pre-filled from the lead, the matched listing and the Calendar viewing; missing values empty
      await openTab('9001', 'loic');
      await until(`!!document.querySelector('#dbody input[data-k="TO_1"]') && !/Loading this client|Loading the Monday Calendar/.test(document.querySelector('#dbody').textContent)`);
      await until(`document.querySelector('#dbody input[data-k="TO_1"]').value !== ''`, 8000).catch(() => {});
      await shot('0-loi-client-loaded' + (mobile ? '-phone' : ''));
      const val = (k) => c.ev(`document.querySelector('#dbody input[data-k="${k}"]').value`);
      const got = { TO_1: await val('TO_1'), TO_2: await val('TO_2'), TO_3: await val('TO_3'), CLIENT: await val('CLIENT'), BROKER_SIGN: await val('BROKER_SIGN'), MONTHLY_RENT: await val('MONTHLY_RENT'), COMM_PCT: await val('COMM_PCT') };
      check(`LOI (Client): fields from the lead, listing and Calendar; commission left empty${tag}`, got.TO_1 === 'Owner A' && got.TO_2 === 'Fake Tower' && got.TO_3 === 'Makati' && got.CLIENT === 'Test Client One' && got.BROKER_SIGN === 'Ely Santos' && got.MONTHLY_RENT === '₱180,000' && got.COMM_PCT === '', JSON.stringify(got));
      check(`LOI (Client): what is still empty is listed${tag}`, /Still empty:.*Commission %/.test(await txt('#dbody')), (await txt('#dbody')).match(/Still empty:[^.]*/));
      // signing is set up on this test server (fake Drive, LOI_SIGNING=on): no setup box; sending starts only from a prepared LOI, after review
      check(`LOI (Client): signing set up (no setup box); the only send happens from a prepared LOI's own button${tag}`, !/isn't set up on this server yet/.test(await txt('#dbody')) && !(await c.ev(`[...document.querySelectorAll('#dbody button')].some((b) => /send/i.test(b.textContent) && !b.dataset.act.startsWith('loi'))`)), await c.ev(`[...document.querySelectorAll('#dbody button')].map((b) => b.textContent).join(' | ')`));
      check(`no sideways scrolling on the LOI tab${tag}`, await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1 && document.querySelector("#drawer").scrollWidth <= document.querySelector("#drawer").clientWidth + 1'));
      if (!mobile) {
        await c.ev(`(() => { const i = document.querySelector('#dbody input[data-k="COMM_PCT"]'); i.value = '3'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
        await c.ev(`document.querySelector('[data-act="loimake"]').click()`);
        await until(`/LOI made/.test(document.querySelector('#toast').textContent) && !!document.querySelector('[data-act="loidl"]')`);
        const made = await Loi.findOne().lean();
        check('Make the LOI document: saved for review with the reviewed values, nothing sent', made && made.status === 'draft' && made.fields.COMM_WORDS === 'Three' && made.fields.TO_1 === 'Owner A'
          && docx.docText(made.data.buffer ? Buffer.from(made.data.buffer) : made.data).some((t) => t.includes('Test Client One')), made && JSON.stringify(made.fields).slice(0, 120));
        await shot('1-loi-client-desktop');
        // LOI (Owner): the owner and the prepared LOIs; owner signing not offered
        await c.ev(`document.querySelector('#drawer [data-act="tab"][data-v="loio"]').click()`); await until(`!!document.querySelector('#dbody [data-act="loidl"]')`);
        check('LOI (Owner): owner from the listing, the prepared LOI listed; the owner is sent it only after the client signs', /Owner on the listing: Owner A/.test(await txt('#dbody')) && !(await c.ev(`!!document.querySelector('#dbody [data-act="loisend"][data-role="owner"]')`)));
        await c.ev(`document.querySelector('#drawer [data-act="close"]').click()`); await sleep(200);
        // Contract for Bea's client: Calendar dates, file columns and the 5-day rule
        await openTab('9003', 'contract'); await until(`/Signed Contract file/.test(document.querySelector('#dbody').textContent)`).catch(() => {});
        const ct = await txt('#dbody');
        check('Contract: Calendar dates and amounts, Signed Contract file "no", 5-day rule warning', /Signed Contract file\s*no/.test(ct) && /Rental rate \/ price\s*₱55k/.test(ct) && /Contract Date was 20 days ago and no Signed Contract/.test(ct), ct.slice(ct.indexOf('From the Monday Calendar board')).replace(/\s+/g, ' '));
        check('Contract: not generated, and says why (no template in the original; details the portal lacks)', /not generated by the portal/.test(ct) && /addresses/.test(ct));
        await shot('2-contract-desktop');
        await c.ev(`document.querySelector('#drawer [data-act="close"]').click()`); await sleep(200);
        // Settings → Files: the uploaded template, the others not uploaded
        await nav('team'); await c.ev(`document.querySelector('[data-act="settab"][data-v="files"]').click()`); await until(`/Made-up lease LOI/.test(document.querySelector('#view').textContent)`);
        check('Settings → Files: lease template uploaded, the sale ones not', /Deed of Absolute Sale\s*not uploaded/.test(await txt('#view')));
        // no fictional names with live data: Source filter and Leads Report "By source"
        await nav('leads'); await sleep(300);
        const srcOpts = await c.ev(`[...document.querySelector('select[data-ch="from"]').options].map((o) => o.text).join(' | ')`);
        check('Source filter: only the board\'s own sources', !/Walk-in|Referral|Website/.test(srcOpts), srcOpts);
        await nav('ldash'); await until(`/By source/.test(document.querySelector('#view').textContent)`);
        check('Leads Report "By source": no fictional sources', !/Walk-in|Referral/.test(await txt('#view')));
        // Calendar broker filter: dropped when it no longer matches a broker (here after switching to MongoDB and back)
        await nav('calendar'); await until(`!!document.querySelector('select[data-ch="calbroker"]')`);
        await c.ev(`(() => { const s = document.querySelector('select[data-ch="calbroker"]'); s.value = 'Gia Cruz'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await c.ev(`document.querySelector('[data-act="source"][data-v="mongo"]').click()`); await sleep(800);
        await c.ev(`document.querySelector('[data-act="source"][data-v="monday"]').click()`); await until(`!!document.querySelector('select[data-ch="calbroker"]')`); await sleep(800);
        check('Calendar: a broker filter that no longer applies is cleared (select and viewings agree)', (await c.ev(`document.querySelector('select[data-ch="calbroker"]').value`)) === '');
        // VA Portal: the Apps Script's task groups the portal has data for, plus its own two
        await nav('vaportal'); await until(`/Asking owner/.test(document.querySelector('#view').textContent) && /Fake Tower/.test(document.querySelector('#view table').textContent)`);
        const cards = await c.ev(`[...document.querySelectorAll('#view .card .l')].map((x) => x.textContent).join(' | ')`);
        check('VA Portal: all the Apps Script groups the portal has, plus Reply and Send more units', cards === 'Reply to client | Asking owner | Approval · not sent | Approval · sent | For Scheduling | Confirm schedule | Confirmed viewing | Mark as done | Record result | Send more units', cards);
        const vrows = await c.ev(`[...document.querySelectorAll('#view tbody tr')].map((r) => r.children[0].textContent + ':' + r.children[3].textContent).join(', ')`);
        check('VA Portal: the asked unit and the confirmed viewing are listed; the failed client is left out', /BH-T1:Asking owner/.test(vrows) && /BH-T1:(Confirmed viewing|Mark as done)/.test(vrows) && !/BH-T5/.test(vrows), vrows);
        await shot('3a-va-portal-desktop');
        // For Client Approval → For Scheduling on lead 9001: owner confirms, sent to the client, client wants to view
        await nav('leads'); await openTab('9001', 'asking'); await until(`!!document.querySelector('#dbody [data-act="askstatus"][data-v="available"]')`);
        await c.ev(`document.querySelector('#dbody [data-act="askstatus"][data-v="available"]').click()`); await sleep(500);
        await c.ev(`document.querySelector('#drawer [data-act="tab"][data-v="approval"]').click()`); await until(`!!document.querySelector('#dbody [data-act="apprsent"]')`);
        check('For Client Approval: the owner-confirmed unit, not sent yet, with the copy-message buttons', /Not sent to the client yet/.test(await txt('#dbody')) && !!(await c.ev(`!!document.querySelector('#dbody [data-act="apprcopy"]')`)));
        await c.ev(`document.querySelector('#dbody [data-act="apprsent"]').click()`); await until(`!!document.querySelector('#dbody [data-act="apprsched"]')`);
        check('Mark as sent → "For Scheduling →" offered', /Sent to the client/.test(await txt('#dbody')));
        await c.ev(`document.querySelector('#dbody [data-act="apprsched"]').click()`); await until(`/No owner-confirmed units waiting/.test(document.querySelector('#dbody').textContent)`);
        await c.ev(`document.querySelector('#drawer [data-act="tab"][data-v="viewings"]').click()`); await until(`/The client wants to view/.test(document.querySelector('#dbody').textContent)`);
        check('For Scheduling: the unit the client wants to view, to book (Monday: on the Calendar board)', /Schedule it on the Monday Calendar board|Book viewing/.test(await txt('#dbody')));
        await shot('3b-for-scheduling-desktop');
        await c.ev(`document.querySelector('#drawer [data-act="close"]').click()`); await sleep(200);
        // Service Requests: the request, a supplier added by the Manager, "Mark as sent"
        await nav('services'); await until(`/SR-9001-MOV/.test(document.querySelector('#view').textContent)`);
        check('Service Requests: the client\'s request with its interest, summary and setup notes', /Interested/.test(await txt('#view')) && /Moving out next Saturday/.test(await txt('#view')) && /ANTHROPIC_API_KEY/.test(await txt('#view')));
        await c.ev(`document.querySelector('[data-act="svsup"]').click()`); await until(`!!document.querySelector('[data-act="supadd"]')`);
        await c.ev(`document.querySelector('[data-act="supadd"]').click()`); await sleep(200);
        await c.ev(`(() => { const set = (k, v) => { const i = document.querySelector('[data-sup="0|' + k + '"]'); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); }; set('name', 'Fake Movers Co'); set('contact', '+63 917 000 0001'); })()`);
        await c.ev(`document.querySelector('[data-act="supsave"]').click()`); await until(`/Suppliers saved/.test(document.querySelector('#toast').textContent)`);
        await c.ev(`document.querySelector('[data-act="svsend"]').click()`); await until(`!!document.querySelector('#svTxt')`);
        const supText = await c.ev(`document.querySelector('#svTxt').value`);
        check('send dialog: the anonymised request text (no client name), WhatsApp to open, "Mark as sent"', /^Hi! New Movers request from Blackhouse — ref SR-9001-MOV/.test(supText) && !/Test Client/.test(supText) && /Open WhatsApp/.test(await txt('#modal')), supText.slice(0, 80));
        await c.ev(`document.querySelector('[data-act="svmark"]').click()`); await until(`/Marked as sent to Fake Movers Co/.test(document.querySelector('#toast').textContent)`);
        check('Mark as sent: stage "Sent to supplier", supplier shown', (await c.ev(`document.querySelector('[data-ch="svstage"]').value`)) === 'Sent to supplier' && /Fake Movers Co/.test(await txt('#view')));
        await shot('3c-service-requests-desktop');
        // deal files: the signed contract with the lease term, uploaded on the Contract tab of lead 9003 (fake Drive)
        await nav('leads'); await openTab('9003', 'contract'); await until(`!!document.querySelector('#dbody [data-ch="dfup"][data-slot="contract"]')`);
        await c.ev(`(() => { document.querySelector('#dfStart-contract').value = '2026-11-01'; document.querySelector('#dfMonths-contract').value = '12'; })()`);
        const docNode = await c.send('DOM.getDocument', { depth: 1 });
        const inp = await c.send('DOM.querySelector', { nodeId: docNode.result.root.nodeId, selector: '#dbody [data-ch="dfup"][data-slot="contract"]' });
        await c.send('DOM.setFileInputFiles', { nodeId: inp.result.nodeId, files: [pdfFile] });
        await until(`/Saved to Google Drive/.test(document.querySelector('#toast').textContent)`);
        await until(`/Lease Nov 1, 2026/.test(document.querySelector('#dbody').textContent) || /Lease 2026-11-01/.test(document.querySelector('#dbody').textContent) || /\\(12 months\\)/.test(document.querySelector('#dbody').textContent)`);
        const rec = await DealFile.findOne({ leadId: '9003' }).lean();
        check('Contract tab: upload saved to the deals folder (fake Drive) with the lease term; shown with the renewal date', rec && rec.slots.contract && rec.term.end === '2027-10-31' && google.uploads.some((u) => u.parent === 'DealsFolderAAAAAAAAA'), rec && JSON.stringify(rec.term));
        await shot('3d-contract-files-desktop');
        await c.ev(`document.querySelector('#drawer [data-act="close"]').click()`); await sleep(200);
        // LOI e-signature: send (copy the link), open the signing page, draw, sign; the LOI shows "Signed by the client"
        await openTab('9001', 'loic'); await until(`!!document.querySelector('#dbody [data-act="loisend"][data-role="client"]:not([disabled])')`);
        await c.ev(`document.querySelector('#dbody [data-act="loisend"][data-role="client"]').click()`); await until(`!!document.querySelector('#lsOk')`);
        await c.ev(`(() => { document.querySelector('#lsOk').checked = true; document.querySelector('[data-act="loisendgo"]').click(); })()`);
        await until(`!!document.querySelector('#lsDone')`);
        const msg = await c.ev(`document.querySelector('#lsDone').value`), signPath = (msg.match(/\/sign\/[A-Za-z0-9_-]{43}/) || [])[0];
        check('Send for e-signature: the message with a one-use link, shown once', !!signPath && /^Hi Test! Here is your Letter of Intent/.test(msg), msg.slice(0, 90));
        await c.send('Page.navigate', { url: base + signPath }); await until(`!!document.querySelector('#pad')`);
        await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await sleep(300);
        check('signing page fits a phone (no sideways scrolling)', await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
        await shot('3e-signing-page-phone');
        await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await sleep(300);
        const rect = await c.ev(`(() => { const r = document.querySelector('#pad').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect[0] + 20, y: rect[1] + rect[3] / 2, button: 'left', clickCount: 1 });
        for (let i = 1; i <= 12; i++) await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect[0] + 20 + i * 25, y: rect[1] + rect[3] / 2 + (i % 2 ? 15 : -15), button: 'left' });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect[0] + 320, y: rect[1] + rect[3] / 2, button: 'left', clickCount: 1 });
        await c.ev(`document.querySelector('#agree').checked = true`);
        await c.ev(`document.querySelector('#go').click()`); await until(`/Signed\\./.test(document.body.textContent)`, 30000);
        const signed = await Loi.findOne({ status: 'clientSigned' }).lean();
        check('the client signed on the page: signed copy and PDF in the fake Drive, the deal\'s client LOI slot filled', !!signed && google.uploads.some((u) => /SIGNED by client\.pdf$/.test(u.name)) && !!(await DealFile.findOne({ leadId: '9001', 'slots.clientLoi.src': 'esign' }).lean()));
        await shot('3f-signed-desktop');
        await c.send('Page.navigate', { url: base + signPath }); await until(`/already been signed/.test(document.body.textContent)`);
        check('the same link again: already signed (one use)', true);
        // error states: the Renewals message log, P&L cost lines and Daily Report notes failing to load
        await signIn('/api/(renewals/log|pl/cells|daily/notes)');
        await nav('renewals'); await until(`/renewal message log could not be loaded/.test(document.querySelector('#view').textContent)`);
        check('Renewals: a failed message log is shown, "Messaged" is unknown, not 0%', /Test outage/.test(await txt('#view')) && !/\b0%\s*Messaged/.test(await txt('#view')));
        await nav('pl'); await until(`/cost lines could not be loaded/.test(document.querySelector('#view').textContent)`);
        check('P&L: failed cost lines are reported; Net Income is not shown as if costs were ₱0', !(await c.ev(`[...document.querySelectorAll('#view table.pl td')].some((t) => /Net Income|Gross Margin/.test(t.textContent))`)) && /cost lines could not be loaded/.test(await txt('#view')));
        await nav('daily'); await until(`/could not be loaded/.test(document.querySelector('#view').textContent)`);
        check('Daily Report: failed notes are reported and can\'t be edited (Clear can\'t wipe them)', await c.ev(`[...document.querySelectorAll('#view textarea')].every((t) => t.disabled)`));
        await shot('3-error-states-desktop');
      } else {
        await shot('4-loi-client-phone');
        await c.ev(`document.querySelector('#drawer [data-act="tab"][data-v="contract"]').click()`); await sleep(500);
        check('phone: Contract tab fits', await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
      }
    }
    c.close();
  } catch (err) { check('run completed', false, err.message); }
  finally {
    br.kill(); server.close(); fake.close(); google.close(); await mongoose.disconnect(); await mem.stop();
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots in ${OUT}`);
    process.exit(failed ? 1 : 0);
  }
})();
