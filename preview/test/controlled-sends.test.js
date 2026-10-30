'use strict';
// A controlled live test, rehearsed with fakes: RESPOND_SEND_ONLY_TO limits every respond.io send and tag to the named
// test contacts (Upselling, supplier requests, LOI links), and only a Manager can send meanwhile. Also "Message Lead" /
// "Call on respond.io": the right lead's conversation link, for leads the member can see, with plain reasons otherwise.
// Fictional data; every respond.io request goes to a local fake and is recorded; nothing real is contacted.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { User, UpsellSend, Supplier, ServiceRequest, ServiceSend } = require('../src/models');
const { hashPassword } = require('../src/auth');
const fx = require('./fixtures/fake-integrations');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];
const L = fx.BOARDS['1111111'];
// fictional leads: a mistyped Respond ID (two numbers in one cell), and a Bea lead with a valid one
L.items.push({ id: '9701', name: 'BH-C1', group: 'ALL CLIENTS', v: { cn: 'Two Ids Tess', va1: 'Ana', inq: 'Rent', cs: 'Qualified', rid: '555701 / 555702', ph: '+63 917 555 0170' } },
  { id: '9702', name: 'BH-C2', group: 'ALL CLIENTS', v: { cn: 'Bea Only Ben', va1: 'Bea', inq: 'Rent', cs: 'Qualified', rid: '555703' } });

const posts = [];
let fake, fakeBase, mem, server, base, noSpace;
const front = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    if (req.method === 'POST' && req.url.startsWith('/respond/')) { posts.push(req.url.slice(8)); res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"messageId":1}'); }
    const r = await fetch(fakeBase + req.url, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '' }, body: req.method === 'GET' ? undefined : body });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
  });
});
const cookies = {};
async function call(b, method, url, { body, cookie } = {}) {
  const res = await fetch(b + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text(); let data = null; try { data = JSON.parse(t); } catch (e) { /* not JSON */ }
  return { status: res.status, data };
}
async function login(who, b = base) {
  const k = who + b; if (cookies[k]) return cookies[k];
  const r = await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: who + '@example.com', password: PW }) });
  assert.strictEqual(r.status, 200); return (cookies[k] = r.headers.get('set-cookie').split(';')[0]);
}

test.before(async () => {
  fake = fx.createFakeServer(); await new Promise((r) => fake.listen(0, '127.0.0.1', r)); fakeBase = `http://127.0.0.1:${fake.address().port}`;
  await new Promise((r) => front.listen(0, '127.0.0.1', r)); const f = `http://127.0.0.1:${front.address().port}`;
  mem = await MongoMemoryServer.create();
  const env = { APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_ctl'), PORT: '0', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333',
    MONDAY_API_URL: f + '/monday', RESPOND_TOKEN: 'rtest', RESPOND_API_URL: f + '/respond', RESPOND_SPACE_ID: '424242', RESPOND_SENDS: 'on', RESPOND_SEND_ONLY_TO: '555001' };
  ({ server } = await start(env, ARGV)); base = `http://127.0.0.1:${server.address().port}`;
  const a2 = createApp(loadConfig({ ...env, RESPOND_SPACE_ID: 'https://app.respond.io/space/424242' }, ARGV));
  noSpace = await new Promise((r) => { const s = a2.listen(0, '127.0.0.1', () => r(s)); });
  const passwordHash = await hashPassword(PW);
  await User.create([{ email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Agent', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view', upsell: 'edit', services: 'edit' }, passwordHash }]);
});
test.after(async () => { [server, noSpace, fake, front].forEach((s) => { s.close(); if (s.closeAllConnections) s.closeAllConnections(); }); await mongoose.disconnect(); await mem.stop(); });

test('config: RESPOND_SEND_ONLY_TO takes up to 10 contact IDs', () => {
  const e = { APP_MODE: 'mongo', MONGODB_URI: 'mongodb://127.0.0.1:1/x' };
  assert.deepStrictEqual(loadConfig({ ...e, RESPOND_SEND_ONLY_TO: '555006, 555001' }, ARGV).integrations.respond.onlyTo, ['555006', '555001']);
  assert.deepStrictEqual(loadConfig(e, ARGV).integrations.respond.onlyTo, []);
  assert.throws(() => loadConfig({ ...e, RESPOND_SEND_ONLY_TO: 'all' }, ARGV), /RESPOND_SEND_ONLY_TO/);
});

test('controlled test: an Upselling batch holds only the test contact; only a Manager sends; nobody else is messaged', async () => {
  const boss = await login('boss');
  const c = (await call(base, 'POST', '/api/upsell/campaigns', { cookie: boss, body: { name: 'Controlled test', template: 'concierge' } })).data.campaign;
  // everyone on respond.io: the whole board, so only the RESPOND_SEND_ONLY_TO filter decides who is in the batch
  const put = await call(base, 'PUT', `/api/upsell/campaigns/${c._id || c.id}`, { cookie: boss, body: { audience: { preset: 'all', statuses: [], type: '', city: '', contact: 'respond', skipDays: 14 }, version: c.version } });
  assert.strictEqual(put.status, 200, JSON.stringify(put.data));
  const aud = (await call(base, 'GET', `/api/upsell/campaigns/${c._id || c.id}/audience`, { cookie: boss })).data;
  assert.ok(aud.counts.respond > 1, 'the audience has several clients on respond.io');
  assert.strictEqual(aud.testOnly, 1);
  assert.deepStrictEqual(aud.batches.message.ids, ['9001'], 'only the lead whose contact is 555001');
  const id = c._id || c.id;
  const ana = await login('ana');
  const vaTry = await call(base, 'POST', `/api/upsell/campaigns/${id}/send`, { cookie: ana, body: { confirm: true, hash: aud.batches.message.hash, action: 'message' } });
  assert.strictEqual(vaTry.status, 403); assert.match(vaTry.data.error, /only a Manager can send/);
  const ok = await call(base, 'POST', `/api/upsell/campaigns/${id}/send`, { cookie: boss, body: { confirm: true, hash: aud.batches.message.hash, action: 'message' } });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
  assert.deepStrictEqual(ok.data.results.map((x) => [x.id, x.status]), [['9001', 'sent']]);
  assert.deepStrictEqual(posts, ['/contact/id:555001/message']);
  assert.deepStrictEqual((await UpsellSend.find().lean()).map((x) => x.contactId), ['555001'], 'no record for anyone else');
});

test('controlled test: a supplier who isn\'t a test contact is refused before anything is recorded or sent', async () => {
  const boss = await login('boss'), n = posts.length;
  const sp = await Supplier.create({ svc: 'movers', name: 'Real Movers Co', channel: 'respond', contact: '', respondId: '777001' });
  const rq = await ServiceRequest.create({ source: 'monday', leadId: '9006', svc: 'movers', interest: 'interested', offeredAt: new Date() });
  const r = await call(base, 'POST', `/api/services/${rq._id}/send`, { cookie: boss, body: { supplierId: String(sp._id), text: 'Movers request, ref test', confirm: true } });
  assert.strictEqual(r.status, 409); assert.match(r.data.error, /RESPOND_SEND_ONLY_TO/);
  // during the controlled test only a Manager sends, on every respond.io path
  const va = await call(base, 'POST', `/api/services/${rq._id}/send`, { cookie: await login('ana'), body: { supplierId: String(sp._id), text: 'Movers request, ref test', confirm: true } });
  assert.strictEqual(va.status, 403); assert.match(va.data.error, /only a Manager can send/);
  assert.strictEqual(posts.length, n); assert.strictEqual(await ServiceSend.countDocuments(), 0);
});

test('Message Lead / Call on respond.io: the lead\'s own conversation, only for leads the member can see; plain reasons otherwise', async () => {
  const boss = await login('boss'), ana = await login('ana'), n = posts.length;
  const ok = await call(base, 'GET', '/api/respond/link/monday/9001', { cookie: ana });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(ok.data, { url: 'https://app.respond.io/space/424242/inbox/555001', name: 'Test Client One', tel: '+639005550001' });
  // a VA can't open another VA's lead (and gets no hint of its contact)
  const other = await call(base, 'GET', '/api/respond/link/monday/9702', { cookie: ana });
  assert.deepStrictEqual([other.status, other.data.error], [404, 'Lead not found.']);
  assert.strictEqual((await call(base, 'GET', '/api/respond/link/monday/9702', { cookie: boss })).data.url, 'https://app.respond.io/space/424242/inbox/555703');
  // two numbers in the Respond ID cell: refused, never merged into one made-up ID
  const bad = await call(base, 'GET', '/api/respond/link/monday/9701', { cookie: ana });
  assert.deepStrictEqual([bad.status, bad.data.problem, bad.data.tel], [422, 'badContact', '+639175550170']);
  assert.match(bad.data.error, /isn't a single number/);
  // no Respond ID at all; the server's space ID set wrongly
  const none = await call(base, 'GET', '/api/respond/link/monday/9004', { cookie: boss });
  assert.ok([404].includes(none.status));
  const nsBase = `http://127.0.0.1:${noSpace.address().port}`;
  const ns = await call(nsBase, 'GET', '/api/respond/link/monday/9001', { cookie: await login('boss', nsBase) });
  assert.strictEqual(ns.status, 409); assert.match(ns.data.error, /RESPOND_SPACE_ID on the server isn't a number/);
  assert.strictEqual((await call(base, 'GET', '/api/respond/link/monday/9001')).status, 401, 'signed out');
  assert.strictEqual(posts.length, n, 'nothing was sent to respond.io');
});
