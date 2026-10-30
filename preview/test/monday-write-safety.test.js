'use strict';
// Regression tests for two Monday-write safety properties, against the local FAKE Monday API only:
// 1. a background board refresh that started before a successful write never brings the old value back;
// 2. Monday network/API errors during a write never put the token or the submitted value into responses, the
//    MondayWrite audit, the integration status or the server's console output. Fictional data only.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { start } = require('../server');
const { User, MondayWrite } = require('../src/models');
const { hashPassword } = require('../src/auth');
const { createMonday } = require('../src/integrations/monday');
const { createStatus } = require('../src/integrations/status');
const fx = require('./fixtures/fake-integrations');

const PW = 'correct-horse-battery', ARGV = ['node', 'server.js'];
const BOARDS = { leads: '1111111', listings: '2222222', calendar: '3333333' };
const TOKEN = 'mtok-SECRET-0123456789abcdef';

// fictional board setup for this file only: the real boards' column kinds
const L = fx.BOARDS['1111111'];
L.columns.find((c) => c.id === 'bud').type = 'numbers';
L.columns.push({ id: 'nat', title: 'Nationality', type: 'text', settings_str: '{}' });
L.items[0].v.bud = '200000';

// a proxy in front of the fake that can hold board-page replies (read from the fake at request time, answered later)
const fake = fx.createFakeServer();
let hold = false, holdMeta = ''; const held = [];
const proxy = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const r = await fetch(`http://127.0.0.1:${fake.address().port}${req.url}`, { method: req.method, headers: { 'content-type': 'application/json', authorization: req.headers.authorization || '' }, body });
    const buf = Buffer.from(await r.arrayBuffer());
    const send = () => { res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(buf); };
    const b = ((JSON.parse(body).variables || {}).b || [''])[0];
    if (hold && /items_page/.test(body)) held.push({ board: b, send });
    else if (holdMeta && b === holdMeta && /columns/.test(body)) { holdMeta = ''; held.push({ board: b, meta: true, send }); }   // a board read's first step
    else send();
  });
});
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await new Promise((r) => setTimeout(r, 20)); } };

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r)); await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
});
test.after(() => { fake.close(); proxy.close(); });

test('a background refresh that started before a write cannot bring back the old value (leads and listings)', async () => {
  let t = 1e12; const now = () => t;
  const m = createMonday({ token: 'mtest', apiUrl: `http://127.0.0.1:${proxy.address().port}/monday`, boards: { leads: BOARDS.leads, listings: BOARDS.listings, calendar: '' }, writes: true },
    createStatus(true, []), { now });
  const first = await m.loadAll(false);
  assert.strictEqual(first.listings.find((x) => x.id === '7001').availabilityLabel, 'Available');
  assert.strictEqual(first.leads.find((x) => x.id === '9001').inquiryLabel, 'Rent');

  // the copy is due: a background refresh starts and reads the boards (old values) but its answer is held back
  t += 6 * 60e3; hold = true;
  await m.loadAll(false);
  await until(() => held.some((h) => h.board === BOARDS.listings) && held.some((h) => h.board === BOARDS.leads));
  hold = false;

  // meanwhile: a successful write, then the one-item re-read the portal does after it
  await m.writeColumn({ board: 'listings', itemId: '7001', columnId: 'av', value: 'Remove' });
  await m.writeColumn({ board: 'leads', itemId: '9001', columnId: 'inq', value: 'Buy' });
  assert.strictEqual((await m.refreshItem('listings', '7001')).availabilityLabel, 'Remove');
  assert.strictEqual((await m.refreshItem('leads', '9001')).inquiryLabel, 'Buy');

  // the refresh that read before the write now finishes
  held.splice(0).forEach((h) => h.send());
  await until(() => !m.freshness().refreshing); await m.settled();
  const after = await m.loadAll(false);
  assert.ok(Date.parse(after.boards.listings.loadedAt) >= t, 'the refresh did finish and replace the copy');
  assert.strictEqual(after.listings.find((x) => x.id === '7001').availabilityLabel, 'Remove', 'listing keeps the value Monday has after the write');
  assert.strictEqual(after.leads.find((x) => x.id === '9001').inquiryLabel, 'Buy', 'lead keeps the value Monday has after the write');
  assert.strictEqual(after.listings.length, first.listings.length, 'no item added or lost');

  // the kept item is not kept forever: a later change made on Monday itself shows up on the next full read
  fx.BOARDS['2222222'].items.find((x) => x.id === '7001').v.av = 'Closed';
  t += 6 * 60e3; await m.loadAll(false); await m.settled();
  assert.strictEqual((await m.loadAll(false)).listings.find((x) => x.id === '7001').availabilityLabel, 'Closed');
});

test('the check read before a write leaves nothing behind that could bring back the old value', async () => {
  let t = 2e12; const now = () => t;
  const m = createMonday({ token: 'mtest', apiUrl: `http://127.0.0.1:${proxy.address().port}/monday`, boards: { leads: BOARDS.leads, listings: BOARDS.listings, calendar: '' }, writes: true },
    createStatus(true, []), { now });
  await m.loadAll(false);
  assert.strictEqual(m.cachedItem('listings', '7003').availabilityLabel, 'Available');
  // a background read of the Listings board starts; its item pages will be read only after the write below
  t += 6 * 60e3; holdMeta = BOARDS.listings;
  await m.loadAll(false);
  await until(() => held.some((h) => h.meta));
  // the portal's check read (as performWrite does it), then a successful write whose follow-up re-read never happens
  assert.strictEqual((await m.refreshItem('listings', '7003', { remember: false })).availabilityLabel, 'Available');
  assert.strictEqual(m.cachedItem('listings', '7003').availabilityLabel, 'Available', 'the check read changes nothing');
  await m.writeColumn({ board: 'listings', itemId: '7003', columnId: 'av', value: 'Remove' });
  held.splice(0).forEach((h) => h.send());
  await until(() => !m.freshness().refreshing); await m.settled();
  assert.strictEqual(m.cachedItem('listings', '7003').availabilityLabel, 'Remove', 'the board read (made after the write) wins over the check read');
});

// ---------- error redaction (HTTP, MongoDB audit, status, console) ----------
let mem, srv, base, ck;
const call = async (method, url, cookie, body) => {
  const res = await fetch(base + url, { method, headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, text: await res.text() };
};

test('Monday network and API errors during a write leak neither the token nor the submitted value', async (t) => {
  mem = await MongoMemoryServer.create();
  const mondayUrl = `http://127.0.0.1:${fake.address().port}/monday`;
  ({ server: srv } = await start({ APP_MODE: 'mongo', MONGODB_URI: mem.getUri('bh_mws'), PORT: '0', MONDAY_TOKEN: TOKEN, MONDAY_WRITES: 'on', MONDAY_WRITE_LIMIT: '60',
    MONDAY_LEADS_BOARD_ID: BOARDS.leads, MONDAY_LISTINGS_BOARD_ID: BOARDS.listings, MONDAY_CALENDAR_BOARD_ID: BOARDS.calendar, MONDAY_API_URL: mondayUrl }, ARGV));
  t.after(async () => { srv.close(); await mongoose.disconnect(); await mem.stop(); });
  base = `http://127.0.0.1:${srv.address().port}`;
  await User.create({ email: 'boss@example.com', name: 'Demo Manager', role: 'Manager', passwordHash: await hashPassword(PW) });
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'boss@example.com', password: PW }) });
  ck = login.headers.get('set-cookie').split(';')[0];
  assert.strictEqual((await call('GET', '/api/monday/bootstrap', ck)).status, 200);

  // Monday mutations fail in the worst way: the error text quotes the Authorization header and the request body
  const realFetch = global.fetch; let mode = '';
  global.fetch = async (url, opts) => {
    if (mode && String(url) === mondayUrl && /mutation/.test(String(opts && opts.body))) {
      const quoted = `Authorization: ${opts.headers.Authorization}; body: ${opts.body}`;
      if (mode === 'network') throw new TypeError(`fetch failed: ${quoted}`, { cause: Object.assign(new Error('socket hang up ' + quoted), { code: 'ECONNRESET' }) });
      return new Response(JSON.stringify({ errors: [{ message: `Invalid value: ${quoted}` }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, opts);
  };
  const logged = [], orig = {};
  for (const k of ['log', 'info', 'warn', 'error']) { orig[k] = console[k]; console[k] = (...a) => { logged.push(a.map(String).join(' ')); }; }
  try {
    const cases = [['network', 'leadNationality', 'Zanzibarian'], ['network', 'leadBudget', '987654'], ['api', 'leadNationality', 'Ruritanian'], ['api', 'leadBudget', '876543'],
      ['api', 'leadNationality', 'Q"uoted\\Land'], ['network', 'leadNationality', 'Q"uoted\\Isle']];   // also hidden in their JSON-escaped form
    for (const [m, action, value] of cases) {
      mode = m;
      const r = await call('POST', '/api/monday/write', ck, { action, itemId: '9001', value, confirm: true });
      mode = '';
      // a network error: uncertain, so Monday is read again (not saved: 502); an API refusal of the value: 409
      assert.strictEqual(r.status, m === 'api' ? 409 : 502, `${m} ${action}: reported as a failure — ${r.text}`);
      assert.match(JSON.parse(r.text).error, /Monday\.com/, 'says Monday failed');
      for (const [where, text] of [['response', r.text], ['status', (await call('GET', '/api/integrations/status', ck)).text],
        ['audit', JSON.stringify(await MondayWrite.find({ itemId: '9001' }).lean())], ['console', logged.join('\n')]]) {
        assert.ok(!text.includes(TOKEN), `${m} ${action}: no token in ${where}`);
        assert.ok(!text.includes(value) && !text.includes(JSON.stringify(value).slice(1, -1)), `${m} ${action}: no submitted value in ${where}`);
      }
    }
    const audits = await MondayWrite.find({ itemId: '9001' }).lean();
    assert.strictEqual(audits.length, cases.length); assert.ok(audits.every((a) => a.ok === false && a.error), 'each failure is audited as a failure');
    assert.ok(audits.some((a) => /ECONNRESET/.test(a.error)), 'a network failure keeps its (safe) error code');
  } finally {
    global.fetch = realFetch; Object.assign(console, orig);
  }
});
