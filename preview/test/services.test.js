'use strict';
// Service Requests end to end with an in-memory MongoDB, the fake Monday board, a fake respond.io (records every
// request with its body) and a fake AI service. Nothing real is read, sent or written.
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { User, ServiceRequest, ServiceSend } = require('../src/models');
const { hashPassword } = require('../src/auth');
const SH = require('../public/shared');
const fx = require('./fixtures/fake-integrations');
const { createFakeAi } = require('./fixtures/fake-google-ai');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];
// a client of Ana's who replied to a movers offer (fake chat 555007)
fx.BOARDS['1111111'].items.push({ id: '9401', name: 'BH-S1', group: 'ALL CLIENTS', v: { cn: 'Sofia Reyes', va1: 'Ana', inq: 'Rent', cs: 'Qualified', city: 'Makati', rid: '555007', ph: '+63 917 555 0199' } });
// everything that identifies this client (synthetic): none of it may reach the AI service, and none may come back
const SECRETS = ['Sofia', 'Reyes', '0917', '555 0199', '5550199', 'sofia.reyes', '@example.com', '12B', 'photos.example.com', '555007'];

let fake, ai, mem, server, base, onServer, onBase;
const cookies = {};
async function call(b, method, url, { body, cookie } = {}) {
  const res = await fetch(b + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, data };
}
async function login(who, b = base) {
  const k = who + b; if (cookies[k]) return cookies[k];
  const r = await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: who + '@example.com', password: PW }) });
  assert.strictEqual(r.status, 200, 'login ' + who); return (cookies[k] = r.headers.get('set-cookie').split(';')[0]);
}
const posts = () => fx.calls.respond.filter((c) => c.method !== 'GET');

test.before(async () => {
  fake = fx.createFakeServer(); await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  ai = createFakeAi(); await new Promise((r) => ai.listen(0, '127.0.0.1', r));
  mem = await MongoMemoryServer.create();
  const f = `http://127.0.0.1:${fake.address().port}`;
  const env = { APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_svc'), PORT: '0', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333',
    MONDAY_API_URL: f + '/monday', RESPOND_TOKEN: 'rtest', RESPOND_API_URL: f + '/respond', ANTHROPIC_API_KEY: 'sk-ant-fake', ANTHROPIC_BASE_URL: `http://127.0.0.1:${ai.address().port}` };
  ({ server } = await start(env, ARGV)); base = `http://127.0.0.1:${server.address().port}`;
  // the same database, with RESPOND_SENDS=on (only this test server; the fake respond.io answers)
  const app2 = createApp(loadConfig({ ...env, RESPOND_SENDS: 'on' }, ARGV)); onServer = await new Promise((r) => { const s = app2.listen(0, '127.0.0.1', () => r(s)); }); onBase = `http://127.0.0.1:${onServer.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Jonjo Boss', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Agent', role: 'VA', vaLabel: 'Ana', modules: { services: 'edit', leads: 'view' }, passwordHash },
    { email: 'bea@example.com', name: 'Bea Agent', role: 'VA', vaLabel: 'Bea', modules: { services: 'edit', leads: 'view' }, passwordHash },
    { email: 'viewer@example.com', name: 'Viewer', role: 'VA', vaLabel: 'Ana', modules: { services: 'view' }, passwordHash }]);
});
test.after(async () => { server.close(); onServer.close(); fake.close(); ai.close(); server.closeAllConnections(); onServer.closeAllConnections(); await mongoose.disconnect(); await mem.stop(); });

test('board and setup state; "Check replies" finds the offer, reads the chat (GET only) and AI marks interest without contact details', async () => {
  const boss = await login('boss');
  const b0 = (await call(base, 'GET', '/api/services?source=monday', { cookie: boss })).data;
  assert.deepStrictEqual([b0.rows.length, b0.setup.ai, b0.setup.respondRead, b0.setup.supplierSends, b0.stages.length], [0, true, true, false, 9]);
  // a movers offer, logged from Renewals → Message (the original's rn_ log)
  assert.strictEqual((await call(base, 'POST', '/api/leads/monday/9401/renewal-log', { cookie: boss, body: { kind: 'movers' } })).status, 201);
  const before = fx.calls.respond.length;
  const scan = (await call(base, 'POST', '/api/services/scan', { cookie: boss, body: { source: 'monday' } })).data;
  assert.deepStrictEqual([scan.scanned, scan.remaining, scan.aiMissing], [1, 0, false]);
  assert.ok(fx.calls.respond.slice(before).every((c) => c.method === 'GET'), 'reading replies never writes to respond.io');
  assert.ok(fx.calls.respond.slice(before).some((c) => c.path === '/contact/id:555007/message/list?limit=50'));
  const req = ai.calls[ai.calls.length - 1].body;
  assert.strictEqual(req.model, 'claude-haiku-5-5');
  assert.strictEqual(req.output_config.format.type, 'json_schema');
  assert.match(req.system, /NEVER include the client's name, phone number/);
  assert.match(req.messages[0].content, /CLIENT: Yes please, this is \[client\]\. I move out next Saturday from \[unit\], 2 bedrooms of furniture/);
  // the exact request that went to the (fake) AI service carries none of the client's identifiers
  const sentToAi = JSON.stringify(req);
  for (const s of SECRETS) assert.ok(!sentToAi.toLowerCase().includes(s.toLowerCase()), 'sent to the AI: ' + s);
  const rows = (await call(base, 'GET', '/api/services?source=monday', { cookie: boss })).data.rows;
  assert.strictEqual(rows.length, 1);
  const r = rows[0];
  assert.deepStrictEqual([r.ref, r.svc, r.interest, r.stage, r.name], ['SR-9401-MOV', 'movers', 'interested', 'New', 'Sofia Reyes']);
  assert.ok(!/0917|@example\.com/.test(JSON.stringify([r.summary, r.details])), 'phone numbers and emails from the AI are removed');
  // an AI answer that names the client and repeats their details: checked again before it is saved or shown
  ai.serviceAnswer = () => ({ services: [{ service: 'movers', interest: 'interested', summary: 'Sofia Reyes in Unit 12B needs movers, ring 0917-555-0199',
    details: { date: 'Saturday', area: '', from: 'Unit 12B', to: '', unit: '12B', items: '', issue: '', budget: '', notes: 'email sofia.reyes@example.com' } }] });
  assert.strictEqual((await call(base, 'POST', '/api/services/scan', { cookie: boss, body: { source: 'monday', force: true } })).data.scanned, 1);
  const r2 = (await call(base, 'GET', '/api/services?source=monday', { cookie: boss })).data.rows[0];
  const shown = JSON.stringify([r2.summary, r2.details]);
  for (const s of SECRETS) assert.ok(!shown.toLowerCase().includes(s.toLowerCase()), 'saved / shown: ' + s);
  assert.strictEqual(r2.interest, 'interested');
  ai.serviceAnswer = null;
  // read again within 3 hours: skipped unless forced (as the original)
  assert.strictEqual((await call(base, 'POST', '/api/services/scan', { cookie: boss, body: { source: 'monday' } })).data.scanned, 0);
  assert.strictEqual((await call(base, 'POST', '/api/services/scan', { cookie: boss, body: { source: 'monday', force: true } })).data.scanned, 1);
  assert.strictEqual(await ServiceRequest.countDocuments(), 1, 'one request per client and service');
  // an offer from the Apps Script's own history (imported rn_ log) is found too: Hot Client (555006) got a cleaning offer
  const { UpsellLegacy } = require('../src/models');
  await UpsellLegacy.create({ source: 'monday', leadId: '9006', kind: 'cleaners', action: 'renewal', at: new Date(Date.now() - 3 * 3600e3) });
  assert.strictEqual((await call(base, 'POST', '/api/services/scan', { cookie: boss, body: { source: 'monday' } })).data.scanned, 1);
  assert.ok((await call(base, 'GET', '/api/services?source=monday', { cookie: boss })).data.rows.some((x) => x.leadId === '9006' && x.svc === 'cleaners'));
  // the import script reads rn_ (renewal messages) as well as up_
  const { parseExport } = require('../scripts/import-legacy-upsell');
  assert.deepStrictEqual(parseExport({ rn_9006: JSON.stringify([{ t: Date.now() - 864e5, k: 'cleaners', by: 'Ana' }]) }).offers.map((o) => [o.leadId, o.kind, o.action]), [['9006', 'cleaners', 'renewal']]);
});

test('redaction rules: names (any case, in parts), emails, phones, links, units and IDs are replaced; leaks are detected', () => {
  const c = { name: 'María Dela Cruz', email: 'maria.dc@example.com', phone: '0917 123 4567', contactId: '8765432' };
  const out = SH.redactForAi('Hi, MARÍA here (dela cruz). Unit 7C / #1203, rm 5. Call 09171234567 or +63 (917) 123-4567, maria.dc@example.com, www.example.com/x, ID 8765432', c);
  for (const s of ['MARÍA', 'María', 'dela', 'cruz', '7C', '1203', '1234567', '4567', 'maria.dc', 'example.com', '8765432']) assert.ok(!out.toLowerCase().includes(s.toLowerCase()), s + ' → ' + out);
  assert.match(out, /\[client\]/); assert.match(out, /\[unit\]/); assert.match(out, /\[phone\]|\[id\]/);
  assert.strictEqual(SH.redactForAi('Needs movers on Saturday, 2 bedrooms, budget ₱8,000', c), 'Needs movers on Saturday, 2 bedrooms, budget ₱8,000', 'ordinary text is kept');
  assert.ok(SH.leaksClient('for Maria', c) && SH.leaksClient('call 0917 123 4567', c) && SH.leaksClient('x@y.com', c) && !SH.leaksClient('Needs movers Saturday', c));
});

test('visibility and permissions: a VA sees only their clients; view access can\'t scan or change; only Managers edit suppliers', async () => {
  const ana = await login('ana'), bea = await login('bea'), viewer = await login('viewer');
  assert.deepStrictEqual((await call(base, 'GET', '/api/services?source=monday', { cookie: ana })).data.rows.map((x) => x.leadId).sort(), ['9006', '9401']);
  assert.strictEqual((await call(base, 'GET', '/api/services?source=monday', { cookie: bea })).data.rows.length, 0, 'Bea\'s board has no Ana clients');
  assert.strictEqual((await call(base, 'POST', '/api/services/scan', { cookie: viewer, body: { source: 'monday' } })).status, 403);
  const id = (await call(base, 'GET', '/api/services?source=monday', { cookie: ana })).data.rows.find((x) => x.leadId === '9401').id;
  assert.strictEqual((await call(base, 'PATCH', '/api/services/' + id, { cookie: viewer, body: { stage: 'Quoted', version: 1 } })).status, 403);
  assert.strictEqual((await call(base, 'PATCH', '/api/services/' + id, { cookie: bea, body: { stage: 'Quoted', version: 1 } })).status, 404, 'not Bea\'s client');
  assert.strictEqual((await call(base, 'PUT', '/api/services/suppliers', { cookie: ana, body: { suppliers: [] } })).status, 403);
  assert.strictEqual((await call(base, 'GET', '/api/services?source=monday')).status, 401);
});

test('suppliers, stages with history, and "Mark as sent" after WhatsApp / Viber / email from the member\'s device', async () => {
  const boss = await login('boss');
  assert.match((await call(base, 'PUT', '/api/services/suppliers', { cookie: boss, body: { suppliers: [{ svc: 'movers', name: 'Fake Movers', channel: 'respond', contact: '' }] } })).data.error, /respond\.io contact ID/);
  const saved = (await call(base, 'PUT', '/api/services/suppliers', { cookie: boss, body: { suppliers: [
    { svc: 'movers', name: 'Fake Movers Co', channel: 'whatsapp', contact: '+63 917 000 0001', notes: 'test only' },
    { svc: 'movers', name: 'Fake Movers RIO', channel: 'respond', contact: '', respondId: '888001' },
    { svc: 'cleaners', name: 'Fake Cleaners', channel: 'email', contact: 'cleaners@example.com' }, { svc: 'movers', name: '   ' }] } })).data.suppliers;
  assert.deepStrictEqual(saved.map((s) => s.name).sort(), ['Fake Cleaners', 'Fake Movers Co', 'Fake Movers RIO'], 'blank rows dropped');
  let r = (await call(base, 'GET', '/api/services?source=monday', { cookie: boss })).data.rows.find((x) => x.leadId === '9401');
  const p = await call(base, 'PATCH', '/api/services/' + r.id, { cookie: boss, body: { stage: 'Quoted', notes: 'Quote ₱9,000 (test)', version: r.version } });
  assert.strictEqual(p.status, 200); assert.strictEqual(p.data.row.stage, 'Quoted');
  assert.strictEqual((await call(base, 'PATCH', '/api/services/' + r.id, { cookie: boss, body: { stage: 'Booked', version: r.version } })).status, 409, 'stale version');
  assert.strictEqual((await call(base, 'PATCH', '/api/services/' + r.id, { cookie: boss, body: { stage: 'Teleported', version: p.data.row.version } })).status, 400);
  const cleaners = saved.find((s) => s.svc === 'cleaners'), movers = saved.find((s) => s.name === 'Fake Movers Co');
  assert.strictEqual((await call(base, 'POST', `/api/services/${r.id}/mark-sent`, { cookie: boss, body: { supplierId: cleaners.id } })).status, 400, 'a supplier of another service');
  const m = (await call(base, 'POST', `/api/services/${r.id}/mark-sent`, { cookie: boss, body: { supplierId: movers.id } })).data.row;
  assert.deepStrictEqual([m.stage, m.supplier, !!m.sentToSupplierAt], ['Sent to supplier', 'Fake Movers Co', true]);
  assert.ok(m.history.some((h) => /Sent to Fake Movers Co/.test(h.what)) && m.history.some((h) => h.stage === 'Quoted'));
  // the supplier text never has the client's name or number (Index.html svSupplierText)
  r = (await call(base, 'GET', '/api/services?source=monday', { cookie: boss })).data.rows.find((x) => x.leadId === '9401');
  const text = SH.serviceSupplierText(r);
  assert.match(text, /^Hi! New Movers request from Blackhouse — ref SR-9401-MOV/);
  assert.ok(!/Sofia|Reyes|555007/.test(text));
});

test('respond.io supplier send: off unless RESPOND_SENDS=on; confirmed, name-checked, recorded before sending', async () => {
  const boss = await login('boss'), bossOn = await login('boss', onBase);
  const d = (await call(base, 'GET', '/api/services?source=monday', { cookie: boss })).data, r = d.rows.find((x) => x.leadId === '9401'), rio = d.suppliers.find((s) => s.respondId);
  const text = 'Hi! New Movers request from Blackhouse — ref ' + r.ref;
  const before = posts().length;
  const off = await call(base, 'POST', `/api/services/${r.id}/send`, { cookie: boss, body: { supplierId: rio.id, text, confirm: true } });
  assert.strictEqual(off.status, 409); assert.match(off.data.error, /RESPOND_SENDS/);
  assert.strictEqual(posts().length, before, 'nothing reached respond.io with sends off');
  assert.strictEqual(await ServiceSend.countDocuments(), 0);
  // on the sends-on test server
  assert.strictEqual((await call(onBase, 'POST', `/api/services/${r.id}/send`, { cookie: bossOn, body: { supplierId: rio.id, text } })).status, 400, 'needs confirmation');
  assert.match((await call(onBase, 'POST', `/api/services/${r.id}/send`, { cookie: bossOn, body: { supplierId: rio.id, text: text + ' for Sofia', confirm: true } })).data.error, /client's name/);
  assert.strictEqual(posts().length, before);
  const ok = await call(onBase, 'POST', `/api/services/${r.id}/send`, { cookie: bossOn, body: { supplierId: rio.id, text, confirm: true } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
  const sent = posts().slice(before);
  assert.deepStrictEqual(sent.map((c) => [c.path, c.body]), [['/contact/id:888001/message', { message: { type: 'text', text } }]]);
  assert.deepStrictEqual((await ServiceSend.find().lean()).map((x) => [x.status, x.supplierName]), [['sent', 'Fake Movers RIO']]);
  assert.strictEqual(ok.data.row.supplier, 'Fake Movers RIO');
});
