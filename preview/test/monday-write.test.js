'use strict';
// Allowlisted Monday.com updates (src/integrations/mondayWrite.js), against the local FAKE Monday API only.
// Proves: off unless MONDAY_WRITES=on; each allowed action sends exactly one fixed single-column mutation with the
// expected board/item/column/value; everything else is refused before anything reaches Monday; confirmation before
// overwriting; minimal audit; clear errors (no MongoDB fallback, no pretend success). Fictional data only.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { User, MondayWrite } = require('../src/models');
const { hashPassword } = require('../src/auth');
const { assertAllowedWrite, assertReadOnly, WRITE_MUTATION } = require('../src/integrations/monday');
const { ACTIONS, checkValue, createWriteLimiter, performWrite, pickColumn } = require('../src/integrations/mondayWrite');
const fx = require('./fixtures/fake-integrations');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];
const BOARDS = { leads: '1111111', listings: '2222222', calendar: '3333333' };

// fictional board setup for this file only: the real boards' column kinds and labels
const L = fx.BOARDS['1111111'], LS = fx.BOARDS['2222222'];
const labels = (xs) => JSON.stringify({ labels: Object.fromEntries(xs.map((x, i) => [String(i), x])) });
L.columns.find((c) => c.id === 'bud').type = 'numbers';
L.columns.find((c) => c.id === 'inq').settings_str = labels(['SALE', 'RENT', 'OTHERS']);
L.columns.push({ id: 'pets', title: 'Pets', type: 'status', settings_str: labels(['No Pets', 'With Pets', 'Not Applicable']) },
  { id: 'nat', title: 'Nationality', type: 'text', settings_str: '{}' });
L.items[0].v.bud = '200000'; L.items[0].v.inq = 'RENT';
L.items.find((x) => x.id === '9006').v.pets = 'Not Applicable';   // a board label the portal shows as "Not specified"
LS.columns.find((c) => c.id === 'av').settings_str = labels(['Availability Inquired', 'Closed', 'Available', 'Remove']);

// a proxy in front of the fake so a test can make Monday fail the next mutation
const fake = fx.createFakeServer();
let failNextMutation = false;
const proxy = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    if (failNextMutation && /"query":"\s*mutation/.test(body)) { failNextMutation = false; fx.calls.monday.push({ method: 'POST', auth: req.headers.authorization, body: JSON.parse(body), failed: true }); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ errors: [{ message: 'Internal server error' }] })); }
    const r = await fetch(`http://127.0.0.1:${fake.address().port}${req.url}`, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '' }, body: req.method === 'GET' ? undefined : body });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' }); res.end(Buffer.from(await r.arrayBuffer()));
  });
});

let mem, main, on, off, extra = [];
const env = (over) => ({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_mw'), PORT: '0', MONDAY_TOKEN: 'mtest', MONDAY_LEADS_BOARD_ID: BOARDS.leads,
  MONDAY_LISTINGS_BOARD_ID: BOARDS.listings, MONDAY_CALENDAR_BOARD_ID: BOARDS.calendar, MONDAY_API_URL: `http://127.0.0.1:${proxy.address().port}/monday`, ...over });
async function instance(over) {
  const app = createApp(loadConfig(env(over), ARGV));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); }); extra.push(srv);
  return `http://127.0.0.1:${srv.address().port}`;
}
async function call(base, method, url, cookie, body) {
  const res = await fetch(base + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, data, text };
}
async function login(base, email) {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PW }) });
  assert.strictEqual(res.status, 200); return res.headers.get('set-cookie').split(';')[0];
}
const mutations = () => fx.calls.monday.filter((c) => /^\s*mutation\b/.test(c.body.query));
const write = (base, who, body) => call(base, 'POST', '/api/monday/write', who, body);
let ck = {};

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r)); await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  mem = await MongoMemoryServer.create();
  ({ server: main } = await start(env({ MONDAY_WRITES: 'on', MONDAY_WRITE_LIMIT: '60' }), ARGV));   // the rate limit has its own test
  on = `http://127.0.0.1:${main.address().port}`;
  off = await instance({});   // the default: no MONDAY_WRITES
  const passwordHash = await hashPassword(PW);
  await User.create([
    { email: 'boss@example.com', name: 'Demo Manager', role: 'Manager', passwordHash },
    { email: 'ana@example.com', name: 'Ana Demo', role: 'VA', vaLabel: 'Ana', modules: { leads: 'edit', invdash: 'view' }, passwordHash },
    { email: 'viewer@example.com', name: 'View Demo', role: 'VA', vaLabel: 'Ana', modules: { leads: 'view' }, passwordHash },
    { email: 'stock@example.com', name: 'Stock Demo', role: 'VA', vaLabel: 'Bea', modules: { invdash: 'edit' }, passwordHash },
  ]);
  for (const k of ['boss', 'ana', 'viewer', 'stock']) { ck[k] = await login(on, k + '@example.com'); ck[k + 'Off'] = await login(off, k + '@example.com'); }
  await call(on, 'GET', '/api/monday/bootstrap', ck.boss);   // load the fake boards into the server's memory
});
test.after(async () => { main.close(); extra.forEach((s) => s.close()); fake.close(); proxy.close(); await mongoose.disconnect(); await mem.stop(); });

test('off by default: no write route works, options say disabled, status stays read-only, nothing reaches Monday', async () => {
  const n = mutations().length;
  await call(off, 'GET', '/api/monday/bootstrap', ck.bossOff);
  const r = await write(off, ck.bossOff, { action: 'listingAvailability', itemId: '7001', value: 'Remove', confirm: true });
  assert.strictEqual(r.status, 409); assert.strictEqual(r.data.writesOff, true); assert.match(r.data.error, /switched off/);
  assert.deepStrictEqual((await call(off, 'GET', '/api/monday/write-options', ck.bossOff)).data, { enabled: false, actions: {} });
  const s = (await call(off, 'GET', '/api/integrations/status', ck.bossOff)).data;
  assert.strictEqual(s.readOnly, true); assert.strictEqual(s.mondayWrites, false);
  assert.strictEqual(mutations().length, n);
});

test('options: allowed actions per role, with the board\'s own labels; no client data', async () => {
  const o = (await call(on, 'GET', '/api/monday/write-options', ck.boss)).data;
  assert.strictEqual(o.enabled, true);
  assert.deepStrictEqual(Object.keys(o.actions).sort(), Object.keys(ACTIONS).sort());
  assert.deepStrictEqual(o.actions.listingAvailability.labels, ['Availability Inquired', 'Closed', 'Available', 'Remove']);
  assert.deepStrictEqual(o.actions.leadInquiry.labels, ['SALE', 'RENT', 'OTHERS']);
  assert.ok(!('leadPets' in o.actions), 'Pets is not on the allowlist, although the board has a Pets column');
  assert.ok(Object.values(o.actions).every((x) => x.allowed), 'a Manager may use every action');
  assert.match(o.actions.listingAvailability.warn, /automations/);
  const a = (await call(on, 'GET', '/api/monday/write-options', ck.ana)).data.actions;
  assert.strictEqual(a.listingAvailability.allowed, false, 'Inventory view-only');
  for (const k of ['leadBudget', 'leadMoveIn', 'leadInquiry', 'leadNationality']) assert.strictEqual(a[k].allowed, false, k + ': Managers only, even with Leads edit');
  const s = (await call(on, 'GET', '/api/monday/write-options', ck.stock)).data.actions;
  assert.strictEqual(s.listingAvailability.allowed, true, 'Inventory edit access (not a Manager)');
  assert.ok(!/Test Client|\+63|@example/.test(JSON.stringify(o)));
});

test('listing Availability: confirm before overwriting, exactly one fixed mutation, Monday copy refreshed, audited', async () => {
  const n = mutations().length;
  const ask = await write(on, ck.boss, { action: 'listingAvailability', itemId: '7001', value: 'Remove' });
  assert.strictEqual(ask.status, 409); assert.strictEqual(ask.data.needsConfirm, true);
  assert.match(ask.data.error, /may trigger automations/, 'the automation warning');
  assert.strictEqual(mutations().length, n, 'nothing sent without the confirmation');
  const r = await write(on, ck.boss, { action: 'listingAvailability', itemId: '7001', value: 'Remove', confirm: true });
  assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.data.ok, true); assert.strictEqual(r.data.column, 'Availability');
  const sent = mutations().slice(n);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].body.query, WRITE_MUTATION);
  assert.deepStrictEqual(sent[0].body.variables, { b: BOARDS.listings, i: '7001', c: 'av', v: 'Remove' });
  assert.strictEqual(sent[0].auth, 'mtest', 'token only in the server→Monday request');
  assert.strictEqual(r.data.record.availabilityLabel, 'Remove'); assert.strictEqual(r.data.record.availability, 'Not Available');
  const boot = (await call(on, 'GET', '/api/monday/bootstrap', ck.boss)).data.listings.find((x) => x.id === '7001');
  assert.strictEqual(boot.availabilityLabel, 'Remove', 'the server\'s copy shows what Monday now holds');
  const au = await MondayWrite.findOne({ itemId: '7001' }).lean();
  assert.deepStrictEqual({ action: au.action, board: au.board, column: au.column, from: au.from, to: au.to, ok: au.ok, by: au.by.name },
    { action: 'listingAvailability', board: 'listings', column: 'Availability', from: 'Available', to: 'Remove', ok: true, by: 'Demo Manager' });
  assert.ok(!/mtest|Owner A|Fake Tower/.test(JSON.stringify(au)), 'no token or item names in the audit');
  assert.ok(!r.text.includes('mtest'));
  // back to Available (the same way), and the same value again changes nothing
  assert.strictEqual((await write(on, ck.stock, { action: 'listingAvailability', itemId: '7001', value: 'Available', confirm: true })).status, 200, 'Inventory edit access');
  const m2 = mutations().length;
  const same = await write(on, ck.boss, { action: 'listingAvailability', itemId: '7001', value: 'Available', confirm: true });
  assert.strictEqual(same.data.unchanged, true); assert.strictEqual(mutations().length, m2);
});

test('lead fields: each allowed field sends one mutation to the right column with the checked value', async () => {
  const cases = [['leadBudget', '300000', 'bud', '300000'], ['leadMoveIn', '2026-12-15', 'mi', '2026-12-15'],
    ['leadInquiry', 'SALE', 'inq', 'SALE'], ['leadNationality', '  Filipino ', 'nat', 'Filipino']];
  for (const [action, value, col, sentValue] of cases) {
    const n = mutations().length;
    const r = await write(on, ck.boss, { action, itemId: '9001', value, confirm: true });
    assert.strictEqual(r.status, 200, action + ': ' + r.text);
    const sent = mutations().slice(n);
    assert.strictEqual(sent.length, 1, action);
    assert.deepStrictEqual(sent[0].body.variables, { b: BOARDS.leads, i: '9001', c: col, v: sentValue }, action);
  }
  const lead = (await call(on, 'GET', '/api/monday/bootstrap', ck.boss)).data.leads.find((x) => x.id === '9001');
  assert.deepStrictEqual([lead.budget, lead.moveIn, lead.inquiry, lead.nationality], [300000, '2026-12-15', 'Buy', 'Filipino']);
  const audits = await MondayWrite.find({ itemId: '9001' }).lean();
  assert.strictEqual(audits.length, 4);
  assert.ok(audits.filter((a) => ['leadBudget', 'leadMoveIn', 'leadNationality'].includes(a.action)).every((a) => !a.from && !a.to), 'no free-text / number / date values in the audit');
  assert.ok(!/Filipino|300000|2026-12-15|Test Client|mtest/.test(JSON.stringify(audits)));
});

test('status fields compare with the board\'s own label, not the portal\'s normalised value', async () => {
  const before = (await call(on, 'GET', '/api/monday/bootstrap', ck.boss)).data.leads.find((x) => x.id === '9006');
  assert.deepStrictEqual([before.inquiry, before.inquiryLabel], ['Rent', 'Rent'], 'the page gets the raw label');
  assert.ok(!('petsLabel' in before), 'no Pets write support left on the record');
  // Monday holds "Rent" (not one of the board's current labels): "RENT" replaces it, so a confirmation is needed
  const n = mutations().length;
  const ask = await write(on, ck.boss, { action: 'leadInquiry', itemId: '9006', value: 'RENT' });
  assert.strictEqual(ask.status, 409); assert.strictEqual(ask.data.needsConfirm, true);
  assert.strictEqual(mutations().length, n, 'nothing sent without the confirmation');
  assert.strictEqual((await write(on, ck.boss, { action: 'leadInquiry', itemId: '9006', value: 'RENT', confirm: true })).status, 200);
  const au = await MondayWrite.findOne({ itemId: '9006', action: 'leadInquiry' }).lean();
  assert.deepStrictEqual([au.from, au.to], ['Rent', 'RENT'], 'the audit shows Monday\'s labels');
  // sending "RENT" again changes nothing and sends nothing
  const m = mutations().length;
  const same = await write(on, ck.boss, { action: 'leadInquiry', itemId: '9006', value: 'RENT', confirm: true });
  assert.strictEqual(same.status, 200); assert.strictEqual(same.data.unchanged, true);
  assert.strictEqual(mutations().length, m, 'no mutation for a value Monday already has');
  assert.strictEqual(same.data.record.inquiryLabel, 'RENT');
});

test('refused before reaching Monday: unknown actions, extra fields, bad values, wrong role, invisible or unknown items', async () => {
  const n = mutations().length;
  const refusals = [
    [ck.boss, { action: 'deleteItem', itemId: '9001', value: 'x', confirm: true }, 400],
    [ck.boss, { action: 'createItem', itemId: '9001', value: 'x', confirm: true }, 400],
    // portal fields that are deliberately NOT on the list (status, VA, notes, override, viewings)
    ...['leadPets', 'leadStatus', 'leadClientStatus', 'leadAiStatus', 'leadVa', 'leadNote', 'leadFailed', 'viewingStatus', 'createUpdate'].map((action) => [ck.boss, { action, itemId: '9001', value: 'Qualified', confirm: true }, 400]),
    [ck.boss, { action: '__proto__', itemId: '9001', value: 'x', confirm: true }, 400],
    [ck.boss, { action: 'toString', itemId: '9001', value: 'x', confirm: true }, 400],
    [ck.boss, { action: 'leadBudget', itemId: '9001', value: '1', confirm: true, columnId: 'cs' }, 400],
    [ck.boss, { action: 'leadBudget', itemId: '9001', value: '1', confirm: true, board: '3333333' }, 400],
    [ck.boss, { action: 'listingAvailability', itemId: '7001', value: 'Sold', confirm: true }, 400],
    [ck.boss, { action: 'leadInquiry', itemId: '9001', value: '', confirm: true }, 400],
    [ck.boss, { action: 'leadBudget', itemId: '9001', value: '-5', confirm: true }, 400],
    [ck.boss, { action: 'leadBudget', itemId: '9001', value: '1e9', confirm: true }, 400],
    [ck.boss, { action: 'leadMoveIn', itemId: '9001', value: '2026-02-30', confirm: true }, 400],
    [ck.boss, { action: 'leadNationality', itemId: '9001', value: 'Fil\nipino', confirm: true }, 400],
    [ck.boss, { action: 'leadNationality', itemId: '9001', value: 'x'.repeat(61), confirm: true }, 400],
    [ck.boss, { action: 'leadNationality', itemId: '9001', value: { text: 'x' }, confirm: true }, 400],
    [ck.boss, { action: 'leadBudget', itemId: '9001 OR 1', value: '1', confirm: true }, 404],
    [ck.boss, { action: 'leadBudget', itemId: '123456', value: '1', confirm: true }, 404],
    [ck.boss, { action: 'listingAvailability', itemId: '7002', value: 'Remove', confirm: true }, 404],   // archived group: not a live listing
    [ck.ana, { action: 'leadBudget', itemId: '9003', value: '1', confirm: true }, 403],                  // Bea's lead; lead fields are Managers only
    // a VA with Leads edit, on her own visible lead: every lead field is Managers only
    ...['leadBudget', 'leadMoveIn', 'leadInquiry', 'leadNationality'].map((action) =>
      [ck.ana, { action, itemId: '9001', value: { leadBudget: '1', leadMoveIn: '2026-12-01', leadInquiry: 'SALE', leadNationality: 'Filipino' }[action], confirm: true }, 403]),
    [ck.ana, { action: 'listingAvailability', itemId: '7001', value: 'Remove', confirm: true }, 403],    // Inventory view only
    [ck.viewer, { action: 'leadBudget', itemId: '9001', value: '1', confirm: true }, 403],               // Leads view only
    [ck.stock, { action: 'leadInquiry', itemId: '9001', value: 'SALE', confirm: true }, 403],            // no Leads access
    [undefined, { action: 'leadBudget', itemId: '9001', value: '1', confirm: true }, 401],
  ];
  for (const [who, body, want] of refusals) {
    const r = await write(on, who, body);
    assert.strictEqual(r.status, want, JSON.stringify(body) + ' → ' + r.text);
  }
  assert.strictEqual(mutations().length, n, 'none of these reached Monday');
  // cross-site and non-JSON requests are refused by the API's general guards
  const cross = await fetch(on + '/api/monday/write', { method: 'POST', headers: { cookie: ck.boss, 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
  assert.strictEqual(cross.status, 403);
  assert.strictEqual(mutations().length, n);
});

test('rate limit: per user, checked before Monday is read or written; 429 with Retry-After; other users unaffected', async () => {
  const lim = await instance({ MONDAY_WRITES: 'on', MONDAY_WRITE_LIMIT: '2' });
  await call(lim, 'GET', '/api/monday/bootstrap', ck.boss);
  const n = mutations().length;
  // refused requests that never get near Monday don't use up the allowance (limit 2, three refusals, then two updates)
  for (let i = 0; i < 3; i++) assert.strictEqual((await write(lim, ck.stock, { action: 'deleteItem', itemId: '7001', value: 'x', confirm: true })).status, 400);
  for (const v of ['Closed', 'Available']) assert.strictEqual((await write(lim, ck.stock, { action: 'listingAvailability', itemId: '7001', value: v, confirm: true })).status, 200);
  const before = fx.calls.monday.length;
  const r = await write(lim, ck.stock, { action: 'listingAvailability', itemId: '7001', value: 'Closed', confirm: true });
  assert.strictEqual(r.status, 429); assert.match(r.data.error, /Too many Monday updates.*Nothing was changed/);
  assert.ok(r.data.retryAfter >= 1 && r.data.retryAfter <= 60);
  const raw = await fetch(lim + '/api/monday/write', { method: 'POST', headers: { cookie: ck.stock, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'listingAvailability', itemId: '7001', value: 'Closed', confirm: true }) });
  assert.strictEqual(raw.status, 429); assert.match(raw.headers.get('retry-after') || '', /^\d+$/);
  assert.strictEqual(fx.calls.monday.length, before, 'over the limit: no Monday call at all (no read, no mutation)');
  assert.strictEqual(mutations().length, n + 2);
  // another user still has their own allowance
  assert.strictEqual((await write(lim, ck.boss, { action: 'listingAvailability', itemId: '7001', value: 'Available', confirm: true })).status, 200);
});

test('rate limiter: rolling minute per user, 3× for the server, from MONDAY_WRITE_LIMIT (1-60, default 10)', () => {
  let t = 0; const take = createWriteLimiter(2, { now: () => t });
  assert.deepStrictEqual([take('a'), take('a')], [0, 0]);
  assert.strictEqual(take('a'), 60, 'third in the same minute waits');
  t = 30e3; assert.strictEqual(take('a'), 30);
  t = 60e3; assert.strictEqual(take('a'), 0, 'allowed again after a minute');
  // server-wide: 3 × perUser across users
  let u = 0; const take2 = createWriteLimiter(1, { now: () => u });
  assert.deepStrictEqual(['x', 'y', 'z'].map(take2), [0, 0, 0]);
  assert.ok(take2('w') > 0, 'a fourth user is refused while the server is at its limit');
  const cfg = (v) => loadConfig({ APP_MODE: 'mongo', MONGODB_URI: 'mongodb://127.0.0.1:1/x', ...(v === undefined ? {} : { MONDAY_WRITE_LIMIT: v }) }, ARGV).integrations.monday.writeLimit;
  assert.strictEqual(cfg(), 10); assert.strictEqual(cfg('25'), 25);
  for (const bad of ['0', '61', '-1', '5.5', 'ten']) assert.throws(() => cfg(bad), /MONDAY_WRITE_LIMIT/);
});

test('the overwrite check uses Monday\'s value right now, not the server\'s copy or what an old page showed', async () => {
  const items = fx.BOARDS['1111111'].items, it = (id) => items.find((x) => x.id === id);
  // 9001 shows "Filipino" in the portal; someone changes it on Monday directly
  it('9001').v.nat = 'Japanese';
  let n = mutations().length;
  const stale = await write(on, ck.boss, { action: 'leadNationality', itemId: '9001', value: 'Korean', expect: 'Filipino', confirm: true });
  assert.strictEqual(stale.status, 409); assert.strictEqual(stale.data.stale, true); assert.match(stale.data.error, /changed since this page loaded/);
  assert.strictEqual(mutations().length, n, 'nothing sent');
  // 9003 has no Nationality in the server's copy, but Monday has one now: replacing it still needs the confirmation
  it('9003').v.nat = 'Thai';
  const ask = await write(on, ck.boss, { action: 'leadNationality', itemId: '9003', value: 'Korean' });
  assert.strictEqual(ask.status, 409); assert.strictEqual(ask.data.needsConfirm, true);
  assert.strictEqual(mutations().length, n, 'nothing sent');
  // Budget: Monday's own number ("0" is a value, not "empty")
  it('9006').v.bud = '0';
  const bud = await write(on, ck.boss, { action: 'leadBudget', itemId: '9006', value: '5000' });
  assert.strictEqual(bud.status, 409); assert.strictEqual(bud.data.needsConfirm, true);
  // with the value the page now shows, and the confirmation, it goes through
  const ok = await write(on, ck.boss, { action: 'leadNationality', itemId: '9001', value: 'Korean', expect: 'Japanese', confirm: true });
  assert.strictEqual(ok.status, 200, ok.text); assert.strictEqual(mutations().length, n + 1);
  assert.strictEqual((await write(on, ck.boss, { action: 'leadNationality', itemId: '9001', value: 'K', expect: 5, confirm: true })).status, 400, 'expect must be text');
});

test('column choice: exactly one column with the action\'s title, and the one the portal reads', () => {
  const st = (id, title) => ({ id, title, type: 'status', settings_str: JSON.stringify({ labels: { 0: 'Available', 1: 'Closed' } }) });
  assert.strictEqual(pickColumn([st('av', 'Availability')], ACTIONS.listingAvailability).id, 'av');
  // the portal would read Availability from "Status" (listed first): refused rather than write a column it doesn't read
  assert.throws(() => pickColumn([st('s', 'Status'), st('av', 'Availability')], ACTIONS.listingAvailability), /reads Availability from a different Monday column/);
  assert.throws(() => pickColumn([st('s', 'Status')], ACTIONS.listingAvailability), /no "Availability" column/);
  const txt = (id, title) => ({ id, title, type: 'text', settings_str: '{}' });
  assert.throws(() => pickColumn([txt('n1', 'Nationality'), txt('n2', 'nationality')], ACTIONS.leadNationality), /more than one "Nationality"/);
  assert.throws(() => pickColumn([{ ...txt('b', 'Budget') }], ACTIONS.leadBudget), /not the expected kind/);
});

test('audit: logged before sending (nothing is sent if it can\'t be); a logging problem afterwards doesn\'t hide success', async () => {
  const cols = [{ id: 'nat', title: 'Nationality', type: 'text', settings_str: '{}' }], rec = { id: '1', nationality: '' };
  let sent = 0;
  const integ = { visibleMondayLead: async () => rec,
    monday: { writesEnabled: true, boardColumns: async () => cols, refreshItem: async () => rec, writeColumn: async () => { sent++; return { id: '1' }; } } };
  const user = { _id: 'u1', name: 'Demo Manager', role: 'Manager' }, body = { action: 'leadNationality', itemId: '1', value: 'Korean', confirm: true };
  await assert.rejects(performWrite({ integ, user, body, audit: { start: async () => { throw new Error('db down'); }, finish: async () => {} } }),
    (e) => e.httpStatus === 503 && /not sent to Monday/.test(e.message));
  assert.strictEqual(sent, 0);
  const err = console.error; console.error = () => {};
  try {
    const out = await performWrite({ integ, user, body, audit: { start: async () => 'a1', finish: async () => { throw new Error('db down'); } } });
    assert.strictEqual(sent, 1); assert.ok(out.record && !out.unchanged);
  } finally { console.error = err; }
});

test('a Monday failure is reported as a failure and audited; nothing is saved elsewhere instead', async () => {
  failNextMutation = true;
  const r = await write(on, ck.boss, { action: 'leadNationality', itemId: '9006', value: 'Korean', confirm: true });
  assert.strictEqual(r.status, 502); assert.match(r.data.error, /Monday\.com: Internal server error/);
  const au = await MondayWrite.findOne({ itemId: '9006', action: 'leadNationality' }).lean();
  assert.strictEqual(au.ok, false); assert.match(au.error, /Internal server error/); assert.ok(!/Korean/.test(au.error));
  const lead = (await call(on, 'GET', '/api/monday/bootstrap', ck.boss)).data.leads.find((x) => x.id === '9006');
  assert.notStrictEqual(lead.nationality, 'Korean', 'not shown as changed');
});

test('second guard: only the exact fixed mutation for a configured board, numeric item, plain column, one-line value', () => {
  const v = { b: BOARDS.leads, i: '9001', c: 'bud', v: '1' };
  assert.doesNotThrow(() => assertAllowedWrite(WRITE_MUTATION, v, BOARDS));
  const bad = [
    ['mutation { delete_item(item_id: 9001) { id } }', v], ['mutation { create_item(board_id: 1111111, item_name: "x") { id } }', v],
    [WRITE_MUTATION + ' mutation { delete_item(item_id: 1) { id } }', v], [WRITE_MUTATION.replace('change_simple_column_value', 'x: change_simple_column_value'), v],
    [WRITE_MUTATION.replace('change_simple_column_value', 'change_multiple_column_values'), v], [' ' + WRITE_MUTATION, v],
    [WRITE_MUTATION, { ...v, b: '9999999' }], [WRITE_MUTATION, { ...v, b: BOARDS.leads, extra2: 1 }], [WRITE_MUTATION, { ...v, i: '9001 OR 1' }], [WRITE_MUTATION, { ...v, c: 'bud"}' }],
    [WRITE_MUTATION, { ...v, v: 'a\nb' }], [WRITE_MUTATION, { ...v, v: 'x'.repeat(201) }], [WRITE_MUTATION, { ...v, v: 5 }], [WRITE_MUTATION, { ...v, extra: 1 }],
  ];
  for (const [q, vars] of bad) assert.throws(() => assertAllowedWrite(q, vars, BOARDS), /not on the allowed list/, q.slice(0, 50));
  // the Calendar board passes this guard only for viewing results (viewingResult.js decides the columns);
  // the generic /monday/write route has no Calendar action at all (see the refusals above: viewingStatus → 400)
  assert.doesNotThrow(() => assertAllowedWrite(WRITE_MUTATION, { ...v, b: BOARDS.calendar }, BOARDS));
  assert.ok(Object.values(ACTIONS).every((a) => a.board !== 'calendar'), 'no generic Calendar action');
  // the read path still refuses every mutation, including the write template
  assert.throws(() => assertReadOnly(WRITE_MUTATION), /only read queries/);
  // values per kind
  assert.throws(() => checkValue(ACTIONS.leadInquiry, { labels: ['SALE', 'RENT'] }, 'Maybe'), /not one of the board's labels/);
  assert.strictEqual(checkValue(ACTIONS.leadBudget, {}, '150000.50'), '150000.5');
});
