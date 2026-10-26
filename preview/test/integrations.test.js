'use strict';
// Read-only Monday.com / respond.io layer, tested against a local fake API server (no real service is contacted).
const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { User, Lead } = require('../src/models');
const { hashPassword } = require('../src/auth');
const { assertReadOnly, money, time24 } = require('../src/integrations/monday');
const { SAFE_PATH, shapeMessage } = require('../src/integrations/respondio');

const PW = 'correct-horse-battery';
const ARGV = ['node', 'server.js'];

const { createFakeServer, calls } = require('./fixtures/fake-integrations');
const fake = createFakeServer();

// ---------- app instances ----------
let mem, main, base, fakeBase, extra = [];
const envFor = (over) => ({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_integ'), PORT: '0',
  MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: '1111111', MONDAY_LISTINGS_BOARD_ID: '2222222', MONDAY_CALENDAR_BOARD_ID: '3333333',
  MONDAY_API_URL: fakeBase + '/monday', RESPOND_TOKEN: 'rtest', RESPOND_API_URL: fakeBase + '/respond', RESPOND_SPACE_ID: '12345', ...over });
async function instance(over) {
  const app = createApp(loadConfig(envFor(over), ARGV));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  extra.push(srv);
  return `http://127.0.0.1:${srv.address().port}`;
}
async function call(b, method, url, cookie) {
  const res = await fetch(b + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}) }, body: method !== 'GET' ? '{}' : undefined });
  let data = null; try { data = await res.json(); } catch (e) { /* not JSON */ }
  return { status: res.status, data };
}
async function login(b, email, password = PW) {
  const res = await fetch(b + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.strictEqual(res.status, 200);
  return res.headers.get('set-cookie').split(';')[0];
}

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeBase = `http://127.0.0.1:${fake.address().port}`;
  mem = await MongoMemoryServer.create();
  ({ server: main } = await start(envFor({}), ARGV));
  base = `http://127.0.0.1:${main.address().port}`;
  const passwordHash = await hashPassword(PW);
  await User.create([
    { email: 'boss@example.com', name: 'Test Manager', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Test', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit', calendar: 'edit' }, passwordHash },
  ]);
});
test.after(async () => { main.close(); extra.forEach((s) => s.close()); fake.close(); await mongoose.disconnect(); await mem.stop(); });

test('config: integrations only in mongo mode; API base URL overrides only for local mocks', () => {
  const demo = loadConfig({ MONDAY_TOKEN: 'x', RESPOND_TOKEN: 'y' }, ARGV);
  assert.strictEqual(demo.integrations, null);
  assert.deepStrictEqual(demo.ignoredIntegrationVars, ['MONDAY_TOKEN', 'RESPOND_TOKEN']);
  assert.throws(() => loadConfig(envFor({ MONDAY_API_URL: 'https://evil.example/v2' }), ARGV), /local mock server/);
  assert.throws(() => loadConfig(envFor({ MONDAY_LEADS_BOARD_ID: 'abc' }), ARGV), /digits only/);
  const real = loadConfig({ APP_MODE: 'mongo', MONGODB_URI: 'mongodb://h/db', MONDAY_TOKEN: 't' }, ARGV);
  assert.strictEqual(real.integrations.monday.apiUrl, 'https://api.monday.com/v2');
  assert.strictEqual(real.integrations.respond.apiUrl, 'https://api.respond.io/v2');
});

test('read-only guards: no Monday mutations, respond.io GET allowlist only', () => {
  assert.throws(() => assertReadOnly('mutation { create_item(board_id: 1, item_name: "x") { id } }'), /only read queries/);
  assert.throws(() => assertReadOnly('query { a } mutation { b }'), /only read queries/);
  assert.doesNotThrow(() => assertReadOnly('query ($b: [ID!]) { boards(ids: $b) { id } }'));
  assert.ok(SAFE_PATH.test('/contact/id:123'));
  assert.ok(SAFE_PATH.test('/contact/id:123/message/list?limit=100&cursorId=99'));
  for (const p of ['/message/sendMessage', '/contact/id:123/message', '/contact/create_or_update/phone:1', '/contact/id:1/tag']) assert.ok(!SAFE_PATH.test(p), p);
  assert.strictEqual(money('₱200k - 250k'), 250000); assert.strictEqual(money('25M'), 25000000); assert.strictEqual(time24('2:30 PM'), '14:30');
  assert.strictEqual(shapeMessage({ messageId: 1, traffic: 'incoming', message: { type: 'text', text: 'hi' } }).from, 'client');
});

test('status: configured but unchecked, then connected after a read', async () => {
  const cookie = await login(base, 'boss@example.com');
  let s = (await call(base, 'GET', '/api/integrations/status', cookie)).data;
  assert.strictEqual(s.readOnly, true);
  assert.strictEqual(s.monday.state, 'not_checked'); assert.strictEqual(s.respond.state, 'not_checked');
  assert.deepStrictEqual(s.monday.boards, { leads: true, listings: true, calendar: true });
  assert.ok(!JSON.stringify(s).includes('mtest') && !JSON.stringify(s).includes('rtest'));   // tokens never reach the browser
  const t = (await call(base, 'POST', '/api/integrations/monday/test', cookie)).data;
  assert.strictEqual(t.user, 'Fake Token User'); assert.strictEqual(t.boards.leads.found, true);
  s = (await call(base, 'GET', '/api/integrations/status', cookie)).data;
  assert.strictEqual(s.monday.state, 'ok');
});

test('Monday leads/listings/viewings: mapped by column title, hidden groups skipped, paged, read-only', async () => {
  const cookie = await login(base, 'boss@example.com');
  calls.monday.length = 0;
  const r = await call(base, 'GET', '/api/monday/bootstrap', cookie);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.data.errors, {});
  assert.deepStrictEqual(r.data.leads.map((l) => l.code).sort(), ['BH-T1', 'BH-T3', 'BH-T5', 'BH-T6']);   // Archive group + "For Validation" hidden
  const t1 = r.data.leads.find((l) => l.code === 'BH-T1');
  assert.strictEqual(t1.name, 'Test Client One'); assert.strictEqual(t1.va, 'Ana'); assert.strictEqual(t1.inquiry, 'Rent');
  assert.strictEqual(t1.budget, 250000); assert.strictEqual(t1.ai, 'Scheduling'); assert.strictEqual(t1.contactId, '555001'); assert.strictEqual(t1.moveIn, '2026-12-01');
  assert.strictEqual(r.data.leads.find((l) => l.code === 'BH-T3').inquiry, 'Buy');
  assert.deepStrictEqual(r.data.listings.map((x) => x.building).sort(), ['Fake Tower', 'Svg Tower']);   // Archive group (Old Tower) skipped
  assert.strictEqual(r.data.listings[0].price, 180000);
  const v1 = r.data.viewings.find((v) => v.id === '6001');
  assert.deepStrictEqual([v1.leadId, v1.date, v1.time, v1.status, v1.building], ['9001', '2026-11-02', '14:30', 'Confirmed', 'Fake Tower']);
  assert.ok(calls.monday.length > 0);
  assert.ok(calls.monday.every((c) => c.method === 'POST' && /^\s*query\b/.test(c.body.query) && !/mutation/i.test(c.body.query)));
  assert.ok(calls.monday.every((c) => c.auth === 'mtest'));
  assert.ok(calls.monday.some((c) => /next_items_page/.test(c.body.query)));               // pagination followed
  assert.strictEqual((await call(base, 'PATCH', '/api/monday/leads/9001', cookie)).status, 404); // no write routes exist
  assert.strictEqual(await Lead.countDocuments(), 0);                                       // nothing copied into MongoDB
});

test('Monday data follows the same visibility rules (VA sees own leads only)', async () => {
  const cookie = await login(base, 'ana@example.com');
  const r = (await call(base, 'GET', '/api/monday/bootstrap', cookie)).data;
  assert.deepStrictEqual(r.leads.map((l) => l.code).sort(), ['BH-T1', 'BH-T6']);
  assert.ok(r.viewings.every((v) => ['9001', '9006'].includes(v.leadId)));
  assert.strictEqual((await call(base, 'GET', '/api/monday/leads/9003/notes', cookie)).status, 404);
  const n = await call(base, 'GET', '/api/monday/leads/9001/notes', cookie);
  assert.strictEqual(n.status, 200); assert.strictEqual(n.data.notes[0].text, 'Monday update text');
  assert.strictEqual((await call(base, 'POST', '/api/integrations/monday/test', cookie)).status, 403);
});

test('respond.io chat: GET only, contact ID taken from a visible lead, 404 is not a connection failure', async () => {
  const boss = await login(base, 'boss@example.com'), ana = await login(base, 'ana@example.com');
  calls.respond.length = 0;
  const r = await call(base, 'GET', '/api/respond/chat/monday/9001', ana);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.data.messages.map((m) => m.from), ['client', 'va']);            // oldest first
  assert.strictEqual(r.data.contact.name, 'Fake Contact');
  assert.strictEqual(r.data.openUrl, 'https://app.respond.io/space/12345/inbox/555001');
  assert.ok(calls.respond.every((c) => c.method === 'GET' && c.auth === 'Bearer rtest'));
  assert.strictEqual((await call(base, 'GET', '/api/respond/chat/monday/9003', ana)).status, 404); // not Ana's lead
  const nf = await call(base, 'GET', '/api/respond/chat/monday/9003', boss);
  assert.strictEqual(nf.status, 404); assert.match(nf.data.error, /no contact/);
  assert.strictEqual((await call(base, 'GET', '/api/integrations/status', boss)).data.respond.state, 'ok');
  assert.strictEqual((await call(base, 'GET', '/api/respond/chat/other/9001', boss)).status, 404);
});

test('a failing integration reports an error and returns no substitute data', async () => {
  const b = await instance({ MONDAY_TOKEN: 'bad-token' });
  const cookie = await login(b, 'boss@example.com');
  const r = await call(b, 'GET', '/api/monday/bootstrap', cookie);
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.data.leads, r.data.listings, r.data.viewings], [[], [], []]);
  assert.match(r.data.errors.leads, /rejected MONDAY_TOKEN/);
  const s = (await call(b, 'GET', '/api/integrations/status', cookie)).data;
  assert.strictEqual(s.monday.state, 'error'); assert.match(s.monday.lastError, /rejected MONDAY_TOKEN/);
});

test('Monday leads get AI Status (proof > Monday AI STATUS > rules) and Days in Stage', async () => {
  const cookie = await login(base, 'boss@example.com');
  const leads = (await call(base, 'GET', '/api/monday/bootstrap', cookie)).data.leads, by = (c) => leads.find((l) => l.code === c);
  // BH-T1: no Calendar proof → the AI STATUS the live portal wrote, with its detail text
  assert.deepStrictEqual([by('BH-T1').ai, by('BH-T1').aiSource, by('BH-T1').aiSub], ['Scheduling', 'monday', 'Viewing set for Saturday']);
  // BH-T3: Date LOI Submitted 2 days ago on the Calendar → LOI (proof), within the owner's 5 days
  assert.deepStrictEqual([by('BH-T3').ai, by('BH-T3').aiSource], ['LOI', 'proof']); assert.match(by('BH-T3').aiSub, /waiting for the owner to sign/);
  // BH-T5: Client Status Failed → Failed / Dead, even without a Respond ID
  assert.deepStrictEqual([by('BH-T5').ai, by('BH-T5').temp], ['Failed', 'Dead']);
  // BH-T6: no proof, no AI STATUS → rules on Next Action "Schedule Viewing"
  assert.deepStrictEqual([by('BH-T6').ai, by('BH-T6').aiSource], ['Scheduling', 'rules']);
  // Days in Stage: BH-T3 enquired 30 days ago, first viewing booked 10 days ago, LOI 2 days ago
  assert.deepStrictEqual([by('BH-T3').stageDays['Property Matching'], by('BH-T3').stageDays.Scheduling, by('BH-T3').stageDays.LOI].map(Math.round), [20, 8, 2]);
  assert.strictEqual(by('BH-T3').daysInStage, 2);
});

test('respond.io list-wide checks are off by default: leads show Unchecked until their Chat tab is opened', async () => {
  const b = await instance({});
  const boss = await login(b, 'boss@example.com');
  assert.strictEqual((await call(b, 'GET', '/api/integrations/status', boss)).data.respond.listChecks, false);
  calls.respond.length = 0;
  const rs = await call(b, 'GET', '/api/respond/reply-states', boss);
  assert.strictEqual(rs.status, 409); assert.strictEqual(rs.data.listChecksOff, true);
  const leads = (await call(b, 'GET', '/api/monday/bootstrap', boss)).data.leads, by = (id) => leads.find((l) => l.id === id);
  assert.strictEqual(calls.respond.length, 0, 'loading the list reads nothing from respond.io');
  for (const id of ['9001', '9006']) {
    assert.deepStrictEqual([by(id).temp, by(id).replyChecked, by(id).waiting], ['Unchecked', false, ''], id);   // no guessed status
    assert.match(by(id).tempWhy, /not checked yet/);
  }
  assert.strictEqual(by('9005').temp, 'Dead');   // Failed leads stay Dead (from Monday, not from a chat)
  // opening one lead's Chat tab reads that contact only, and gives that lead its reply status and Temperature
  const chat = await call(b, 'GET', '/api/respond/chat/monday/9006', boss);
  assert.strictEqual(chat.status, 200);
  assert.deepStrictEqual([chat.data.lead.waiting, chat.data.lead.temp, chat.data.lead.replyChecked], ['va', 'Hot', true]);
  assert.ok(calls.respond.length > 0 && calls.respond.every((c) => c.method === 'GET' && c.path.startsWith('/contact/id:555006')));
  const after = (await call(b, 'GET', '/api/monday/bootstrap', boss)).data.leads;
  assert.strictEqual(after.find((l) => l.id === '9006').temp, 'Hot');
  assert.strictEqual(after.find((l) => l.id === '9001').temp, 'Unchecked');
});

test('reply states from respond.io (RESPOND_LIST_CHECKS=on): human replies only, bounded batches, Temperature follows', async () => {
  const base = await instance({ RESPOND_LIST_CHECKS: 'on' });
  const boss = await login(base, 'boss@example.com');
  calls.respond.length = 0;
  const r = await call(base, 'GET', '/api/respond/reply-states', boss);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.linked, 3); assert.strictEqual(r.data.pending, 0);
  const s = r.data.leads;
  assert.deepStrictEqual([s['9001'].waiting, s['9001'].temp], ['client', 'Lost']);           // VA answered; client quiet for 3 days
  assert.deepStrictEqual([s['9006'].waiting, s['9006'].temp], ['va', 'Hot']);                // workflow auto-reply is not a human reply
  assert.match(s['9006'].lastText, /Auto-reply/);
  assert.strictEqual(s['9003'].replyChecked, false);                                         // contact 404 → unchecked, not invented
  assert.ok(calls.respond.every((c) => c.method === 'GET' && /message\/list\?limit=15$/.test(c.path)));
  // second call is served from the cache (no new respond.io requests), and the bootstrap now carries the states
  const n = calls.respond.length;
  await call(base, 'GET', '/api/respond/reply-states', boss);
  assert.strictEqual(calls.respond.length, n);
  const lead = (await call(base, 'GET', '/api/monday/bootstrap', boss)).data.leads.find((l) => l.id === '9006');
  assert.deepStrictEqual([lead.waiting, lead.temp], ['va', 'Hot']);
  const ana = await login(base, 'ana@example.com');
  assert.deepStrictEqual(Object.keys((await call(base, 'GET', '/api/respond/reply-states', ana)).data.leads).sort(), ['9001', '9006']);
});

test('Team & Access: VA labels come from the Monday board and are enforced on save', async () => {
  const boss = await login(base, 'boss@example.com');
  const t = (await call(base, 'GET', '/api/team/labels', boss)).data;
  assert.strictEqual(t.source, 'monday');
  assert.deepStrictEqual(t.va, ['Ana', 'Bea', 'Cora Fake', 'Dev Fake']);
  assert.ok(t.salesperson.includes('Hal Fake'));
  const post = (body) => fetch(base + '/api/team', { method: 'POST', headers: { 'content-type': 'application/json', cookie: boss }, body: JSON.stringify(body) }).then((x) => x.status);
  const member = { name: 'Cora Test', email: 'cora@example.com', role: 'VA', modules: { leads: 'view' }, password: 'a-long-temporary-pw' };
  assert.strictEqual(await post({ ...member, vaLabel: 'Not A Label' }), 400);
  assert.strictEqual(await post({ ...member, vaLabel: 'Cora Fake' }), 201);                   // real board label accepted
  const cora = await login(base, 'cora@example.com', 'a-long-temporary-pw');
  assert.deepStrictEqual((await call(base, 'GET', '/api/monday/bootstrap', cora)).data.leads.map((l) => l.code), ['BH-T5']);
  const ana = await login(base, 'ana@example.com');
  assert.strictEqual((await call(base, 'GET', '/api/team/labels', ana)).status, 403);
});

test('listing photos: proxied, image types only, Monday token never sent to the file host', async () => {
  const boss = await login(base, 'boss@example.com');
  const listings = (await call(base, 'GET', '/api/monday/bootstrap', boss)).data.listings;
  const tower = listings.find((x) => x.building === 'Fake Tower');
  assert.deepStrictEqual(tower.photos, ['30003', '30001']);                                   // Photos column order first; the PDF is skipped
  assert.ok(!JSON.stringify(listings).includes('/files/'));                                   // file links never reach the browser
  calls.files.length = 0;
  const img = await fetch(base + '/api/monday/photo/30001?thumb=1', { headers: { cookie: boss } });
  assert.strictEqual(img.status, 200); assert.strictEqual(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('content-security-policy'), /sandbox/);
  assert.ok((await img.arrayBuffer()).byteLength > 0);
  assert.ok(calls.files.length === 1 && calls.files[0].auth === '');                         // no Authorization header to the file host
  assert.strictEqual((await fetch(base + '/api/monday/photo/30009', { headers: { cookie: boss } })).status, 415);   // SVG refused
  assert.strictEqual((await fetch(base + '/api/monday/photo/99999', { headers: { cookie: boss } })).status, 404);   // not a listing photo
  assert.strictEqual((await fetch(base + '/api/monday/photo/30001')).status, 401);                                  // sign-in required
});

test('startup preload reads Monday once (read-only) and logs counts only', async () => {
  const { preloadMonday } = require('../server');
  const app = createApp(loadConfig(envFor({}), ARGV));
  calls.monday.length = 0;
  const logs = [];
  const all = await preloadMonday(app, (l) => logs.push(l));
  assert.strictEqual(all.leads.length, 4);
  assert.match(logs[1], /ready in \d+ s — 4 leads, 2 listings, 2 viewings/);
  assert.ok(calls.monday.length > 0 && calls.monday.every((c) => /^\s*query\b/.test(c.body.query)));
  assert.ok(!logs.join('\n').includes('mtest') && !logs.join('\n').includes('Test Client'));   // no token, no customer data
  const n = calls.monday.length;
  await app.locals.integ.monday.loadAll(false);                                                // the page's first load is served from memory
  assert.strictEqual(calls.monday.length, n);
  // nothing to preload when Monday isn't configured; a failing token is logged, not thrown
  assert.strictEqual(preloadMonday(createApp(loadConfig(envFor({ MONDAY_TOKEN: '' }), ARGV)), () => {}), null);
  const bad = []; const r = await preloadMonday(createApp(loadConfig(envFor({ MONDAY_TOKEN: 'bad-token' }), ARGV)), (l) => bad.push(l));
  assert.match(bad[1], /errors: leads: Monday.com rejected MONDAY_TOKEN/); assert.strictEqual(r.leads.length, 0);
});

test('Monday refresh: last good copy served (with its age) while refreshing; a failed refresh keeps it and is reported', async () => {
  const { createMonday } = require('../src/integrations/monday');
  const { createStatus } = require('../src/integrations/status');
  let t = Date.parse('2026-10-23T09:00:00Z');
  const cfg = { ...loadConfig(envFor({}), ARGV).integrations.monday };
  const m = createMonday(cfg, createStatus(true, []), { now: () => t });
  calls.monday.length = 0;
  const loading = m.loadAll(false);
  // during the first load: progress per board, and asking for it does not start another fetch
  const f0 = m.freshness();
  assert.deepStrictEqual(Object.values(f0.boards).map((b) => [b.loaded, b.refreshing, !!b.progress]), [[false, true, true], [false, true, true], [false, true, true]]);
  assert.ok(!JSON.stringify(f0).includes('Test Client'));
  const first = await loading;
  const perBoard = calls.monday.length;
  m.freshness(); assert.strictEqual(calls.monday.length, perBoard, 'freshness never re-fetches fresh data');
  assert.ok(first.boards.leads.progress === null, 'no progress once loaded');
  assert.strictEqual(first.leads.length, 4); assert.strictEqual(first.refreshing, false);
  assert.strictEqual(first.fetchedAt, '2026-10-23T09:00:00.000Z');   // the time the read started, not "now"
  assert.deepStrictEqual(Object.keys(first.boards).sort(), ['leads', 'listings', 'viewings']);

  // 6 minutes later (past the 5-minute limit) with Monday failing: old copy right away, labelled with its old time
  t += 6 * 60e3; cfg.token = 'bad-token';
  calls.monday.length = 0;
  const during = await m.loadAll(false);
  assert.strictEqual(during.leads.length, 4); assert.strictEqual(during.refreshing, true);
  assert.strictEqual(during.fetchedAt, '2026-10-23T09:00:00.000Z');
  assert.deepStrictEqual(during.errors, {});
  await m.settled();
  const after = await m.loadAll(false);
  assert.strictEqual(after.leads.length, 4, 'last good copy kept after a failed refresh');
  assert.strictEqual(after.fetchedAt, '2026-10-23T09:00:00.000Z', 'never relabelled as fresh');
  assert.match(after.boards.leads.refreshError, /rejected MONDAY_TOKEN/);
  assert.strictEqual(after.boards.leads.refreshFailedAt, '2026-10-23T09:06:00.000Z');
  const n = calls.monday.length;
  t += 10e3; await m.loadAll(false); assert.strictEqual(calls.monday.length, n, 'no automatic retry within 30 s of a failure');
  const f = m.freshness();
  assert.match(f.boards.leads.refreshError, /rejected/); assert.ok(!JSON.stringify(f).includes('Test Client'), 'freshness carries no data');

  // Monday back: a forced refresh replaces the copy and clears the error
  cfg.token = 'mtest'; t += 30e3;
  await m.loadAll(true); await m.settled();
  const fresh = await m.loadAll(false);
  assert.strictEqual(fresh.fetchedAt, '2026-10-23T09:06:40.000Z'); assert.strictEqual(fresh.boards.leads.refreshError, '');
  assert.ok(calls.monday.every((c) => /^\s*query\b/.test(c.body.query)), 'reads only');

  // first load failing: no data at all, an error per board (nothing substituted)
  const cold = createMonday({ ...cfg, token: 'bad-token' }, createStatus(true, []), { now: () => t });
  const none = await cold.loadAll(false);
  assert.strictEqual(none.leads.length, 0); assert.strictEqual(none.fetchedAt, null); assert.match(none.errors.leads, /rejected/);
});

test('Monday data is not stored in MongoDB or the browser', async () => {
  const cookie = await login(base, 'boss@example.com');
  await call(base, 'GET', '/api/monday/bootstrap', cookie);
  const names = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name);
  for (const n of names) {
    const docs = JSON.stringify(await mongoose.connection.db.collection(n).find({}).toArray());
    assert.ok(!docs.includes('Test Client One') && !docs.includes('BH-T1'), 'collection ' + n);
  }
  const fr = await call(base, 'GET', '/api/monday/freshness', cookie);
  assert.strictEqual(fr.status, 200); assert.ok(fr.data.boards.leads.loaded);
  // the page writes to localStorage only its demo data (demo mode) and display preferences
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const writes = src.match(/store\.set\([^,]+/g);
  assert.deepStrictEqual(writes.sort(), ['store.set(PREF', 'store.set(STORE'].sort());
  assert.match(src, /function persist\(\) \{ if \(DEMO &&/);
});

test('check-respond: reads a few Respond IDs and their chats; prints status and counts only', async () => {
  const { checkRespond } = require('../scripts/check-respond');
  const cfg = loadConfig(envFor({}), ARGV);
  calls.monday.length = 0; calls.respond.length = 0;
  const logs = [];
  const r = await checkRespond(cfg, (l) => logs.push(l));
  assert.strictEqual(r.state, 'ok');
  assert.ok(r.sample.tested >= 1 && r.results.every((x) => x.ok));
  const out = logs.join('\n');
  assert.match(out, /Respond ID/); assert.match(out, /respond\.io: connected \(read-only\)/);
  // nothing from the customer: no names, contact IDs, tokens or message text
  const chats = await Promise.all(['555001', '555003', '555006'].map((id) => createRespondFor(cfg).chat(id).catch(() => null)));
  const texts = chats.filter(Boolean).flatMap((c) => c.messages.map((m) => m.text)).filter((t) => t && t.length > 3);
  assert.ok(texts.length > 0);
  for (const s of [...texts, 'Test Client', '555001', '555003', '555006', 'mtest', 'rtest']) assert.ok(!out.includes(s), 'printed: ' + s);
  // read-only: Monday queries only, respond.io GETs only
  assert.ok(calls.monday.every((c) => /^\s*query\b/.test(c.body.query)));
  assert.ok(calls.respond.length > 0 && calls.respond.every((c) => c.method === 'GET'));
  await assert.rejects(checkRespond(loadConfig(envFor({ RESPOND_TOKEN: '' }), ARGV), () => {}), /RESPOND_TOKEN is empty/);
  const bad = []; const rb = await checkRespond(loadConfig(envFor({ RESPOND_TOKEN: 'bad-token' }), ARGV), (l) => bad.push(l));
  assert.strictEqual(rb.state, 'error'); assert.match(bad.join('\n'), /rejected RESPOND_TOKEN/);
});
const createRespondFor = (cfg) => require('../src/integrations/respondio').createRespond(cfg.integrations.respond, require('../src/integrations/status').createStatus(true, []));

test('missing credentials show "not connected" and the routes refuse politely', async () => {
  const b = await instance({ MONDAY_TOKEN: '', RESPOND_TOKEN: '' });
  const cookie = await login(b, 'boss@example.com');
  const s = (await call(b, 'GET', '/api/integrations/status', cookie)).data;
  assert.strictEqual(s.monday.state, 'not_configured'); assert.deepStrictEqual(s.monday.missing, ['MONDAY_TOKEN']);
  assert.strictEqual(s.respond.state, 'not_configured');
  const m = await call(b, 'GET', '/api/monday/bootstrap', cookie);
  assert.strictEqual(m.status, 409); assert.match(m.data.error, /not connected/);
  assert.strictEqual((await call(b, 'GET', '/api/respond/chat/monday/9001', cookie)).status, 409);
  assert.strictEqual((await call(b, 'GET', '/api/integrations/status')).status, 401);       // still requires sign-in
});
