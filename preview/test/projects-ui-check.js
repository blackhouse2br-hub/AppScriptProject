'use strict';
// Browser check of Project Pages at desktop and phone widths: a throwaway MongoDB, fake Google Drive and a fake AI
// service (fictional data; nothing real is contacted, no inquiry is sent).   node test/projects-ui-check.js [outDir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User } = require('../src/models');
const { hashPassword } = require('../src/auth');
const { fakeServiceAccount, createFakeGoogle, createFakeAi, PNG, PDF } = require('./fixtures/fake-google-ai');

const OUT = path.resolve(process.argv[2] || 'pp-ui-out');
fs.mkdirSync(OUT, { recursive: true });
const BROWSER = ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p));
const PW = 'correct-horse-battery', sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const sa = fakeServiceAccount(), g = createFakeGoogle(sa), ai = createFakeAi();
  await new Promise((r) => g.listen(0, '127.0.0.1', r)); await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  const gb = `http://127.0.0.1:${g.address().port}`;
  const mem = await MongoMemoryServer.create();
  const { server } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_pp_ui'), PORT: '0', HOST: '127.0.0.1', GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: sa.json,
    GOOGLE_DRIVE_TOKEN_URL: gb + '/token', GOOGLE_DRIVE_API_URL: gb + '/drive/v3', ANTHROPIC_API_KEY: 'sk-ant-fake', ANTHROPIC_BASE_URL: `http://127.0.0.1:${ai.address().port}` }, ['node', 'server.js']);
  const base = `http://127.0.0.1:${server.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash },
    { email: 'viewer@example.com', name: 'Viewer', role: 'VA', vaLabel: 'Ana', modules: { pages: 'view' }, passwordHash }]);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'bhpp-')), dport = 9300 + Math.floor(Math.random() * 500);
  const br = spawn(BROWSER, ['--headless=new', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${dport}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  const results = [];
  const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail != null && detail !== '' ? ' — ' + detail : '')); };
  try {
    let tabs; for (let i = 0; i < 50 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${dport}/json`)).json(); } catch (e) { await sleep(200); } }
    const c = await cdp(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await c.send('Page.enable'); await c.send('Runtime.enable');
    const until = async (expr, ms = 20000) => { const t = Date.now(); for (;;) { if (await c.ev(`(() => { try { return !!(${expr}); } catch (e) { return false; } })()`)) return true; if (Date.now() - t > ms) throw new Error('timed out waiting for: ' + expr); await sleep(120); } };
    const shot = async (name) => { const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };
    const click = (sel) => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('missing ${sel.replace(/'/g, '')}'); e.click(); return true; })()`);
    const typeIn = (sel, v) => c.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    const text = () => c.ev('document.querySelector("#view").textContent');
    const signIn = async (email) => {
      await c.send('Network.clearBrowserCookies'); await c.send('Page.navigate', { url: base + '/' }); await sleep(300); await c.ev('localStorage.clear()'); await c.send('Page.navigate', { url: base + '/' });
      await until(`!!document.querySelector('#loginForm')`);
      await c.ev(`(() => { document.querySelector('#lEmail').value = ${JSON.stringify(email)}; document.querySelector('#lPass').value = ${JSON.stringify(PW)}; document.querySelector('#loginForm').requestSubmit(); })()`);
      await until(`!!document.querySelector('[data-act="nav"]')`); await c.ev('window.confirm = () => true');
    };
    const go = async (v, mobile) => { if (mobile) { await c.ev(`(() => { const b = document.querySelector('.nav-burger'); b && b.click(); })()`); await sleep(250); } await click(`[data-act="nav"][data-v="${v}"]`); };
    const drive0 = g.calls.length;

    // ---- desktop: add, edit, save, reload; upload; units; preview; publish ----
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await signIn('boss@example.com'); await go('pages');
    await until(`/No projects yet/.test(document.querySelector('#view').textContent)`);
    check('empty state', true);
    for (const [name, dev] of [['Demo Bay Residences', 'Demo Developer Inc.'], ['Sample Heights', 'Sample Land'], ['Garden Court', 'Demo Developer Inc.']]) {
      await click('[data-act="ppnew"]'); await until(`!!document.querySelector('#ppnName')`);
      await c.ev(`(() => { document.querySelector('#ppnName').value = ${JSON.stringify(name)}; document.querySelector('#ppnDev').value = ${JSON.stringify(dev)}; document.querySelector('#ppnLoc').value = 'Pasay'; document.querySelector('#modalForm').requestSubmit(); })()`);
      await until(`!!document.querySelector('[data-pp="name"]') && document.querySelector('[data-pp="name"]').value === ${JSON.stringify(name)}`);
    }
    const groups = await c.ev(`[...document.querySelectorAll('.pp-list h4')].map((h) => h.textContent).join(' | ')`);
    check('projects grouped by developer', groups === 'Demo Developer Inc. | Sample Land', groups);
    await typeIn('[data-in="ppq"]', 'sample'); await sleep(400);
    const found = await c.ev(`[...document.querySelectorAll('.pp-item b')].map((b) => b.textContent).join(',')`);
    check('search narrows the list', found === 'Sample Heights', found);
    await typeIn('[data-in="ppq"]', ''); await sleep(400);
    await click('.pp-item[data-act="ppopen"]'); await until(`document.querySelector('[data-pp="name"]') && document.querySelector('[data-pp="name"]').value === 'Demo Bay Residences'`);
    await typeIn('[data-pp="tagline"]', 'Manual tagline'); await typeIn('[data-pp="highlights"]', 'Bay views\nWalk to the mall');
    await typeIn('[data-pp="video"]', 'https://youtu.be/dQw4w9WgXcQ'); await typeIn('[data-pp="turnover"]', '2028');
    await click('[data-act="ppsave"]'); await until(`/Project saved/.test(document.querySelector('#toast').textContent)`);
    await c.send('Page.reload'); await until(`!!document.querySelector('[data-act="nav"]')`); await c.ev('window.confirm = () => true');
    await until(`!!document.querySelector('.pp-item')`); await click('.pp-item'); await until(`document.querySelector('[data-pp="tagline"]') && document.querySelector('[data-pp="tagline"]').value === 'Manual tagline'`);
    check('details save and reload', (await c.ev(`document.querySelector('[data-pp="highlights"]').value`)) === 'Bay views\nWalk to the mall' && (await c.ev(`document.querySelector('[data-pp="turnover"]').value`)) === '2028');
    // a bad link is caught before saving
    await typeIn('[data-pp="video"]', 'https://vimeo.com/1'); await click('[data-act="ppsave"]');
    check('invalid YouTube link shows an error', /YouTube video link/.test(await c.ev(`(document.querySelector('.pp-main .src-err') || {}).textContent || ''`)));
    await typeIn('[data-pp="video"]', 'https://youtu.be/dQw4w9WgXcQ');
    // uploads through the file input (a real File from bytes), one refused
    const b64 = (b) => b.toString('base64');
    await c.ev(`(() => { const dt = new DataTransfer(); const f = (b, n, t) => new File([Uint8Array.from(atob(b), (ch) => ch.charCodeAt(0))], n, { type: t });
      dt.items.add(f(${JSON.stringify(b64(PNG(5)))}, 'Pool deck.png', 'image/png')); dt.items.add(f(${JSON.stringify(b64(PDF))}, 'Price list brochure.pdf', 'application/pdf'));
      dt.items.add(f(${JSON.stringify(b64(Buffer.from('<svg onload=alert(1)>')))}, 'evil.png', 'image/png'));
      const i = document.querySelector('[data-ch="ppfiles"]'); i.files = dt.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await until(`/uploaded/.test(document.querySelector('#toast').textContent)`);
    const toastUp = await c.ev(`document.querySelector('#toast').textContent`);
    check('uploads: images and PDFs added, an unsafe file refused', /2 files uploaded/.test(toastUp) && /evil\.png/.test(toastUp), toastUp);
    await until(`document.querySelectorAll('.pp-m').length === 2`);
    const kinds = await c.ev(`[...document.querySelectorAll('.pp-m select[data-k="kind"]')].map((s) => s.value).join(',')`);
    check('media kinds from the file names (photo, brochure)', kinds === 'photo,brochure', kinds);
    const imgOk = await c.ev(`(async () => { const i = document.querySelector('.pp-m img'); await (i.decode ? i.decode().catch(() => {}) : 0); return (await fetch(i.src)).headers.get('content-type'); })()`);
    check('uploaded image is served back', imgOk === 'image/png', imgOk);
    await click('[data-act="ppaddunit"]'); await typeIn('[data-ppu="0"][data-k="type"]', '2BR'); await typeIn('[data-ppu="0"][data-k="sizeSqm"]', '80');
    await c.ev(`(() => { const s = document.querySelector('[data-ppu="0"][data-k="media"]'); s.value = s.options[1].value; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await click('[data-act="ppcover"]');
    await click('[data-act="ppsave"]'); await until(`/Project saved/.test(document.querySelector('#toast').textContent)`);
    check('unit with a photo and a cover saved', (await c.ev(`document.querySelector('[data-ppu="0"][data-k="type"]').value`)) === '2BR' && /Cover ✓/.test(await text()));
    // preview (signed in), then publish and open the public page
    const pv = await c.ev(`(async () => { const r = await fetch(document.querySelector('a[href*="/preview"]').href); return r.status + ' ' + (await r.text()).includes('Manual tagline'); })()`);
    check('preview opens the page', pv === '200 true', pv);
    await click('[data-act="pppublish"]'); await until(`/Published page:/.test(document.querySelector('#view').textContent)`);
    const link = await c.ev(`document.querySelector('[data-act="ppcopylink"]').dataset.v`);
    await c.send('Page.navigate', { url: link }); await until(`!!document.querySelector('.bhp .hero h1')`);
    check('published page loads by its link', /Demo Bay Residences/.test(await c.ev('document.title')) && !document_has_form_placeholder(await c.ev('document.body.innerHTML')), link);
    check('no inquiry form until the form endpoint is set', /inquiries for this project aren't open yet/.test(await c.ev('document.body.textContent')));
    check('public page has no sideways scroll at desktop', await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
    await shot('1-public-page-desktop');
    await c.send('Page.navigate', { url: base + '/' }); await until(`!!document.querySelector('[data-act="nav"]')`); await c.ev('window.confirm = () => true');
    await go('pages'); await until(`!!document.querySelector('[data-ch="pphook"]')`);
    await typeIn('[data-ch="pphook"]', 'https://evil.example/exec'); await sleep(300);
    check('form endpoint: only the Apps Script /exec link is accepted', /must be the Apps Script/.test(await c.ev(`document.querySelector('#toast').textContent`)));
    await typeIn('[data-ch="pphook"]', 'https://script.google.com/macros/s/AKfycbxDEMOreviewONLY/exec'); await until(`/Form endpoint saved/.test(document.querySelector('#toast').textContent)`);
    const pub = await c.ev(`(async () => (await fetch(${JSON.stringify(link)})).text())()`);
    check('with the endpoint, the page has the inquiry form (posting to that endpoint)', /<form/.test(pub) && pub.includes('data-hook="https://script.google.com/macros/s/AKfycbxDEMOreviewONLY/exec"'));
    check('core editing made no Google Drive requests', g.calls.length === drive0, g.calls.length - drive0);

    // ---- Build from Google Drive: review panel, empty fields ticked, typed fields only offered ----
    await click('.pp-item'); await until(`!!document.querySelector('[data-act="ppbuild"]')`);
    await typeIn('[data-pp="driveLink"]', 'https://drive.google.com/drive/folders/DemoFolderAAAAAAAA');
    await click('[data-act="ppbuild"]'); await until(`!!document.querySelector('.pp-review')`, 30000);
    const rows = await c.ev(`[...document.querySelectorAll('.pp-review tbody tr')].map((r) => r.children[1].textContent.trim().split(' ')[0] + '=' + r.querySelector('input').checked).join(',')`);
    check('review: empty fields ticked, the typed tagline only offered', /description=true/.test(rows) && /tagline=false/.test(rows) && !/turnover/.test(rows), rows);
    check('Drive media added (photos, floor plan, brochure)', (await c.ev(`document.querySelectorAll('.pp-m').length`)) === 6);
    await click('[data-act="ppapplyprop"]');
    check('applied values fill the form, unsaved', /Unsaved changes/.test(await text()) && (await c.ev(`document.querySelector('[data-pp="tagline"]').value`)) === 'Manual tagline' && /fictional project/.test(await c.ev(`document.querySelector('[data-pp="description"]').value`)));
    await click('[data-act="ppsave"]'); await until(`/Project saved/.test(document.querySelector('#toast').textContent)`);
    await shot('2-editor-desktop');
    check('Drive was only read', g.calls.every((x) => x.method === 'GET' || x.path === '/token'));

    // ---- a viewer: read only ----
    await signIn('viewer@example.com'); await go('pages'); await until(`!!document.querySelector('.pp-item')`); await click('.pp-item'); await until(`!!document.querySelector('[data-pp="name"]')`);
    check('viewer: fields disabled, no Save / upload / publish', await c.ev(`document.querySelector('[data-pp="name"]').disabled && !document.querySelector('[data-act="ppsave"]') && !document.querySelector('[data-ch="ppfiles"]') && !document.querySelector('[data-act="pppublish"]')`));

    // ---- phone ----
    await c.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await signIn('boss@example.com'); await go('pages', true); await until(`!!document.querySelector('.pp-item')`); await click('.pp-item'); await until(`!!document.querySelector('[data-pp="name"]')`);
    check('phone: editor without sideways scrolling', await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
    const stacked = await c.ev(`(() => { const a = document.querySelector('.pp-side').getBoundingClientRect(), b = document.querySelector('.pp-main').getBoundingClientRect(); return b.top >= a.bottom - 1; })()`);
    check('phone: list above the editor', stacked);
    await shot('3-editor-phone');
    await c.send('Page.navigate', { url: link }); await until(`!!document.querySelector('.bhp form')`);
    check('phone: public page fits, form one column', await c.ev('document.documentElement.scrollWidth <= window.innerWidth + 1'));
    // client-side checks only (nothing is sent: the endpoint is a fictional Apps Script link)
    await c.ev(`(() => { window.fetch = () => { window.__sent = true; return Promise.resolve(); }; document.querySelector('.bhp [name=name]').value = 'Test'; document.querySelector('.bhp form').requestSubmit(); })()`);
    check('form asks for an email or phone first (nothing sent)', /email or phone/.test(await c.ev(`document.querySelector('.bhp .msg').textContent`)) && !(await c.ev('!!window.__sent')));
    await shot('4-public-page-phone');
    c.close();
  } catch (err) { check('run completed', false, err.message); }
  finally {
    br.kill(); server.close(); g.close(); ai.close(); await mongoose.disconnect(); await mem.stop();
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots in ${OUT}`);
    process.exit(failed ? 1 : 0);
  }
})();
function document_has_form_placeholder(html) { return /<form/.test(html); }
